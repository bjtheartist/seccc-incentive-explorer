import { normalizePin14 } from "./cook-viewer";
import { normalizeSiteMatchmakerAddress } from "./site-matchmaker-context";

export const PARCEL_RESOLUTION_SOURCE = "cook_county_current_parcels" as const;
export const PARCEL_RESOLUTION_METHOD = "exact_intersection" as const;

export type ParcelResolutionFailureReason =
  | "no_intersection"
  | "address_mismatch"
  | "invalid_location";

export type CandidateParcelResolution =
  | { status: "not_checked" }
  | { status: "resolving" }
  | {
      status: "resolved";
      pin: string;
      pinSource: "saved_snapshot" | "coordinate_exact";
      source: typeof PARCEL_RESOLUTION_SOURCE | "saved_shortlist_snapshot";
      matchMethod: typeof PARCEL_RESOLUTION_METHOD | "published_pin";
      checkedAt: string | null;
    }
  | { status: "no_match"; reason: "invalid_location"; checkedAt: null }
  | {
      status: "no_match";
      reason: "no_intersection" | "address_mismatch";
      checkedAt: string;
      source: typeof PARCEL_RESOLUTION_SOURCE;
      matchMethod: typeof PARCEL_RESOLUTION_METHOD;
    }
  | {
      status: "ambiguous";
      candidateCount: number;
      checkedAt: string;
      source: typeof PARCEL_RESOLUTION_SOURCE;
      matchMethod: typeof PARCEL_RESOLUTION_METHOD;
    }
  | { status: "unavailable" }
  | { status: "malformed" };

export interface ParcelResolutionCandidate {
  key: string;
  pin: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
}

export function isChicagoParcelCoordinate(
  lat: number | null | undefined,
  lon: number | null | undefined,
): boolean {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= 41.64 &&
    lat <= 42.03 &&
    lon >= -87.95 &&
    lon <= -87.50
  );
}

export function normalizedParcelStreetAddress(value: string | null | undefined): string {
  return normalizeSiteMatchmakerAddress(value)
    .replace(/\s+CHICAGO(?:\s+IL)?(?:\s+\d{5}(?:-\d{4})?)?$/, "")
    .trim();
}

export function parcelAddressesMatch(
  requested: string | null | undefined,
  resolved: string | null | undefined,
): boolean {
  const left = normalizedParcelStreetAddress(requested);
  const right = normalizedParcelStreetAddress(resolved);
  return left.length >= 6 && right.length >= 6 && left === right;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validCheckedAt(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

/** Allowlist and validate the dedicated resolver response. Unknown fields are discarded. */
export function parseCandidateParcelResolution(value: unknown): CandidateParcelResolution | null {
  if (!isRecord(value) || typeof value.status !== "string") return null;

  if (value.status === "resolved") {
    if (typeof value.pin !== "string") return null;
    const pin = normalizePin14(value.pin);
    if (!pin) return null;
    if (value.source !== PARCEL_RESOLUTION_SOURCE) return null;
    if (value.matchMethod !== PARCEL_RESOLUTION_METHOD) return null;
    if (!validCheckedAt(value.checkedAt)) return null;
    return {
      status: "resolved",
      pin,
      pinSource: "coordinate_exact",
      source: PARCEL_RESOLUTION_SOURCE,
      matchMethod: PARCEL_RESOLUTION_METHOD,
      checkedAt: value.checkedAt,
    };
  }

  if (value.status === "no_match") {
    if (
      value.reason !== "no_intersection" &&
      value.reason !== "address_mismatch" &&
      value.reason !== "invalid_location"
    ) return null;
    if (value.reason === "invalid_location") {
      return value.checkedAt === null
        ? { status: "no_match", reason: "invalid_location", checkedAt: null }
        : null;
    }
    if (!validCheckedAt(value.checkedAt)) return null;
    if (value.source !== PARCEL_RESOLUTION_SOURCE) return null;
    if (value.matchMethod !== PARCEL_RESOLUTION_METHOD) return null;
    return {
      status: "no_match",
      reason: value.reason,
      checkedAt: value.checkedAt,
      source: PARCEL_RESOLUTION_SOURCE,
      matchMethod: PARCEL_RESOLUTION_METHOD,
    };
  }

  if (value.status === "ambiguous") {
    if (!Number.isInteger(value.candidateCount) || Number(value.candidateCount) < 2) return null;
    if (!validCheckedAt(value.checkedAt)) return null;
    if (value.source !== PARCEL_RESOLUTION_SOURCE) return null;
    if (value.matchMethod !== PARCEL_RESOLUTION_METHOD) return null;
    return {
      status: "ambiguous",
      candidateCount: Number(value.candidateCount),
      checkedAt: value.checkedAt,
      source: PARCEL_RESOLUTION_SOURCE,
      matchMethod: PARCEL_RESOLUTION_METHOD,
    };
  }

  if (value.status === "unavailable") return { status: "unavailable" };
  if (value.status === "malformed") return { status: "malformed" };
  return null;
}
