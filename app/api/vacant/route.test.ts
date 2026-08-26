import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { cachedMock, fetchMock, getSQLMock, sqlMock } = vi.hoisted(() => ({
  cachedMock: vi.fn(),
  fetchMock: vi.fn(),
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getSQL: getSQLMock,
}));

vi.mock("@/lib/redis", () => ({
  cached: cachedMock,
  roundCoord: (value: number, decimals = 4) => value.toFixed(decimals),
}));

import { GET } from "./route";
import { includeVacancyForFreshnessFilter } from "@/lib/vacancy-evidence";

const BOUNDS = "-87.75,41.75,-87.55,41.95";
const NOT_REQUESTED_LICENSE_SCREENING = {
  policyVersion: "issued-exact-address-v4",
  sourcePath: "https://data.cityofchicago.org/resource/r5kz-chrr.json",
  status: "not_requested",
  checkedAt: null,
  candidateCount: 0,
  checkedCount: 0,
  matchedPropertyCount: 0,
  capped: false,
  addressCap: 500,
  sourceCallCount: 0,
  successfulBatches: 0,
  failedBatches: 0,
  malformedRowCount: 0,
  partialReasons: [],
  caveats: [
    "An issued, unexpired BACP license at the exact published address is a conflict signal, not proof that the property is occupied.",
    "No exact-address match is not evidence that a property is unoccupied; address formatting and change-of-location records can limit matching.",
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

const CCLBA_SOURCE_COVERAGE_ROW = {
  source: "cclba",
  source_dataset_id: "epropertyplus-published-properties",
  source_url: "https://public-cclba.epropertyplus.com/",
  published_county_total: 1_033,
  chicago_total: 915,
  located_chicago_total: 913,
  unlocated_chicago_total: 2,
  source_as_of: null,
  source_retrieved_at: "2026-08-26 18:00:00+00",
};

function mockVacancySql(rows: unknown[]) {
  sqlMock.mockImplementation((strings: TemplateStringsArray) =>
    Promise.resolve(
      String(strings).includes("FROM vacant_source_snapshots")
        ? [CCLBA_SOURCE_COVERAGE_ROW]
        : rows,
    ),
  );
}

function vacantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cols-1",
    source: "cols",
    address: "123 S STATE ST",
    lat: 41.8819,
    lon: -87.6278,
    property_type: "vacant_land",
    ward: "42",
    community_area: "LOOP",
    zoning_class: "DX-7",
    square_feet: 5000,
    status: "city_owned",
    zone_matches: [{ zoneKey: "tif", zoneName: "Central Loop" }],
    incentive_count: 1,
    owner_name: "CITY OF CHICAGO",
    owner_type: "public",
    source_record_date: null,
    explorer_refreshed_at: "2026-08-05T12:00:00.000Z",
    ...overrides,
  };
}

function staticFeature(id: string, coordinates: [number, number]): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties: {
      id,
      source: "cols",
      address: `${id} S STATE ST`,
      propertyType: "vacant_land",
      status: "city_owned",
      zoneMatches: [],
      sourceSnapshotId: "unsubstantiated-static-snapshot",
      sourceUrl: "javascript:alert(1)",
      applicationUrl: "data:text/html,unsafe",
    },
  };
}

function resolvedCacheTTL(callIndex: number, result: unknown): number {
  const ttl = cachedMock.mock.calls[callIndex]?.[1] as
    | number
    | ((value: unknown) => number);
  return typeof ttl === "function" ? ttl(result) : ttl;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
  fetchMock.mockReset();
  cachedMock.mockReset().mockImplementation(
    async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
  );
  getSQLMock.mockReset();
  sqlMock.mockReset();
  getSQLMock.mockReturnValue(sqlMock);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/vacant", () => {
  it("screens polygon results for issued, unexpired exact-address conflicts", async () => {
    mockVacancySql([
      vacantRow({
        source: "dpd_vacant",
        property_type: "vacant_building",
        source_record_date: "2026-01-02T00:00:00.000Z",
      }),
    ]);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            address: "123 S STATE ST",
            doing_business_as_name: "State Street Cafe",
            license_description: "Retail Food",
            license_status: "AAI",
            expiration_date: "2027-01-01T00:00:00.000",
          },
        ]),
        { status: 200 },
      ),
    );
    const polygon: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [[
        [-87.7, 41.8],
        [-87.6, 41.8],
        [-87.6, 41.9],
        [-87.7, 41.8],
      ]],
    };
    const params = new URLSearchParams({ polygon: JSON.stringify(polygon) });

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?${params.toString()}`),
    );
    const body = await response.json();

    expect(body.features[0].properties).toMatchObject({
      licenseCheckState: "match",
      currentLicenseMatches: [
        {
          name: "State Street Cafe",
          status: "AAI",
          expirationDate: "2027-01-01",
        },
      ],
      licenseCheckedAt: "2026-08-14T12:00:00.000Z",
    });
    expect(body.meta.licenseScreening).toMatchObject({
      policyVersion: "issued-exact-address-v4",
      status: "available",
      candidateCount: 1,
      checkedCount: 1,
      matchedPropertyCount: 1,
      sourceCallCount: 1,
      successfulBatches: 1,
      failedBatches: 0,
    });
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain(
      "license_status='AAI'",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=21600, stale-while-revalidate=0",
    );
    expect(resolvedCacheTTL(0, body)).toBe(86_400);
    expect(resolvedCacheTTL(1, body)).toBe(21_600);
  });

  it("short-caches an unavailable polygon license lookup for recovery", async () => {
    mockVacancySql([vacantRow()]);
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    const polygon: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [[
        [-87.7, 41.8],
        [-87.6, 41.8],
        [-87.6, 41.9],
        [-87.7, 41.8],
      ]],
    };
    const params = new URLSearchParams({ polygon: JSON.stringify(polygon) });

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?${params.toString()}`),
    );
    const body = await response.json();

    expect(body.meta.licenseScreening.status).toBe("unavailable");
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=0",
    );
    expect(resolvedCacheTTL(1, body)).toBe(300);
  });

  it("returns database records with complete source coverage metadata", async () => {
    mockVacancySql([
      vacantRow({ explorer_refreshed_at: "2026-08-05 12:00:00+00" }),
    ]);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
    expect(body).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-87.6278, 41.8819] },
          properties: {
            id: "cols-1",
            source: "cols",
            address: "123 S STATE ST",
            propertyType: "vacant_land",
            ward: "42",
            communityArea: "LOOP",
            zoningClass: "DX-7",
            squareFeet: 5000,
            status: "city_owned",
            zoneMatches: [{ zoneKey: "tif", zoneName: "Central Loop" }],
            incentiveCount: 1,
            ownerName: "CITY OF CHICAGO",
            ownerType: "public",
            canonicalType: "land",
            recordId: "cols:cols-1",
            pin: null,
            sourceDatasetId: "aksk-kvfp",
            sourceDatasetLabel: "Chicago City-Owned Land Inventory",
            sourceSnapshotId: null,
            sourceRowId: null,
            sourceUrl: "https://data.cityofchicago.org/Community-Economic-Development/City-Owned-Land-Inventory/aksk-kvfp",
            sourceAsOf: null,
            sourceRetrievedAt: null,
            ownerJurisdiction: null,
            managingOrganization: null,
            programName: null,
            programKey: null,
            offerRound: null,
            applicationUse: null,
            applicationOpens: null,
            applicationDeadline: null,
            applicationUrl: null,
            propertyStatus: null,
            salesStatus: null,
            saleOfferingStatus: null,
            saleOfferingReason: null,
            programContext: [],
            sourceRecordDate: null,
            freshnessClass: "unknown_date",
            explorerRefreshedAt: "2026-08-05T12:00:00.000Z",
          },
        },
      ],
      meta: {
        sourceMode: "database",
        sourcePath: "database:vacant_properties",
        asOf: "2026-08-05T12:00:00.000Z",
        asOfBasis: "explorer_refresh_timestamp",
        explorerRefreshedAt: "2026-08-05T12:00:00.000Z",
        freshness: {
          policyVersion: "source-record-date-v1",
          referenceDate: "2026-08-14T00:00:00.000Z",
          recentWithinYears: 3,
          cutoffDate: "2023-08-14T00:00:00.000Z",
          retainedWithinYears: 5,
          retentionPolicyCutoffDate: "2021-08-14T00:00:00.000Z",
          retentionCutoffBasis: "current_request_reference_policy",
          returnedCounts: { recent: 0, stale: 0, unknownDate: 1 },
        },
        licenseScreening: NOT_REQUESTED_LICENSE_SCREENING,
        returnedCount: 1,
        configuredLimit: 5,
        queryLimit: 6,
        coverageStatus: "complete",
        potentiallyTruncated: false,
        fallbackReason: null,
        cclbaSourceCoverage: CCLBA_SOURCE_COVERAGE,
      },
    });

    const query = String(sqlMock.mock.calls[0][0]);
    const values = sqlMock.mock.calls[0].slice(1);
    expect(query).toContain("updated_at::text");
    expect(query).toContain("to_jsonb(vp)->>'source_record_date'");
    expect(query).toContain("ST_Intersects");
    expect(values).toContain(6);
    expect(cachedMock.mock.calls[0]?.[0]).toContain("vacant:v7:");
  });

  it("keeps database rows available but fails CCLBA coverage closed before migration", async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      if (String(strings).includes("FROM vacant_source_snapshots")) {
        return Promise.reject(new Error("relation vacant_source_snapshots does not exist"));
      }
      return Promise.resolve([vacantRow()]);
    });

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`),
    );
    const body = await response.json();

    expect(body.features).toHaveLength(1);
    expect(body.meta).toMatchObject({
      sourceMode: "database",
      coverageStatus: "complete",
      cclbaSourceCoverage: {
        status: "unavailable",
        source: "cclba",
        sourceDatasetId: "epropertyplus-published-properties",
        sourceUrl: "https://public-cclba.epropertyplus.com/",
        reason: "metadata_unavailable",
      },
    });
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=0",
    );
    expect(resolvedCacheTTL(0, body)).toBe(300);
  });

  it("normalizes an empty legacy zone name to its canonical zone key", async () => {
    mockVacancySql([
      vacantRow({
        zone_matches: [{ zoneKey: "illinoisOZ", zoneName: "" }],
        incentive_count: 1,
      }),
    ]);

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`),
    );
    const body = await response.json();

    expect(body.meta.sourceMode).toBe("database");
    expect(body.features[0].properties.zoneMatches).toEqual([
      { zoneKey: "illinoisOZ", zoneName: "illinoisOZ" },
    ]);
  });

  it("publishes stable CCLBA provenance without relabeling it City-owned", async () => {
    mockVacancySql([
      vacantRow({
        id: "cclba-52905642",
        source: "cclba",
        pin: "16141010090000",
        property_type: "vacant_land",
        status: "Acquired",
        owner_name: "Cook County Land Bank Authority",
        owner_type: "city_public",
        owner_jurisdiction: "cook_county",
        source_dataset_id: "epropertyplus-published-properties",
        source_row_id: "52905642",
        source_url: "https://public-cclba.epropertyplus.com/",
        source_as_of: null,
        source_retrieved_at: "2026-08-26T18:00:00.000Z",
        program_name: null,
        program_key: null,
        program_context: [{
          sourceRowId: "52905642",
          currentStatus: "Acquired",
          inventoryType: "Vacant Land",
        }],
      }),
    ]);

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`),
    );
    const body = await response.json();

    expect(body.features[0].properties).toMatchObject({
      recordId: "cclba:52905642",
      pin: "16141010090000",
      source: "cclba",
      sourceDatasetId: "epropertyplus-published-properties",
      sourceDatasetLabel:
        "Cook County Land Bank Authority Published Property Inventory",
      sourceRowId: "52905642",
      sourceSnapshotId: null,
      sourceAsOf: null,
      sourceRetrievedAt: "2026-08-26T18:00:00.000Z",
      ownerName: "Cook County Land Bank Authority",
      ownerJurisdiction: "cook_county",
      status: "Acquired",
      programName: null,
      programContext: [{
        sourceRowId: "52905642",
        currentStatus: "Acquired",
        inventoryType: "Vacant Land",
      }],
    });
    expect(body.features[0].properties.ownerName).not.toBe("City of Chicago");
  });

  it("does not invent official CCLBA provenance for a pre-migration row", async () => {
    mockVacancySql([
      vacantRow({
        id: "legacy-cclba-row",
        source: "cclba",
        property_type: "vacant_land",
        status: "Listed",
        source_dataset_id: null,
        source_url: null,
      }),
    ]);

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`),
    );
    const body = await response.json();
    const properties = body.features[0].properties;

    expect(properties).toMatchObject({
      source: "cclba",
      sourceDatasetId: null,
      sourceDatasetLabel: null,
      sourceUrl: null,
    });
    expect(properties.sourceDatasetId).not.toBe(
      "epropertyplus-published-properties",
    );
    expect(properties.sourceDatasetLabel).not.toBe(
      "Cook County Land Bank Authority Published Property Inventory",
    );
    expect(properties.sourceUrl).not.toBe(
      "https://public-cclba.epropertyplus.com/",
    );
  });

  it("fills known CCLBA provenance only for the explicit official dataset", async () => {
    mockVacancySql([
      vacantRow({
        id: "official-cclba-row",
        source: "cclba",
        property_type: "vacant_land",
        status: "Acquired",
        source_dataset_id: "epropertyplus-published-properties",
        source_url: null,
      }),
    ]);

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`),
    );
    const body = await response.json();

    expect(body.features[0].properties).toMatchObject({
      source: "cclba",
      sourceDatasetId: "epropertyplus-published-properties",
      sourceDatasetLabel:
        "Cook County Land Bank Authority Published Property Inventory",
      sourceUrl: "https://public-cclba.epropertyplus.com/",
    });
  });

  it("strips incomplete official CCLBA tuples from static fallback rows", async () => {
    sqlMock.mockRejectedValue(new Error("connection failed"));
    const labelOnly = staticFeature("cclba-label-only", [-87.6278, 41.8819]);
    labelOnly.properties = {
      ...labelOnly.properties,
      source: "cclba",
      sourceDatasetId: null,
      sourceDatasetLabel:
        "Cook County Land Bank Authority Published Property Inventory",
      sourceUrl: "https://public-cclba.epropertyplus.com/",
    };
    const mismatchedPair = staticFeature(
      "cclba-mismatched-pair",
      [-87.6277, 41.8818],
    );
    mismatchedPair.properties = {
      ...mismatchedPair.properties,
      source: "cclba",
      sourceDatasetId: "epropertyplus-published-properties",
      sourceDatasetLabel:
        "Cook County Land Bank Authority Published Property Inventory",
      sourceUrl: "https://example.com/not-the-official-source",
    };
    const malformedUrl = staticFeature(
      "cclba-malformed-url",
      [-87.6276, 41.8817],
    );
    malformedUrl.properties = {
      ...malformedUrl.properties,
      source: "cclba",
      sourceDatasetId: "epropertyplus-published-properties",
      sourceDatasetLabel:
        "Cook County Land Bank Authority Published Property Inventory",
      sourceUrl: "javascript:invent-official-provenance()",
    };
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "FeatureCollection",
          features: [labelOnly, mismatchedPair, malformedUrl],
        }),
        { status: 200 },
      ),
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`),
    );
    const body = await response.json();

    expect(body.meta).toMatchObject({
      sourceMode: "static_fallback",
      coverageStatus: "partial",
    });
    expect(body.features[0].properties).toMatchObject({
      source: "cclba",
      sourceDatasetId: null,
      sourceDatasetLabel: null,
      sourceUrl: null,
    });
    expect(body.features[1].properties).toMatchObject({
      source: "cclba",
      sourceDatasetId: null,
      sourceDatasetLabel: null,
      sourceUrl: "https://example.com/not-the-official-source",
    });
    expect(body.features[2].properties).toMatchObject({
      source: "cclba",
      sourceDatasetId: null,
      sourceDatasetLabel: null,
      sourceUrl: null,
    });
  });

  it("anchors freshness to Chicago today before the UTC-day rollover", async () => {
    vi.setSystemTime(new Date("2026-08-15T04:38:00.000Z"));
    mockVacancySql([vacantRow()]);

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`),
    );
    const body = await response.json();

    expect(body.meta.freshness).toMatchObject({
      referenceDate: "2026-08-14T00:00:00.000Z",
      cutoffDate: "2023-08-14T00:00:00.000Z",
      retentionPolicyCutoffDate: "2021-08-14T00:00:00.000Z",
    });
  });

  it("discloses truncation when a sentinel row exceeds the configured limit", async () => {
    mockVacancySql([
      vacantRow({ id: "cols-1" }),
      vacantRow({ id: "cols-2", address: "125 S STATE ST" }),
      vacantRow({ id: "sentinel", address: "127 S STATE ST" }),
    ]);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/vacant?bounds=${BOUNDS}&limit=2`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.features).toHaveLength(2);
    expect(body.features.map((feature: GeoJSON.Feature) => feature.properties?.id)).not.toContain(
      "sentinel",
    );
    expect(body.meta).toEqual({
      sourceMode: "database",
      sourcePath: "database:vacant_properties",
      asOf: "2026-08-05T12:00:00.000Z",
      asOfBasis: "explorer_refresh_timestamp",
      explorerRefreshedAt: "2026-08-05T12:00:00.000Z",
      freshness: {
        policyVersion: "source-record-date-v1",
        referenceDate: "2026-08-14T00:00:00.000Z",
        recentWithinYears: 3,
        cutoffDate: "2023-08-14T00:00:00.000Z",
        retainedWithinYears: 5,
        retentionPolicyCutoffDate: "2021-08-14T00:00:00.000Z",
        retentionCutoffBasis: "current_request_reference_policy",
        returnedCounts: { recent: 0, stale: 0, unknownDate: 2 },
      },
      licenseScreening: NOT_REQUESTED_LICENSE_SCREENING,
      returnedCount: 2,
      configuredLimit: 2,
      queryLimit: 3,
      coverageStatus: "truncated",
      potentiallyTruncated: true,
      fallbackReason: null,
      cclbaSourceCoverage: CCLBA_SOURCE_COVERAGE,
    });
  });

  it("marks a static response as partial after a database query failure", async () => {
    sqlMock.mockRejectedValue(new Error("connection failed"));
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "FeatureCollection",
          generatedAt: "2026-08-13T09:00:00.000Z",
          cclbaSourceCoverage: CCLBA_SOURCE_COVERAGE,
          features: [
            staticFeature("fallback-1", [-87.6278, 41.8819]),
            staticFeature("outside", [-88.1, 41.8819]),
          ],
        }),
        { status: 200 },
      ),
    );

    const response = await GET(
      new NextRequest(
        `http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.features).toEqual([
      {
        ...staticFeature("fallback-1", [-87.6278, 41.8819]),
        properties: {
          ...staticFeature("fallback-1", [-87.6278, 41.8819]).properties,
          recordId: "cols:fallback-1",
          pin: null,
          sourceDatasetId: "aksk-kvfp",
          sourceDatasetLabel: "Chicago City-Owned Land Inventory",
          sourceSnapshotId: null,
          sourceRowId: null,
          sourceUrl: "https://data.cityofchicago.org/Community-Economic-Development/City-Owned-Land-Inventory/aksk-kvfp",
          sourceAsOf: null,
          sourceRetrievedAt: null,
          ownerJurisdiction: null,
          managingOrganization: null,
          programName: null,
          programKey: null,
          offerRound: null,
          applicationUse: null,
          applicationOpens: null,
          applicationDeadline: null,
          applicationUrl: null,
          salesStatus: null,
          saleOfferingStatus: null,
          saleOfferingReason: null,
          programContext: [],
          canonicalType: "land",
          sourceRecordDate: null,
          freshnessClass: "unknown_date",
          explorerRefreshedAt: "2026-08-13T09:00:00.000Z",
          status: "city_owned",
          zoneMatches: [],
          incentiveCount: 0,
        },
      },
    ]);
    expect(body.meta).toEqual({
      sourceMode: "static_fallback",
      sourcePath: "/data/vacant-properties.json",
      asOf: "2026-08-13T09:00:00.000Z",
      asOfBasis: "static_export_generated_at",
      explorerRefreshedAt: "2026-08-13T09:00:00.000Z",
      freshness: {
        policyVersion: "source-record-date-v1",
        referenceDate: "2026-08-14T00:00:00.000Z",
        recentWithinYears: 3,
        cutoffDate: "2023-08-14T00:00:00.000Z",
        retainedWithinYears: 5,
        retentionPolicyCutoffDate: "2021-08-14T00:00:00.000Z",
        retentionCutoffBasis: "current_request_reference_policy",
        returnedCounts: { recent: 0, stale: 0, unknownDate: 1 },
      },
      licenseScreening: NOT_REQUESTED_LICENSE_SCREENING,
      returnedCount: 1,
      configuredLimit: 5,
      queryLimit: null,
      coverageStatus: "partial",
      potentiallyTruncated: false,
      fallbackReason: "database_query_failed",
      cclbaSourceCoverage: CCLBA_SOURCE_COVERAGE,
    });
    expect(body.features[0].properties).not.toHaveProperty("propertyStatus");
    expect(body.features[0].properties.applicationUrl).toBeNull();
    expect(
      includeVacancyForFreshnessFilter(
        body.features[0],
        "current_screening",
      ),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/data/vacant-properties.json",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=0",
    );
    expect(resolvedCacheTTL(0, body)).toBe(300);
  });

  it("fails over instead of publishing an incoherent source/property pair", async () => {
    mockVacancySql([
      vacantRow({
        id: "bad-source-pair",
        source: "311_clean_lot",
        property_type: "vacant_building",
      }),
    ]);
    fetchMock.mockResolvedValue(new Response("missing", { status: 503 }));

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`),
    );
    const body = await response.json();

    expect(body.features).toEqual([]);
    expect(body.meta).toMatchObject({
      sourceMode: "static_fallback",
      coverageStatus: "partial",
      fallbackReason: "database_query_failed",
    });
  });

  it("classifies clean-lot reports from their original source date", async () => {
    mockVacancySql([
      vacantRow({
        id: "311-clean-lot-SR21-1",
        source: "311_clean_lot",
        property_type: "reported_vacant_lot",
        status: "Completed",
        source_record_date: "2021-07-01T10:00:00.000Z",
      }),
    ]);

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`),
    );
    const body = await response.json();

    expect(body.features[0].properties).toMatchObject({
      source: "311_clean_lot",
      propertyType: "reported_vacant_lot",
      canonicalType: "land",
      status: "Completed",
      sourceRecordDate: "2021-07-01T10:00:00.000Z",
      freshnessClass: "stale",
    });
    expect(body.meta.freshness.returnedCounts).toEqual({
      recent: 0,
      stale: 1,
      unknownDate: 0,
    });
  });
});
