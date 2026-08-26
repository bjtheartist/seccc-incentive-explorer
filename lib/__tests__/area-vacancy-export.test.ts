import { describe, expect, it } from "vitest";
import { buildDrawnAreaCsv } from "@/lib/polygon-investment";
import { unavailableCclbaSourceCoverage, type VacancyCoverageMetadata } from "@/lib/drawn-area-vacancy";

const COVERAGE: VacancyCoverageMetadata = {
  sourceMode: "database",
  sourcePath: "database:vacant_properties",
  asOf: "2026-08-14T02:00:00.000Z",
  asOfBasis: "explorer_refresh_timestamp",
  explorerRefreshedAt: "2026-08-14T02:00:00.000Z",
  freshness: {
    policyVersion: "source-record-date-v1",
    referenceDate: "2026-08-14T00:00:00.000Z",
    recentWithinYears: 3,
    cutoffDate: "2023-08-14T00:00:00.000Z",
    retainedWithinYears: 5,
    retentionPolicyCutoffDate: "2021-08-14T00:00:00.000Z",
    retentionCutoffBasis: "current_request_reference_policy",
    returnedCounts: { recent: 0, stale: 1, unknownDate: 0 },
  },
  licenseScreening: {
    policyVersion: "issued-exact-address-v4",
    sourcePath: "https://data.cityofchicago.org/resource/r5kz-chrr.json",
    status: "available",
    checkedAt: "2026-08-14T00:00:00.000Z",
    candidateCount: 1,
    checkedCount: 1,
    matchedPropertyCount: 1,
    capped: false,
    addressCap: 500,
    sourceCallCount: 1,
    successfulBatches: 1,
    failedBatches: 0,
    malformedRowCount: 0,
    partialReasons: [],
    caveats: ["A match is a conflict signal, not proof of occupancy."],
  },
  returnedCount: 1,
  configuredLimit: 10_000,
  queryLimit: 10_001,
  coverageStatus: "complete",
  potentiallyTruncated: false,
  fallbackReason: null,
  cclbaSourceCoverage: unavailableCclbaSourceCoverage("snapshot_not_recorded"),
};

describe("drawn-area vacancy CSV evidence", () => {
  it("exports original date, raw status, freshness and license conflict without calling sync time source-as-of", () => {
    const csv = buildDrawnAreaCsv({
      areaName: "External feedback test",
      vacancyFeatures: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-87.63, 41.88] },
          properties: {
            recordId: "311_clean_lot:SR21-1",
            pin: null,
            address: "300 S STATE ST",
            source: "311_clean_lot",
            sourceDatasetId: "v6vf-nfxy",
            sourceDatasetLabel: "Chicago 311 Service Requests",
            sourceRowId: "SR21-1",
            sourceUrl: "https://data.cityofchicago.org/resource/v6vf-nfxy.json?sr_number=SR21-1",
            sourceSnapshotId: "source-published-row-revision-test-2",
            sourceAsOf: null,
            sourceRetrievedAt: "2026-08-14T02:00:00.000Z",
            status: "Completed",
            sourceRecordDate: "2021-07-01T00:00:00.000Z",
            freshnessClass: "stale",
            canonicalType: "land",
            propertyType: "reported_vacant_lot",
            explorerRefreshedAt: "2026-08-14T02:00:00.000Z",
            licenseCheckState: "match",
            currentLicenseMatches: [
              { name: "Current Shop", status: "AAI", expirationDate: "2027-01-01" },
            ],
            licenseCheckedAt: "2026-08-14T00:00:00.000Z",
            zoneMatches: [],
          },
        },
      ],
      vacancyReturnedCountBeforeFilters: 3,
      vacancyFreshnessFilter: "all_records",
      vacancyLicenseFilter: "conflicts",
      vacancyCoverage: COVERAGE,
    });

    expect(csv).toContain('"Explorer refreshed at","2026-08-14T02:00:00.000Z"');
    expect(csv).toContain("Source As Of");
    expect(csv).toContain("Source Retrieved At");
    expect(csv).toContain('"311_clean_lot:SR21-1"');
    expect(csv).toContain('"source-published-row-revision-test-2"');
    expect(csv).toContain('"Records before filters","3"');
    expect(csv).toContain('"Records exported","1"');
    expect(csv).toContain('"311 Clean Vacant Lot Request","311_clean_lot"');
    expect(csv).toContain('"Completed","2021-07-01T00:00:00.000Z","stale"');
    expect(csv).toContain('"Tracked land signal","reported_vacant_lot"');
    expect(csv).toContain('"match","Current Shop (AAI) through 2027-01-01"');
    expect(csv).toContain("conflict signal, not proof of occupancy");
    expect(csv).toContain("311 retention policy");
    expect(csv).toContain("not the persisted cutoff of the last source sync");
  });

  it("neutralizes formula-leading source and license cells for spreadsheets", () => {
    const csv = buildDrawnAreaCsv({
      areaName: "Formula safety",
      vacancyFeatures: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-87.63, 41.88] },
          properties: {
            address: "  =HYPERLINK(\"https://evil.test\")",
            source: "dpd_vacant",
            status: "+SUM(1,1)",
            canonicalType: "building",
            propertyType: "vacant_building",
            currentLicenseMatches: [
              { name: "@DANGEROUS", status: "AAI", expirationDate: "2027-01-01" },
            ],
            zoneMatches: [],
          },
        },
      ],
    });

    expect(csv).toContain("'  =HYPERLINK");
    expect(csv).toContain("'+SUM(1,1)");
    expect(csv).toContain("'@DANGEROUS");
  });

  it("exports exact license cap and partial batch coverage facts", () => {
    const csv = buildDrawnAreaCsv({
      areaName: "Bounded screening",
      vacancyFeatures: [],
      vacancyCoverage: {
        ...COVERAGE,
        returnedCount: 0,
        freshness: {
          ...COVERAGE.freshness,
          returnedCounts: { recent: 0, stale: 0, unknownDate: 0 },
        },
        licenseScreening: {
          ...COVERAGE.licenseScreening,
          status: "partial",
          candidateCount: 900,
          checkedCount: 500,
          matchedPropertyCount: 0,
          capped: true,
          sourceCallCount: 10,
          successfulBatches: 9,
          failedBatches: 1,
          partialReasons: ["address_cap", "source_batch_failure"],
        },
      },
    });

    expect(csv).toContain('"License screening capped","yes"');
    expect(csv).toContain('"License address cap","500"');
    expect(csv).toContain('"License source calls","10"');
    expect(csv).toContain('"License root groups complete","9"');
    expect(csv).toContain('"License root groups incomplete","1"');
    expect(csv).toContain('"License partial reasons","address_cap; source_batch_failure"');
  });
});
