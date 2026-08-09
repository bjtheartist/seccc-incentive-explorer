/**
 * PERMIT → VACANT-PARCEL MATCHING — the pure half.
 *
 * The tier vocabulary, the address normalization, and the confidence rules that
 * scripts/sync-vacant-properties.ts executes in SQL and that the vacancy site
 * card renders. Kept free of `neon`, `node:fs` and the map runtime so both the
 * sync script and the client bundle can import it and so every rule below is
 * unit-testable from fixtures without a database or a network call.
 *
 * ── Why three tiers and no fuzzy name matching ──
 *
 * A permit is EVIDENCE that a filing happened at a place. Attaching the wrong
 * permit to a parcel is worse than attaching none, because the card is read
 * before someone spends money or knocks on a door. So every tier is an
 * identifier-or-geometry rule that can be re-derived and audited:
 *
 *   1. `pin_exact`         — the permit's PIN identifies the parcel.
 *   2. `address_normalized`— the permit's street address, normalized, equals
 *                            the parcel's street address, normalized.
 *   3. `spatial_proximity` — the permit's point falls within
 *                            {@link SPATIAL_MATCH_RADIUS_M} of the parcel's
 *                            point. Explicitly LOW confidence.
 *
 * There is deliberately NO fuzzy/approximate name or address similarity tier.
 * Names in these datasets are contractor and applicant names, not owners, and
 * an edit-distance address match across a city with repeating grid addresses
 * manufactures matches that read as fact on the card.
 *
 * ── The 10-vs-14 digit PIN fact this all rests on ──
 *
 * Building Permits (`ydr8-5enu`) stores **10-digit** PINs
 * (area-subarea-block-parcel, e.g. "1709119028"). The City-Owned Land
 * Inventory and `parcels` store **14-digit** PINs including the 4-digit unit
 * suffix (e.g. "16-11-105-004-0000" → "16111050040000"). Verified live
 * 2026-08-04 against both endpoints. A digits-only equality join between the
 * two therefore matches NOTHING; the comparison must be
 * `LEFT(parcel_pin, 10) = permit_pin`, which is what
 * {@link parcelPinMatchesPermitPin} encodes.
 *
 * That truncation has a consequence the confidence grade must carry: when the
 * parcel's 4-digit suffix is "0000" the 10-digit PIN identifies that parcel
 * uniquely (HIGH). When the suffix is anything else the parcel is a unit inside
 * a divided PIN and the permit's 10-digit PIN names the whole parcel, not the
 * unit (MEDIUM). See {@link pinMatchConfidence}.
 */

/**
 * The issue-date floor of the ingest window, and the single source of truth for
 * it. lib/ingest/permits.ts builds its `$where` from this and
 * lib/permit-match-lines.ts renders the window label from it, so the UI can
 * never advertise a window the fetch did not query. It lives in this
 * dependency-free module precisely so the client bundle can read it without
 * pulling in the Socrata/Node half of the adapter.
 */
export const PERMIT_SINCE_DATE = "2015-01-01";

/** How a permit was tied to a parcel. Stored verbatim in
 *  `vacant_property_permit_matches.match_method`. */
export type PermitMatchMethod = "pin_exact" | "address_normalized" | "spatial_proximity";

/** How much the method is worth. Stored verbatim in
 *  `vacant_property_permit_matches.match_confidence`. */
export type PermitMatchConfidence = "high" | "medium" | "low";

/**
 * Tier order, strongest first. The sync inserts tiers in this order with
 * `ON CONFLICT DO NOTHING`, so a pair already claimed by a stronger tier keeps
 * that tier — precedence falls out of the insert order rather than needing a
 * ranking pass.
 */
export const PERMIT_MATCH_METHOD_ORDER: readonly PermitMatchMethod[] = [
  "pin_exact",
  "address_normalized",
  "spatial_proximity",
];

/**
 * Radius for the tertiary tier, in metres.
 *
 * NOTE, and this is a deliberate deviation to state plainly rather than paper
 * over: the plan called this tier "point-in-polygon". This database has no
 * parcel polygons — `vacant_properties.geom` and `parcels.geom` are both
 * `GEOGRAPHY(POINT, 4326)` — so a true point-in-polygon test is not available
 * here. What runs is a point-to-point proximity test at this radius, which is
 * why the tier is NAMED `spatial_proximity` everywhere (method, DB value, UI
 * copy) and is graded `low`. Nothing claims containment.
 *
 * 25 m is roughly a standard Chicago lot's short dimension, so a permit point
 * this close is plausibly the same parcel and implausibly two parcels away.
 */
export const SPATIAL_MATCH_RADIUS_M = 25;

/**
 * Per-parcel cap on tertiary matches. Proximity is the only tier that can
 * fan out (a dense block can put many permit points inside the radius), so it
 * is capped at the most recent few. The PIN and address tiers are uncapped:
 * a parcel with fifteen PIN-matched permits genuinely has fifteen.
 */
export const SPATIAL_MATCH_PER_PARCEL_CAP = 3;

/** Human labels for the three methods. Used by the card and by the sync report. */
export const PERMIT_MATCH_METHOD_LABELS: Record<PermitMatchMethod, string> = {
  pin_exact: "Parcel PIN",
  address_normalized: "Street address",
  spatial_proximity: `Location within ${SPATIAL_MATCH_RADIUS_M} m`,
};

export const PERMIT_MATCH_CONFIDENCE_LABELS: Record<PermitMatchConfidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

/**
 * The address normalization used on BOTH sides of the secondary tier. This is
 * the exact expression the corridor-owners join and the vacancy export already
 * use (`regexp_replace(lower(coalesce(address,'')), '[^a-z0-9]', '', 'g')`),
 * reproduced here so the TypeScript tests and the SQL cannot drift.
 *
 * It is intentionally destructive-but-total: no abbreviation expansion, no
 * token reordering, no suffix guessing. "3717 W CHICAGO AVE" and
 * "3717 w chicago ave." both become "3717wchicagoave"; "3717 W CHICAGO" does
 * NOT, and is left unmatched rather than guessed at.
 */
export function normalizePermitAddress(address: string | null | undefined): string {
  return (address ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The SQL expression that must stay identical to {@link normalizePermitAddress}. */
export const NORMALIZED_ADDRESS_SQL =
  "regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g')";

/**
 * Does this 14-digit parcel PIN correspond to this 10-digit permit PIN?
 *
 * Both inputs are digits-only. A 14-digit permit PIN (rare but permitted by
 * {@link parsePinList}) is compared in full. Anything shorter than 10 digits on
 * either side is not comparable and returns false — a partial PIN must never
 * become a match.
 */
export function parcelPinMatchesPermitPin(
  parcelPin: string | null | undefined,
  permitPin: string | null | undefined,
): boolean {
  const parcel = (parcelPin ?? "").replace(/\D/g, "");
  const permit = (permitPin ?? "").replace(/\D/g, "");
  if (parcel.length !== 14) return false;
  if (permit.length === 14) return parcel === permit;
  if (permit.length === 10) return parcel.slice(0, 10) === permit;
  return false;
}

/**
 * Confidence for a PIN match, from the parcel's 4-digit unit suffix.
 * "0000" (an undivided parcel) → `high`; any other suffix → `medium`, because
 * the permit's 10-digit PIN names the parcel and not the specific unit.
 */
export function pinMatchConfidence(parcelPin: string | null | undefined): PermitMatchConfidence {
  const parcel = (parcelPin ?? "").replace(/\D/g, "");
  if (parcel.length !== 14) return "medium";
  return parcel.slice(10) === "0000" ? "high" : "medium";
}

/** The fixed confidence each non-PIN tier carries. */
export const METHOD_BASE_CONFIDENCE: Record<
  Exclude<PermitMatchMethod, "pin_exact">,
  PermitMatchConfidence
> = {
  address_normalized: "medium",
  spatial_proximity: "low",
};

/** The minimum a parcel must expose to be matched. */
export interface MatchableParcel {
  /** 14-digit digits-only Cook County PIN, or null (311 rows carry none). */
  pin: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
}

/** The minimum a permit must expose to be matched. */
export interface MatchablePermit {
  permitId: string;
  /** EVERY pin on the permit, digits-only (10-digit from `ydr8-5enu`). */
  pins: string[];
  address: string | null;
  lat: number | null;
  lon: number | null;
}

/** The tier a pair earned, or null when the pair does not match at all. */
export interface MatchOutcome {
  method: PermitMatchMethod;
  confidence: PermitMatchConfidence;
  /** The literal value that matched — the PIN, the normalized address, or the
   *  measured distance — mirroring `vacant_property_permit_matches.matched_on`. */
  matchedOn: string;
}

/** Great-circle metres between two WGS84 points. Sufficient at the tens-of-
 *  metres scale this tier works at, and dependency-free so the rule is testable
 *  without PostGIS. */
export function haversineMetres(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Minimum normalized-address length for the secondary tier. Short stubs (and
 *  the literal placeholder "unknown") must not match each other. */
export const MIN_NORMALIZED_ADDRESS_LENGTH = 8;

/**
 * THE canonical statement of the matching rule for a single (parcel, permit)
 * pair, tiers strongest-first.
 *
 * scripts/sync-vacant-properties.ts executes the same three rules set-based in
 * SQL because 43k parcels x 467k permits is not a job for a per-pair loop; this
 * function is the readable, unit-testable definition those queries mirror, and
 * lib/__tests__/permit-match.test.ts pins the behavior with fixtures from the
 * North, West and South sides. If you change a rule, change it in BOTH — the
 * tests here will not catch SQL drift on their own.
 */
export function classifyMatch(
  parcel: MatchableParcel,
  permit: MatchablePermit,
): MatchOutcome | null {
  // Tier 1 · PIN.
  const parcelPin = (parcel.pin ?? "").replace(/\D/g, "");
  if (parcelPin.length === 14) {
    const hit = permit.pins.find((p) => parcelPinMatchesPermitPin(parcelPin, p));
    if (hit) {
      return {
        method: "pin_exact",
        confidence: pinMatchConfidence(parcelPin),
        matchedOn: hit,
      };
    }
  }

  // Tier 2 · normalized street address.
  const parcelAddr = normalizePermitAddress(parcel.address);
  const permitAddr = normalizePermitAddress(permit.address);
  if (
    parcelAddr.length >= MIN_NORMALIZED_ADDRESS_LENGTH &&
    parcelAddr !== "unknown" &&
    parcelAddr === permitAddr
  ) {
    return {
      method: "address_normalized",
      confidence: METHOD_BASE_CONFIDENCE.address_normalized,
      matchedOn: parcelAddr,
    };
  }

  // Tier 3 · spatial proximity. NOT containment — see SPATIAL_MATCH_RADIUS_M.
  if (
    parcel.lat != null &&
    parcel.lon != null &&
    permit.lat != null &&
    permit.lon != null
  ) {
    const d = haversineMetres(parcel.lat, parcel.lon, permit.lat, permit.lon);
    if (d <= SPATIAL_MATCH_RADIUS_M) {
      return {
        method: "spatial_proximity",
        confidence: METHOD_BASE_CONFIDENCE.spatial_proximity,
        matchedOn: `${Math.round(d)} m`,
      };
    }
  }

  return null;
}

/** One `vacant_property_permit_matches` row joined to its permit, as the API
 *  serves it and the card renders it. */
export interface MatchedPermit {
  permitId: string;
  permitType: string | null;
  workType: string | null;
  workDescription: string | null;
  issueDate: string | null;
  /** APPLICANT ESTIMATE — see {@link PERMIT_COST_LABEL}. Never aggregated. */
  reportedCost: number | null;
  permitStatus: string | null;
  permitMilestone: string | null;
  permitCondition: string | null;
  matchMethod: PermitMatchMethod;
  matchConfidence: PermitMatchConfidence;
}

/**
 * Pick the ONE permit a card should show: strongest method first, then the most
 * recent issue date, then the permit id for a stable tie-break. Pure so the
 * "which permit is shown" rule is testable without a database.
 */
export function bestMatchedPermit(matches: readonly MatchedPermit[]): MatchedPermit | null {
  if (matches.length === 0) return null;
  const rank = (m: PermitMatchMethod) => PERMIT_MATCH_METHOD_ORDER.indexOf(m);
  return [...matches].sort((a, b) => {
    const byMethod = rank(a.matchMethod) - rank(b.matchMethod);
    if (byMethod !== 0) return byMethod;
    const aDate = a.issueDate ?? "";
    const bDate = b.issueDate ?? "";
    if (aDate !== bDate) return bDate.localeCompare(aDate);
    return a.permitId.localeCompare(b.permitId);
  })[0];
}
