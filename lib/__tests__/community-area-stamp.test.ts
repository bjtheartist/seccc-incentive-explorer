import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHICAGO_COMMUNITY_AREAS } from "../community-areas";
import { assignCommunityArea, loadCommunityAreaPolygons } from "../community-area-stamp";

/**
 * Spot fixture for the point-in-polygon community-area stamping, run against the
 * committed City boundary file (public/data/community-areas.geojson). Known
 * coordinates must land in their real community area, and a point outside the
 * city must return null (kept with no CA, counted in meta.outsideCommunityAreas).
 */
const GEOJSON_PATH = path.join(process.cwd(), "public", "data", "community-areas.geojson");
const polygons = loadCommunityAreaPolygons(GEOJSON_PATH);
const CANON = new Set(CHICAGO_COMMUNITY_AREAS.map((ca) => ca.name));

describe("loadCommunityAreaPolygons", () => {
  it("loads all 77 community areas with canonical title-case names", () => {
    expect(polygons).toHaveLength(77);
    for (const p of polygons) {
      expect(CANON.has(p.name), `${p.name} is a canonical CA name`).toBe(true);
      expect(p.bounds).toHaveLength(4);
    }
    // All 77 canonical names are represented exactly once.
    expect(new Set(polygons.map((p) => p.name)).size).toBe(77);
  });
});

describe("assignCommunityArea", () => {
  it("stamps a 79th St grant point into South Shore (2049 E 79th St)", () => {
    expect(assignCommunityArea(-87.57402, 41.75164, polygons)).toBe("South Shore");
  });

  it("stamps a W 79th St grant point into Auburn Gresham (1024 W 79th St)", () => {
    expect(assignCommunityArea(-87.64992, 41.75054, polygons)).toBe("Auburn Gresham");
  });

  it("stamps a downtown point into the Loop (State & Madison)", () => {
    expect(assignCommunityArea(-87.6278, 41.8819, polygons)).toBe("Loop");
  });

  it("returns null for a point outside every Chicago community area (Evanston)", () => {
    expect(assignCommunityArea(-87.68537, 42.05112, polygons)).toBeNull();
  });

  it("returns null far out in Lake Michigan", () => {
    expect(assignCommunityArea(-87.4, 41.85, polygons)).toBeNull();
  });
});
