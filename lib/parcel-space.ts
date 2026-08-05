/**
 * Source-separated parcel and building dimensions.
 *
 * These measurements answer different questions and must never be collapsed
 * into one synthetic "footprint" value. Optional properties keep the static
 * vacancy export compact: an absent property means the source has not
 * published or verified that measurement.
 */
export interface ParcelSpaceFacts {
  /** Parcel/lot area from the Cook County parcel record. */
  lotAreaSqft?: number;
  /** Assessor-recorded total building area across floors. */
  assessorBuildingSqft?: number;
  /** Tax year attached to the assessor building-area record. */
  assessorBuildingYear?: number;
  /** Two-dimensional building coverage computed from City polygons. */
  cityGroundFootprintSqft?: number;
  /** Source vintage for the City building-footprint geometry. */
  cityGroundFootprintVintage?: string;
  /** Explicitly verified usable vacant interior space. */
  availableSpaceSqft?: number;
  /** Public-safe source label for the available-space verification. */
  availableSpaceSource?: string;
  /** ISO date/time when available space was verified or source-updated. */
  availableSpaceVerifiedAt?: string;
  /** ISO date/time after which the availability must be reconfirmed. */
  availableSpaceReconfirmAfter?: string;
}

export interface PublicAvailableSpaceMeasurement {
  pin: string;
  availableSpaceSqft: number;
  source: string;
  verifiedAt: string;
  reconfirmAfter: string;
}

export type SiteMatchAreaKind = "lot_area" | "verified_available_space";

export interface SiteMatchArea {
  sqft: number | null;
  kind: SiteMatchAreaKind;
}

export const CITY_BUILDING_FOOTPRINTS_VINTAGE = "Current as of August 2015";

export const PARCEL_SPACE_SOURCE_NOTES = {
  lotArea: "Cook County CookViewer parcel record",
  assessorBuilding:
    "Cook County Assessor residential characteristics or commercial valuation record",
  cityGroundFootprint: `City of Chicago Building Footprints (${CITY_BUILDING_FOOTPRINTS_VINTAGE})`,
  availableSpace: "Verified owner, chamber, or official property record",
} as const;

export function positiveSquareFeet(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : null;
}

/** Return a compact, public-safe object, or undefined when every fact is absent. */
export function compactParcelSpaceFacts(
  input: ParcelSpaceFacts | null | undefined,
): ParcelSpaceFacts | undefined {
  if (!input) return undefined;

  const lotAreaSqft = positiveSquareFeet(input.lotAreaSqft);
  const assessorBuildingSqft = positiveSquareFeet(input.assessorBuildingSqft);
  const cityGroundFootprintSqft = positiveSquareFeet(input.cityGroundFootprintSqft);
  const availableSpaceSqft = positiveSquareFeet(input.availableSpaceSqft);
  const assessorBuildingYear = positiveSquareFeet(input.assessorBuildingYear);
  const cityGroundFootprintVintage = input.cityGroundFootprintVintage?.trim() || undefined;
  const availableSpaceSource = input.availableSpaceSource?.trim() || undefined;
  const availableSpaceVerifiedAt = input.availableSpaceVerifiedAt?.trim() || undefined;
  const availableSpaceReconfirmAfter = input.availableSpaceReconfirmAfter?.trim() || undefined;

  const output: ParcelSpaceFacts = {
    ...(lotAreaSqft === null ? {} : { lotAreaSqft }),
    ...(assessorBuildingSqft === null ? {} : { assessorBuildingSqft }),
    ...(assessorBuildingYear === null ? {} : { assessorBuildingYear }),
    ...(cityGroundFootprintSqft === null ? {} : { cityGroundFootprintSqft }),
    ...(cityGroundFootprintVintage ? { cityGroundFootprintVintage } : {}),
    ...(availableSpaceSqft === null ? {} : { availableSpaceSqft }),
    ...(availableSpaceSource ? { availableSpaceSource } : {}),
    ...(availableSpaceVerifiedAt ? { availableSpaceVerifiedAt } : {}),
    ...(availableSpaceReconfirmAfter ? { availableSpaceReconfirmAfter } : {}),
  };

  return Object.keys(output).length > 0 ? output : undefined;
}

/** Remove the complete availability bundle while preserving the three public-record facts. */
export function withoutAvailableSpaceFacts(
  input: ParcelSpaceFacts | null | undefined,
): ParcelSpaceFacts | undefined {
  if (!input) return undefined;
  const {
    availableSpaceSqft: _availableSpaceSqft,
    availableSpaceSource: _availableSpaceSource,
    availableSpaceVerifiedAt: _availableSpaceVerifiedAt,
    availableSpaceReconfirmAfter: _availableSpaceReconfirmAfter,
    ...rest
  } = input;
  return compactParcelSpaceFacts(rest);
}

function timestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Keep available space only while its complete verification bundle is current. */
export function currentParcelSpaceFacts(
  input: ParcelSpaceFacts | null | undefined,
  now: Date | number = Date.now(),
): ParcelSpaceFacts | undefined {
  const normalized = compactParcelSpaceFacts(input);
  if (!normalized) return undefined;

  const nowMs = now instanceof Date ? now.getTime() : now;
  const verifiedAt = timestamp(normalized.availableSpaceVerifiedAt);
  const reconfirmAfter = timestamp(normalized.availableSpaceReconfirmAfter);
  const availabilityIsCurrent =
    normalized.availableSpaceSqft !== undefined &&
    Boolean(normalized.availableSpaceSource) &&
    verifiedAt !== null &&
    reconfirmAfter !== null &&
    verifiedAt <= nowMs &&
    reconfirmAfter > nowMs &&
    reconfirmAfter > verifiedAt;

  return availabilityIsCurrent ? normalized : withoutAvailableSpaceFacts(normalized);
}

/** Replace the availability bundle from an authoritative live snapshot. */
export function replaceAvailableSpaceFacts(
  input: ParcelSpaceFacts | null | undefined,
  measurement: PublicAvailableSpaceMeasurement | null | undefined,
  now: Date | number = Date.now(),
): ParcelSpaceFacts | undefined {
  const base = withoutAvailableSpaceFacts(input);
  if (!measurement) return base;
  return currentParcelSpaceFacts(
    {
      ...base,
      availableSpaceSqft: measurement.availableSpaceSqft,
      availableSpaceSource: measurement.source,
      availableSpaceVerifiedAt: measurement.verifiedAt,
      availableSpaceReconfirmAfter: measurement.reconfirmAfter,
    },
    now,
  );
}

/**
 * Backward-compatible read for vacancy exports created before `space` existed.
 * The legacy field is only safe to reuse as lot area for a land record. It is
 * never promoted to building area or available interior space.
 */
export function vacancySpaceFacts(
  propertyType: "vacant_land" | "vacant_building",
  space: ParcelSpaceFacts | null | undefined,
  legacySquareFeet: number | null | undefined,
  now: Date | number = Date.now(),
): ParcelSpaceFacts | undefined {
  const normalized = currentParcelSpaceFacts(space, now);
  if (propertyType !== "vacant_land") return normalized;
  const lotAreaSqft = positiveSquareFeet(legacySquareFeet);
  return compactParcelSpaceFacts({
    ...normalized,
    lotAreaSqft: normalized?.lotAreaSqft ?? lotAreaSqft ?? undefined,
  });
}

/**
 * The area that may satisfy a Matchmaker min/max request.
 *
 * Land uses parcel area. Existing buildings require verified available space;
 * assessor area and City ground coverage remain useful context but do not prove
 * that any indoor space is currently available.
 */
export function siteMatchAreaForProperty(
  propertyType: "vacant_land" | "vacant_building",
  facts: ParcelSpaceFacts | null | undefined,
  now: Date | number = Date.now(),
): SiteMatchArea {
  const currentFacts = currentParcelSpaceFacts(facts, now);
  if (propertyType === "vacant_land") {
    return { kind: "lot_area", sqft: positiveSquareFeet(currentFacts?.lotAreaSqft) };
  }
  return {
    kind: "verified_available_space",
    sqft: positiveSquareFeet(currentFacts?.availableSpaceSqft),
  };
}

export function siteMatchAreaLabel(kind: SiteMatchAreaKind): string {
  return kind === "lot_area" ? "Lot area" : "Reported available space";
}

export function availableSpaceSourceLabel(sourceKey: string): string {
  switch (sourceKey) {
    case "owner_confirmation":
      return "Owner confirmation";
    case "seccc_field_survey":
      return "SECCC field verification";
    case "cclba_record":
      return "Cook County Land Bank record";
    case "city_record":
      return "City property record";
    default:
      return "Verified property record";
  }
}

export function squareFeetLabel(value: number | null | undefined): string {
  const normalized = positiveSquareFeet(value);
  return normalized === null ? "Not published" : `${normalized.toLocaleString("en-US")} sq ft`;
}
