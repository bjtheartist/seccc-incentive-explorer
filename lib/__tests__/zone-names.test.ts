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

  it("names a TIF from the published District_Name + TIF_Number", () => {
    // The TIF boundary GeoJSON carries no `name`/`description` at all, so the
    // static fallback used to render every TIF match nameless.
    expect(
      formatZoneFeatureName("tif", {
        TIF_Number: "T- 75",
        District_Name: "Madison/Austin Corridor",
      }),
    ).toBe("Madison/Austin Corridor TIF (T-75)");
  });

  it("still lets an explicit name win for a TIF (the DB feature_name path is unchanged)", () => {
    expect(
      formatZoneFeatureName("tif", {
        name: "Madison/Austin Corridor",
        TIF_Number: "T- 75",
        District_Name: "ignored",
      }),
    ).toBe("Madison/Austin Corridor");
  });

  it("degrades gracefully for a TIF feature carrying only one of the two fields", () => {
    expect(formatZoneFeatureName("tif", { District_Name: "Kinzie Industrial" })).toBe(
      "Kinzie Industrial",
    );
    expect(formatZoneFeatureName("tif", { TIF_Number: "T- 12" })).toBe("T-12");
    expect(formatZoneFeatureName("tif", {})).toBe("");
  });

  it("resolves the real TIF covering 4048 W MADISON ST from the committed boundary file", () => {
    const fc = JSON.parse(
      readFileSync("public/data/zones/tif-districts.geojson", "utf8"),
    ) as GeoJSON.FeatureCollection;
    const madison = turf.point([-87.7279171939, 41.8811054031]);
    const match = fc.features.find(
      (feature): feature is Feature<Polygon | MultiPolygon> =>
        Boolean(feature.geometry) &&
        turf.booleanPointInPolygon(madison, feature as Feature<Polygon | MultiPolygon>),
    );

    expect(match).toBeDefined();
    expect(featureDisplayName("tif", match!)).toBe("Madison/Austin Corridor TIF (T-75)");
    expect(featureDisplayName("tif", match!)).not.toBe("");
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
