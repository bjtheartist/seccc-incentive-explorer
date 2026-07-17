import { describe, expect, it, vi } from "vitest";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  buildingViolationCountForCluster,
  fetchOwnerClusters,
  loadStaticOwnerClusters,
  normalizeDistressSignals,
  taxSaleSignalsForCluster,
  type TaxSaleEntrySummary,
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
   * public/data/corridor-owners.json predates pins[]/distressSignals/
   * latestTaxSaleYear/taxSaleSoldCount (the export must be regenerated on a
   * refresh branch to populate them for real) — every loaded cluster must
   * still satisfy the current OwnerCluster shape rather than leaving the new
   * fields undefined.
   */
  it("the shipped export carries pins and the MVP distress signal for every ZIP", () => {
    // The 2026-07-16 nine-ZIP export populates pins[] and
    // buildingViolationCount; the Phase-2 signals (vacant-violation count,
    // sale flag, and the two tax-sale copy fields) stay null until the
    // export is regenerated on a refresh branch with the new adapters
    // synced. Old-shape defaulting stays covered by the synthetic
    // normalizeDistressSignals tests below.
    const zips = ["60617", "60619", "60649", "60624", "60623", "60644", "60651", "60621", "60636"];
    for (const zip of zips) {
      const clusters = loadStaticOwnerClusters(zip, 50)!;
      expect(clusters.length).toBeGreaterThan(0);
      for (const cluster of clusters) {
        expect(Array.isArray(cluster.pins)).toBe(true);
        const ds = cluster.distressSignals;
        expect(ds.buildingViolationCount === null || typeof ds.buildingViolationCount === "number").toBe(true);
        expect(ds.vacantBuildingViolationCount).toBeNull();
        expect(ds.delinquentTaxCount).toBeNull();
        expect(ds.scavengerOrAnnualSaleFlag).toBeNull();
        expect(ds.cclbaInventoryFlag).toBeNull();
        expect(cluster.latestTaxSaleYear).toBeNull();
        expect(cluster.taxSaleSoldCount).toBeNull();
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

describe("taxSaleSignalsForCluster", () => {
  it("returns every field null when the join could not run (tables unavailable)", () => {
    expect(taxSaleSignalsForCluster(["17213210180000"], null)).toEqual({
      flag: null,
      latestTaxSaleYear: null,
      taxSaleSoldCount: null,
    });
  });

  it("returns a real false/null/0 (no exposure) when the join ran but no PIN matched", () => {
    const byPin = new Map<string, TaxSaleEntrySummary>([["99999999999999", { years: [2020], soldCount: 1 }]]);
    expect(taxSaleSignalsForCluster(["17213210180000"], byPin)).toEqual({
      flag: false,
      latestTaxSaleYear: null,
      taxSaleSoldCount: 0,
    });
    expect(taxSaleSignalsForCluster([], byPin)).toEqual({ flag: false, latestTaxSaleYear: null, taxSaleSoldCount: 0 });
    expect(taxSaleSignalsForCluster(null, byPin)).toEqual({ flag: false, latestTaxSaleYear: null, taxSaleSoldCount: 0 });
  });

  it("flags exposure and reports the latest year + sold count across matched pins", () => {
    const byPin = new Map<string, TaxSaleEntrySummary>([
      ["17213210180000", { years: [2007], soldCount: 1 }],
      ["07184110250000", { years: [2013, 2014], soldCount: 0 }],
    ]);
    expect(taxSaleSignalsForCluster(["17213210180000", "07184110250000"], byPin)).toEqual({
      flag: true,
      latestTaxSaleYear: 2014,
      taxSaleSoldCount: 1,
    });
  });

  it("sums soldCount across multiple matched pins in the same cluster", () => {
    const byPin = new Map<string, TaxSaleEntrySummary>([
      ["pin1", { years: [2020], soldCount: 2 }],
      ["pin2", { years: [2021], soldCount: 3 }],
    ]);
    expect(taxSaleSignalsForCluster(["pin1", "pin2"], byPin)).toEqual({
      flag: true,
      latestTaxSaleYear: 2021,
      taxSaleSoldCount: 5,
    });
  });
});

/**
 * fetchOwnerClusters export-time join, against a mocked Neon tagged-template
 * sql client (same queued-response pattern as lib/__tests__/owner-file.test.ts'
 * makeSql). Verifies the query call order — main cluster query, licenses,
 * building_violations, vacant_building_violations, scavenger_sale_entries,
 * annual_tax_sale_entries — and that the Phase-2 fields (vacant-violation
 * count, sale flag, latestTaxSaleYear, taxSaleSoldCount) come out right.
 */
describe("fetchOwnerClusters (Phase-2 distress join)", () => {
  const clusterRow = {
    cluster_key: "mail:testowner",
    pins: ["17213210180000"],
    owner_name: "TEST OWNER LLC",
    owner_mailing_address: "1 MAIN ST, CHICAGO, IL",
    owner_type: "corporate_llc",
    parcel_count: 1,
    vacant_parcel_count: 0,
    sample_addresses: ["100 MAIN ST"],
    norm_addresses: ["100mainst"],
    norm_owners: ["testownerllc"],
    latest_transfer_date: null,
    latest_buyer_name: null,
    latest_seller_name: null,
    confidence: "High",
    evidence: "grouped by recorded owner mailing address",
  };

  /** Queued-response mock for the Neon tagged-template sql client. */
  function makeSql(responses: unknown[][]) {
    let call = 0;
    const fn = vi.fn(async () => {
      const result = responses[call] ?? [];
      call += 1;
      return result;
    });
    return fn as unknown as NeonQueryFunction<false, false>;
  }

  it("populates vacantBuildingViolationCount and sale-exposure fields when a PIN matches", async () => {
    const sql = makeSql([
      [clusterRow], // main cluster query
      [], // licenses
      [], // building_violations
      [{ norm_address: "100mainst" }], // vacant_building_violations
      [{ pin: "17213210180000", tax_sale_year: 2007, sold_at_sale: true }], // scavenger_sale_entries
      [{ pin: "17213210180000", tax_sale_year: 2013, sold_at_sale: false }], // annual_tax_sale_entries
    ]);

    const [cluster] = await fetchOwnerClusters(sql, "60617", 50);
    expect(cluster.distressSignals.buildingViolationCount).toBe(0);
    expect(cluster.distressSignals.vacantBuildingViolationCount).toBe(1);
    expect(cluster.distressSignals.scavengerOrAnnualSaleFlag).toBe(true);
    expect(cluster.latestTaxSaleYear).toBe(2013);
    expect(cluster.taxSaleSoldCount).toBe(1);
  });

  it("returns a real false/0 sale-exposure result when the join ran but no PIN matched", async () => {
    const sql = makeSql([
      [clusterRow],
      [],
      [],
      [], // no vacant-violation rows
      [{ pin: "00000000000000", tax_sale_year: 2020, sold_at_sale: true }], // different pin
      [],
    ]);

    const [cluster] = await fetchOwnerClusters(sql, "60617", 50);
    expect(cluster.distressSignals.vacantBuildingViolationCount).toBe(0);
    expect(cluster.distressSignals.scavengerOrAnnualSaleFlag).toBe(false);
    expect(cluster.latestTaxSaleYear).toBeNull();
    expect(cluster.taxSaleSoldCount).toBe(0);
  });

  it("degrades every Phase-2 field to null (never a silent false/0) when the tax-sale tables aren't migrated", async () => {
    let call = 0;
    const sql = vi.fn(async () => {
      const idx = call;
      call += 1;
      if (idx === 0) return [clusterRow];
      if (idx === 1) return [];
      if (idx === 2) return []; // building_violations join runs fine
      if (idx === 3) return []; // vacant_building_violations join runs fine
      // scavenger_sale_entries / annual_tax_sale_entries: relation missing
      throw Object.assign(new Error('relation "scavenger_sale_entries" does not exist'), { code: "42P01" });
    }) as unknown as NeonQueryFunction<false, false>;

    const [cluster] = await fetchOwnerClusters(sql, "60617", 50);
    expect(cluster.distressSignals.scavengerOrAnnualSaleFlag).toBeNull();
    expect(cluster.latestTaxSaleYear).toBeNull();
    expect(cluster.taxSaleSoldCount).toBeNull();
  });
});
