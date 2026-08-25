import { normalizePermitAddress } from "./permit-match";

export const CENSUS_BATCH_ENDPOINT =
  "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
export const CENSUS_BENCHMARK = "Public_AR_Current";
export const PERMIT_GEOCODE_STRATEGY_VERSION = "city-reuse-then-census-v1";
export const INTERNAL_POINT_MAX_SPREAD_M = 25;

export const CHICAGO_GEOCODE_BOUNDS = {
  latMin: 41.6,
  latMax: 42.1,
  lonMin: -88.0,
  lonMax: -87.4,
} as const;

export type PermitGeocodeResolutionSource =
  | "city_permit_address_reuse"
  | "city_permit_pin_reuse"
  | "census_geocoder";

export type PermitGeocodeResultStatus =
  | "accepted"
  | "unmatched"
  | "review_required"
  | "provider_error";

export interface PermitBackfillCandidate {
  permitId: string;
  address: string;
  addressKey: string;
  addressCandidateLat: number | null;
  addressCandidateLon: number | null;
  addressCandidatePoints: number;
  addressCandidateRows: number;
  addressMaxSpreadM: number | null;
  pinCandidateLat: number | null;
  pinCandidateLon: number | null;
  pinCandidatePoints: number;
  pinCandidateRows: number;
  pinMaxSpreadM: number | null;
}

export interface InternalPermitGeocodeResolution {
  source: Exclude<PermitGeocodeResolutionSource, "census_geocoder">;
  matchType: "exact_address_cluster" | "exact_pin_cluster";
  lat: number;
  lon: number;
  maxSpreadM: number;
  candidatePoints: number;
  candidateRows: number;
}

export interface CensusBatchRequest {
  id: string;
  address: string;
  addressKey: string;
}

export interface CensusBatchResult {
  id: string;
  inputAddress: string;
  matchIndicator: string;
  matchType: string;
  matchedAddress: string | null;
  lon: number | null;
  lat: number | null;
  tigerLineId: string | null;
  tigerLineSide: string | null;
  rawFields: string[];
}

export interface EvaluatedCensusResult {
  status: PermitGeocodeResultStatus;
  reason:
    | "exact_match"
    | "no_match"
    | "non_exact_match"
    | "invalid_coordinates"
    | "outside_chicago"
    | "missing_response";
  lat: number | null;
  lon: number | null;
}

function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function insideChicago(lat: number, lon: number): boolean {
  return (
    lat >= CHICAGO_GEOCODE_BOUNDS.latMin &&
    lat <= CHICAGO_GEOCODE_BOUNDS.latMax &&
    lon >= CHICAGO_GEOCODE_BOUNDS.lonMin &&
    lon <= CHICAGO_GEOCODE_BOUNDS.lonMax
  );
}

/**
 * Reuse only coordinates the City already published for the same exact
 * normalized address or PIN, and only when every source point stays inside a
 * single 25 m cluster. A disagreement is review material, not an average.
 */
export function selectInternalPermitGeocode(
  candidate: PermitBackfillCandidate,
): InternalPermitGeocodeResolution | null {
  const addressLat = finite(candidate.addressCandidateLat);
  const addressLon = finite(candidate.addressCandidateLon);
  const addressSpread = finite(candidate.addressMaxSpreadM);
  if (
    addressLat != null &&
    addressLon != null &&
    addressSpread != null &&
    addressSpread <= INTERNAL_POINT_MAX_SPREAD_M &&
    insideChicago(addressLat, addressLon)
  ) {
    return {
      source: "city_permit_address_reuse",
      matchType: "exact_address_cluster",
      lat: addressLat,
      lon: addressLon,
      maxSpreadM: addressSpread,
      candidatePoints: candidate.addressCandidatePoints,
      candidateRows: candidate.addressCandidateRows,
    };
  }

  const pinLat = finite(candidate.pinCandidateLat);
  const pinLon = finite(candidate.pinCandidateLon);
  const pinSpread = finite(candidate.pinMaxSpreadM);
  if (
    pinLat != null &&
    pinLon != null &&
    pinSpread != null &&
    pinSpread <= INTERNAL_POINT_MAX_SPREAD_M &&
    insideChicago(pinLat, pinLon)
  ) {
    return {
      source: "city_permit_pin_reuse",
      matchType: "exact_pin_cluster",
      lat: pinLat,
      lon: pinLon,
      maxSpreadM: pinSpread,
      candidatePoints: candidate.pinCandidatePoints,
      candidateRows: candidate.pinCandidateRows,
    };
  }

  return null;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function encodeCsvRow(values: readonly string[]): string {
  return values.map(csvField).join(",");
}

/** Small RFC 4180 parser for the Census service's headerless CSV response. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("Census CSV response ended inside a quoted field");
  row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

/** Census batch input grain: one row per unique normalized Chicago address. */
export function buildCensusBatchCsv(requests: readonly CensusBatchRequest[]): string {
  return `${requests
    .map((request) => encodeCsvRow([request.id, request.address, "Chicago", "IL", ""]))
    .join("\n")}\n`;
}

export function parseCensusBatchResponse(text: string): Map<string, CensusBatchResult> {
  const parsed = new Map<string, CensusBatchResult>();

  for (const fields of parseCsv(text)) {
    const id = fields[0]?.trim();
    if (!id) throw new Error("Census batch response included a row without an id");
    if (parsed.has(id)) throw new Error(`Census batch response repeated id ${id}`);

    const coordinateParts = fields[5]?.split(",").map((value) => value.trim()) ?? [];
    const lon = finite(coordinateParts[0]);
    const lat = finite(coordinateParts[1]);
    parsed.set(id, {
      id,
      inputAddress: fields[1] ?? "",
      matchIndicator: fields[2]?.trim() ?? "",
      matchType: fields[3]?.trim() ?? "",
      matchedAddress: fields[4]?.trim() || null,
      lon,
      lat,
      tigerLineId: fields[6]?.trim() || null,
      tigerLineSide: fields[7]?.trim() || null,
      rawFields: fields,
    });
  }

  return parsed;
}

export function evaluateCensusResult(
  result: CensusBatchResult | undefined,
): EvaluatedCensusResult {
  if (!result) {
    return { status: "provider_error", reason: "missing_response", lat: null, lon: null };
  }
  if (result.matchIndicator.toLowerCase() !== "match") {
    return { status: "unmatched", reason: "no_match", lat: null, lon: null };
  }
  if (result.matchType.toLowerCase() !== "exact") {
    return {
      status: "review_required",
      reason: "non_exact_match",
      lat: result.lat,
      lon: result.lon,
    };
  }
  if (result.lat == null || result.lon == null) {
    return {
      status: "review_required",
      reason: "invalid_coordinates",
      lat: null,
      lon: null,
    };
  }
  if (!insideChicago(result.lat, result.lon)) {
    return {
      status: "review_required",
      reason: "outside_chicago",
      lat: result.lat,
      lon: result.lon,
    };
  }
  return {
    status: "accepted",
    reason: "exact_match",
    lat: result.lat,
    lon: result.lon,
  };
}

export function uniqueCensusRequests(
  candidates: readonly PermitBackfillCandidate[],
): CensusBatchRequest[] {
  const byAddress = new Map<string, string>();
  for (const candidate of candidates) {
    const addressKey = candidate.addressKey || normalizePermitAddress(candidate.address);
    if (addressKey && !byAddress.has(addressKey)) byAddress.set(addressKey, candidate.address);
  }
  return Array.from(byAddress, ([addressKey, address], index) => ({
    id: `address-${String(index + 1).padStart(5, "0")}`,
    address,
    addressKey,
  }));
}
