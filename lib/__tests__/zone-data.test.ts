import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import {
  CHECKABLE_ZONE_KEYS,
  POINT_DATA_ZONE_KEYS,
  ZONE_LABELS,
} from "../constants";

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

  it("keeps restored point-data layers out of address-confirmed eligibility checks", () => {
    expect(POINT_DATA_ZONE_KEYS).toEqual([
      "brownfields",
      "lustSites",
      "nofFundedProjects",
      "countyIncentiveParcels",
    ]);

    for (const key of POINT_DATA_ZONE_KEYS) {
      expect(ZONE_LABELS[key]).toBeDefined();
      expect(CHECKABLE_ZONE_KEYS).not.toContain(key);
    }
  });

  it("keeps restored polygon layers eligible for address matching and reports", () => {
    for (const key of ["ccsa", "energyCommunities", "hubzone"]) {
      expect(ZONE_LABELS[key]).toBeDefined();
      expect(CHECKABLE_ZONE_KEYS).toContain(key);
    }

    const energy = JSON.parse(
      readFileSync("public/data/zones/energy-communities.geojson", "utf8"),
    ) as FeatureCollection;
    const hubzone = JSON.parse(
      readFileSync("public/data/zones/hubzone.geojson", "utf8"),
    ) as FeatureCollection;

    expect(energy.features.length).toBeGreaterThan(0);
    expect(new Set(energy.features.map((feature) => feature.geometry?.type))).toEqual(
      new Set(["Polygon"]),
    );
    expect(hubzone.features.length).toBeGreaterThan(0);
    expect(new Set(hubzone.features.map((feature) => feature.geometry?.type))).toEqual(
      new Set(["MultiPolygon"]),
    );
  });
});
