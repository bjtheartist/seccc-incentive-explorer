/**
 * District-family classification and filtering, built on the existing
 * ZONING_CATEGORIES table.
 *
 * SINGLE SOURCE OF TRUTH
 * ----------------------
 * The prefix-to-family table already lives in `lib/constants.ts` as
 * ZONING_CATEGORIES, where it drives map fill colours
 * (`buildZoningColorExpression`) and the legend's per-category toggles.
 * This module does NOT restate those prefixes. It imports them, so a
 * category added there is immediately filterable here and cannot drift.
 *
 * WHY THIS DERIVES FROM `zoneClass` AND NOT `zoneTypeCode`
 * -------------------------------------------------------
 * The ArcGIS layer publishes a numeric ZONE_TYPE with no attached
 * value-domain label, so `app/api/zoning/route.ts` deliberately returns
 * `zoneType: null` rather than inferring a user-facing category from it.
 * That decision stands. This module reads the published designation
 * string (`zoneClass`, e.g. "C1-2") instead — grouping "C1-2" with
 * "C3-5" restates the City's own naming rather than decoding an
 * undocumented code.
 *
 * STRICTER MATCHING THAN THE MAP'S COLOUR EXPRESSION
 * -------------------------------------------------
 * `buildZoningColorExpression` compares a leading slice of the class
 * string. That is correct for painting, where an unmatched parcel simply
 * takes the fallback colour. For filtering, a loose match silently
 * includes or excludes sites, so this module matches the *whole leading
 * alphabetic run* instead: "RM4-.5" yields "RM", and a hypothetical
 * future "CX-1" yields "CX" and stays unclassified rather than being
 * absorbed into commercial by its first letter.
 *
 * VALIDATION
 * ----------
 * Validated 2026-08-10 against the City of Chicago ArcGIS zoning layer
 * (ExternalApps/Zoning/MapServer/1) with returnDistinctValues on
 * ZONE_CLASS. The layer publishes 1,528 distinct designations resolving
 * to exactly 14 prefixes, and ZONING_CATEGORIES covers all 14 with none
 * left over. Distribution: PD 1444, B 15, PMD 14, C 13, M 9, RM 8, DX 6,
 * DR 4, DS 3, POS 3, RS 3, RT 3, DC 2, T 1.
 *
 * The fixture in `__tests__/zoning-districts.test.ts` locks that set, so
 * a newly published prefix fails a test rather than silently landing in
 * the unclassified bucket.
 *
 * WHAT THIS IS NOT
 * ----------------
 * A district family is NOT a statement about what a business may do at a
 * site. Whether a use is permitted is set by the ordinance's use tables
 * and confirmed by the City. Filtering narrows a candidate list; it never
 * concludes eligibility.
 */

import { ZONING_CATEGORIES } from "@/lib/constants";

export type ZoningDistrictFamilyId = (typeof ZONING_CATEGORIES)[number]["key"];

export interface ZoningDistrictFamily {
  id: ZoningDistrictFamilyId;
  label: string;
  prefixes: readonly string[];
  color: string;
}

export const ZONING_DISTRICT_FAMILIES: readonly ZoningDistrictFamily[] =
  ZONING_CATEGORIES.map((cat) => ({
    id: cat.key,
    label: cat.label,
    prefixes: cat.prefixes,
    color: cat.color,
  }));

const PREFIX_TO_FAMILY = new Map<string, ZoningDistrictFamily>(
  ZONING_DISTRICT_FAMILIES.flatMap((family) =>
    family.prefixes.map((prefix) => [prefix.toUpperCase(), family] as const),
  ),
);

/**
 * The leading alphabetic run of a designation, uppercased.
 * "C1-2" -> "C", "RS-3" -> "RS", "PMD 11" -> "PMD", "T" -> "T".
 * Returns null when the value does not begin with letters.
 */
export function zoneClassPrefix(zoneClass: string): string | null {
  const match = zoneClass.trim().toUpperCase().match(/^[A-Z]+/);
  return match ? match[0] : null;
}

/**
 * Classify a published designation into a family.
 *
 * Returns null when the designation is empty, malformed, or carries a
 * prefix no category claims. Callers MUST surface null as "district not
 * classified" rather than dropping the site or defaulting it into a
 * family — an unrecognized designation is a gap in the table, not a
 * property of the parcel.
 */
export function classifyZoneClass(
  zoneClass: string | null | undefined,
): ZoningDistrictFamily | null {
  if (!zoneClass) return null;
  const prefix = zoneClassPrefix(zoneClass);
  if (!prefix) return null;
  return PREFIX_TO_FAMILY.get(prefix) ?? null;
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
 * including unclassified sites. A non-empty selection excludes
 * unclassified sites, because including them would assert a family
 * membership that was never established.
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
 * Counts for a candidate set, so a filter UI can show what it is hiding
 * and how many sites carry no classifiable district at all.
 */
export function summarizeDistricts(
  zoneClasses: readonly (string | null | undefined)[],
): { byFamily: Map<ZoningDistrictFamilyId, number>; unclassified: number } {
  const byFamily = new Map<ZoningDistrictFamilyId, number>();
  let unclassified = 0;
  for (const zoneClass of zoneClasses) {
    const family = classifyZoneClass(zoneClass);
    if (!family) {
      unclassified += 1;
      continue;
    }
    byFamily.set(family.id, (byFamily.get(family.id) ?? 0) + 1);
  }
  return { byFamily, unclassified };
}

/**
 * Copy for any surface that filters by district. Kept here so the caveat
 * travels with the filter rather than being re-invented per surface.
 */
export const DISTRICT_FILTER_DISCLAIMER =
  "Filtering by district narrows sites by their published zoning designation. It does not determine whether a particular business may operate at a site — permitted uses are set by the zoning ordinance's use tables and confirmed by the City. Verify before signing a lease or spending money.";
