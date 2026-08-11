/**
 * Zoning district families, for filtering candidate sites.
 *
 * WHY THIS DERIVES FROM `zoneClass` AND NOT `zoneTypeCode`
 * -------------------------------------------------------
 * The ArcGIS layer publishes a numeric ZONE_TYPE without an attached
 * value-domain label, so `app/api/zoning/route.ts` deliberately returns
 * `zoneType: null` rather than inferring a user-facing category from it.
 * That decision stands. This module does not read `zoneTypeCode`.
 *
 * What it reads instead is the published district designation itself
 * (`zoneClass`, e.g. "C1-2", "RS-3", "M1-2"). The leading letters of a
 * Chicago district designation are part of the designation as published —
 * grouping "C1-2" and "C3-5" as commercial districts restates the City's
 * own naming, it does not decode an undocumented code.
 *
 * WHAT THIS IS NOT
 * ----------------
 * A district family is NOT a statement about what a business may do at a
 * site. Whether a use is permitted is determined by the use tables in the
 * Municipal Code (and ultimately by the Zoning Administrator), which this
 * module does not model. Filtering by family narrows a candidate list; it
 * never concludes eligibility. Any UI built on this must say what the
 * district IS, not what the user MAY DO.
 *
 * UNMATCHED CLASSES SURFACE, THEY DO NOT GET BUCKETED
 * --------------------------------------------------
 * `classifyZoneClass` returns `null` for anything it does not recognize,
 * and callers are expected to show those sites as "district not
 * classified" rather than dropping them or guessing. A filter that
 * silently discards rows it failed to parse would misreport coverage.
 */

export type ZoningDistrictFamilyId =
  | "residential"
  | "business"
  | "commercial"
  | "downtown"
  | "manufacturing"
  | "planned-manufacturing"
  | "planned-development"
  | "parks-open-space"
  | "transportation";

export interface ZoningDistrictFamily {
  id: ZoningDistrictFamilyId;
  /** Short label for filter chips. */
  label: string;
  /** One line explaining what the family covers, in plain language. */
  description: string;
  /**
   * Designation prefixes, longest-first within the family. Matching is
   * done against the leading alphabetic run of the class string.
   */
  prefixes: string[];
}

/**
 * Ordered most-specific-first so that multi-letter prefixes (PMD, POS, RS)
 * are tested before single-letter ones (P, R) can shadow them.
 */
export const ZONING_DISTRICT_FAMILIES: readonly ZoningDistrictFamily[] = [
  {
    id: "planned-manufacturing",
    label: "Planned manufacturing",
    description: "Planned Manufacturing Districts, which restrict conversion away from industrial use.",
    prefixes: ["PMD"],
  },
  {
    id: "parks-open-space",
    label: "Parks and open space",
    description: "Parks, open space, and conservation designations.",
    prefixes: ["POS"],
  },
  {
    id: "planned-development",
    label: "Planned development",
    description: "Sites governed by an adopted Planned Development ordinance rather than base district rules alone.",
    prefixes: ["PD"],
  },
  {
    id: "residential",
    label: "Residential",
    description: "Single-unit, two-flat and townhouse, and multi-unit residential districts.",
    prefixes: ["RS", "RT", "RM"],
  },
  {
    id: "downtown",
    label: "Downtown",
    description: "Downtown core, mixed-use, residential, and service districts.",
    prefixes: ["DC", "DX", "DR", "DS"],
  },
  {
    id: "business",
    label: "Business",
    description: "Business districts, oriented to storefront retail and services.",
    prefixes: ["B"],
  },
  {
    id: "commercial",
    label: "Commercial",
    description: "Commercial districts, which accommodate a broader range of activity than business districts.",
    prefixes: ["C"],
  },
  {
    id: "manufacturing",
    label: "Manufacturing",
    description: "Manufacturing and industrial districts.",
    prefixes: ["M"],
  },
  {
    id: "transportation",
    label: "Transportation",
    description: "Transportation designations.",
    prefixes: ["T"],
  },
] as const;

const PREFIX_LOOKUP: ReadonlyArray<{ prefix: string; family: ZoningDistrictFamily }> =
  ZONING_DISTRICT_FAMILIES.flatMap((family) =>
    family.prefixes.map((prefix) => ({ prefix, family })),
  ).sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * The leading alphabetic run of a district designation, uppercased.
 * "C1-2" -> "C", "RS-3" -> "RS", "PMD 11" -> "PMD". Returns null when the
 * value does not start with letters.
 */
export function zoneClassPrefix(zoneClass: string): string | null {
  const match = zoneClass.trim().toUpperCase().match(/^[A-Z]+/);
  return match ? match[0] : null;
}

/**
 * Classify a published district designation into a family.
 *
 * Returns null when the designation is empty, malformed, or not a
 * designation this module recognizes. Callers MUST surface null as
 * "not classified" rather than dropping the site or defaulting it into a
 * family — an unrecognized designation is a gap in this table, not a
 * property of the parcel.
 */
export function classifyZoneClass(
  zoneClass: string | null | undefined,
): ZoningDistrictFamily | null {
  if (!zoneClass) return null;
  const prefix = zoneClassPrefix(zoneClass);
  if (!prefix) return null;

  for (const entry of PREFIX_LOOKUP) {
    if (prefix === entry.prefix) return entry.family;
  }
  return null;
}

export function familyById(
  id: ZoningDistrictFamilyId,
): ZoningDistrictFamily | undefined {
  return ZONING_DISTRICT_FAMILIES.find((family) => family.id === id);
}

/**
 * Does a site's designation fall into any of the selected families?
 *
 * An empty selection means "no filter applied" and matches everything,
 * including sites whose designation could not be classified. A non-empty
 * selection excludes unclassified sites, because including them would
 * assert a family membership that was never established.
 */
export function matchesDistrictFilter(
  zoneClass: string | null | undefined,
  selected: readonly ZoningDistrictFamilyId[],
): boolean {
  if (selected.length === 0) return true;
  const family = classifyZoneClass(zoneClass);
  if (!family) return false;
  return selected.includes(family.id);
}

/**
 * Copy for any surface that filters by district. Kept here so the caveat
 * travels with the filter rather than being re-invented per surface.
 */
export const DISTRICT_FILTER_DISCLAIMER =
  "Filtering by district narrows sites by their published zoning designation. It does not determine whether a particular business may operate at a site — permitted uses are set by the zoning ordinance's use tables and confirmed by the City. Verify before signing a lease or spending money.";
