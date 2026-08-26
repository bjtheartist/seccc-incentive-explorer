import {
  canonicalVacancyType,
  chicagoCalendarDay,
  classifyVacancyFreshness,
  isVacancySourceTypePair,
  summarizeVacancyFreshness,
  vacancyFreshnessCutoff,
  type VacancyFreshnessMetadata,
} from "@/lib/vacancy-evidence";
import {
  VACANCY_LICENSE_ADDRESS_CAP,
  VACANCY_LICENSE_BATCH_SIZE,
  type VacancyLicenseScreeningMetadata,
} from "@/lib/vacancy-license-screening";
import { isCanonicalVacancyZoneMatchSet } from "@/lib/vacancy-zone-matches";
import {
  CCLBA_PUBLIC_DATASET_ID,
  CCLBA_PUBLIC_PORTAL_URL,
} from "@/lib/vacancy-inventory-sources";

export type CclbaSourceCoverageUnavailableReason =
  | "metadata_unavailable"
  | "snapshot_not_recorded"
  | "malformed_metadata"
  | "not_recorded_at_generation";

export type CclbaSourceCoverage =
  | {
      status: "available";
      source: "cclba";
      sourceDatasetId: typeof CCLBA_PUBLIC_DATASET_ID;
      sourceUrl: typeof CCLBA_PUBLIC_PORTAL_URL;
      publishedCountyTotal: number;
      chicagoTotal: number;
      locatedChicagoTotal: number;
      unlocatedChicagoTotal: number;
      sourceAsOf: string | null;
      retrievedAt: string;
    }
  | {
      status: "unavailable";
      source: "cclba";
      sourceDatasetId: typeof CCLBA_PUBLIC_DATASET_ID;
      sourceUrl: typeof CCLBA_PUBLIC_PORTAL_URL;
      reason: CclbaSourceCoverageUnavailableReason;
    };

export interface VacancyCoverageMetadata {
  sourceMode: "database" | "static_fallback";
  sourcePath: "database:vacant_properties" | "/data/vacant-properties.json";
  asOf: string | null;
  asOfBasis:
    | "explorer_refresh_timestamp"
    | "static_export_generated_at"
    | null;
  /** Explicit name for `asOf`; never an original vacancy report date. */
  explorerRefreshedAt: string | null;
  freshness: VacancyFreshnessMetadata;
  licenseScreening: VacancyLicenseScreeningMetadata;
  returnedCount: number;
  configuredLimit: number;
  queryLimit: number | null;
  coverageStatus: "complete" | "truncated" | "partial";
  potentiallyTruncated: boolean;
  fallbackReason: "database_unavailable" | "database_query_failed" | null;
  /**
   * Coverage of the upstream CCLBA snapshot, distinct from this request's
   * point-in-polygon/query completeness. Unlocated Chicago source rows cannot
   * enter the point table and therefore must remain visible here.
   */
  cclbaSourceCoverage: CclbaSourceCoverage;
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

export function unavailableCclbaSourceCoverage(
  reason: CclbaSourceCoverageUnavailableReason,
): CclbaSourceCoverage {
  return {
    status: "unavailable",
    source: "cclba",
    sourceDatasetId: CCLBA_PUBLIC_DATASET_ID,
    sourceUrl: CCLBA_PUBLIC_PORTAL_URL,
    reason,
  };
}

export function normalizeCclbaSourceCoverage(
  value: unknown,
): CclbaSourceCoverage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const coverage = value as Record<string, unknown>;
  if (
    coverage.source !== "cclba" ||
    coverage.sourceDatasetId !== CCLBA_PUBLIC_DATASET_ID ||
    coverage.sourceUrl !== CCLBA_PUBLIC_PORTAL_URL
  ) {
    return null;
  }
  if (coverage.status === "unavailable") {
    if (
      coverage.reason !== "metadata_unavailable" &&
      coverage.reason !== "snapshot_not_recorded" &&
      coverage.reason !== "malformed_metadata" &&
      coverage.reason !== "not_recorded_at_generation"
    ) {
      return null;
    }
    return unavailableCclbaSourceCoverage(coverage.reason);
  }
  if (coverage.status !== "available") return null;
  if (
    !isNonnegativeInteger(coverage.publishedCountyTotal) ||
    !isNonnegativeInteger(coverage.chicagoTotal) ||
    !isNonnegativeInteger(coverage.locatedChicagoTotal) ||
    !isNonnegativeInteger(coverage.unlocatedChicagoTotal) ||
    coverage.chicagoTotal > coverage.publishedCountyTotal ||
    coverage.locatedChicagoTotal + coverage.unlocatedChicagoTotal !==
      coverage.chicagoTotal ||
    typeof coverage.retrievedAt !== "string" ||
    !isCanonicalIsoTimestamp(coverage.retrievedAt) ||
    (coverage.sourceAsOf !== null &&
      (typeof coverage.sourceAsOf !== "string" ||
        !isCanonicalIsoTimestamp(coverage.sourceAsOf)))
  ) {
    return null;
  }
  return {
    status: "available",
    source: "cclba",
    sourceDatasetId: CCLBA_PUBLIC_DATASET_ID,
    sourceUrl: CCLBA_PUBLIC_PORTAL_URL,
    publishedCountyTotal: coverage.publishedCountyTotal,
    chicagoTotal: coverage.chicagoTotal,
    locatedChicagoTotal: coverage.locatedChicagoTotal,
    unlocatedChicagoTotal: coverage.unlocatedChicagoTotal,
    sourceAsOf: coverage.sourceAsOf,
    retrievedAt: coverage.retrievedAt,
  };
}

export function cclbaSourceCoverageSummary(
  coverage: CclbaSourceCoverage | null | undefined,
): string {
  if (!coverage) return "Not recorded";
  if (coverage.status === "unavailable") {
    return `Unavailable (${coverage.reason})`;
  }
  const sourceAsOf = coverage.sourceAsOf ?? "not published by source";
  return [
    `${coverage.publishedCountyTotal.toLocaleString("en-US")} published countywide`,
    `${coverage.chicagoTotal.toLocaleString("en-US")} Chicago`,
    `${coverage.locatedChicagoTotal.toLocaleString("en-US")} located Chicago`,
    `${coverage.unlocatedChicagoTotal.toLocaleString("en-US")} unlocated Chicago`,
    `retrieved ${coverage.retrievedAt}`,
    `source as-of ${sourceAsOf}`,
    `dataset ${coverage.sourceDatasetId}`,
    coverage.sourceUrl,
  ].join("; ");
}

function isAbsoluteHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isVacancyLicenseScreeningMetadata(
  value: unknown,
  returnedCount: number,
): value is VacancyLicenseScreeningMetadata {
  if (!value || typeof value !== "object") return false;
  const meta = value as Partial<VacancyLicenseScreeningMetadata>;
  return (
    meta.policyVersion === "issued-exact-address-v4" &&
    meta.sourcePath ===
      "https://data.cityofchicago.org/resource/r5kz-chrr.json" &&
    (meta.status === "available" ||
      meta.status === "partial" ||
      meta.status === "unavailable") &&
    typeof meta.checkedAt === "string" &&
    isCanonicalIsoTimestamp(meta.checkedAt) &&
    isNonnegativeInteger(meta.candidateCount) &&
    isNonnegativeInteger(meta.checkedCount) &&
    isNonnegativeInteger(meta.matchedPropertyCount) &&
    meta.matchedPropertyCount <= returnedCount &&
    meta.checkedCount <= meta.candidateCount &&
    meta.candidateCount <= returnedCount &&
    typeof meta.capped === "boolean" &&
    meta.addressCap === 500 &&
    isNonnegativeInteger(meta.sourceCallCount) &&
    meta.sourceCallCount <= 40 &&
    isNonnegativeInteger(meta.successfulBatches) &&
    isNonnegativeInteger(meta.failedBatches) &&
    meta.successfulBatches + meta.failedBatches <= 10 &&
    isNonnegativeInteger(meta.malformedRowCount) &&
    Array.isArray(meta.partialReasons) &&
    new Set(meta.partialReasons).size === meta.partialReasons.length &&
    meta.partialReasons.every(
      (reason) =>
        reason === "address_cap" ||
        reason === "source_batch_failure" ||
        reason === "malformed_source_rows",
    ) &&
    Array.isArray(meta.caveats) &&
    meta.caveats.every((caveat) => typeof caveat === "string")
  );
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
  const explorerRefreshIsCoherent =
    meta.explorerRefreshedAt === meta.asOf;
  const freshness = meta.freshness;
  const freshnessIsCoherent =
    !!freshness &&
    freshness.policyVersion === "source-record-date-v1" &&
    freshness.recentWithinYears === 3 &&
    freshness.retainedWithinYears === 5 &&
    typeof freshness.referenceDate === "string" &&
    isCanonicalIsoTimestamp(freshness.referenceDate) &&
    typeof freshness.cutoffDate === "string" &&
    isCanonicalIsoTimestamp(freshness.cutoffDate) &&
    typeof freshness.retentionPolicyCutoffDate === "string" &&
    isCanonicalIsoTimestamp(freshness.retentionPolicyCutoffDate) &&
    freshness.retentionCutoffBasis === "current_request_reference_policy" &&
    isNonnegativeInteger(freshness.returnedCounts?.recent) &&
    isNonnegativeInteger(freshness.returnedCounts?.stale) &&
    isNonnegativeInteger(freshness.returnedCounts?.unknownDate) &&
    freshness.returnedCounts.recent +
      freshness.returnedCounts.stale +
      freshness.returnedCounts.unknownDate ===
      meta.returnedCount &&
    freshness.cutoffDate === vacancyFreshnessCutoff(freshness.referenceDate) &&
    freshness.retentionPolicyCutoffDate ===
      vacancyFreshnessCutoff(
        freshness.referenceDate,
        freshness.retainedWithinYears,
      );
  if (!explorerRefreshIsCoherent || !freshnessIsCoherent) return false;
  if (!isVacancyLicenseScreeningMetadata(meta.licenseScreening, meta.returnedCount)) {
    return false;
  }
  if (!normalizeCclbaSourceCoverage(meta.cclbaSourceCoverage)) return false;

  if (meta.sourceMode === "database") {
    return (
      meta.sourcePath === "database:vacant_properties" &&
      meta.queryLimit === meta.configuredLimit + 1 &&
      meta.fallbackReason === null &&
      ((hasAsOf && meta.asOfBasis === "explorer_refresh_timestamp") ||
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

function isVacancyEvidenceFeature(feature: GeoJSON.Feature): boolean {
  if (
    feature.geometry?.type !== "Point" ||
    !Array.isArray(feature.geometry.coordinates) ||
    feature.geometry.coordinates.length < 2 ||
    !feature.geometry.coordinates.slice(0, 2).every(Number.isFinite) ||
    feature.geometry.coordinates[0] < -88 ||
    feature.geometry.coordinates[0] > -87.4 ||
    feature.geometry.coordinates[1] < 41.6 ||
    feature.geometry.coordinates[1] > 42.1
  ) {
    return false;
  }
  const properties = feature.properties;
  if (!properties || typeof properties !== "object") return false;
  const sourceDate = properties.sourceRecordDate;
  const refreshedAt = properties.explorerRefreshedAt;
  const sourceAsOf = properties.sourceAsOf;
  const sourceRetrievedAt = properties.sourceRetrievedAt;
  const sourceSnapshotId = properties.sourceSnapshotId;
  const licenseCheckState = properties.licenseCheckState;
  const sourceIsKnown =
    properties.source === "cols" ||
    properties.source === "cclba" ||
    properties.source === "dpd_vacant" ||
    properties.source === "311_clean_lot" ||
    properties.source === "violations";
  const propertyTypeIsKnown =
    properties.propertyType === "vacant_land" ||
    properties.propertyType === "reported_vacant_lot" ||
    properties.propertyType === "vacant_building" ||
    properties.propertyType === "vacant_storefront";
  const matches = properties.currentLicenseMatches;
  const licenseMatchesAreCoherent =
    Array.isArray(matches) &&
    matches.every(
      (match) =>
        !!match &&
        typeof match === "object" &&
        typeof (match as Record<string, unknown>).name === "string" &&
        typeof (match as Record<string, unknown>).description === "string" &&
        (match as Record<string, unknown>).status === "AAI" &&
        typeof (match as Record<string, unknown>).expirationDate === "string",
    ) &&
    ((licenseCheckState === "match" && matches.length > 0) ||
      (licenseCheckState !== "match" && matches.length === 0));
  const optionalTextFieldsAreCoherent = [
    properties.recordId,
    properties.sourceDatasetId,
    properties.sourceDatasetLabel,
    properties.sourceSnapshotId,
    properties.sourceRowId,
    properties.sourceUrl,
    properties.ownerJurisdiction,
    properties.managingOrganization,
    properties.programName,
    properties.programKey,
    properties.offerRound,
    properties.applicationUse,
    properties.applicationUrl,
    properties.propertyStatus,
    properties.salesStatus,
    properties.saleOfferingStatus,
    properties.saleOfferingReason,
  ].every(
    (field) =>
      field === undefined ||
      field === null ||
      (typeof field === "string" && field.trim().length > 0),
  );
  const sourceSnapshotIsCoherent =
    sourceSnapshotId === undefined ||
    sourceSnapshotId === null;
  const sourceLinksAreCoherent = [properties.sourceUrl, properties.applicationUrl]
    .every(
      (value) =>
        value === undefined || value === null || isAbsoluteHttpUrl(value),
    );
  return (
    typeof properties.id === "string" &&
    properties.id.trim().length > 0 &&
    typeof properties.address === "string" &&
    properties.address.trim().length > 0 &&
    typeof properties.status === "string" &&
    properties.status.trim().length > 0 &&
    sourceIsKnown &&
    propertyTypeIsKnown &&
    isVacancySourceTypePair(properties.source, properties.propertyType) &&
    properties.canonicalType === canonicalVacancyType(properties.propertyType) &&
    (properties.freshnessClass === "recent" ||
      properties.freshnessClass === "stale" ||
      properties.freshnessClass === "unknown_date") &&
    (sourceDate === null ||
      (typeof sourceDate === "string" && isCanonicalIsoTimestamp(sourceDate))) &&
    (refreshedAt === null ||
      (typeof refreshedAt === "string" && isCanonicalIsoTimestamp(refreshedAt))) &&
    (sourceAsOf === undefined ||
      sourceAsOf === null ||
      (typeof sourceAsOf === "string" && isCanonicalIsoTimestamp(sourceAsOf))) &&
    (sourceRetrievedAt === undefined ||
      sourceRetrievedAt === null ||
      (typeof sourceRetrievedAt === "string" &&
        isCanonicalIsoTimestamp(sourceRetrievedAt))) &&
    (properties.pin === undefined ||
      properties.pin === null ||
      (typeof properties.pin === "string" && /^\d{14}$/.test(properties.pin))) &&
    (properties.applicationOpens === undefined ||
      properties.applicationOpens === null ||
      (typeof properties.applicationOpens === "string" &&
        isCanonicalIsoTimestamp(properties.applicationOpens))) &&
    (properties.applicationDeadline === undefined ||
      properties.applicationDeadline === null ||
      (typeof properties.applicationDeadline === "string" &&
        isCanonicalIsoTimestamp(properties.applicationDeadline))) &&
    (properties.programContext === undefined ||
      Array.isArray(properties.programContext)) &&
    optionalTextFieldsAreCoherent &&
    sourceSnapshotIsCoherent &&
    sourceLinksAreCoherent &&
    (licenseCheckState === "match" ||
      licenseCheckState === "no_match" ||
      licenseCheckState === "not_checked_address" ||
      licenseCheckState === "not_checked_cap" ||
      licenseCheckState === "unavailable") &&
    licenseMatchesAreCoherent &&
    isCanonicalVacancyZoneMatchSet(properties.zoneMatches) &&
    properties.incentiveCount === properties.zoneMatches.length &&
    (properties.licenseCheckedAt === null ||
      (typeof properties.licenseCheckedAt === "string" &&
        isCanonicalIsoTimestamp(properties.licenseCheckedAt)))
  );
}

function canonicalScreeningAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ").toUpperCase();
  return normalized.length >= 5 ? normalized : null;
}

function collectionEvidenceIsCoherent(
  features: readonly GeoJSON.Feature[],
  meta: VacancyCoverageMetadata,
): boolean {
  const license = meta.licenseScreening;
  if (!license.checkedAt) return false;
  const licenseCheckedAt = license.checkedAt;
  const expectedFreshness = summarizeVacancyFreshness(features);
  if (
    expectedFreshness.recent !== meta.freshness.returnedCounts.recent ||
    expectedFreshness.stale !== meta.freshness.returnedCounts.stale ||
    expectedFreshness.unknownDate !== meta.freshness.returnedCounts.unknownDate
  ) {
    return false;
  }

  const addressStates = new Map<string, string>();
  const candidateAddresses = new Set<string>();
  const checkedAddresses = new Set<string>();
  let matchedProperties = 0;
  let cappedProperties = 0;
  let unavailableProperties = 0;

  for (const feature of features) {
    const properties = feature.properties ?? {};
    if (
      properties.freshnessClass !==
      classifyVacancyFreshness(
        properties.sourceRecordDate,
        meta.freshness.referenceDate,
      )
    ) {
      return false;
    }

    const address = canonicalScreeningAddress(properties.address);
    const state = properties.licenseCheckState;
    const selectedForCheck =
      state === "match" || state === "no_match" || state === "unavailable";
    if (!address) {
      if (state !== "not_checked_address") return false;
    } else {
      candidateAddresses.add(address);
      if (state === "not_checked_address") return false;
      const priorState = addressStates.get(address);
      if (priorState && priorState !== state) return false;
      addressStates.set(address, String(state));
      if (state === "match" || state === "no_match") {
        checkedAddresses.add(address);
      }
    }

    if (state === "match") matchedProperties += 1;
    if (state === "not_checked_cap") cappedProperties += 1;
    if (state === "unavailable") unavailableProperties += 1;
    if (
      (selectedForCheck && properties.licenseCheckedAt !== licenseCheckedAt) ||
      (!selectedForCheck && properties.licenseCheckedAt !== null)
    ) {
      return false;
    }

    const matches = properties.currentLicenseMatches as Array<Record<string, unknown>>;
    if (
      matches.some(
        (match) =>
          typeof match.expirationDate !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(match.expirationDate) ||
          match.expirationDate <= chicagoCalendarDay(licenseCheckedAt),
      )
    ) {
      return false;
    }
  }

  const expectedBatches = Math.ceil(
    Math.min(candidateAddresses.size, VACANCY_LICENSE_ADDRESS_CAP) /
      VACANCY_LICENSE_BATCH_SIZE,
  );
  if (
    license.candidateCount !== candidateAddresses.size ||
    license.checkedCount !== checkedAddresses.size ||
    license.matchedPropertyCount !== matchedProperties ||
    license.capped !== (candidateAddresses.size > VACANCY_LICENSE_ADDRESS_CAP) ||
    license.successfulBatches + license.failedBatches !== expectedBatches ||
    license.sourceCallCount < expectedBatches ||
    license.partialReasons.includes("address_cap") !== license.capped ||
    license.partialReasons.includes("source_batch_failure") !==
      (license.failedBatches > 0) ||
    license.partialReasons.includes("malformed_source_rows") !==
      (license.malformedRowCount > 0) ||
    (license.capped && cappedProperties === 0) ||
    (!license.capped && cappedProperties > 0)
  ) {
    return false;
  }

  if (license.status === "available") {
    return (
      license.failedBatches === 0 &&
      !license.capped &&
      license.malformedRowCount === 0 &&
      license.partialReasons.length === 0 &&
      unavailableProperties === 0
    );
  }
  if (license.status === "unavailable") {
    return (
      expectedBatches > 0 &&
      license.successfulBatches === 0 &&
      license.failedBatches === expectedBatches &&
      license.checkedCount === 0 &&
      matchedProperties === 0 &&
      unavailableProperties > 0
    );
  }
  return license.checkedCount > 0 && license.partialReasons.length > 0;
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
    !collection.features.every(isVacancyEvidenceFeature) ||
    !isVacancyCoverageMetadata(collection.meta) ||
    collection.meta.returnedCount !== collection.features.length ||
    !collectionEvidenceIsCoherent(collection.features, collection.meta)
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
  let requestCoverageNote: string | null = null;
  if (coverage.coverageStatus === "partial") {
    const reason =
      coverage.fallbackReason === "database_query_failed"
        ? "the primary database query failed"
        : "the primary database was unavailable";
    const limitNote = coverage.potentiallyTruncated
      ? ` The fallback also reached its ${coverage.configuredLimit.toLocaleString("en-US")}-record limit.`
      : "";
    requestCoverageNote = `Vacancy results are partial: the published static fallback was used because ${reason}. Absence from these results does not establish that no tracked vacancy exists.${limitNote}`;
  }
  if (coverage.coverageStatus === "truncated") {
    requestCoverageNote = `Vacancy results reached the ${coverage.configuredLimit.toLocaleString("en-US")}-record response limit. Counts and exports may omit additional tracked records.`;
  }
  const sourceCoverage = coverage.cclbaSourceCoverage;
  const cclbaCoverageNote = sourceCoverage.status === "available"
    ? sourceCoverage.unlocatedChicagoTotal > 0
      ? `The latest CCLBA published-property snapshot contained ${sourceCoverage.publishedCountyTotal.toLocaleString("en-US")} countywide records, including ${sourceCoverage.chicagoTotal.toLocaleString("en-US")} in Chicago. ${sourceCoverage.locatedChicagoTotal.toLocaleString("en-US")} Chicago records had usable coordinates; ${sourceCoverage.unlocatedChicagoTotal.toLocaleString("en-US")} could not be tested against this area. Publication and source status are not independent deed proof.`
      : null
    : "CCLBA source-coverage metadata is unavailable, so this result cannot quantify published CCLBA records excluded because they lacked usable coordinates.";
  return [requestCoverageNote, cclbaCoverageNote].filter(Boolean).join(" ") || null;
}
