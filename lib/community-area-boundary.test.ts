import { describe, expect, it } from "vitest";
import { CHICAGO_COMMUNITY_AREAS } from "@/lib/community-areas";
import { getCommunityAreaBoundary } from "@/lib/community-area-boundary";

describe("getCommunityAreaBoundary", () => {
  it("resolves the official boundary for all 77 canonical community areas", () => {
    for (const area of CHICAGO_COMMUNITY_AREAS) {
      expect(getCommunityAreaBoundary(area.name), area.name).not.toBeNull();
    }
  });

  it("preserves O'Hare's detached boundary pieces", () => {
    const geometry = getCommunityAreaBoundary("O'Hare");
    expect(geometry?.type).toBe("MultiPolygon");
    if (geometry?.type !== "MultiPolygon") throw new Error("expected MultiPolygon");
    expect(geometry.coordinates).toHaveLength(3);
  });
});
