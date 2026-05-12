import type { SurveyAnswers } from "./types";
import type { WizardState, ReportType } from "./report-wizard-config";
import { INITIAL_WIZARD_STATE } from "./report-wizard-config";

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
    address: params.get("addr") || "",
  };

  const sector = params.get("sector");
  if (sector) state.sector = sector;

  const sa = params.get("sa");
  if (sa) {
    try {
      state.surveyAnswers = JSON.parse(atob(sa));
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
  // Legacy
  "location-incentives": "li",
  "best-location": "bl",
  "program-explorer": "pe",
  "developer-analysis": "da",
};

const SHORT_TO_REPORT_TYPE: Record<string, ReportType> = {
  si: "site-incentives",
  df: "dev-feasibility",
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
  if (state.projectType) params.set("pt", state.projectType);
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

  const rt = params.get("rt");
  if (rt) state.reportType = SHORT_TO_REPORT_TYPE[rt] || (rt as ReportType);

  const addr = params.get("addr");
  if (addr) state.address = addr;

  const lat = params.get("lat");
  const lon = params.get("lon");
  if (lat) state.lat = parseFloat(lat);
  if (lon) state.lon = parseFloat(lon);

  const nbh = params.get("nbh");
  if (nbh) state.neighborhood = nbh;

  const ind = params.get("ind");
  if (ind) state.industry = ind;

  const bud = params.get("bud");
  if (bud) state.budgetRange = bud;

  const pt = params.get("pt");
  if (pt) state.projectType = pt;

  const pu = params.get("pu");
  if (pu) state.proposedUse = pu;

  const fc = params.get("fc");
  if (fc) state.fundingCommitted = fc;

  const gap = params.get("gap");
  if (gap) state.remainingGap = gap;

  const tl = params.get("tl");
  if (tl) state.timeline = tl;

  const sc = params.get("sc");
  if (sc) state.siteControl = sc;

  const jobs = params.get("jobs");
  if (jobs) state.jobsImpact = jobs;

  // Decode array fields
  function decodeArray(key: string): string[] {
    const val = params.get(key);
    if (!val) return [];
    try { return JSON.parse(atob(val)); } catch { return []; }
  }

  state.creditsToAnalyze = decodeArray("cta");
  state.documentsAvailable = decodeArray("docs");
  state.supportNeeded = decodeArray("need");

  // Comparison address
  const caddr = params.get("caddr");
  if (caddr) state.compareAddress = caddr;
  const clat = params.get("clat");
  const clon = params.get("clon");
  if (clat) state.compareLat = parseFloat(clat);
  if (clon) state.compareLon = parseFloat(clon);

  return state;
}
