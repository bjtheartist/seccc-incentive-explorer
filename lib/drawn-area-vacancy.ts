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

export const DRAWN_AREA_VACANCY_LIMIT = 10_000;
export const DRAWN_AREA_VACANCY_REQUEST_TIMEOUT_MS = 15_000;

export interface DrawnAreaVacancyFetchOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface DrawnAreaVacancyRequestToken {
  signal: AbortSignal;
  isCurrent: () => boolean;
  release: () => void;
}

export interface DrawnAreaVacancyRequestLifecycle {
  start: () => DrawnAreaVacancyRequestToken;
  cancel: () => void;
}

/**
 * Own the single active drawn-area vacancy request. Aborting is the fast path;
 * the generation check is the integrity rail for fetch implementations that
 * resolve after abort, so an older polygon can never publish into a newer one.
 */
export function createDrawnAreaVacancyRequestLifecycle(): DrawnAreaVacancyRequestLifecycle {
  let generation = 0;
  let activeController: AbortController | null = null;

  const cancel = () => {
    generation += 1;
    activeController?.abort();
    activeController = null;
  };

  return {
    start() {
      cancel();
      const requestGeneration = generation;
      const controller = new AbortController();
      activeController = controller;

      return {
        signal: controller.signal,
        isCurrent: () =>
          !controller.signal.aborted &&
          generation === requestGeneration &&
          activeController === controller,
        release: () => {
          if (generation === requestGeneration && activeController === controller) {
            activeController = null;
          }
        },
      };
    },
    cancel,
  };
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isCanonicalIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isVacancyCoverageMetadata(value: unknown): value is VacancyCoverageMetadata {
  if (!value || typeof value !== "object") return false;
  const meta = value as Partial<VacancyCoverageMetadata>;
  if (
    !isNonnegativeInteger(meta.returnedCount) ||
    meta.configuredLimit !== DRAWN_AREA_VACANCY_LIMIT ||
    meta.returnedCount > meta.configuredLimit ||
    typeof meta.potentiallyTruncated !== "boolean"
  ) {
    return false;
  }

  const hasAsOf =
    typeof meta.asOf === "string" && isCanonicalIsoTimestamp(meta.asOf);
  const hasNoAsOf = meta.asOf === null;
  const truncationIsCoherent =
    !meta.potentiallyTruncated || meta.returnedCount === meta.configuredLimit;
  if ((!hasAsOf && !hasNoAsOf) || !truncationIsCoherent) return false;

  if (meta.sourceMode === "database") {
    return (
      meta.sourcePath === "database:vacant_properties" &&
      meta.queryLimit === meta.configuredLimit + 1 &&
      meta.fallbackReason === null &&
      ((hasAsOf && meta.asOfBasis === "latest_queried_row_updated_at") ||
        (hasNoAsOf && meta.asOfBasis === null)) &&
      ((meta.coverageStatus === "complete" && !meta.potentiallyTruncated) ||
        (meta.coverageStatus === "truncated" && meta.potentiallyTruncated))
    );
  }

  if (meta.sourceMode === "static_fallback") {
    return (
      meta.sourcePath === "/data/vacant-properties.json" &&
      meta.queryLimit === null &&
      meta.coverageStatus === "partial" &&
      (meta.fallbackReason === "database_unavailable" ||
        meta.fallbackReason === "database_query_failed") &&
      ((hasAsOf && meta.asOfBasis === "static_export_generated_at") ||
        (hasNoAsOf && meta.asOfBasis === null))
    );
  }

  return false;
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

export function drawnAreaVacancyRequestPath(polygon: GeoJSON.Polygon): string {
  const params = new URLSearchParams({ polygon: JSON.stringify(polygon) });
  return `/api/vacant?${params.toString()}`;
}

/**
 * Bound the network request independently from polygon generation ownership.
 * A timeout aborts only this fetch, so the current request can publish an
 * explicit failure; cancelling or superseding the polygon still invalidates it.
 */
export async function fetchDrawnAreaVacancy(
  polygon: GeoJSON.Polygon,
  options: DrawnAreaVacancyFetchOptions = {},
): Promise<VacancyFeatureCollection> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const relayAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    relayAbort();
  } else {
    options.signal?.addEventListener("abort", relayAbort, { once: true });
  }
  const timeoutId = setTimeout(
    () =>
      controller.abort(
        new DOMException("Drawn-area vacancy request timed out", "TimeoutError"),
      ),
    options.timeoutMs ?? DRAWN_AREA_VACANCY_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetchImpl(drawnAreaVacancyRequestPath(polygon), {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Drawn-area vacancy request failed with HTTP ${response.status}`);
    }

    const body: unknown = await response.json();
    const result = parseDrawnAreaVacancyResponse(body);
    if (!result) throw new Error("Malformed vacancy response");
    return result;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", relayAbort);
  }
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
