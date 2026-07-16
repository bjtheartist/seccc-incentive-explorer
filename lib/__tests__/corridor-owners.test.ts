import { describe, expect, it } from "vitest";
import {
  buildingViolationCountForCluster,
  loadStaticOwnerClusters,
  normalizeDistressSignals,
} from "../corridor-owners";

/**
 * Guards the committed static export (public/data/corridor-owners.json)
 * that /api/corridor/owners serves on prod, where the request-time database
 * holds no parcel data by design (corridor-metrics doctrine).
 */
describe("loadStaticOwnerClusters", () => {
  it("returns clusters for every footprint ZIP", () => {
    for (const zip of ["60617", "60619", "60649"]) {
      const clusters = loadStaticOwnerClusters(zip, 50);
      expect(clusters, `expected clusters for ${zip}`).not.toBeNull();
      expect(clusters!.length).toBeGreaterThan(0);
      const top = clusters![0];
      expect(top.clusterKey).toBeTruthy();
      expect(top.parcelCount).toBeGreaterThan(0);
      expect(top.confidence).toMatch(/^(High|Medium|Low)$/);
      expect(Array.isArray(top.businessNames)).toBe(true);
      expect(Array.isArray(top.sampleAddresses)).toBe(true);
    }
  });

  it("respects the limit parameter", () => {
    expect(loadStaticOwnerClusters("60619", 5)).toHaveLength(5);
  });

  it("returns null for a ZIP outside the export", () => {
    expect(loadStaticOwnerClusters("60601", 50)).toBeNull();
  });

  /**
   * public/data/corridor-owners.json predates pins[]/distressSignals (the
   * export must be regenerated on a refresh branch to populate them for
   * real) — every loaded cluster must still satisfy the current OwnerCluster
   * shape rather than leaving the new fields undefined.
   */
  it("backward-compat: defaults pins to [] and distressSignals fields to null for the current export", () => {
    for (const zip of ["60617", "60619", "60649"]) {
      const clusters = loadStaticOwnerClusters(zip, 50)!;
      for (const cluster of clusters) {
        expect(Array.isArray(cluster.pins)).toBe(true);
        expect(cluster.distressSignals).toEqual({
          buildingViolationCount: null,
          vacantBuildingViolationCount: null,
          delinquentTaxCount: null,
          scavengerOrAnnualSaleFlag: null,
          cclbaInventoryFlag: null,
        });
      }
    }
  });
});

describe("normalizeDistressSignals", () => {
  it("defaults every field to null for a missing/invalid value", () => {
    for (const value of [undefined, null, "not an object", 42, []]) {
      expect(normalizeDistressSignals(value)).toEqual({
        buildingViolationCount: null,
        vacantBuildingViolationCount: null,
        delinquentTaxCount: null,
        scavengerOrAnnualSaleFlag: null,
        cclbaInventoryFlag: null,
      });
    }
  });

  it("keeps well-typed fields and drops garbage-typed ones", () => {
    expect(
      normalizeDistressSignals({
        buildingViolationCount: 3,
        vacantBuildingViolationCount: "not a number",
        delinquentTaxCount: null,
        scavengerOrAnnualSaleFlag: true,
        cclbaInventoryFlag: "yes",
        extraneous: "ignored",
      })
    ).toEqual({
      buildingViolationCount: 3,
      vacantBuildingViolationCount: null,
      delinquentTaxCount: null,
      scavengerOrAnnualSaleFlag: true,
      cclbaInventoryFlag: null,
    });
  });
});

describe("buildingViolationCountForCluster", () => {
  it("returns null when the join could not run (source table unavailable)", () => {
    expect(buildingViolationCountForCluster(["123mainst"], null)).toBeNull();
  });

  it("sums counts across the cluster's normalized addresses", () => {
    const counts = new Map([
      ["123mainst", 2],
      ["456elmst", 5],
    ]);
    expect(buildingViolationCountForCluster(["123mainst", "456elmst"], counts)).toBe(7);
  });

  it("returns a real 0 when the join ran but nothing matched", () => {
    expect(buildingViolationCountForCluster(["999nowherest"], new Map())).toBe(0);
    expect(buildingViolationCountForCluster([], new Map())).toBe(0);
    expect(buildingViolationCountForCluster(null, new Map())).toBe(0);
  });
});
