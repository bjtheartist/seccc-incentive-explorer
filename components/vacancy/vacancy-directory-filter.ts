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
}

/** OR within a column, AND across columns; an empty column selection passes. */
export function rowMatchesFilters(row: VacancyDirectoryRow, filters: DirectoryFilters): boolean {
  if (filters.areaId != null && row.clusterId !== filters.areaId) return false;
  if (filters.sectors.size > 0 && !filters.sectors.has(rowSector(row))) return false;
  if (filters.structures.size > 0 && !filters.structures.has(rowStructure(row))) return false;
  if (filters.types.size > 0 && !filters.types.has(row.propertyType)) return false;
  if (filters.flags.size > 0 && !rowFlags(row).some((f) => filters.flags.has(f))) return false;
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
