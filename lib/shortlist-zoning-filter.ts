/**
 * Client-safe zoning filter helpers for the Site Matchmaker shortlist.
 *
 * The shortlist already publishes one exact zoning designation per candidate.
 * These helpers derive linked family -> district type -> exact-code options
 * from that value without changing rank, inferring permitted uses, or hiding
 * unresolved records.
 */

import { ZONING_CODE_DESCRIPTIONS } from "@/lib/constants";
import type { RankedShortlistCandidate } from "@/lib/shortlist-engine";
import {
  ZONING_DISTRICT_FAMILIES,
  familyById,
  normalizeZoneClass,
  subtypeById,
  subtypesForFamily,
  zoneSubtype,
  classifyZoneClass,
  type ZoningDistrictFamilyId,
} from "@/lib/zoning-districts";

export const SHORTLIST_ZONING_UNRESOLVED = "zoning:unresolved";
export const SHORTLIST_ZONING_AMBIGUOUS = "zoning:ambiguous";
export const SHORTLIST_ZONING_UNCLASSIFIED = "zoning:unclassified";

const EXACT_CODE_PREFIX = "zoning-code:";

export interface ShortlistZoningFilterOption {
  value: string;
  label: string;
  count: number;
}

function canonicalDistrict(candidate: RankedShortlistCandidate): string | null {
  const published = candidate.zoningDistrict?.trim().toUpperCase() ?? null;
  const normalized = normalizeZoneClass(published);
  return normalized ? normalized.toUpperCase() : null;
}

function zoningStatusValue(candidate: RankedShortlistCandidate): string | null {
  if (candidate.zoningStatus === "ambiguous") return SHORTLIST_ZONING_AMBIGUOUS;
  if (candidate.zoningStatus !== "resolved" || canonicalDistrict(candidate) === null) {
    return SHORTLIST_ZONING_UNRESOLVED;
  }
  return null;
}

/** Family/status value used by the first select. */
export function shortlistFamilyFilterValue(candidate: RankedShortlistCandidate): string {
  const status = zoningStatusValue(candidate);
  if (status) return status;
  return classifyZoneClass(canonicalDistrict(candidate))?.id ?? SHORTLIST_ZONING_UNCLASSIFIED;
}

/** District use-type/status value used by the second select. */
export function shortlistDistrictTypeFilterValue(candidate: RankedShortlistCandidate): string {
  const status = zoningStatusValue(candidate);
  if (status) return status;
  return zoneSubtype(canonicalDistrict(candidate)) ?? SHORTLIST_ZONING_UNCLASSIFIED;
}

/** Canonical exact-code value used by the third select. */
export function shortlistExactZoningFilterValue(
  candidate: RankedShortlistCandidate,
): string | null {
  if (zoningStatusValue(candidate)) return null;
  const normalized = canonicalDistrict(candidate);
  return normalized ? `${EXACT_CODE_PREFIX}${normalized}` : null;
}

export function shortlistFamilyFilterLabel(value: string): string {
  if (value === SHORTLIST_ZONING_UNRESOLVED) return "District unresolved";
  if (value === SHORTLIST_ZONING_AMBIGUOUS) return "District boundary ambiguous";
  if (value === SHORTLIST_ZONING_UNCLASSIFIED) return "District not classified";
  return familyById(value as ZoningDistrictFamilyId)?.label ?? value;
}

export function shortlistDistrictTypeFilterLabel(value: string): string {
  if (value === SHORTLIST_ZONING_UNRESOLVED) return "District unresolved";
  if (value === SHORTLIST_ZONING_AMBIGUOUS) return "District boundary ambiguous";
  if (value === SHORTLIST_ZONING_UNCLASSIFIED) return "District not classified";
  const subtype = subtypeById(value);
  return subtype ? `${subtype.id} · ${subtype.label}` : value;
}

export function shortlistExactZoningFilterLabel(value: string): string {
  const code = value.startsWith(EXACT_CODE_PREFIX)
    ? value.slice(EXACT_CODE_PREFIX.length)
    : value;
  const description = ZONING_CODE_DESCRIPTIONS[code];
  return description ? `${code} · ${description}` : code;
}

export function candidateMatchesShortlistFamily(
  candidate: RankedShortlistCandidate,
  selection: string,
): boolean {
  return selection === "" || shortlistFamilyFilterValue(candidate) === selection;
}

export function candidateMatchesShortlistDistrictType(
  candidate: RankedShortlistCandidate,
  selection: string,
): boolean {
  return selection === "" || shortlistDistrictTypeFilterValue(candidate) === selection;
}

export function candidateMatchesShortlistZoningFilters(
  candidate: RankedShortlistCandidate,
  familySelection: string,
  districtTypeSelection: string,
  exactCodeSelection: string,
): boolean {
  if (!candidateMatchesShortlistFamily(candidate, familySelection)) return false;
  if (!candidateMatchesShortlistDistrictType(candidate, districtTypeSelection)) return false;
  if (exactCodeSelection === "") return true;
  return shortlistExactZoningFilterValue(candidate) === exactCodeSelection;
}

/** Family roll-ups actually present in this result set, followed by statuses. */
export function shortlistFamilyFilterOptions(
  candidates: readonly RankedShortlistCandidate[],
): ShortlistZoningFilterOption[] {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const value = shortlistFamilyFilterValue(candidate);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const options: ShortlistZoningFilterOption[] = ZONING_DISTRICT_FAMILIES.filter((family) =>
    counts.has(family.id),
  ).map((family) => ({
    value: family.id,
    label: family.label,
    count: counts.get(family.id) ?? 0,
  }));
  for (const value of [
    SHORTLIST_ZONING_AMBIGUOUS,
    SHORTLIST_ZONING_UNRESOLVED,
    SHORTLIST_ZONING_UNCLASSIFIED,
  ]) {
    const count = counts.get(value) ?? 0;
    if (count > 0) options.push({ value, label: shortlistFamilyFilterLabel(value), count });
  }
  return options;
}

/** District use types present after applying the optional family selection. */
export function shortlistDistrictTypeFilterOptions(
  candidates: readonly RankedShortlistCandidate[],
  familySelection: string,
): ShortlistZoningFilterOption[] {
  if (
    familySelection === SHORTLIST_ZONING_AMBIGUOUS ||
    familySelection === SHORTLIST_ZONING_UNRESOLVED
  ) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    if (!candidateMatchesShortlistFamily(candidate, familySelection)) continue;
    const value = shortlistDistrictTypeFilterValue(candidate);
    if (
      value === SHORTLIST_ZONING_AMBIGUOUS ||
      value === SHORTLIST_ZONING_UNRESOLVED
    ) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const subtypeOrder =
    familySelection === ""
      ? ZONING_DISTRICT_FAMILIES.flatMap((family) => subtypesForFamily(family.id))
      : familySelection === SHORTLIST_ZONING_UNCLASSIFIED
        ? []
        : subtypesForFamily(familySelection as ZoningDistrictFamilyId);
  const options: ShortlistZoningFilterOption[] = subtypeOrder
    .filter((value) => counts.has(value))
    .map((value) => ({
      value,
      label: shortlistDistrictTypeFilterLabel(value),
      count: counts.get(value) ?? 0,
    }));
  const unclassifiedCount = counts.get(SHORTLIST_ZONING_UNCLASSIFIED) ?? 0;
  if (unclassifiedCount > 0) {
    options.push({
      value: SHORTLIST_ZONING_UNCLASSIFIED,
      label: shortlistDistrictTypeFilterLabel(SHORTLIST_ZONING_UNCLASSIFIED),
      count: unclassifiedCount,
    });
  }
  return options;
}

/** Exact codes present after applying the optional family and type selections. */
export function shortlistExactZoningFilterOptions(
  candidates: readonly RankedShortlistCandidate[],
  familySelection: string,
  districtTypeSelection: string,
): ShortlistZoningFilterOption[] {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    if (!candidateMatchesShortlistFamily(candidate, familySelection)) continue;
    if (!candidateMatchesShortlistDistrictType(candidate, districtTypeSelection)) continue;
    const value = shortlistExactZoningFilterValue(candidate);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({
      value,
      label: shortlistExactZoningFilterLabel(value),
      count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
