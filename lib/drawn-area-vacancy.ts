export interface VacancyCoverageMetadata {
  sourceMode: "database" | "static_fallback";
  sourcePath: "database:vacant_properties" | "/data/vacant-properties.json";
  asOf: string | null;
  asOfBasis:
    | "latest_queried_row_updated_at"
    | "static_export_generated_at"
    | null;
  returnedCount: number;
  configuredLimit: number;
  queryLimit: number | null;
  coverageStatus: "complete" | "truncated" | "partial";
  potentiallyTruncated: boolean;
  fallbackReason: "database_unavailable" | "database_query_failed" | null;
}

export type VacancyFeatureCollection = GeoJSON.FeatureCollection & {
  meta: VacancyCoverageMetadata;
};

export const VACANCY_LOOKUP_UNAVAILABLE_NOTE =
  "Vacancy records could not be checked right now. This is a lookup failure, not evidence that the area has no tracked vacancies.";

function isFiniteNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isVacancyCoverageMetadata(value: unknown): value is VacancyCoverageMetadata {
  if (!value || typeof value !== "object") return false;
  const meta = value as Partial<VacancyCoverageMetadata>;
  return (
    (meta.sourceMode === "database" || meta.sourceMode === "static_fallback") &&
    (meta.sourcePath === "database:vacant_properties" ||
      meta.sourcePath === "/data/vacant-properties.json") &&
    (meta.asOf === null || typeof meta.asOf === "string") &&
    (meta.asOfBasis === null ||
      meta.asOfBasis === "latest_queried_row_updated_at" ||
      meta.asOfBasis === "static_export_generated_at") &&
    isFiniteNonnegativeNumber(meta.returnedCount) &&
    isFiniteNonnegativeNumber(meta.configuredLimit) &&
    (meta.queryLimit === null || isFiniteNonnegativeNumber(meta.queryLimit)) &&
    (meta.coverageStatus === "complete" ||
      meta.coverageStatus === "truncated" ||
      meta.coverageStatus === "partial") &&
    typeof meta.potentiallyTruncated === "boolean" &&
    (meta.fallbackReason === null ||
      meta.fallbackReason === "database_unavailable" ||
      meta.fallbackReason === "database_query_failed")
  );
}

/**
 * Parse the drawn-area vacancy response without manufacturing an empty result.
 * Missing or malformed coverage metadata is a source failure, because the
 * caller cannot otherwise distinguish complete results from fallback coverage.
 */
export function parseDrawnAreaVacancyResponse(
  value: unknown,
): VacancyFeatureCollection | null {
  if (!value || typeof value !== "object") return null;
  const collection = value as Partial<VacancyFeatureCollection>;
  if (
    collection.type !== "FeatureCollection" ||
    !Array.isArray(collection.features) ||
    !isVacancyCoverageMetadata(collection.meta) ||
    collection.meta.returnedCount !== collection.features.length
  ) {
    return null;
  }
  return collection as VacancyFeatureCollection;
}

export function vacancyCoverageDisclosure(
  coverage: VacancyCoverageMetadata | null | undefined,
): string | null {
  if (!coverage) return null;
  if (coverage.coverageStatus === "partial") {
    const reason =
      coverage.fallbackReason === "database_query_failed"
        ? "the primary database query failed"
        : "the primary database was unavailable";
    const limitNote = coverage.potentiallyTruncated
      ? ` The fallback also reached its ${coverage.configuredLimit.toLocaleString("en-US")}-record limit.`
      : "";
    return `Vacancy results are partial: the published static fallback was used because ${reason}. Absence from these results does not establish that no tracked vacancy exists.${limitNote}`;
  }
  if (coverage.coverageStatus === "truncated") {
    return `Vacancy results reached the ${coverage.configuredLimit.toLocaleString("en-US")}-record response limit. Counts and exports may omit additional tracked records.`;
  }
  return null;
}
