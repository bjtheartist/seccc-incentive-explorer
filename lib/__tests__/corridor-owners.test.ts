import { describe, expect, it } from "vitest";
import { loadStaticOwnerClusters } from "../corridor-owners";

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
});
