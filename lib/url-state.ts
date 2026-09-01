import type { SurveyAnswers } from "./types";
import { SurveyAnswersSchema } from "./schemas";
import type { WizardState, ReportType } from "./report-wizard-config";
import {
  INITIAL_WIZARD_STATE,
  MAX_PROJECT_GOALS,
  PROJECT_TYPE_LABELS,
  selectedProjectGoals,
} from "./report-wizard-config";

// Share-link params are attacker-writable, so goal ids decoded from `pg`/`pt`
// must be checked against the ids the wizard can actually produce (site +
// vacancy option lists) before they enter wizard state — otherwise arbitrary
// strings ride the gate's uncapped pass-through budget into the engine
// (finding NEW-R4-3). `hasOwnProperty.call` rather than `in`, so prototype
// keys ("constructor", "__proto__") don't count as known ids.
function isKnownGoalId(goalId: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROJECT_TYPE_LABELS, goalId);
}

/**
 * Length ceiling for every free-text share-link param (R2 finding 6).
 *
 * Goal ids were fixed against an allow-list and `cg` (custom goal) was capped
 * at 240 — but the ELEVEN other free-string params beside them (`nbh`, `ind`,
 * `bud`, `pu`, `fc`, `gap`, `tl`, `sc`, `jobs`, `addr`, `caddr`) were copied
 * into wizard state raw, at whatever length the URL carried. Every one of them
 * is attacker-writable, and they flow into the report engine, into rendered
 * report copy, and into saved-report jsonb. 240 matches the cap `cg` already
 * had — comfortably above any real value (the longest genuine neighborhood or
 * address string is well under 100 characters) and far below a payload worth
 * sending.
 */
const MAX_SHARE_PARAM_LENGTH = 240;

/**
 * Read a free-text param and cap it. Returns "" for a missing param so callers
 * keep the existing `if (value)` truthiness checks.
 */
function cappedParam(params: URLSearchParams, key: string): string {
  return (params.get(key) ?? "").slice(0, MAX_SHARE_PARAM_LENGTH);
}

/**
 * Count ceiling for the base64-JSON array params (`cta`, `docs`, `need`).
 *
 * `decodeArray` filtered its output to strings and then returned however many
 * of them the link contained. The largest real option list behind these params
 * has 13 entries (DOCUMENT_READINESS_OPTIONS); 32 leaves generous headroom for
 * the lists to grow while keeping a hand-written link from pushing thousands
 * of entries into wizard state and, from there, into the engine and the saved
 * report. Item length is capped for the same reason the scalar params are.
 */
const MAX_DECODED_ARRAY_ITEMS = 32;
const MAX_DECODED_ARRAY_ITEM_LENGTH = 120;

/**
 * Ceiling on the ENCODED length of a base64 param before it is decoded, so a
 * multi-megabyte `sa=`/`docs=` string is rejected without ever being expanded
 * in memory.
 */
const MAX_ENCODED_PARAM_LENGTH = 4096;

export interface CheckState {
  lat: number;
  lon: number;
  address: string;
  sector?: string;
  surveyAnswers?: SurveyAnswers;
}

const CURRENT_VERSION = "1";

/**
 * Encode check state as URL search params.
 */
export function encodeCheckState(state: CheckState): string {
  const params = new URLSearchParams();
  params.set("v", CURRENT_VERSION);
  params.set("lat", state.lat.toFixed(5));
  params.set("lon", state.lon.toFixed(5));
  if (state.address) params.set("addr", state.address);
  if (state.sector) params.set("sector", state.sector);

  if (state.surveyAnswers) {
    const json = JSON.stringify(state.surveyAnswers);
    params.set("sa", btoa(json));
  }

  return params.toString();
}

/**
 * Decode check state from URL search params.
 */
export function decodeCheckState(
  params: URLSearchParams
): CheckState | null {
  const lat = params.get("lat");
  const lon = params.get("lon");

  if (!lat || !lon) return null;

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);

  if (isNaN(latNum) || isNaN(lonNum)) return null;

  const state: CheckState = {
    lat: latNum,
    lon: lonNum,
    // `addr` is the short form encodeCheckState emits and every existing deep
    // link carries; `address` is the readable spelling /check links are written
    // with. Accept both so neither shape drops the label.
    address: cappedParam(params, "addr") || cappedParam(params, "address"),
  };

  const sector = cappedParam(params, "sector");
  if (sector) state.sector = sector;

  // `sa=` is attacker-writable base64 JSON that used to be JSON.parse'd
  // straight into `state.surveyAnswers` — any shape at all, including a
  // multi-megabyte object, typed as `SurveyAnswers` on the way out.
  // SurveyAnswersSchema already existed in lib/schemas.ts and simply was not
  // wired in here. The param is NOT dead (components/check/QuickCheckClient
  // decodes it, and lib/check-retirement.ts forwards it on the /check ->
  // /report redirect), so it is validated rather than removed. Note this only
  // makes the decode honest: per CLAUDE.md the confidence engine's `survey`
  // parameter stays `undefined` at every live call site pending an owner
  // ruling, and nothing here changes that.
  const sa = params.get("sa");
  if (sa && sa.length <= MAX_ENCODED_PARAM_LENGTH) {
    try {
      const parsed = SurveyAnswersSchema.safeParse(JSON.parse(atob(sa)));
      if (parsed.success) state.surveyAnswers = parsed.data;
    } catch {
      // Ignore invalid survey answers
    }
  }

  return state;
}

// ─── Wizard State URL Encoding ──────────────────────────────────────

const REPORT_TYPE_SHORT: Record<string, string> = {
  "site-incentives": "si",
  "dev-feasibility": "df",
  "corridor-intelligence": "ci",
  // Legacy
  "location-incentives": "li",
  "best-location": "bl",
  "program-explorer": "pe",
  "developer-analysis": "da",
};

const SHORT_TO_REPORT_TYPE: Record<string, ReportType> = {
  si: "site-incentives",
  df: "dev-feasibility",
  ci: "corridor-intelligence",
  // Legacy shortcuts map to new types
  li: "site-incentives",
  bl: "dev-feasibility",
  pe: "site-incentives",
  da: "dev-feasibility",
};

/**
 * Encode wizard state as URL search params for shareable report links.
 */
export function encodeWizardState(state: WizardState): string {
  const params = new URLSearchParams();
  params.set("wv", "2"); // wizard version 2

  if (state.reportType) {
    params.set("rt", REPORT_TYPE_SHORT[state.reportType] || state.reportType);
  }
  if (state.address) params.set("addr", state.address);
  if (state.lat != null) params.set("lat", state.lat.toFixed(5));
  if (state.lon != null) params.set("lon", state.lon.toFixed(5));
  if (state.neighborhood) params.set("nbh", state.neighborhood);
  if (state.industry) params.set("ind", state.industry);
  if (state.budgetRange) params.set("bud", state.budgetRange);
  const projectGoals = selectedProjectGoals(state);
  const primaryProjectType = projectGoals[0] || state.projectType;
  if (primaryProjectType) params.set("pt", primaryProjectType);
  if (projectGoals.length > 0) params.set("pg", btoa(JSON.stringify(projectGoals)));
  // `customGoal` post-dates the reports already sitting in `saved_reports`, and
  // those are re-hydrated with a raw cast over persisted JSON — the field is
  // genuinely absent at runtime despite the type. An unguarded `.trim()` here
  // threw inside the Share click handler, so the button silently did nothing.
  const customGoal = state.customGoal?.trim();
  if (customGoal) params.set("cg", customGoal);
  if (state.proposedUse) params.set("pu", state.proposedUse);
  if (state.fundingCommitted) params.set("fc", state.fundingCommitted);
  if (state.remainingGap) params.set("gap", state.remainingGap);
  if (state.timeline) params.set("tl", state.timeline);
  if (state.siteControl) params.set("sc", state.siteControl);
  if (state.jobsImpact) params.set("jobs", state.jobsImpact);

  if (state.creditsToAnalyze.length > 0) params.set("cta", btoa(JSON.stringify(state.creditsToAnalyze)));
  if (state.documentsAvailable.length > 0) params.set("docs", btoa(JSON.stringify(state.documentsAvailable)));
  if (state.supportNeeded.length > 0) params.set("need", btoa(JSON.stringify(state.supportNeeded)));

  // Comparison address
  if (state.compareAddress) params.set("caddr", state.compareAddress);
  if (state.compareLat != null) params.set("clat", state.compareLat.toFixed(5));
  if (state.compareLon != null) params.set("clon", state.compareLon.toFixed(5));

  return params.toString();
}

/**
 * Decode wizard state from URL search params.
 * Handles both v1 (legacy 4-type) and v2 (new 2-type) URLs.
 */
export function decodeWizardState(params: URLSearchParams): WizardState | null {
  const version = params.get("wv");
  if (!version) return null;

  const state: WizardState = { ...INITIAL_WIZARD_STATE };

  // Accept short codes and full report-type names (current or legacy), but
  // never cast an unrecognized string into `reportType` — an unknown value
  // leaves it null so the wizard re-asks instead of rendering a junk type.
  const rt = params.get("rt");
  if (rt) {
    const mapped: ReportType | undefined =
      SHORT_TO_REPORT_TYPE[rt] || SHORT_TO_REPORT_TYPE[REPORT_TYPE_SHORT[rt]];
    if (mapped) state.reportType = mapped;
  }

  const addr = cappedParam(params, "addr");
  if (addr) state.address = addr;

  const lat = params.get("lat");
  const lon = params.get("lon");
  if (lat) state.lat = parseFloat(lat);
  if (lon) state.lon = parseFloat(lon);

  const nbh = cappedParam(params, "nbh");
  if (nbh) state.neighborhood = nbh;

  const ind = cappedParam(params, "ind");
  if (ind) state.industry = ind;

  const bud = cappedParam(params, "bud");
  if (bud) state.budgetRange = bud;

  // `pt` is a goal id too (legacy single-goal links, and the fallback into
  // `projectGoals` below) — an unknown id here would flow into the engine the
  // same way a junk `pg` entry would, so it gets the same validation.
  const pt = params.get("pt");
  if (pt && isKnownGoalId(pt)) state.projectType = pt;

  const customGoal = cappedParam(params, "cg");
  if (customGoal) state.customGoal = customGoal;

  const pu = cappedParam(params, "pu");
  if (pu) state.proposedUse = pu;

  const fc = cappedParam(params, "fc");
  if (fc) state.fundingCommitted = fc;

  const gap = cappedParam(params, "gap");
  if (gap) state.remainingGap = gap;

  const tl = cappedParam(params, "tl");
  if (tl) state.timeline = tl;

  const sc = cappedParam(params, "sc");
  if (sc) state.siteControl = sc;

  const jobs = cappedParam(params, "jobs");
  if (jobs) state.jobsImpact = jobs;

  // Decode array fields. Bounded three ways: the encoded param is rejected
  // outright above a fixed size (so a huge string is never expanded), the
  // decoded list is truncated to MAX_DECODED_ARRAY_ITEMS, and each surviving
  // entry is capped in length. Previously this returned every string the link
  // contained, at any length.
  function decodeArray(key: string): string[] {
    const val = params.get(key);
    if (!val || val.length > MAX_ENCODED_PARAM_LENGTH) return [];
    try {
      const parsed: unknown = JSON.parse(atob(val));
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is string => typeof item === "string")
        .slice(0, MAX_DECODED_ARRAY_ITEMS)
        .map((item) => item.slice(0, MAX_DECODED_ARRAY_ITEM_LENGTH));
    } catch {
      return [];
    }
  }

  state.creditsToAnalyze = decodeArray("cta");
  state.documentsAvailable = decodeArray("docs");
  state.supportNeeded = decodeArray("need");
  state.projectGoals = Array.from(
    new Set(decodeArray("pg").filter((goal) => Boolean(goal) && isKnownGoalId(goal)))
  ).slice(0, MAX_PROJECT_GOALS);
  if (state.projectGoals.length === 0 && state.projectType) {
    state.projectGoals = [state.projectType];
  }
  if (state.projectGoals.length > 0) {
    state.projectType = state.projectGoals[0];
  }

  // Comparison address
  const caddr = cappedParam(params, "caddr");
  if (caddr) state.compareAddress = caddr;
  const clat = params.get("clat");
  const clon = params.get("clon");
  if (clat) state.compareLat = parseFloat(clat);
  if (clon) state.compareLon = parseFloat(clon);

  return state;
}
