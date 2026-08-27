import type { VacancyPropertyType } from "@/lib/vacancy-evidence";
import {
  CCLBA_PUBLIC_DATASET_ID,
  CCLBA_PUBLIC_PORTAL_URL,
} from "@/lib/vacancy-inventory-sources";
import type { CclbaSourceCoverage } from "@/lib/drawn-area-vacancy";

export const STATIC_FALLBACK_LIMIT = 2_000;

/** Minimum per-class representation when that class exists in the live snapshot. */
export const STATIC_FALLBACK_TYPE_QUOTAS: Readonly<
  Record<VacancyPropertyType, number>
> = {
  vacant_land: 600,
  reported_vacant_lot: 600,
  vacant_building: 600,
  vacant_storefront: 100,
};

export function staticFallbackReservedCount(): number {
  return Object.values(STATIC_FALLBACK_TYPE_QUOTAS).reduce(
    (total, quota) => total + quota,
    0,
  );
}

export function normalizeStaticFallbackTimestamp(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

type StaticFallbackRow = {
  id?: unknown;
  source?: unknown;
  source_row_id?: unknown;
  source_dataset_id?: unknown;
  source_url?: unknown;
  source_retrieved_at?: unknown;
};

/**
 * Fail the export before it can publish a bounded fallback that silently drops
 * located CCLBA records or detaches them from the official source snapshot.
 */
export function assertStaticFallbackCclbaPublication(
  rows: readonly StaticFallbackRow[],
  coverage: CclbaSourceCoverage,
): void {
  if (rows.length > STATIC_FALLBACK_LIMIT) {
    throw new Error(
      `Static fallback selected ${rows.length} rows; limit is ${STATIC_FALLBACK_LIMIT}`,
    );
  }
  const cclbaRows = rows.filter((row) => row.source === "cclba");
  if (coverage.status !== "available") {
    if (cclbaRows.length > 0) {
      throw new Error(
        "Static fallback cannot publish CCLBA rows without available source coverage",
      );
    }
    return;
  }

  if (cclbaRows.length !== coverage.locatedChicagoTotal) {
    throw new Error(
      `Static fallback selected ${cclbaRows.length} of ${coverage.locatedChicagoTotal} located CCLBA rows`,
    );
  }

  const ids = new Set<string>();
  const sourceRowIds = new Set<string>();
  for (const row of cclbaRows) {
    const id = typeof row.id === "string" ? row.id : "";
    const sourceRowId =
      typeof row.source_row_id === "string" ? row.source_row_id : "";
    if (!sourceRowId || id !== `cclba-${sourceRowId}`) {
      throw new Error("Static fallback CCLBA identity contract failed");
    }
    if (ids.has(id) || sourceRowIds.has(sourceRowId)) {
      throw new Error("Static fallback contains duplicate CCLBA identities");
    }
    if (
      row.source_dataset_id !== CCLBA_PUBLIC_DATASET_ID ||
      row.source_url !== CCLBA_PUBLIC_PORTAL_URL
    ) {
      throw new Error("Static fallback CCLBA provenance contract failed");
    }
    if (
      normalizeStaticFallbackTimestamp(row.source_retrieved_at) !==
      coverage.retrievedAt
    ) {
      throw new Error("Static fallback CCLBA retrieval snapshot drifted");
    }
    ids.add(id);
    sourceRowIds.add(sourceRowId);
  }
}
