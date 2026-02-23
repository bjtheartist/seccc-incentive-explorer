import type { SurveyAnswers } from "./types";

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
