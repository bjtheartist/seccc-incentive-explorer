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

import { ZONING_CATEGORIES, ZONING_CODE_DESCRIPTIONS } from "@/lib/constants";

/**
 * Separator repairs for designations the City publishes malformed.
 *
 * Verified 2026-08-10 against the live layer. Each key is a published
 * value whose canonical twin ALSO appears in the same layer, so these
 * are demonstrable duplicates rather than inferred corrections:
 *
 *   RM4-.5 / RM4.5 -> RM-4.5   (RM-4.5 published alongside)
 *   RM5.5          -> RM-5.5   (RM-5.5 published alongside)
 *   PMD-4 / PMD13  -> PMD 4 / PMD 13  (space is the PMD convention)
 *
 * This is an explicit allow-list, NOT a general repair heuristic. A
 * value not listed here is never rewritten — it either matches a known
 * designation or stays unclassified. Guessing at unknown malformations
 * is how a parser silently mis-buckets a parcel.
 *
 * Callers display the published string verbatim; this canonical form is
 * for matching and de-duplication only.
 */
const CANONICAL_ZONE_CLASS: Readonly<Record<string, string>> = {
  "RM4-.5": "RM-4.5",
  "RM4.5": "RM-4.5",
  "RM5.5": "RM-5.5",
  "PMD-4": "PMD 4",
  PMD13: "PMD 13",
};

/**
 * Canonical form of a published designation, for matching and for
 * collapsing duplicate spellings in a filter dropdown.
 *
 * Returns the input trimmed and uppercased when no repair applies, so
 * this is safe to call on every value.
 */
export function normalizeZoneClass(
  zoneClass: string | null | undefined,
): string | null {
  if (!zoneClass) return null;
  const trimmed = zoneClass.trim();
  if (trimmed.length === 0) return null;
  return CANONICAL_ZONE_CLASS[trimmed] ?? trimmed;
}

/** Was this designation published in a form needing repair? */
export function isMalformedZoneClass(
  zoneClass: string | null | undefined,
): boolean {
  if (!zoneClass) return false;
  return zoneClass.trim() in CANONICAL_ZONE_CLASS;
}

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

/* ------------------------------------------------------------------ *
 * Sub-types — the tier that actually means something
 * ------------------------------------------------------------------ */

/**
 * A designation carries two independent axes. In "B3-2", the "B3" is a
 * USE type (community shopping) and the "-2" is BULK (floor area ratio).
 * B1-1 and B1-5 allow the same activities at different densities; B1-1
 * and B3-1 allow different activities at the same density.
 *
 * Family ("B/C") is too coarse to act on and the full code is too
 * specific to browse — there are 84 non-PD codes. The sub-type is the
 * middle tier, ~20 buckets, and it is the one a person site-searching
 * for a business can actually use.
 *
 * Extraction rule: for B, C, and M the first digit selects the use type,
 * so the sub-type is letters + first digit. Everywhere else the letters
 * already are the use type (RS/RT/RM differ from each other; DC/DX/DR/DS
 * likewise), so the sub-type is just the letters.
 */
const DIGIT_BEARING_PREFIXES = new Set(["B", "C", "M"]);

export interface ZoneSubtype {
  id: string;
  familyId: ZoningDistrictFamilyId;
  label: string;
  /**
   * True when the designation itself carries no use meaning and the
   * answer lives in a site-specific adopted ordinance. Surfaces as a
   * "check the ordinance" handoff rather than a bucket that pretends to
   * answer the question.
   */
  requiresOrdinanceLookup: boolean;
}

/** Sub-type id for a published designation, or null if unclassifiable. */
export function zoneSubtype(zoneClass: string | null | undefined): string | null {
  const normalized = normalizeZoneClass(zoneClass);
  if (!normalized) return null;
  const prefix = zoneClassPrefix(normalized);
  if (!prefix || !PREFIX_TO_FAMILY.has(prefix)) return null;
  if (!DIGIT_BEARING_PREFIXES.has(prefix)) return prefix;
  const digit = normalized.toUpperCase().slice(prefix.length).match(/^\d/);
  return digit ? `${prefix}${digit[0]}` : prefix;
}

/**
 * Labels come from ZONING_CODE_DESCRIPTIONS with the intensity
 * parenthetical stripped, so the sub-type names stay in step with the
 * per-code descriptions instead of being a second copy that drifts.
 */
function deriveSubtypeLabel(subtypeId: string): string | null {
  for (const [code, description] of Object.entries(ZONING_CODE_DESCRIPTIONS)) {
    if (zoneSubtype(code) !== subtypeId) continue;
    return description.replace(/\s*\([^)]*\)\s*$/, "").trim() || null;
  }
  return null;
}

const ORDINANCE_LOOKUP_LABELS: Readonly<Record<string, string>> = {
  PD: "Planned Development",
  PMD: "Planned Manufacturing District",
};

export const ZONE_SUBTYPES: readonly ZoneSubtype[] = (() => {
  const seen = new Map<string, ZoningDistrictFamilyId>();
  for (const code of Object.keys(ZONING_CODE_DESCRIPTIONS)) {
    const id = zoneSubtype(code);
    const family = classifyZoneClass(code);
    if (id && family && !seen.has(id)) seen.set(id, family.id);
  }
  for (const id of Object.keys(ORDINANCE_LOOKUP_LABELS)) {
    const family = classifyZoneClass(`${id} 1`);
    if (family && !seen.has(id)) seen.set(id, family.id);
  }

  const familyOrder = new Map(
    ZONING_DISTRICT_FAMILIES.map((family, index) => [family.id, index]),
  );

  return [...seen.entries()]
    .map(([id, familyId]) => ({
      id,
      familyId,
      label: ORDINANCE_LOOKUP_LABELS[id] ?? deriveSubtypeLabel(id) ?? id,
      requiresOrdinanceLookup: id in ORDINANCE_LOOKUP_LABELS,
    }))
    .sort((a, b) => {
      const byFamily =
        (familyOrder.get(a.familyId) ?? 99) - (familyOrder.get(b.familyId) ?? 99);
      return byFamily !== 0 ? byFamily : a.id.localeCompare(b.id);
    });
})();

export function subtypeById(id: string): ZoneSubtype | undefined {
  return ZONE_SUBTYPES.find((subtype) => subtype.id === id);
}

/** Sub-type ids belonging to a family, in display order. */
export function subtypesForFamily(familyId: ZoningDistrictFamilyId): string[] {
  return ZONE_SUBTYPES.filter((s) => s.familyId === familyId).map((s) => s.id);
}

/**
 * A selection may be a family id (roll-up) or a sub-type id (specific).
 * Returns true when the candidate's sub-type satisfies the selection.
 */
export function subtypeMatchesSelection(
  candidateSubtypeId: string | null,
  selection: string,
): boolean {
  if (!candidateSubtypeId) return false;
  if (candidateSubtypeId === selection) return true;
  const subtype = subtypeById(candidateSubtypeId);
  return subtype ? subtype.familyId === selection : false;
}

/**
 * Shown wherever a Planned Development turns up. A PD number is a
 * pointer to a site-specific ordinance, not a category — the base
 * district rules do not answer the question, and neither does this
 * tool. Every PD parcel record carries pdNumber, ordinanceNumber, and
 * a Clerk URL, so this is a handoff to a real document.
 */
export const PD_ORDINANCE_HANDOFF =
  "This site is governed by an adopted Planned Development ordinance, which sets its own rules in place of the base district. The designation number is a reference to that ordinance, not a category — read the ordinance itself to see what it permits.";

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
