import { describe, expect, it } from "vitest";
import type { VacancyCaseRecord } from "@/lib/vacancy-cases";
import {
  filterVacancyWorkspaceRecords,
  parseWorkspaceBounds,
  parseWorkspaceQuery,
  parseWorkspaceUniverse,
  parseWorkspaceView,
  serializeWorkspaceBounds,
} from "@/lib/vacancy-workspace";

function record(overrides: Partial<VacancyCaseRecord>): VacancyCaseRecord {
  return {
    id: "record",
    address: "7900 S COMMERCIAL AVE",
    pin: "21313210010000",
    universe: "land",
    ownerType: "city_public",
    ownerStructure: null,
    ownerGeography: null,
    saleYear: null,
    violation: false,
    squareFeet: null,
    lat: 41.75,
    lon: -87.55,
    ...overrides,
  };
}

const records = [
  record({ id: "land", address: "7900 S COMMERCIAL AVE" }),
  record({
    id: "building",
    address: "3022 E 91ST ST",
    pin: "21323120020000",
    universe: "building_report",
    lat: 41.73,
    lon: -87.56,
  }),
  record({ id: "unmapped", address: "10000 S EWING AVE", pin: null, lat: null, lon: null }),
];

describe("vacancy workspace URL state", () => {
  it("parses only the supported view and record-type values", () => {
    expect(parseWorkspaceView("map")).toBe("map");
    expect(parseWorkspaceView("split")).toBe("list");
    expect(parseWorkspaceUniverse("building_report")).toBe("building_report");
    expect(parseWorkspaceUniverse("developer")).toBe("all");
    expect(parseWorkspaceQuery("  Commercial  ")).toBe("Commercial");
  });

  it("normalizes bounds to four decimals and rejects invalid boxes", () => {
    const parsed = parseWorkspaceBounds("-87.612345,41.701234,-87.501234,41.812345");
    expect(parsed).toEqual([-87.6123, 41.7012, -87.5012, 41.8123]);
    expect(serializeWorkspaceBounds(parsed!)).toBe("-87.6123,41.7012,-87.5012,41.8123");
    expect(parseWorkspaceBounds("-87.5,41.8,-87.6,41.7")).toBeNull();
    expect(parseWorkspaceBounds("not,a,bounds,value")).toBeNull();
  });
});

describe("vacancy workspace filters", () => {
  it("uses AND semantics across query, record type, and committed bounds", () => {
    expect(
      filterVacancyWorkspaceRecords(records, {
        query: "91st",
        universe: "building_report",
        bounds: [-87.57, 41.72, -87.55, 41.74],
      }).map((item) => item.id),
    ).toEqual(["building"]);
  });

  it("matches a PIN without making an alphabetic address query match every PIN", () => {
    expect(
      filterVacancyWorkspaceRecords(records, {
        query: "2132312",
        universe: "all",
        bounds: null,
      }).map((item) => item.id),
    ).toEqual(["building"]);
    expect(
      filterVacancyWorkspaceRecords(records, {
        query: "commercial",
        universe: "all",
        bounds: null,
      }).map((item) => item.id),
    ).toEqual(["land"]);
  });

  it("excludes unmapped records only after a map area is committed", () => {
    expect(
      filterVacancyWorkspaceRecords(records, { query: "", universe: "all", bounds: null }),
    ).toHaveLength(3);
    expect(
      filterVacancyWorkspaceRecords(records, {
        query: "",
        universe: "all",
        bounds: [-87.7, 41.6, -87.4, 41.9],
      }).map((item) => item.id),
    ).toEqual(["land", "building"]);
  });
});
