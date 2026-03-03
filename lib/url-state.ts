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
 * Human-readable lat/lon/addr, with optional survey answers as base64.
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
 * Returns null if required params are missing.
 */
export function decodeCheckState(
  params: URLSearchParams
): CheckState | null {
  // Version check — default to "1" for URLs created before versioning
  const _version = params.get("v") || "1";
  // Future: switch on _version for backward-compatible decode changes

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
  "location-incentives": "li",
  "best-location": "bl",
  "program-explorer": "pe",
  "developer-analysis": "da",
};

const SHORT_TO_REPORT_TYPE: Record<string, ReportType> = {
  li: "location-incentives",
  bl: "best-location",
  pe: "program-explorer",
  da: "developer-analysis",
};

/**
 * Encode wizard state as URL search params for shareable report links.
 * Uses compact keys to keep URLs manageable.
 */
export function encodeWizardState(state: WizardState): string {
  const params = new URLSearchParams();
  params.set("wv", "1"); // wizard version

  if (state.reportType) {
    params.set("rt", REPORT_TYPE_SHORT[state.reportType] || state.reportType);
  }
  if (state.address) params.set("addr", state.address);
  if (state.lat != null) params.set("lat", state.lat.toFixed(5));
  if (state.lon != null) params.set("lon", state.lon.toFixed(5));
  if (state.industry) params.set("ind", state.industry);
  if (state.budgetRange) params.set("bud", state.budgetRange);
  if (state.projectType) params.set("pt", state.projectType);

  // Array fields: base64-encode as JSON
  if (state.activities.length > 0) params.set("act", btoa(JSON.stringify(state.activities)));
  if (state.incentiveInterests.length > 0) params.set("ii", btoa(JSON.stringify(state.incentiveInterests)));
  if (state.locationPriorities.length > 0) params.set("lp", btoa(JSON.stringify(state.locationPriorities)));
  if (state.governmentLevels.length > 0) params.set("gl", btoa(JSON.stringify(state.governmentLevels)));
  if (state.benefitTypes.length > 0) params.set("bt", btoa(JSON.stringify(state.benefitTypes)));
  if (state.creditsToAnalyze.length > 0) params.set("cta", btoa(JSON.stringify(state.creditsToAnalyze)));

  // Comparison address
  if (state.compareAddress) params.set("caddr", state.compareAddress);
  if (state.compareLat != null) params.set("clat", state.compareLat.toFixed(5));
  if (state.compareLon != null) params.set("clon", state.compareLon.toFixed(5));

  return params.toString();
}

/**
 * Decode wizard state from URL search params.
 * Returns null if no wizard params are present.
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

  const ind = params.get("ind");
  if (ind) state.industry = ind;

  const bud = params.get("bud");
  if (bud) state.budgetRange = bud;

  const pt = params.get("pt");
  if (pt) state.projectType = pt;

  // Decode array fields
  function decodeArray(key: string): string[] {
    const val = params.get(key);
    if (!val) return [];
    try { return JSON.parse(atob(val)); } catch { return []; }
  }

  state.activities = decodeArray("act");
  state.incentiveInterests = decodeArray("ii");
  state.locationPriorities = decodeArray("lp");
  state.governmentLevels = decodeArray("gl");
  state.benefitTypes = decodeArray("bt");
  state.creditsToAnalyze = decodeArray("cta");

  // Comparison address
  const caddr = params.get("caddr");
  if (caddr) state.compareAddress = caddr;
  const clat = params.get("clat");
  const clon = params.get("clon");
  if (clat) state.compareLat = parseFloat(clat);
  if (clon) state.compareLon = parseFloat(clon);

  return state;
}
