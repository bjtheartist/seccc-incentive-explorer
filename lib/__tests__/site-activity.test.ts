import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ARTERIAL_RADIUS_MI,
  CATCHMENT_RADIUS_MI,
  LICENSE_RADIUS_MI,
  RAIL_RADIUS_MI,
  buildSiteActivityContext,
  catchmentAround,
  distanceMiles,
  licensesNear,
  nearestArterial,
  railStationsNear,
  type AadtStationRow,
  type BlockGroupRow,
  type LicenseRow,
  type RailStationRow,
} from "../site-activity";

// Loop coordinates for fixtures; ~0.01° latitude ≈ 0.69 mi.
const AT = { lat: 41.8837, lng: -87.6289 };
const NEAR = { lat: 41.8845, lng: -87.6295 }; // well inside every radius
const FAR = { lat: 41.95, lng: -87.7 }; // miles away

const aadt = (over: Partial<AadtStationRow> = {}): AadtStationRow => ({
  id: "s1",
  roadName: "State St",
  lat: NEAR.lat,
  lng: NEAR.lng,
  aadt: 18500,
  aadtYear: "2025",
  ...over,
});

const rail = (over: Partial<RailStationRow> = {}): RailStationRow => ({
  id: "40380",
  name: "Clark/Lake",
  lines: "Blue|Brown",
  lat: NEAR.lat,
  lng: NEAR.lng,
  avgWeekdayEntries: 13231.5,
  month: "2026-05",
  priorYearAvgWeekdayEntries: 10728,
  ...over,
});

const bg = (over: Partial<BlockGroupRow> = {}): BlockGroupRow => ({
  geoid: "170310101001",
  lat: NEAR.lat,
  lng: NEAR.lng,
  population: 647,
  acsVintage: "ACS 2020-2024 5-year",
  jobs: 6,
  lodesVintage: "LODES8 2023",
  ...over,
});

const lic = (over: Partial<LicenseRow> = {}): LicenseRow => ({
  category: "grocery",
  lat: NEAR.lat,
  lng: NEAR.lng,
  ...over,
});

describe("distanceMiles", () => {
  it("is ~0 for identical points and ~8.2 mi Loop→O'Hare-ish sanity", () => {
    expect(distanceMiles(AT.lat, AT.lng, AT.lat, AT.lng)).toBeLessThan(0.001);
    // Loop -> Midway (41.7868,-87.7522) is roughly 8.5 mi as the crow flies
    const d = distanceMiles(41.8837, -87.6289, 41.7868, -87.7522);
    expect(d).toBeGreaterThan(7.5);
    expect(d).toBeLessThan(9.5);
  });
});

describe("radius honesty — nothing outside a disclosed radius ever counts", () => {
  it("nearestArterial returns null when the only station is beyond the radius", () => {
    expect(nearestArterial(AT.lat, AT.lng, [aadt({ lat: FAR.lat, lng: FAR.lng })])).toBeNull();
  });

  it("railStationsNear excludes beyond-walkshed stations and sorts nearest first", () => {
    const out = railStationsNear(AT.lat, AT.lng, [
      rail({ id: "far", lat: FAR.lat, lng: FAR.lng }),
      rail({ id: "near2", name: "Washington", lat: AT.lat + 0.004, lng: AT.lng }),
      rail({ id: "near1" }),
    ]);
    expect(out.map((s) => s.name)).toEqual(["Clark/Lake", "Washington"]);
    expect(out[0].distanceMi).toBeLessThanOrEqual(RAIL_RADIUS_MI);
  });

  it("catchmentAround returns NULL (not zero) when no centroid is in radius", () => {
    expect(catchmentAround(AT.lat, AT.lng, [bg({ lat: FAR.lat, lng: FAR.lng })])).toBeNull();
  });

  it("licensesNear returns NULL (not zero) when nothing is in radius", () => {
    expect(licensesNear(AT.lat, AT.lng, [lic({ lat: FAR.lat, lng: FAR.lng })])).toBeNull();
  });
});

describe("measurement mechanics", () => {
  it("nearestArterial picks the CLOSEST in-radius station, with distance shipped", () => {
    const out = nearestArterial(AT.lat, AT.lng, [
      aadt({ id: "farther", aadt: 99999, lat: AT.lat + 0.0018, lng: AT.lng }),
      aadt({ id: "closest", aadt: 18500 }),
    ]);
    expect(out?.stationId).toBe("closest");
    expect(out?.aadt).toBe(18500);
    expect(out?.distanceMi).toBeGreaterThanOrEqual(0);
    expect(out?.distanceMi).toBeLessThanOrEqual(ARTERIAL_RADIUS_MI);
  });

  it("catchment sums population and jobs over in-radius centroids only", () => {
    const out = catchmentAround(AT.lat, AT.lng, [
      bg({ geoid: "a", population: 1000, jobs: 50 }),
      bg({ geoid: "b", population: 200, jobs: 7, lat: AT.lat + 0.005 }),
      bg({ geoid: "out", population: 999999, jobs: 999999, lat: FAR.lat, lng: FAR.lng }),
    ]);
    expect(out).toEqual({
      population: 1200,
      jobs: 57,
      blockGroups: 2,
      acsVintage: "ACS 2020-2024 5-year",
      lodesVintage: "LODES8 2023",
    });
  });

  it("licensesNear counts by category, largest first, 'other' preserved not hidden", () => {
    const out = licensesNear(AT.lat, AT.lng, [
      lic(),
      lic({ category: "restaurant_cafe" }),
      lic({ category: "restaurant_cafe" }),
      lic({ category: "other" }),
    ]);
    expect(out?.total).toBe(4);
    expect(out?.byCategory[0]).toEqual({ category: "restaurant_cafe", count: 2 });
    expect(out?.byCategory.some((c) => c.category === "other")).toBe(true);
  });

  it("rail lines split on the pipe delimiter", () => {
    const [s] = railStationsNear(AT.lat, AT.lng, [rail()]);
    expect(s.lines).toEqual(["Blue", "Brown"]);
  });
});

describe("honesty rails — the shape itself forbids synthesis", () => {
  it("the context payload NEVER carries a modeled foot-traffic figure", () => {
    const context = buildSiteActivityContext(AT.lat, AT.lng, {
      aadt: [aadt()],
      rail: [rail()],
      blockGroups: [bg()],
      licenses: [lic()],
    });
    // If someone ever adds a synthesized visitor/footfall estimate, this test
    // is the tripwire: no key at ANY depth may match the banned family.
    const banned = /visit|footfall|foot_?traffic|estimate|capture|weekly_?volume|synthetic/i;
    const offending: string[] = [];
    const walk = (value: unknown, trail: string) => {
      if (value == null || typeof value !== "object") return;
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (banned.test(k)) offending.push(`${trail}.${k}`);
        walk(v, `${trail}.${k}`);
      }
    };
    walk(context, "context");
    expect(offending).toEqual([]);
  });

  it("the disclosed radii ship inside the payload the UI renders", () => {
    const context = buildSiteActivityContext(AT.lat, AT.lng, {
      aadt: [],
      rail: [],
      blockGroups: [],
      licenses: [],
    });
    expect(context.radii).toEqual({
      arterialMi: ARTERIAL_RADIUS_MI,
      railMi: RAIL_RADIUS_MI,
      catchmentMi: CATCHMENT_RADIUS_MI,
      licenseMi: LICENSE_RADIUS_MI,
    });
    expect(context.arterial).toBeNull();
    expect(context.rail).toEqual([]);
  });
});

describe("committed feed artifacts stay parseable by the engine's expectations", () => {
  const dir = path.join(process.cwd(), "data", "curated", "site-activity");

  it("all four CSV headers match the loader's column names", () => {
    const header = (f: string) => readFileSync(path.join(dir, f), "utf8").split("\n", 1)[0].trim();
    expect(header("idot_aadt_stations.csv")).toBe("station_or_segment_id,road_name,lat,lng,aadt,aadt_year");
    expect(header("cta_l_station_avg_weekday.csv")).toBe(
      "station_id,station_name,lines,lat,lng,avg_weekday_entries,month,prior_year_avg_weekday_entries,status_note",
    );
    expect(header("catchment_block_groups.csv")).toBe(
      "bg_geoid,lat,lng,population,acs_vintage,jobs,lodes_vintage",
    );
    expect(header("active_licenses_compact.csv")).toBe("license_id,name,category,lat,lng");
  });
});
