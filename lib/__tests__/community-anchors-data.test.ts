import { describe, expect, it } from "vitest";
import anchorsData from "@/data/exports/chicago-neighborhood-economics/neighborhood_anchors_by_community_area.json";
import { rankCommunityAnchors, type CommunityAnchorFile } from "@/lib/neighborhood-economic-models";

const file = anchorsData as CommunityAnchorFile;

describe("curated community-anchor data file", () => {
  it("is keyed by numeric community area (1-77) with named anchors", () => {
    const keys = Object.keys(file.byCommunityArea);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toMatch(/^\d{1,2}$/);
      const n = Number(key);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(77);
      for (const anchor of file.byCommunityArea[key].anchors) {
        expect(anchor.name.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("ranks each area's anchors by total score without error", () => {
    for (const entry of Object.values(file.byCommunityArea)) {
      const ranked = rankCommunityAnchors(entry.anchors, 5);
      for (let i = 1; i < ranked.length; i += 1) {
        expect(ranked[i - 1].totalScore ?? 0).toBeGreaterThanOrEqual(ranked[i].totalScore ?? 0);
      }
    }
  });
});
