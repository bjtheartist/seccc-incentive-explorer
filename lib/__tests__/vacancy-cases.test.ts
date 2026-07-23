import { describe, expect, it } from "vitest";
import { PILOT_ZIPS } from "../pilot-zips";
import {
  buildCaseRecords,
  buildCaseSearchParams,
  initialStateFromParams,
  type BuilderGoal,
  type BuilderUniverse,
  type PresetId,
  type WorkbenchMode,
} from "../vacancy-cases";

const FORBIDDEN_KEYS = ["priorityScore", "priorityTier", "portfolio"];

describe("buildCaseRecords", () => {
  for (const entry of PILOT_ZIPS) {
    it(`returns records and areas for ${entry.zip} (${entry.primaryNeighborhood})`, () => {
      const { records, areas, recordsAsOf } = buildCaseRecords(entry.zip);
      expect(records.length).toBeGreaterThan(0);
      expect(areas.length).toBeGreaterThan(0);
      expect(recordsAsOf.length).toBeGreaterThan(0);
    });
  }

  it("returns an honest empty result for a non-pilot / unknown ZIP", () => {
    const result = buildCaseRecords("00000");
    expect(result).toEqual({ records: [], areas: [], recordsAsOf: "" });
  });

  it(
    "never carries a scoring/ranking field on any record, for any pilot ZIP",
    () => {
      for (const entry of PILOT_ZIPS) {
        const { records } = buildCaseRecords(entry.zip);
        for (const record of records) {
          const serialized = record as unknown as Record<string, unknown>;
          for (const key of FORBIDDEN_KEYS) {
            expect(serialized).not.toHaveProperty(key);
          }
          for (const [key, value] of Object.entries(serialized)) {
            if (typeof value === "string") {
              expect(value, `record.${key} on ${entry.zip}/${record.id}`).not.toMatch(/priority/i);
            }
          }
        }
      }
    },
    15_000,
  );

  it("keeps land and building-report records as distinct universes", () => {
    const { records } = buildCaseRecords("60617");
    const universes = new Set(records.map((record) => record.universe));
    expect([...universes].every((u) => u === "land" || u === "building_report")).toBe(true);
  });
});

describe("initialStateFromParams / buildCaseSearchParams round trip", () => {
  const recordIds = ["land-1", "land-2", "building-3"];

  it("round-trips a full builder-mode state through the URL codec", () => {
    const state = {
      mode: "builder" as WorkbenchMode,
      activePreset: "tax-title" as PresetId,
      goal: "verify" as BuilderGoal,
      universe: "land" as BuilderUniverse,
      taxSaleOnly: true,
      violationsOnly: true,
      selectedIds: ["land-1", "building-3"],
    };
    const search = buildCaseSearchParams(state);
    const paramsObject = Object.fromEntries(search.entries());
    const parsed = initialStateFromParams(paramsObject, recordIds);

    expect(parsed).toEqual({
      mode: "builder",
      activePreset: "public-land", // not serialized outside "paths" mode -> falls back
      goal: "verify",
      universe: "land",
      taxSaleOnly: true,
      violationsOnly: true,
      initialSelectedIds: ["land-1", "building-3"],
    });
  });

  it("round-trips a paths-mode state (preset carried, builder fields default)", () => {
    const state = {
      mode: "paths" as WorkbenchMode,
      activePreset: "private-outreach" as PresetId,
      goal: "all" as BuilderGoal,
      universe: "all" as BuilderUniverse,
      taxSaleOnly: false,
      violationsOnly: false,
      selectedIds: [],
    };
    const search = buildCaseSearchParams(state);
    const paramsObject = Object.fromEntries(search.entries());
    const parsed = initialStateFromParams(paramsObject, recordIds);

    expect(parsed).toEqual({
      mode: "paths",
      activePreset: "private-outreach",
      goal: "all",
      universe: "all",
      taxSaleOnly: false,
      violationsOnly: false,
      initialSelectedIds: [],
    });
  });

  it("falls back to defaults for invalid mode/preset/goal/universe values", () => {
    const parsed = initialStateFromParams(
      {
        view: "bogus",
        case: "not-a-preset",
        goal: "not-a-goal",
        records: "not-a-universe",
        tax: "yes", // only "1" counts as true
        violations: "1",
      },
      recordIds,
    );
    expect(parsed).toEqual({
      mode: "paths",
      activePreset: "public-land",
      goal: "all",
      universe: "all",
      taxSaleOnly: false,
      violationsOnly: true,
      initialSelectedIds: [],
    });
  });

  it("drops sel ids that are not in the record set, dedupes, and caps at 3", () => {
    const parsed = initialStateFromParams(
      { view: "compare", sel: "land-1,ghost-id,land-2,land-1,building-3,land-2" },
      recordIds,
    );
    // "ghost-id" dropped (not a valid record), "land-1" deduped, capped at 3.
    expect(parsed.initialSelectedIds).toEqual(["land-1", "land-2", "building-3"]);
  });

  it("caps sel at 3 even when more than 3 valid ids are present", () => {
    const wideIds = ["a", "b", "c", "d", "e"];
    const parsed = initialStateFromParams({ sel: "a,b,c,d,e" }, wideIds);
    expect(parsed.initialSelectedIds).toHaveLength(3);
    expect(parsed.initialSelectedIds).toEqual(["a", "b", "c"]);
  });

  it("treats an absent sel param as no selection", () => {
    const parsed = initialStateFromParams({ view: "paths" }, recordIds);
    expect(parsed.initialSelectedIds).toEqual([]);
  });

  it("accepts a Set for validRecordIds identically to an array", () => {
    const fromArray = initialStateFromParams({ sel: "land-1,building-3" }, recordIds);
    const fromSet = initialStateFromParams({ sel: "land-1,building-3" }, new Set(recordIds));
    expect(fromArray).toEqual(fromSet);
  });
});
