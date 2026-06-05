import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";

describe("zone data guardrails", () => {
  it("uses official NOF corridor polygons for NOF eligibility matching", () => {
    const fc = JSON.parse(
      readFileSync("public/data/zones/nof-corridors.geojson", "utf8"),
    ) as FeatureCollection;

    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(45);
    expect(new Set(fc.features.map((feature) => feature.geometry?.type))).toEqual(
      new Set(["Polygon"]),
    );
    expect(
      fc.features.filter((feature) => feature.properties?.nofLayer === "eligible_corridor"),
    ).toHaveLength(22);
    expect(
      fc.features.filter((feature) => feature.properties?.nofLayer === "priority_corridor"),
    ).toHaveLength(23);
  });

  it("keeps old NOF awarded-project points separate from eligibility corridors", () => {
    const fc = JSON.parse(
      readFileSync("public/data/zones/nof-projects.geojson", "utf8"),
    ) as FeatureCollection;

    expect(fc.features).toHaveLength(6);
    expect(new Set(fc.features.map((feature) => feature.geometry?.type))).toEqual(
      new Set(["Point"]),
    );
  });
});
