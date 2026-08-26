import { describe, expect, it } from "vitest";
import { type VacancyCoverageMetadata } from "@/lib/drawn-area-vacancy";
import {
  createDrawnAreaReportScope,
  drawnAreaScopeFingerprint,
  normalizeDrawnAreaPolygon,
  parseDrawnAreaReportScope,
  recordRefsAtGeneration,
  resolveDrawnAreaReportScope,
  type DrawnAreaReportScope,
} from "@/lib/drawn-area-report-scope";
import type { PermitAreaResult } from "@/lib/permit-area";
import { normalizeSavedReport } from "@/lib/report-schema";

const POLYGON: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-87.63, 41.749],
      [-87.615, 41.749],
      [-87.615, 41.758],
      [-87.63, 41.758],
      [-87.63, 41.749],
    ],
  ],
};

const CCLBA_SOURCE_COVERAGE = {
  status: "available",
  source: "cclba",
  sourceDatasetId: "epropertyplus-published-properties",
  sourceUrl: "https://public-cclba.epropertyplus.com/",
  publishedCountyTotal: 1_033,
  chicagoTotal: 915,
  locatedChicagoTotal: 913,
  unlocatedChicagoTotal: 2,
  sourceAsOf: null,
  retrievedAt: "2026-08-26T18:00:00.000Z",
} as const;

const COVERAGE: VacancyCoverageMetadata = {
  sourceMode: "database",
  sourcePath: "database:vacant_properties",
  asOf: "2026-08-24T12:00:00.000Z",
  asOfBasis: "explorer_refresh_timestamp",
  explorerRefreshedAt: "2026-08-24T12:00:00.000Z",
  freshness: {
    policyVersion: "source-record-date-v1",
    referenceDate: "2026-08-26T00:00:00.000Z",
    recentWithinYears: 3,
    cutoffDate: "2023-08-26T00:00:00.000Z",
    retainedWithinYears: 5,
    retentionPolicyCutoffDate: "2021-08-26T00:00:00.000Z",
    retentionCutoffBasis: "current_request_reference_policy",
    returnedCounts: { recent: 2, stale: 0, unknownDate: 1 },
  },
  licenseScreening: {
    policyVersion: "issued-exact-address-v4",
    sourcePath: "https://data.cityofchicago.org/resource/r5kz-chrr.json",
    status: "available",
    checkedAt: "2026-08-26T13:00:00.000Z",
    candidateCount: 3,
    checkedCount: 3,
    matchedPropertyCount: 1,
    capped: false,
    addressCap: 500,
    sourceCallCount: 1,
    successfulBatches: 1,
    failedBatches: 0,
    malformedRowCount: 0,
    partialReasons: [],
    caveats: [],
  },
  returnedCount: 3,
  configuredLimit: 10_000,
  queryLimit: 10_001,
  coverageStatus: "complete",
  potentiallyTruncated: false,
  fallbackReason: null,
  cclbaSourceCoverage: CCLBA_SOURCE_COVERAGE,
};

const SELECTED_FEATURES: GeoJSON.Feature[] = [
  {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-87.62, 41.752] },
    properties: { id: "vacancy-2", sourceSnapshotId: "snapshot-2026-08-24" },
  },
  {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-87.625, 41.755] },
    properties: { id: "vacancy-1" },
  },
];

const PERMIT_ANALYSIS = {
  status: "ready",
  source: {
    label: "Chicago building permits",
    url: "https://data.cityofchicago.org/resource/ydr8-5enu.json",
    portalUrl: "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu",
  },
  dataWindow: "Issued since 2006",
  sourceRefresh: {
    asOf: "2026-08-25T15:30:00.000Z",
    asOfBasis: "latest_queried_row_fetched_at",
  },
  totalFilings: 4,
  recordsReturned: 2,
  recordsTruncated: true,
} as unknown as PermitAreaResult;

function createValidScope(): DrawnAreaReportScope {
  const result = createDrawnAreaReportScope({
    name: "79th Corridor — Ward 6",
    geometry: POLYGON,
    generatedAt: "2026-08-26T14:15:00.000Z",
    vacancy: {
      loadFailed: false,
      coverage: COVERAGE,
      freshnessFilter: "recent_reports",
      licenseFilter: "all",
      returnedCountBeforeFilters: 3,
      selectedFeatures: SELECTED_FEATURES,
    },
    permit: { analysis: PERMIT_ANALYSIS, loadFailed: false },
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  return result.scope;
}

function savedReport(scope?: unknown): Record<string, unknown> {
  return {
    schemaVersion: 1,
    title: "Area Analysis Report — 79th Corridor — Ward 6",
    subtitle: "Drawn-area public-record vacancy signals and permit context",
    reportType: "best-location",
    generatedAt: "2026-08-26T14:15:00.000Z",
    summary: "Two records were selected inside the saved polygon.",
    sections: [],
    recommendedActions: [],
    metadata: { address: "Greater Grand Crossing" },
    ...(scope === undefined ? {} : { drawnAreaScope: scope }),
  };
}

describe("drawn-area report scope contract", () => {
  it("preserves the custom name, exact polygon, timestamp, and generation provenance", () => {
    const scope = createValidScope();

    expect(scope.name).toBe("79th Corridor — Ward 6");
    expect(scope.generatedAt).toBe("2026-08-26T14:15:00.000Z");
    expect(scope.scope).toEqual({
      type: "polygon",
      geometry: POLYGON,
      fingerprint: drawnAreaScopeFingerprint(POLYGON),
    });
    expect(scope.provenance.vacancy).toMatchObject({
      status: "ready",
      source: {
        mode: "database",
        path: "database:vacant_properties",
        explorerRefreshedAt: "2026-08-24T12:00:00.000Z",
        asOfBasis: "explorer_refresh_timestamp",
      },
      coverage: {
        status: "complete",
        returnedCount: 3,
        configuredLimit: 10_000,
        potentiallyTruncated: false,
        fallbackReason: null,
        licenseScreeningStatus: "available",
        cclbaSourceCoverage: CCLBA_SOURCE_COVERAGE,
      },
      filters: { freshness: "recent_reports", license: "all" },
      returnedCountBeforeFilters: 3,
      selectedCount: 2,
      recordRefsAtGeneration: [
        { recordId: "vacancy-1" },
        { recordId: "vacancy-2", sourceSnapshotId: "snapshot-2026-08-24" },
      ],
    });
    expect(scope.provenance.permit).toEqual({
      status: "ready",
      source: {
        label: "Chicago building permits",
        url: "https://data.cityofchicago.org/resource/ydr8-5enu.json",
        portalUrl:
          "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu",
        dataWindow: "Issued since 2006",
        sourceRefreshedAt: "2026-08-25T15:30:00.000Z",
        sourceRefreshBasis: "latest_queried_row_fetched_at",
      },
      coverage: {
        locatedRecordsOnly: true,
        totalFilings: 4,
        recordsReturned: 2,
        recordsTruncated: true,
      },
    });
  });

  it("creates a browser-safe deterministic fingerprint that survives JSON round trips", () => {
    const first = drawnAreaScopeFingerprint(POLYGON);
    const clone = JSON.parse(JSON.stringify(POLYGON)) as GeoJSON.Polygon;
    const changed = JSON.parse(JSON.stringify(POLYGON)) as GeoJSON.Polygon;
    changed.coordinates[0][1][0] = -87.614;

    expect(first).toMatch(/^polygon-v1-[0-9a-f]{16}$/);
    expect(drawnAreaScopeFingerprint(clone)).toBe(first);
    expect(drawnAreaScopeFingerprint(changed)).not.toBe(first);
  });

  it.each([
    ["a MultiPolygon", { type: "MultiPolygon", coordinates: [[POLYGON.coordinates]] }],
    ["an open ring", { ...POLYGON, coordinates: [[...POLYGON.coordinates[0].slice(0, -1)]] }],
    [
      "a non-finite coordinate",
      {
        ...POLYGON,
        coordinates: [[[Number.NaN, 41.749], ...POLYGON.coordinates[0].slice(1)]],
      },
    ],
    [
      "a zero-area ring",
      {
        type: "Polygon",
        coordinates: [[[-87.63, 41.75], [-87.62, 41.75], [-87.61, 41.75], [-87.63, 41.75]]],
      },
    ],
  ])("rejects %s instead of widening its geography", (_label, geometry) => {
    expect(normalizeDrawnAreaPolygon(geometry)).toBeNull();
  });

  it("keeps a compact, sorted manifest and rejects records without unique stable ids", () => {
    expect(recordRefsAtGeneration(SELECTED_FEATURES)).toEqual({
      ok: true,
      refs: [
        { recordId: "vacancy-1" },
        { recordId: "vacancy-2", sourceSnapshotId: "snapshot-2026-08-24" },
      ],
    });
    expect(
      recordRefsAtGeneration([
        SELECTED_FEATURES[0],
        {
          ...SELECTED_FEATURES[0],
          properties: { id: "vacancy-2", sourceSnapshotId: "a-different-snapshot" },
        },
      ]),
    ).toMatchObject({ ok: false, reason: "invalid-record-manifest" });
    expect(
      recordRefsAtGeneration([{ type: "Feature", geometry: null, properties: {} }]),
    ).toMatchObject({ ok: false, reason: "invalid-record-manifest" });
  });

  it("saves an exact-area manifest when an API record has no comparable source snapshot", () => {
    const result = createDrawnAreaReportScope({
      name: "79th Corridor — Ward 8",
      geometry: POLYGON,
      generatedAt: "2026-08-26T18:30:00.000Z",
      vacancy: {
        loadFailed: false,
        coverage: COVERAGE,
        freshnessFilter: "current_screening",
        licenseFilter: "all",
        returnedCountBeforeFilters: 3,
        selectedFeatures: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-87.62, 41.752] },
            properties: {
              id: "cclba-52905642",
              recordId: "cclba:52905642",
              source: "cclba",
              sourceDatasetId: "epropertyplus-published-properties",
              sourceSnapshotId: null,
              sourceRetrievedAt: "2026-08-26T18:00:00.000Z",
            },
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    expect(result.scope.scope.geometry).toEqual(POLYGON);
    expect(result.scope.provenance.vacancy.recordRefsAtGeneration).toEqual([
      { recordId: "cclba:52905642" },
    ]);
  });

  it("detects tampered geometry and incoherent record-manifest counts", () => {
    const scope = createValidScope();
    const geometryTamper = JSON.parse(JSON.stringify(scope));
    geometryTamper.scope.geometry.coordinates[0][1][0] = -87.614;
    const manifestTamper = JSON.parse(JSON.stringify(scope));
    manifestTamper.provenance.vacancy.selectedCount = 1;

    expect(parseDrawnAreaReportScope(geometryTamper)).toMatchObject({
      ok: false,
      reason: "invalid-fingerprint",
    });
    expect(parseDrawnAreaReportScope(manifestTamper)).toMatchObject({
      ok: false,
      reason: "invalid-provenance",
    });
  });

  it("marks legacy saved scopes whose generation-time CCLBA coverage was not recorded", () => {
    const legacy = JSON.parse(JSON.stringify(createValidScope()));
    delete legacy.provenance.vacancy.coverage.cclbaSourceCoverage;

    const parsed = parseDrawnAreaReportScope(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(parsed.scope.provenance.vacancy.coverage?.cclbaSourceCoverage).toEqual({
      status: "unavailable",
      source: "cclba",
      sourceDatasetId: "epropertyplus-published-properties",
      sourceUrl: "https://public-cclba.epropertyplus.com/",
      reason: "not_recorded_at_generation",
    });
  });

  it("rejects incoherent failed lookups instead of silently discarding stale selection data", () => {
    const result = createDrawnAreaReportScope({
      name: "79th Corridor",
      geometry: POLYGON,
      generatedAt: "2026-08-26T14:15:00.000Z",
      vacancy: {
        loadFailed: true,
        coverage: COVERAGE,
        freshnessFilter: "all_records",
        licenseFilter: "all",
        returnedCountBeforeFilters: 3,
        selectedFeatures: SELECTED_FEATURES,
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid-provenance" });
  });
});

describe("drawn-area report fail-closed resolution", () => {
  it("returns the validated exact scope and never treats context labels as geography", () => {
    const scope = createValidScope();

    expect(resolveDrawnAreaReportScope(savedReport(scope))).toEqual({
      status: "ready",
      scope,
    });
  });

  it("marks legacy and malformed drawn-area reports unavailable", () => {
    expect(resolveDrawnAreaReportScope(savedReport())).toMatchObject({
      status: "unavailable",
      reason: "legacy-scope-missing",
    });
    expect(
      resolveDrawnAreaReportScope(savedReport({
        kind: "drawn-area",
        scope: { type: "community-area", name: "Greater Grand Crossing" },
      })),
    ).toMatchObject({ status: "unavailable", reason: "malformed-scope" });
    expect(
      resolveDrawnAreaReportScope({
        title: "Ordinary report",
        subtitle: "Greater Grand Crossing",
      }),
    ).toEqual({ status: "not-drawn-area" });
  });

  it("round-trips a valid scope through the saved-report boundary", () => {
    const scope = createValidScope();
    const result = normalizeSavedReport(savedReport(scope));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.drawnAreaScope).toEqual(scope);
  });

  it("rejects malformed and legacy missing scopes at the saved-report boundary", () => {
    const malformed = normalizeSavedReport(
      savedReport({
        kind: "drawn-area",
        scope: { type: "community-area", name: "Greater Grand Crossing" },
      }),
    );
    expect(malformed).toMatchObject({
      ok: false,
      reason: "invalid-drawn-area-scope",
    });

    const legacy = normalizeSavedReport(savedReport());
    expect(legacy).toMatchObject({
      ok: false,
      reason: "invalid-drawn-area-scope",
    });
  });
});
