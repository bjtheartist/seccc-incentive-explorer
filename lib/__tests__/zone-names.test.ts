import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { featureDisplayName, formatZoneFeatureName } from "../zone-names";

describe("zone feature names", () => {
  it("keeps SSA names tied to their actual SSA number", () => {
    expect(
      formatZoneFeatureName("ssa", {
        name: "Englewood",
        description: "SSA#80",
      }),
    ).toBe("Englewood (SSA #80)");

    expect(
      formatZoneFeatureName("ssa", {
        name: "Calumet Hts/Avalon",
        description: "SSA#50",
      }),
    ).toBe("Calumet Hts/Avalon (SSA #50)");
  });

  it("does not append an SSA number twice", () => {
    expect(
      formatZoneFeatureName("ssa", {
        name: "Englewood (SSA #80)",
        description: "SSA#80",
      }),
    ).toBe("Englewood (SSA #80)");
  });

  it("identifies Go Green Community Fresh Market as Englewood SSA 80, not SSA 50", () => {
    const fc = JSON.parse(
      readFileSync("public/data/zones/special-service-areas.geojson", "utf8"),
    ) as GeoJSON.FeatureCollection;
    const goGreen = turf.point([-87.6548974, 41.7794440]);
    const match = fc.features.find(
      (feature): feature is Feature<Polygon | MultiPolygon> =>
        Boolean(feature.geometry) &&
        turf.booleanPointInPolygon(
          goGreen,
          feature as Feature<Polygon | MultiPolygon>,
        ),
    );

    expect(match).toBeDefined();
    expect(featureDisplayName("ssa", match!)).toBe("Englewood (SSA #80)");
    expect(featureDisplayName("ssa", match!)).not.toContain("SSA #50");
  });
});
