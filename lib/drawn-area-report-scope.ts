import type { VacancyLicenseFilter } from "@/lib/area-vacancy-presentation";
import {
  normalizeCclbaSourceCoverage,
  unavailableCclbaSourceCoverage,
  type CclbaSourceCoverage,
  type VacancyCoverageMetadata,
} from "@/lib/drawn-area-vacancy";
import type { PermitAreaResult } from "@/lib/permit-area";
import type { VacancyFreshnessFilter } from "@/lib/vacancy-evidence";
import type { VacancyLicenseScreeningStatus } from "@/lib/vacancy-license-screening";

/**
 * Persisted contract for a report generated from the map's drawn-area tool.
 *
 * A community-area name is useful context, but it is never the report scope.
 * The only selectable geography in this contract is the exact GeoJSON Polygon
 * the user drew. Consumers must resolve this contract before considering any
 * legacy neighborhood/community-area report behavior.
 */
export const DRAWN_AREA_REPORT_SCOPE_VERSION = 1 as const;
export const DRAWN_AREA_REPORT_MAX_RINGS = 20;
export const DRAWN_AREA_REPORT_MAX_POSITIONS = 5_000;
export const DRAWN_AREA_REPORT_MAX_RECORD_REFS = 10_000;
export const DRAWN_AREA_REPORT_MAX_NAME_LENGTH = 200;

export type DrawnAreaVacancySourceMode = "database" | "static_fallback";
export type DrawnAreaVacancySourcePath =
  | "database:vacant_properties"
  | "/data/vacant-properties.json";
export type DrawnAreaVacancyCoverageStatus =
  | "complete"
  | "truncated"
  | "partial";
export type DrawnAreaVacancyFallbackReason =
  | "database_unavailable"
  | "database_query_failed";

export interface DrawnAreaRecordRef {
  /** Stable record id published by the vacancy response. */
  recordId: string;
  /** Upstream snapshot/version id when the record publishes one. Never inferred. */
  sourceSnapshotId?: string;
}

export interface DrawnAreaVacancySourceProvenance {
  mode: DrawnAreaVacancySourceMode;
  path: DrawnAreaVacancySourcePath;
  /** Explorer refresh/export timestamp; never represented as a source record date. */
  explorerRefreshedAt: string | null;
  asOfBasis:
    | "explorer_refresh_timestamp"
    | "static_export_generated_at"
    | null;
}

export interface DrawnAreaVacancyCoverageProvenance {
  status: DrawnAreaVacancyCoverageStatus;
  returnedCount: number;
  configuredLimit: number;
  potentiallyTruncated: boolean;
  fallbackReason: DrawnAreaVacancyFallbackReason | null;
  /** Generation-time BACP screening coverage; `available` is the complete state. */
  licenseScreeningStatus: VacancyLicenseScreeningStatus;
  /** Generation-time upstream CCLBA coverage, including unlocated Chicago rows. */
  cclbaSourceCoverage: CclbaSourceCoverage;
}

export interface DrawnAreaVacancyFilterProvenance {
  freshness: VacancyFreshnessFilter;
  license: VacancyLicenseFilter;
}

export interface DrawnAreaVacancyProvenance {
  status: "ready" | "unavailable";
  source: DrawnAreaVacancySourceProvenance | null;
  coverage: DrawnAreaVacancyCoverageProvenance | null;
  filters: DrawnAreaVacancyFilterProvenance;
  /** Count returned by the polygon lookup before the user's display filters. */
  returnedCountBeforeFilters: number | null;
  /** Exact selected count represented by recordRefsAtGeneration. */
  selectedCount: number;
  /**
   * Compact proof of the saved selection. This avoids embedding up to 10,000
   * full feature payloads while allowing a later polygon re-query to disclose
   * additions, removals, and changed source snapshots.
   */
  recordRefsAtGeneration: DrawnAreaRecordRef[];
}

export interface DrawnAreaPermitSourceProvenance {
  label: string;
  url: string;
  portalUrl: string;
  dataWindow: string;
  sourceRefreshedAt: string | null;
  sourceRefreshBasis: "latest_queried_row_fetched_at" | null;
}

export interface DrawnAreaPermitCoverageProvenance {
  locatedRecordsOnly: true;
  totalFilings: number;
  recordsReturned: number;
  recordsTruncated: boolean;
}

export interface DrawnAreaPermitProvenance {
  status: "ready" | "unavailable" | "not_attached";
  source: DrawnAreaPermitSourceProvenance | null;
  coverage: DrawnAreaPermitCoverageProvenance | null;
}

export interface DrawnAreaReportScope {
  version: typeof DRAWN_AREA_REPORT_SCOPE_VERSION;
  kind: "drawn-area";
  /** Explicitly excludes community-area, ward, bounds, or point fallback. */
  scope: {
    type: "polygon";
    geometry: GeoJSON.Polygon;
    /** Browser-safe deterministic fingerprint of the normalized polygon. */
    fingerprint: string;
  };
  /** User-authored report/area name, preserving case and punctuation. */
  name: string;
  /** When this polygon selection and its provenance manifest were generated. */
  generatedAt: string;
  provenance: {
    vacancy: DrawnAreaVacancyProvenance;
    permit: DrawnAreaPermitProvenance;
  };
}

export type DrawnAreaReportScopeFailureReason =
  | "not-an-object"
  | "unsupported-version"
  | "wrong-kind"
  | "invalid-name"
  | "invalid-generated-at"
  | "invalid-polygon"
  | "invalid-fingerprint"
  | "invalid-provenance"
  | "invalid-record-manifest";

export interface DrawnAreaReportScopeSuccess {
  ok: true;
  scope: DrawnAreaReportScope;
}

export interface DrawnAreaReportScopeFailure {
  ok: false;
  reason: DrawnAreaReportScopeFailureReason;
  detail: string;
}

export type DrawnAreaReportScopeResult =
  | DrawnAreaReportScopeSuccess
  | DrawnAreaReportScopeFailure;

export type DrawnAreaReportScopeResolution =
  | { status: "ready"; scope: DrawnAreaReportScope }
  | {
      status: "unavailable";
      reason: "legacy-scope-missing" | "malformed-scope";
      detail: string;
    }
  | { status: "not-drawn-area" };

export interface CreateDrawnAreaReportScopeInput {
  name: string;
  geometry: unknown;
  generatedAt: string;
  vacancy: {
    loadFailed: boolean;
    coverage?: VacancyCoverageMetadata | null;
    freshnessFilter: VacancyFreshnessFilter;
    licenseFilter: VacancyLicenseFilter;
    /** The full polygon result count before the two presentation filters. */
    returnedCountBeforeFilters: number | null;
    /** The exact feature set represented in the saved report/export. */
    selectedFeatures: readonly unknown[];
  };
  permit?: {
    analysis?: PermitAreaResult | null;
    loadFailed?: boolean;
  };
}

type Position = [number, number];

function fail(
  reason: DrawnAreaReportScopeFailureReason,
  detail: string,
): DrawnAreaReportScopeFailure {
  return { ok: false, reason, detail };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function normalizedCoordinate(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function ringHasArea(ring: readonly Position[]): boolean {
  let doubledArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    doubledArea += current[0] * next[1] - next[0] * current[1];
  }
  return Number.isFinite(doubledArea) && Math.abs(doubledArea) > Number.EPSILON;
}

/**
 * Validate and clone the persisted polygon. This intentionally accepts only
 * two-dimensional Polygon coordinates: a saved drawn area must never decode as
 * a point, bounds, MultiPolygon, or a community-area fallback.
 */
export function normalizeDrawnAreaPolygon(value: unknown): GeoJSON.Polygon | null {
  if (!isPlainObject(value) || value.type !== "Polygon") return null;
  if (
    !Array.isArray(value.coordinates) ||
    value.coordinates.length === 0 ||
    value.coordinates.length > DRAWN_AREA_REPORT_MAX_RINGS
  ) {
    return null;
  }

  let positionCount = 0;
  const coordinates: Position[][] = [];

  for (const rawRing of value.coordinates) {
    if (!Array.isArray(rawRing) || rawRing.length < 4) return null;
    positionCount += rawRing.length;
    if (positionCount > DRAWN_AREA_REPORT_MAX_POSITIONS) return null;

    const ring: Position[] = [];
    for (const rawPosition of rawRing) {
      if (
        !Array.isArray(rawPosition) ||
        rawPosition.length !== 2 ||
        typeof rawPosition[0] !== "number" ||
        typeof rawPosition[1] !== "number" ||
        !Number.isFinite(rawPosition[0]) ||
        !Number.isFinite(rawPosition[1]) ||
        rawPosition[0] < -180 ||
        rawPosition[0] > 180 ||
        rawPosition[1] < -90 ||
        rawPosition[1] > 90
      ) {
        return null;
      }
      ring.push([
        normalizedCoordinate(rawPosition[0]),
        normalizedCoordinate(rawPosition[1]),
      ]);
    }

    if (!samePosition(ring[0], ring[ring.length - 1])) return null;
    const uniquePositions = new Set(
      ring.slice(0, -1).map(([longitude, latitude]) => `${longitude},${latitude}`),
    );
    if (uniquePositions.size < 3 || !ringHasArea(ring)) return null;
    coordinates.push(ring);
  }

  return { type: "Polygon", coordinates };
}

/**
 * Small synchronous fingerprint for client and server bundles. It is an
 * integrity/deduplication key, not a cryptographic signature. Two independent
 * 32-bit streams make accidental collisions less likely while keeping the
 * implementation browser-safe (no node:crypto and no async Web Crypto call).
 */
function browserSafeFingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return [first, second]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

export function drawnAreaScopeFingerprint(geometry: unknown): string | null {
  const polygon = normalizeDrawnAreaPolygon(geometry);
  if (!polygon) return null;
  const canonical = JSON.stringify({
    type: polygon.type,
    coordinates: polygon.coordinates,
  });
  return `polygon-v1-${browserSafeFingerprint(canonical)}`;
}

function normalizeRecordRef(value: unknown): DrawnAreaRecordRef | null {
  if (!isPlainObject(value)) return null;
  const recordId = typeof value.recordId === "string" ? value.recordId.trim() : "";
  if (!recordId || recordId.length > 512) return null;

  if (value.sourceSnapshotId == null) return { recordId };
  const sourceSnapshotId =
    typeof value.sourceSnapshotId === "string"
      ? value.sourceSnapshotId.trim()
      : "";
  if (!sourceSnapshotId || sourceSnapshotId.length > 512) return null;
  return { recordId, sourceSnapshotId };
}

function sortRecordRefs(refs: DrawnAreaRecordRef[]): DrawnAreaRecordRef[] {
  return refs.sort((a, b) => {
    const byId = a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0;
    if (byId !== 0) return byId;
    const aSnapshot = a.sourceSnapshotId ?? "";
    const bSnapshot = b.sourceSnapshotId ?? "";
    return aSnapshot < bSnapshot ? -1 : aSnapshot > bSnapshot ? 1 : 0;
  });
}

function normalizeRecordManifest(value: unknown): DrawnAreaRecordRef[] | null {
  if (
    !Array.isArray(value) ||
    value.length > DRAWN_AREA_REPORT_MAX_RECORD_REFS
  ) {
    return null;
  }
  const refs: DrawnAreaRecordRef[] = [];
  const recordIds = new Set<string>();
  for (const rawRef of value) {
    const ref = normalizeRecordRef(rawRef);
    if (!ref || recordIds.has(ref.recordId)) return null;
    recordIds.add(ref.recordId);
    refs.push(ref);
  }
  return sortRecordRefs(refs);
}

export type DrawnAreaRecordManifestResult =
  | { ok: true; refs: DrawnAreaRecordRef[] }
  | DrawnAreaReportScopeFailure;

/** Build the compact generation-time manifest from selected GeoJSON features. */
export function recordRefsAtGeneration(
  features: readonly unknown[],
): DrawnAreaRecordManifestResult {
  if (features.length > DRAWN_AREA_REPORT_MAX_RECORD_REFS) {
    return fail(
      "invalid-record-manifest",
      `Record manifest exceeds ${DRAWN_AREA_REPORT_MAX_RECORD_REFS} entries.`,
    );
  }

  const refs: DrawnAreaRecordRef[] = [];
  for (const feature of features) {
    if (!isPlainObject(feature) || !isPlainObject(feature.properties)) {
      return fail(
        "invalid-record-manifest",
        "Every selected feature must publish a properties object.",
      );
    }
    const properties = feature.properties;
    const ref = normalizeRecordRef({
      recordId: properties.recordId ?? properties.id,
      ...(properties.sourceSnapshotId == null
        ? {}
        : { sourceSnapshotId: properties.sourceSnapshotId }),
    });
    if (!ref) {
      return fail(
        "invalid-record-manifest",
        "Every selected feature must publish a non-empty record id and a valid optional source snapshot id.",
      );
    }
    refs.push(ref);
  }

  const normalized = normalizeRecordManifest(refs);
  if (!normalized) {
    return fail(
      "invalid-record-manifest",
      "Record ids in a drawn-area selection must be unique.",
    );
  }
  return { ok: true, refs: normalized };
}

function normalizeVacancySource(
  value: unknown,
): DrawnAreaVacancySourceProvenance | null {
  if (!isPlainObject(value)) return null;
  const mode = value.mode;
  const path = value.path;
  const coherentPath =
    (mode === "database" && path === "database:vacant_properties") ||
    (mode === "static_fallback" && path === "/data/vacant-properties.json");
  if (!coherentPath) return null;
  if (
    value.explorerRefreshedAt !== null &&
    !isCanonicalIsoTimestamp(value.explorerRefreshedAt)
  ) {
    return null;
  }
  const asOfBasis = value.asOfBasis;
  const coherentBasis =
    (value.explorerRefreshedAt === null && asOfBasis === null) ||
    (mode === "database" &&
      value.explorerRefreshedAt !== null &&
      asOfBasis === "explorer_refresh_timestamp") ||
    (mode === "static_fallback" &&
      value.explorerRefreshedAt !== null &&
      asOfBasis === "static_export_generated_at");
  if (!coherentBasis) return null;

  return {
    mode,
    path,
    explorerRefreshedAt: value.explorerRefreshedAt,
    asOfBasis,
  } as DrawnAreaVacancySourceProvenance;
}

function normalizeVacancyCoverage(
  value: unknown,
  source: DrawnAreaVacancySourceProvenance,
): DrawnAreaVacancyCoverageProvenance | null {
  if (!isPlainObject(value)) return null;
  if (
    value.status !== "complete" &&
    value.status !== "truncated" &&
    value.status !== "partial"
  ) {
    return null;
  }
  const cclbaSourceCoverage = value.cclbaSourceCoverage === undefined
    ? unavailableCclbaSourceCoverage("not_recorded_at_generation")
    : normalizeCclbaSourceCoverage(value.cclbaSourceCoverage);
  if (!cclbaSourceCoverage) return null;
  if (
    !isNonnegativeInteger(value.returnedCount) ||
    !isNonnegativeInteger(value.configuredLimit) ||
    value.returnedCount > value.configuredLimit ||
    typeof value.potentiallyTruncated !== "boolean"
  ) {
    return null;
  }
  if (
    value.fallbackReason !== null &&
    value.fallbackReason !== "database_unavailable" &&
    value.fallbackReason !== "database_query_failed"
  ) {
    return null;
  }
  if (
    value.licenseScreeningStatus !== "not_requested" &&
    value.licenseScreeningStatus !== "available" &&
    value.licenseScreeningStatus !== "partial" &&
    value.licenseScreeningStatus !== "unavailable"
  ) {
    return null;
  }

  const complete =
    value.status === "complete" &&
    source.mode === "database" &&
    !value.potentiallyTruncated &&
    value.fallbackReason === null;
  const truncated =
    value.status === "truncated" &&
    source.mode === "database" &&
    value.potentiallyTruncated &&
    value.returnedCount === value.configuredLimit &&
    value.fallbackReason === null;
  const partial =
    value.status === "partial" &&
    source.mode === "static_fallback" &&
    (value.fallbackReason === "database_unavailable" ||
      value.fallbackReason === "database_query_failed");
  const truncationIsCoherent =
    !value.potentiallyTruncated ||
    value.returnedCount === value.configuredLimit;
  if ((!complete && !truncated && !partial) || !truncationIsCoherent) return null;

  return {
    status: value.status,
    returnedCount: value.returnedCount,
    configuredLimit: value.configuredLimit,
    potentiallyTruncated: value.potentiallyTruncated,
    fallbackReason: value.fallbackReason,
    licenseScreeningStatus: value.licenseScreeningStatus,
    cclbaSourceCoverage,
  } as DrawnAreaVacancyCoverageProvenance;
}

function normalizeVacancyFilters(
  value: unknown,
): DrawnAreaVacancyFilterProvenance | null {
  if (!isPlainObject(value)) return null;
  if (
    value.freshness !== "current_screening" &&
    value.freshness !== "recent_reports" &&
    value.freshness !== "all_records"
  ) {
    return null;
  }
  if (value.license !== "all" && value.license !== "conflicts") return null;
  return { freshness: value.freshness, license: value.license };
}

function normalizeVacancyProvenance(
  value: unknown,
): DrawnAreaVacancyProvenance | null {
  if (!isPlainObject(value)) return null;
  if (value.status !== "ready" && value.status !== "unavailable") return null;
  const filters = normalizeVacancyFilters(value.filters);
  const refs = normalizeRecordManifest(value.recordRefsAtGeneration);
  if (!filters || !refs || !isNonnegativeInteger(value.selectedCount)) return null;
  if (value.selectedCount !== refs.length) return null;

  if (value.status === "unavailable") {
    if (
      value.source !== null ||
      value.coverage !== null ||
      value.returnedCountBeforeFilters !== null ||
      value.selectedCount !== 0
    ) {
      return null;
    }
    return {
      status: "unavailable",
      source: null,
      coverage: null,
      filters,
      returnedCountBeforeFilters: null,
      selectedCount: 0,
      recordRefsAtGeneration: [],
    };
  }

  const source = normalizeVacancySource(value.source);
  if (!source) return null;
  const coverage = normalizeVacancyCoverage(value.coverage, source);
  if (
    !coverage ||
    !isNonnegativeInteger(value.returnedCountBeforeFilters) ||
    value.returnedCountBeforeFilters !== coverage.returnedCount ||
    value.selectedCount > value.returnedCountBeforeFilters
  ) {
    return null;
  }
  return {
    status: "ready",
    source,
    coverage,
    filters,
    returnedCountBeforeFilters: value.returnedCountBeforeFilters,
    selectedCount: value.selectedCount,
    recordRefsAtGeneration: refs,
  };
}

function normalizePermitSource(
  value: unknown,
): DrawnAreaPermitSourceProvenance | null {
  if (!isPlainObject(value)) return null;
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const url = typeof value.url === "string" ? value.url.trim() : "";
  const portalUrl =
    typeof value.portalUrl === "string" ? value.portalUrl.trim() : "";
  const dataWindow =
    typeof value.dataWindow === "string" ? value.dataWindow.trim() : "";
  if (!label || !url || !portalUrl || !dataWindow) return null;
  if (
    value.sourceRefreshedAt !== null &&
    !isCanonicalIsoTimestamp(value.sourceRefreshedAt)
  ) {
    return null;
  }
  const sourceRefreshBasis = value.sourceRefreshBasis;
  const coherentRefresh =
    (value.sourceRefreshedAt === null && sourceRefreshBasis === null) ||
    (value.sourceRefreshedAt !== null &&
      sourceRefreshBasis === "latest_queried_row_fetched_at");
  if (!coherentRefresh) return null;
  return {
    label,
    url,
    portalUrl,
    dataWindow,
    sourceRefreshedAt: value.sourceRefreshedAt,
    sourceRefreshBasis,
  };
}

function normalizePermitCoverage(
  value: unknown,
): DrawnAreaPermitCoverageProvenance | null {
  if (!isPlainObject(value) || value.locatedRecordsOnly !== true) return null;
  if (
    !isNonnegativeInteger(value.totalFilings) ||
    !isNonnegativeInteger(value.recordsReturned) ||
    value.recordsReturned > value.totalFilings ||
    typeof value.recordsTruncated !== "boolean" ||
    value.recordsTruncated !== (value.recordsReturned < value.totalFilings)
  ) {
    return null;
  }
  return {
    locatedRecordsOnly: true,
    totalFilings: value.totalFilings,
    recordsReturned: value.recordsReturned,
    recordsTruncated: value.recordsTruncated,
  };
}

function normalizePermitProvenance(
  value: unknown,
): DrawnAreaPermitProvenance | null {
  if (!isPlainObject(value)) return null;
  if (
    value.status !== "ready" &&
    value.status !== "unavailable" &&
    value.status !== "not_attached"
  ) {
    return null;
  }
  if (value.status !== "ready") {
    if (value.source !== null || value.coverage !== null) return null;
    return { status: value.status, source: null, coverage: null };
  }
  const source = normalizePermitSource(value.source);
  const coverage = normalizePermitCoverage(value.coverage);
  if (!source || !coverage) return null;
  return { status: "ready", source, coverage };
}

/** Validate untrusted/persisted JSON and return a sanitized contract. */
export function parseDrawnAreaReportScope(
  value: unknown,
): DrawnAreaReportScopeResult {
  if (!isPlainObject(value)) {
    return fail("not-an-object", "Drawn-area scope must be an object.");
  }
  if (value.version !== DRAWN_AREA_REPORT_SCOPE_VERSION) {
    return fail(
      "unsupported-version",
      `Drawn-area scope version must be ${DRAWN_AREA_REPORT_SCOPE_VERSION}.`,
    );
  }
  if (value.kind !== "drawn-area") {
    return fail("wrong-kind", "Drawn-area scope kind must be drawn-area.");
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > DRAWN_AREA_REPORT_MAX_NAME_LENGTH) {
    return fail(
      "invalid-name",
      `Drawn-area name must contain 1-${DRAWN_AREA_REPORT_MAX_NAME_LENGTH} characters.`,
    );
  }
  if (!isCanonicalIsoTimestamp(value.generatedAt)) {
    return fail(
      "invalid-generated-at",
      "Drawn-area generatedAt must be a canonical ISO timestamp.",
    );
  }
  if (!isPlainObject(value.scope) || value.scope.type !== "polygon") {
    return fail(
      "invalid-polygon",
      "Drawn-area scope must use polygon geometry with no geography fallback.",
    );
  }
  const geometry = normalizeDrawnAreaPolygon(value.scope.geometry);
  if (!geometry) {
    return fail("invalid-polygon", "Drawn-area polygon geometry is malformed.");
  }
  const fingerprint = drawnAreaScopeFingerprint(geometry);
  if (
    typeof value.scope.fingerprint !== "string" ||
    value.scope.fingerprint !== fingerprint
  ) {
    return fail(
      "invalid-fingerprint",
      "Drawn-area polygon fingerprint does not match its geometry.",
    );
  }
  if (!isPlainObject(value.provenance)) {
    return fail("invalid-provenance", "Drawn-area provenance is required.");
  }
  const vacancy = normalizeVacancyProvenance(value.provenance.vacancy);
  const permit = normalizePermitProvenance(value.provenance.permit);
  if (!vacancy || !permit) {
    return fail(
      "invalid-provenance",
      "Drawn-area source, coverage, filter, or record-manifest provenance is malformed.",
    );
  }

  return {
    ok: true,
    scope: {
      version: DRAWN_AREA_REPORT_SCOPE_VERSION,
      kind: "drawn-area",
      scope: { type: "polygon", geometry, fingerprint },
      name,
      generatedAt: value.generatedAt,
      provenance: { vacancy, permit },
    },
  };
}

/**
 * Build the persisted contract from the exact values the polygon panel already
 * uses. The final parse is deliberate: caller mistakes fail at generation time
 * under the same rules used for untrusted saved JSON.
 */
export function createDrawnAreaReportScope(
  input: CreateDrawnAreaReportScopeInput,
): DrawnAreaReportScopeResult {
  const geometry = normalizeDrawnAreaPolygon(input.geometry);
  if (!geometry) {
    return fail("invalid-polygon", "Drawn-area polygon geometry is malformed.");
  }
  const manifest = recordRefsAtGeneration(input.vacancy.selectedFeatures);
  if (!manifest.ok) return manifest;

  const coverage = input.vacancy.coverage ?? null;
  if (
    input.vacancy.loadFailed &&
    (coverage !== null ||
      input.vacancy.returnedCountBeforeFilters !== null ||
      manifest.refs.length > 0)
  ) {
    return fail(
      "invalid-provenance",
      "An unavailable vacancy lookup cannot retain result counts, coverage, or selected record references.",
    );
  }
  const vacancy: DrawnAreaVacancyProvenance = input.vacancy.loadFailed
    ? {
        status: "unavailable",
        source: null,
        coverage: null,
        filters: {
          freshness: input.vacancy.freshnessFilter,
          license: input.vacancy.licenseFilter,
        },
        returnedCountBeforeFilters: null,
        selectedCount: 0,
        recordRefsAtGeneration: [],
      }
    : {
        status: "ready",
        source: coverage
          ? {
              mode: coverage.sourceMode,
              path: coverage.sourcePath,
              explorerRefreshedAt: coverage.explorerRefreshedAt,
              asOfBasis: coverage.asOfBasis,
            }
          : null,
        coverage: coverage
          ? {
              status: coverage.coverageStatus,
              returnedCount: coverage.returnedCount,
              configuredLimit: coverage.configuredLimit,
              potentiallyTruncated: coverage.potentiallyTruncated,
              fallbackReason: coverage.fallbackReason,
              licenseScreeningStatus: coverage.licenseScreening.status,
              cclbaSourceCoverage: coverage.cclbaSourceCoverage,
            }
          : null,
        filters: {
          freshness: input.vacancy.freshnessFilter,
          license: input.vacancy.licenseFilter,
        },
        returnedCountBeforeFilters: input.vacancy.returnedCountBeforeFilters,
        selectedCount: manifest.refs.length,
        recordRefsAtGeneration: manifest.refs,
      };

  const permitAnalysis = input.permit?.analysis ?? null;
  const permitLoadFailed = input.permit?.loadFailed === true;
  if (permitAnalysis && permitLoadFailed) {
    return fail(
      "invalid-provenance",
      "Permit provenance cannot be both ready and unavailable.",
    );
  }
  const permit: DrawnAreaPermitProvenance = permitAnalysis
    ? {
        status: "ready",
        source: {
          label: permitAnalysis.source.label,
          url: permitAnalysis.source.url,
          portalUrl: permitAnalysis.source.portalUrl,
          dataWindow: permitAnalysis.dataWindow,
          sourceRefreshedAt: permitAnalysis.sourceRefresh.asOf,
          sourceRefreshBasis: permitAnalysis.sourceRefresh.asOfBasis,
        },
        coverage: {
          locatedRecordsOnly: true,
          totalFilings: permitAnalysis.totalFilings,
          recordsReturned: permitAnalysis.recordsReturned,
          recordsTruncated: permitAnalysis.recordsTruncated,
        },
      }
    : permitLoadFailed
      ? { status: "unavailable", source: null, coverage: null }
      : { status: "not_attached", source: null, coverage: null };

  return parseDrawnAreaReportScope({
    version: DRAWN_AREA_REPORT_SCOPE_VERSION,
    kind: "drawn-area",
    scope: {
      type: "polygon",
      geometry,
      fingerprint: drawnAreaScopeFingerprint(geometry),
    },
    name: input.name,
    generatedAt: input.generatedAt,
    provenance: { vacancy, permit },
  });
}

/** Existing area reports have a unique subtitle but persisted no geometry. */
export function isLegacyDrawnAreaReport(value: unknown): boolean {
  if (!isPlainObject(value) || typeof value.subtitle !== "string") return false;
  return /^drawn-area\b/i.test(value.subtitle.trim());
}

/**
 * Consumer gate. `unavailable` is terminal for geography lookup: callers may
 * render the stored summary, but must not widen to neighborhood/community area.
 */
export function resolveDrawnAreaReportScope(
  report: unknown,
): DrawnAreaReportScopeResolution {
  if (!isPlainObject(report)) return { status: "not-drawn-area" };
  if (report.drawnAreaScope !== undefined) {
    const parsed = parseDrawnAreaReportScope(report.drawnAreaScope);
    if (parsed.ok) return { status: "ready", scope: parsed.scope };
    return {
      status: "unavailable",
      reason: "malformed-scope",
      detail: parsed.detail,
    };
  }
  if (isLegacyDrawnAreaReport(report)) {
    return {
      status: "unavailable",
      reason: "legacy-scope-missing",
      detail:
        "This legacy drawn-area report did not persist its polygon. Its saved summary may render, but the geography must not fall back to a community area.",
    };
  }
  return { status: "not-drawn-area" };
}
