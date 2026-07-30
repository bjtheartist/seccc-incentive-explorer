/**
 * The pure core of the All Properties directory (VacancyDirectory.tsx): per-row
 * classification derivations and the column-multifilter predicate, extracted so
 * the filter semantics are unit-testable without rendering the table.
 *
 * Client-safe and dependency-free (NO `node:fs`, no React) — the component
 * imports these; so do the tests.
 *
 * Filter semantics (unchanged from the original inline implementation):
 *   • OR within a column  — any checked value matches.
 *   • AND across columns  — every column with a selection must match.
 *   • An EMPTY column selection is NO filter (all rows pass), never
 *     match-nothing.
 *   • Search is a case-insensitive substring on address.
 *   • The Opportunity-Area handoff filter is an exact clusterId match, and rows
 *     that never mapped into a kept cluster (clusterId null) simply don't match.
 *
 * Anonymized end to end: every derivation below reads owner CLASSIFICATION
 * fields only (sector / structure) — never a taxpayer name or mailing address,
 * neither of which the directory file carries in the first place.
 */

import { classifyOwnerSector, type OwnerSector } from "@/lib/owner-sector";
import { normalizeOwnerStructure, type OwnerStructure } from "@/lib/owner-taxonomy";
import { siteStarKey } from "@/lib/vacancy-starred";
import type { VacancyDirectoryRow, VacancyPropertyType } from "@/lib/vacancy-index";

export type FlagValue = "tax_sale" | "violation" | "none";
export type SortDir = "asc" | "desc";

export const PROPERTY_TYPES: VacancyPropertyType[] = ["vacant_land", "vacant_building"];

export const PROPERTY_TYPE_ABBREV: Record<VacancyPropertyType, string> = {
  vacant_land: "LAND",
  vacant_building: "BLDG",
};

/** Full property-type labels, for the mobile card's plain-language line. */
export const PROPERTY_TYPE_LABELS: Record<VacancyPropertyType, string> = {
  vacant_land: "Vacant land",
  vacant_building: "Vacant building",
};

export const FLAG_VALUES: FlagValue[] = ["tax_sale", "violation", "none"];

export const FLAG_LABELS: Record<FlagValue, string> = {
  tax_sale: "Tax-sale record on file",
  violation: "Violation",
  none: "No flags",
};

/**
 * A row's SECTOR (public / private / not yet classified), reconciled from the
 * two ownership signals the directory file carries. A row that predates either
 * axis reports "unclassified" rather than being guessed into a bucket.
 */
export function rowSector(row: VacancyDirectoryRow): OwnerSector {
  return classifyOwnerSector({ ownerStructure: row.ownerStructure, ownerType: row.ownerType });
}

/**
 * A row's v2 structure, treating a row that predates the taxonomy as
 * "unresolved" (normalizeOwnerStructure(undefined)) — consistent across the
 * filter, the per-value counts, and the ENTITY cell.
 */
export function rowStructure(row: VacancyDirectoryRow): OwnerStructure {
  return normalizeOwnerStructure(row.ownerStructure);
}

/** The flag values a row carries; always non-empty ("none" when clean). */
export function rowFlags(row: VacancyDirectoryRow): FlagValue[] {
  const flags: FlagValue[] = [];
  if (row.saleYear != null) flags.push("tax_sale");
  if (row.violation) flags.push("violation");
  if (flags.length === 0) flags.push("none");
  return flags;
}

/** Two-digit tax-sale year suffix, e.g. 2015 -> "'15". */
export function saleYearSuffix(year: number): string {
  return `'${String(year % 100).padStart(2, "0")}`;
}

/**
 * Careful public-record wording for the mobile card's evidence line — never
 * "exposed"/"exposure" (implies current risk), just what's on file.
 */
export function rowEvidenceLine(row: VacancyDirectoryRow): string {
  const parts: string[] = [];
  if (row.saleYear != null) parts.push(`Tax-sale record on file (${saleYearSuffix(row.saleYear)})`);
  if (row.violation) parts.push("Violation on file");
  return parts.length > 0 ? parts.join(" · ") : "No flags on file";
}

// ── Starred (admin) ──────────────────────────────────────────────────────────

export type StarValue = "starred" | "unstarred";

export const STAR_VALUES: StarValue[] = ["starred", "unstarred"];

export const STAR_LABELS: Record<StarValue, string> = {
  starred: "Starred",
  unstarred: "Not starred",
};

/**
 * A row's identity in the starred store — the SAME key the map card computes
 * for the matching dot (PIN when one resolved, else the normalized address), so
 * starring from either surface lights up the other.
 */
export function rowStarKey(row: VacancyDirectoryRow): string {
  return siteStarKey({ pin: row.pin, address: row.address });
}

/** Whether a row is in the starred set. Empty set = nothing starred. */
export function rowIsStarred(
  row: VacancyDirectoryRow,
  starredKeys: ReadonlySet<string>,
): boolean {
  const key = rowStarKey(row);
  return key !== "" && starredKeys.has(key);
}

/** The directory's full filter state. Every set is "empty means no filter". */
export interface DirectoryFilters {
  /** Opportunity-Area handoff: exact clusterId match, or null for no filter. */
  areaId: number | null;
  sectors: ReadonlySet<OwnerSector>;
  structures: ReadonlySet<OwnerStructure>;
  types: ReadonlySet<VacancyPropertyType>;
  flags: ReadonlySet<FlagValue>;
  /** Case-insensitive substring on address; empty/whitespace = no filter. */
  search: string;
  /**
   * Starred facet (admin only). Optional so every pre-existing caller and test
   * compiles unchanged, and — like every other column — an empty/absent
   * selection is NO filter rather than match-nothing.
   */
  starred?: ReadonlySet<StarValue>;
  /**
   * The starred keys to evaluate the facet against. Absent/empty means nothing
   * is starred, so a `starred` selection of exactly {"starred"} correctly
   * matches no rows while {"unstarred"} matches all of them.
   */
  starredKeys?: ReadonlySet<string>;
}

/** OR within a column, AND across columns; an empty column selection passes. */
export function rowMatchesFilters(row: VacancyDirectoryRow, filters: DirectoryFilters): boolean {
  if (filters.areaId != null && row.clusterId !== filters.areaId) return false;
  if (filters.sectors.size > 0 && !filters.sectors.has(rowSector(row))) return false;
  if (filters.structures.size > 0 && !filters.structures.has(rowStructure(row))) return false;
  if (filters.types.size > 0 && !filters.types.has(row.propertyType)) return false;
  if (filters.flags.size > 0 && !rowFlags(row).some((f) => filters.flags.has(f))) return false;
  if (filters.starred && filters.starred.size > 0) {
    const value: StarValue = rowIsStarred(row, filters.starredKeys ?? new Set())
      ? "starred"
      : "unstarred";
    if (!filters.starred.has(value)) return false;
  }
  const needle = filters.search.trim().toLowerCase();
  if (needle && !row.address.toLowerCase().includes(needle)) return false;
  return true;
}

/**
 * Filter then sort by address. The public directory stays neutral: address order
 * is explicit and does not reveal or imply the export's private ordering inputs.
 * Returns a new array — never mutates the input.
 */
export function filterAndSortRows(
  rows: readonly VacancyDirectoryRow[],
  filters: DirectoryFilters,
  sortDir: SortDir,
): VacancyDirectoryRow[] {
  const out = rows.filter((r) => rowMatchesFilters(r, filters));
  out.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  if (sortDir === "desc") out.reverse();
  return out;
}
