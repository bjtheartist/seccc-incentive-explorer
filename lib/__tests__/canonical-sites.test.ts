import { describe, expect, it } from "vitest";
import {
  MERGE_DISTANCE_METERS,
  aggregateCanonicalSites,
  findDuplicateCanonicalKeys,
  normalizeSiteAddress,
  type RawTrackedRecord,
} from "../canonical-sites";

function record(overrides: Partial<RawTrackedRecord> & { recordId: string }): RawTrackedRecord {
  return {
    evidenceType: "city_land",
    pin: null,
    address: null,
    lat: null,
    lon: null,
    propertyType: "vacant_land",
    status: null,
    statusDate: null,
    lotSqft: null,
    buildingSqft: null,
    ownerType: null,
    ownerStructureHint: null,
    ownerGeographyHint: null,
    incentiveCount: null,
    legacyZoningClass: null,
    ...overrides,
  };
}

describe("normalizeSiteAddress", () => {
  it("lowercases and strips non-alphanumeric characters", () => {
    expect(normalizeSiteAddress("3842 W WEST END AVE")).toBe("3842wwestendave");
    expect(normalizeSiteAddress("3842 W WEST  END AVE")).toBe("3842wwestendave");
    expect(normalizeSiteAddress(null)).toBe("");
  });
});

describe("aggregateCanonicalSites — PIN identity", () => {
  it("collapses every record sharing a PIN into one canonical site", () => {
    const records = [
      record({ recordId: "a", evidenceType: "assessor_vacant_land", pin: "12-34-567-890-0000", propertyType: "vacant_land", lotSqft: 5000 }),
      record({ recordId: "b", evidenceType: "311_building", pin: "12345678900000", propertyType: "vacant_building", buildingSqft: 1200 }),
    ];
    const { sites, stats } = aggregateCanonicalSites(records);
    expect(sites).toHaveLength(1);
    expect(sites[0].canonicalKey).toBe("pin:12345678900000");
    expect(sites[0].pin).toBe("12345678900000");
    expect(stats.sourceRecords).toBe(2);
    expect(stats.canonicalSites).toBe(1);
    expect(stats.collapsedRecords).toBe(1);
  });

  it("normalizes differently-punctuated PINs to the same identity", () => {
    const records = [
      record({ recordId: "a", pin: "12341234123412" }),
      record({ recordId: "b", pin: "12-34-123-412-3412" }),
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(sites).toHaveLength(1);
  });
});

describe("aggregateCanonicalSites — evidence preservation, not richer-row-wins", () => {
  it("carries both land and building evidence with explicit conflict flag rather than picking one", () => {
    const records = [
      record({
        recordId: "land-1",
        evidenceType: "city_land",
        pin: "11111111111111",
        propertyType: "vacant_land",
        lotSqft: 4000,
        status: "vacant",
      }),
      record({
        recordId: "bld-1",
        evidenceType: "311_building",
        pin: "11111111111111",
        propertyType: "vacant_building",
        status: "open",
      }),
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(sites).toHaveLength(1);
    const site = sites[0];
    expect(site.hasVacantLandEvidence).toBe(true);
    expect(site.hasVacantBuildingEvidence).toBe(true);
    expect(site.conflictingPropertyTypes).toBe(true);
    expect(site.evidenceTypes).toEqual(["311_building", "city_land"]);
    // Building evidence is the resolved display type, but land evidence is NOT lost.
    expect(site.propertyType).toBe("vacant_building");
    expect(site.lotSqft).toBe(4000);
  });

  it("flags ownerTypeConflict when sources disagree instead of silently overwriting", () => {
    const records = [
      record({ recordId: "a", pin: "22222222222222", evidenceType: "city_land", ownerType: "city_public" }),
      record({ recordId: "b", pin: "22222222222222", evidenceType: "assessor_vacant_land", ownerType: "corporate_llc" }),
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(sites[0].ownerTypeConflict).toBe(true);
    // assessor_vacant_land outranks city_land in SOURCE_PRECEDENCE.
    expect(sites[0].ownerType).toBe("corporate_llc");
    expect(sites[0].ownerTypeSource).toBe("assessor_vacant_land");
  });

  it("picks pre-classified ownerStructure/ownerGeography hints by source precedence", () => {
    const records = [
      record({ recordId: "a", pin: "10101010101010", evidenceType: "city_land", ownerStructureHint: "government", ownerGeographyHint: "in_state" }),
      record({ recordId: "b", pin: "10101010101010", evidenceType: "assessor_vacant_land", ownerStructureHint: "entity", ownerGeographyHint: "out_of_state" }),
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(sites[0].ownerStructure).toBe("entity");
    expect(sites[0].ownerGeography).toBe("out_of_state");
  });

  it("applies measurement precedence and records the winning source", () => {
    const records = [
      record({ recordId: "a", pin: "33333333333333", evidenceType: "city_land", lotSqft: 1000 }),
      record({ recordId: "b", pin: "33333333333333", evidenceType: "assessor_vacant_land", lotSqft: 3125 }),
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(sites[0].lotSqft).toBe(3125);
    expect(sites[0].lotSqftSource).toBe("assessor_vacant_land");
  });

  it("ignores invalid higher-precedence areas and retains a valid positive measurement", () => {
    const records = [
      record({ recordId: "a", pin: "33333333333333", evidenceType: "city_land", lotSqft: 3125 }),
      record({ recordId: "b", pin: "33333333333333", evidenceType: "assessor_vacant_land", lotSqft: 0 }),
      record({ recordId: "c", pin: "33333333333333", evidenceType: "311_building", buildingSqft: -1 }),
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(sites[0].lotSqft).toBe(3125);
    expect(sites[0].lotSqftSource).toBe("city_land");
    expect(sites[0].buildingSqft).toBeNull();
    expect(sites[0].buildingSqftSource).toBeNull();
  });

  it("collapses repeated same-source records to the most recent statusDate", () => {
    const records = [
      record({ recordId: "a", pin: "44444444444444", evidenceType: "311_building", status: "open", statusDate: "2025-01-01" }),
      record({ recordId: "b", pin: "44444444444444", evidenceType: "311_building", status: "closed", statusDate: "2025-06-01" }),
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(sites[0].perSourceStatus).toHaveLength(1);
    expect(sites[0].perSourceStatus[0]).toEqual({
      evidenceType: "311_building",
      status: "closed",
      statusDate: "2025-06-01",
    });
  });
});

describe("aggregateCanonicalSites — PIN-less merge rules", () => {
  it("merges PIN-less records only when address AND proximity both agree", () => {
    const records = [
      record({ recordId: "a", evidenceType: "311_building", address: "100 W MAIN ST", lat: 41.7, lon: -87.6 }),
      record({ recordId: "b", evidenceType: "311_building", address: "100 W MAIN ST", lat: 41.70005, lon: -87.6 }), // ~5.5m away
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(sites).toHaveLength(1);
    expect(sites[0].sourceRecordIds).toEqual(["a", "b"]);
  });

  it("never merges on rounded coordinates alone when addresses differ", () => {
    const records = [
      record({ recordId: "a", evidenceType: "311_building", address: "100 W MAIN ST", lat: 41.7, lon: -87.6 }),
      record({ recordId: "b", evidenceType: "311_building", address: "102 W MAIN ST", lat: 41.7, lon: -87.6 }),
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(sites).toHaveLength(2);
  });

  it("does not merge same-address records beyond the distance threshold", () => {
    const records = [
      record({ recordId: "a", evidenceType: "311_building", address: "100 W MAIN ST", lat: 41.7, lon: -87.6 }),
      // ~55m north — well past MERGE_DISTANCE_METERS.
      record({ recordId: "b", evidenceType: "311_building", address: "100 W MAIN ST", lat: 41.7005, lon: -87.6 }),
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(sites).toHaveLength(2);
  });

  it("chains transitively within the same address bucket", () => {
    // a-b close, b-c close, a-c not directly close but chained through b.
    const records = [
      record({ recordId: "a", evidenceType: "311_building", address: "1 CHAIN ST", lat: 41.70000, lon: -87.60000 }),
      record({ recordId: "b", evidenceType: "311_building", address: "1 CHAIN ST", lat: 41.70010, lon: -87.60000 }),
      record({ recordId: "c", evidenceType: "311_building", address: "1 CHAIN ST", lat: 41.70020, lon: -87.60000 }),
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(sites).toHaveLength(1);
    expect(sites[0].sourceRecordIds).toEqual(["a", "b", "c"]);
  });

  it("treats records with no address and no PIN as singletons, never merged", () => {
    const records = [
      record({ recordId: "a", evidenceType: "311_building", address: null, lat: 41.7, lon: -87.6 }),
      record({ recordId: "b", evidenceType: "311_building", address: null, lat: 41.7, lon: -87.6 }),
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(sites).toHaveLength(2);
  });

  it("treats a same-address pair with a missing coordinate as unconfirmed (no merge)", () => {
    const records = [
      record({ recordId: "a", evidenceType: "311_building", address: "5 NO COORD AVE", lat: 41.7, lon: -87.6 }),
      record({ recordId: "b", evidenceType: "311_building", address: "5 NO COORD AVE", lat: null, lon: null }),
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(sites).toHaveLength(2);
  });
});

describe("aggregateCanonicalSites — determinism", () => {
  it("produces identical canonicalKeys regardless of input array order", () => {
    const records: RawTrackedRecord[] = [
      record({ recordId: "a", pin: "55555555555555", evidenceType: "city_land", lotSqft: 1000 }),
      record({ recordId: "b", evidenceType: "311_building", address: "9 ORDER ST", lat: 41.7, lon: -87.6 }),
      record({ recordId: "c", evidenceType: "311_building", address: "9 ORDER ST", lat: 41.70005, lon: -87.6 }),
    ];
    const forward = aggregateCanonicalSites(records);
    const reversed = aggregateCanonicalSites([...records].reverse());
    const keysA = forward.sites.map((s) => s.canonicalKey).sort();
    const keysB = reversed.sites.map((s) => s.canonicalKey).sort();
    expect(keysA).toEqual(keysB);
  });

  it("has no duplicate canonical keys across a mixed batch", () => {
    const records: RawTrackedRecord[] = [
      record({ recordId: "a", pin: "66666666666666" }),
      record({ recordId: "b", pin: "77777777777777" }),
      record({ recordId: "c", evidenceType: "311_building", address: "12 UNIQUE ST", lat: 41.71, lon: -87.61 }),
      record({ recordId: "d", evidenceType: "311_building", address: "13 UNIQUE ST", lat: 41.72, lon: -87.62 }),
    ];
    const { sites } = aggregateCanonicalSites(records);
    expect(findDuplicateCanonicalKeys(sites)).toEqual([]);
  });
});

describe("aggregateCanonicalSites — stats", () => {
  it("computes honest dedupe stats across a mixed batch", () => {
    const records: RawTrackedRecord[] = [
      // PIN group with a conflict (land + building evidence).
      record({ recordId: "a", pin: "88888888888888", evidenceType: "city_land", propertyType: "vacant_land" }),
      record({ recordId: "b", pin: "88888888888888", evidenceType: "311_building", propertyType: "vacant_building" }),
      // Clean singleton.
      record({ recordId: "c", pin: "99999999999999", propertyType: "vacant_land" }),
    ];
    const { stats } = aggregateCanonicalSites(records);
    expect(stats.sourceRecords).toBe(3);
    expect(stats.canonicalSites).toBe(2);
    expect(stats.collapsedRecords).toBe(1);
    expect(stats.conflictingPropertyTypes).toBe(1);
    expect(stats.unresolvedConflicts).toBe(1);
  });

  it("returns zero stats for an empty input", () => {
    const { sites, stats } = aggregateCanonicalSites([]);
    expect(sites).toEqual([]);
    expect(stats).toEqual({
      sourceRecords: 0,
      canonicalSites: 0,
      collapsedRecords: 0,
      conflictingPropertyTypes: 0,
      unresolvedConflicts: 0,
    });
  });
});

describe("MERGE_DISTANCE_METERS", () => {
  it("is exported as a fixed constant used by the merge rule", () => {
    expect(MERGE_DISTANCE_METERS).toBe(15);
  });
});
