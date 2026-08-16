import { normalizePin14 } from "./cook-viewer";
import { normalizeSiteMatchmakerAddress } from "./site-matchmaker-context";
import type { ShortlistPinProvenance } from "./site-shortlist";

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
  /** WHERE `pin` came from. Absent means the saved shortlist snapshot
   *  published it — see `resolvedParcelIdentityFromCandidate`. */
  pinProvenance?: ShortlistPinProvenance;
}

export type ResolvedCandidateParcelResolution = Extract<
  CandidateParcelResolution,
  { status: "resolved" }
>;

/**
 * The ONE place a known PIN is turned into a resolved resolution, so every
 * surface (the resolution client's cache/short-circuit, the dossier's
 * starting state, the card label) tells the same story about where it came
 * from.
 *
 * A PIN the universe row published is `saved_snapshot` / `published_pin`
 * with no `checkedAt`. A PIN the committed sidecar resolved offline by exact
 * map-point intersection is reported exactly like a LIVE coordinate match —
 * `coordinate_exact` / `cook_county_current_parcels` / `exact_intersection`,
 * carrying the offline `checkedAt` — because that is literally what it is.
 * Calling it "published in the saved snapshot" would be a false provenance
 * claim; calling it a saved snapshot's PIN would also hide the check date.
 *
 * Returns null when there is no usable 14-digit PIN at all.
 */
export function resolvedParcelIdentityFromCandidate(
  candidate: ParcelResolutionCandidate,
): ResolvedCandidateParcelResolution | null {
  const pin = normalizePin14(candidate.pin);
  if (!pin) return null;
  if (candidate.pinProvenance?.source === "coordinate_exact_precomputed") {
    return {
      status: "resolved",
      pin,
      pinSource: "coordinate_exact",
      source: PARCEL_RESOLUTION_SOURCE,
      matchMethod: PARCEL_RESOLUTION_METHOD,
      checkedAt: candidate.pinProvenance.checkedAt,
    };
  }
  return {
    status: "resolved",
    pin,
    pinSource: "saved_snapshot",
    source: "saved_shortlist_snapshot",
    matchMethod: "published_pin",
    checkedAt: null,
  };
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

/**
 * Street-suffix synonyms. Candidate records frequently omit the suffix
 * ("9410 S CHAMPLAIN") while the County publishes it ("9410 S CHAMPLAIN AVE").
 * The house number, direction, and street name still have to be identical.
 */
const STREET_SUFFIX_CANONICAL: Record<string, string> = {
  AVE: "AVE",
  AVENUE: "AVE",
  AV: "AVE",
  ST: "ST",
  STREET: "ST",
  BLVD: "BLVD",
  BOULEVARD: "BLVD",
  RD: "RD",
  ROAD: "RD",
  DR: "DR",
  DRIVE: "DR",
  PL: "PL",
  PLACE: "PL",
  CT: "CT",
  COURT: "CT",
  PKWY: "PKWY",
  PARKWAY: "PKWY",
  LN: "LN",
  LANE: "LN",
  TER: "TER",
  TERR: "TER",
  TERRACE: "TER",
  HWY: "HWY",
  HIGHWAY: "HWY",
  CIR: "CIR",
  CIRCLE: "CIR",
  SQ: "SQ",
  SQUARE: "SQ",
  WAY: "WAY",
  TRL: "TRL",
  TRAIL: "TRL",
  EXPY: "EXPY",
  EXPRESSWAY: "EXPY",
};

const DIRECTION_CANONICAL: Record<string, string> = {
  N: "N",
  NORTH: "N",
  S: "S",
  SOUTH: "S",
  E: "E",
  EAST: "E",
  W: "W",
  WEST: "W",
};
const DIRECTIONS = new Set(Object.keys(DIRECTION_CANONICAL));

function hasStreetSuffixToken(tokens: string[]): boolean {
  return tokens.some((token, index) => index >= 2 && Boolean(STREET_SUFFIX_CANONICAL[token]));
}

export function normalizedParcelStreetAddress(value: string | null | undefined): string {
  // Strip a trailing city/state/ZIP block ("CHICAGO IL 60623", "CHICAGO 60623 1234").
  const stripped = normalizeSiteMatchmakerAddress(value)
    .replace(/\s+CHICAGO(?:\s+IL)?\s+\d{5}(?:\s+\d{4})?$/, "")
    .replace(/\s+CHICAGO\s+IL$/, "")
    .trim();
  // A bare trailing "CHICAGO" is the city only when a street suffix already
  // appeared ("6333 S GREEN ST CHICAGO"); otherwise it is the street name on
  // W/E Chicago Ave when a candidate record omits the suffix ("5936 W CHICAGO").
  const tokens = stripped.split(" ").filter(Boolean);
  if (tokens.length >= 4 && tokens[tokens.length - 1] === "CHICAGO" && hasStreetSuffixToken(tokens.slice(0, -1))) {
    return tokens.slice(0, -1).join(" ");
  }
  return stripped;
}

const UNIT_LABELS = new Set(["UNIT", "APT", "STE", "SUITE", "FL", "FLOOR", "NO", "NUM", "BLDG"]);

/**
 * A single unlabeled trailing token counts as a unit designator only when it
 * carries a digit and is short: "2", "2FL", "3B", "101", "B2". A five-digit
 * token is a ZIP, not a unit. Alphabetic tokens ("EAST", "WEST", "NORTH") are
 * never units — they belong to the street name (S Stony Island Ave East).
 */
const UNLABELED_UNIT = /^(?:\d{1,4}[A-Z]{0,2}|[A-Z]{1,2}\d{1,4})$/;
const LABELED_UNIT = /^[A-Z0-9]{1,6}$/;

interface ParcelAddressParts {
  /** House number, optional direction, and street name — must match exactly. */
  core: string;
  /** Canonical street suffix, when published. */
  suffix: string | null;
  /** Trailing unit designator (e.g. "2", "3B"), when published. */
  unit: string | null;
}

function canonicalUnit(value: string): string {
  // "2FL" and "FL 2" both mean the second floor.
  return value.replace(/^(\d{1,4})FL$/, "$1");
}

/** Interpret the tokens after the street name as a unit designator, or "not_unit" if they are not one. */
function trailingUnit(rest: string[]): string | null | "not_unit" {
  if (rest.length === 0) return null;
  if (UNIT_LABELS.has(rest[0])) {
    if (rest.length === 2 && LABELED_UNIT.test(rest[1])) return canonicalUnit(rest[1]);
    return "not_unit";
  }
  if (rest.length === 1 && UNLABELED_UNIT.test(rest[0])) return canonicalUnit(rest[0]);
  return "not_unit";
}

/**
 * Split a normalized street address into number+direction+street, an optional
 * canonical suffix, and an optional trailing unit designator. County parcel
 * records often publish "4320 W CERMAK RD 2" for the single lot at 4320 W Cermak.
 *
 * The LAST suffix-looking token is the split point (so "S DR MARTIN LUTHER KING
 * JR DR" keeps its embedded "DR"). Only ONE short digit-bearing token (or a
 * labeled token like "UNIT 2") after the suffix is treated as a unit; anything
 * else means the suffix-looking token is part of the street name and the whole
 * string is the core. "<direction> AVENUE <letter>" streets (S Avenue L, S Ave O)
 * are kept intact as canonical street names.
 */
export function parcelAddressParts(value: string | null | undefined): ParcelAddressParts {
  const tokens = normalizedParcelStreetAddress(value).split(" ").filter(Boolean);
  // Canonicalize the leading direction only ("70 EAST LAKE ST" ≡ "70 E LAKE ST");
  // later direction words are street-name parts (S SOUTH CHICAGO AVE, E END AVE).
  if (tokens.length >= 2 && DIRECTION_CANONICAL[tokens[1]]) tokens[1] = DIRECTION_CANONICAL[tokens[1]];
  const whole: ParcelAddressParts = { core: tokens.join(" "), suffix: null, unit: null };
  // Need a house number and a street name before any suffix token.
  for (let index = tokens.length - 1; index >= 2; index -= 1) {
    const suffix = STREET_SUFFIX_CANONICAL[tokens[index]];
    if (!suffix) continue;
    // "S AVENUE L" style street name: the letter belongs to the name, not a unit.
    if (
      suffix === "AVE" &&
      DIRECTIONS.has(tokens[index - 1]) &&
      index + 1 < tokens.length &&
      /^[A-Z]$/.test(tokens[index + 1])
    ) {
      const unit = trailingUnit(tokens.slice(index + 2));
      if (unit === "not_unit") return whole;
      const core = [...tokens.slice(0, index), "AVE", tokens[index + 1]].join(" ");
      return { core, suffix: null, unit };
    }
    const unit = trailingUnit(tokens.slice(index + 1));
    if (unit === "not_unit") return whole;
    return { core: tokens.slice(0, index).join(" "), suffix, unit };
  }
  return whole;
}

function coreHasStreetName(core: string): boolean {
  const tokens = core.split(" ").filter(Boolean);
  // House number plus at least one token that is a street name — not a bare
  // direction and not purely numeric ("1940 S" alone never identifies a street).
  return tokens.length >= 2 && tokens.slice(1).some((token) => /[A-Z]/.test(token) && !DIRECTIONS.has(token));
}

export function parcelAddressesMatch(
  requested: string | null | undefined,
  resolved: string | null | undefined,
): boolean {
  const leftNormalized = normalizedParcelStreetAddress(requested);
  const rightNormalized = normalizedParcelStreetAddress(resolved);
  if (leftNormalized.length < 6 || rightNormalized.length < 6) return false;
  if (leftNormalized === rightNormalized) return true;
  const left = parcelAddressParts(leftNormalized);
  const right = parcelAddressParts(rightNormalized);
  if (!coreHasStreetName(left.core) || !coreHasStreetName(right.core)) return false;
  if (left.core !== right.core) return false;
  // Suffix and unit must agree only when both records publish them.
  if (left.suffix != null && right.suffix != null && left.suffix !== right.suffix) return false;
  if (left.unit != null && right.unit != null && left.unit !== right.unit) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * A full millisecond-precision ISO instant that ROUND-TRIPS. The shape regex
 * alone accepts impossible dates ("2026-13-45T99:99:99.999Z"); re-serializing
 * the parsed Date and requiring an identical string is what actually rejects
 * them. Exported so the committed parcel-identity sidecars are validated by
 * exactly the same rule as a live resolver response.
 */
export function validCheckedAt(value: unknown): value is string {
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
