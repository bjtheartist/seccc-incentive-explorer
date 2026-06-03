import { describe, expect, it } from "vitest";
import anchorsData from "@/data/exports/chicago-neighborhood-economics/neighborhood_anchors_by_community_area.json";
import { rankCommunityAnchors, type CommunityAnchorFile } from "@/lib/neighborhood-economic-models";

const file = anchorsData as CommunityAnchorFile;

describe("curated community-anchor data file", () => {
  it("covers all 77 community areas with exactly two anchors each", () => {
    const keys = Object.keys(file.byCommunityArea);
    expect(file.communityAreaCount).toBe(77);
    expect(file.anchorCount).toBe(154);
    expect(keys).toHaveLength(77);

    for (const key of keys) {
      expect(key).toMatch(/^\d{1,2}$/);
      const n = Number(key);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(77);

      const entry = file.byCommunityArea[key];
      expect(entry.communityArea.trim().length).toBeGreaterThan(0);
      expect(entry.anchors).toHaveLength(2);

      for (const anchor of entry.anchors) {
        expect(anchor.name.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every anchor scored, sourced, and bounded for public reporting", () => {
    for (const entry of Object.values(file.byCommunityArea)) {
      for (const anchor of entry.anchors) {
        expect(anchor.name.trim().length).toBeGreaterThan(0);
        expect(anchor.totalScore).not.toBeNull();
        expect(anchor.totalScore).toBeGreaterThanOrEqual(0);
        expect(anchor.totalScore).toBeLessThanOrEqual(100);
        expect(anchor.sourceUrls?.length ?? 0).toBeGreaterThan(0);
        for (const url of anchor.sourceUrls ?? []) {
          expect(url).toMatch(/^https?:\/\//);
        }
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
