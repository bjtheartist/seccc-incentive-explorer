import { describe, expect, it } from "vitest";
import { parsePinList, permitsAdapter, SINCE_DATE, type RawPermit } from "../permits";
import { PERMIT_SINCE_DATE } from "../../permit-match";

const base: RawPermit = {
  permit_: "100912345",
  permit_status: "COMPLETE",
  permit_milestone: "PERMIT ISSUED",
  permit_type: "PERMIT - RENOVATION/ALTERATION",
  permit_condition: "STANDARD",
  work_type: "Interior Alteration",
  work_description: "INTERIOR REMODEL",
  issue_date: "2024-03-15T00:00:00.000",
  reported_cost: "125000",
  // Verified live: this dataset separates PINs with " | ", not ";" or ",".
  pin_list: "2605112042 | 2605112043",
  street_number: "3251",
  street_direction: "S",
  street_name: "91ST ST",
  latitude: "41.7300",
  longitude: "-87.5448",
};

describe("permitsAdapter.normalize", () => {
  it("maps a complete record into a DB-ready row", () => {
    const row = permitsAdapter.normalize(base);
    expect(row).not.toBeNull();
    expect(row!.permitId).toBe("100912345");
    expect(row!.permitType).toBe("PERMIT - RENOVATION/ALTERATION");
    expect(row!.workDescription).toBe("INTERIOR REMODEL");
    expect(row!.issueDate).toBe("2024-03-15T00:00:00.000");
    expect(row!.reportedCost).toBe(125000);
    expect(row!.address).toBe("3251 S 91ST ST");
    expect(row!.lat).toBeCloseTo(41.73);
    expect(row!.lon).toBeCloseTo(-87.5448);
    expect(row!.isDemolition).toBe(false);
  });

  it("carries the four verified metadata columns through", () => {
    const row = permitsAdapter.normalize(base)!;
    expect(row.permitStatus).toBe("COMPLETE");
    expect(row.permitMilestone).toBe("PERMIT ISSUED");
    expect(row.workType).toBe("Interior Alteration");
    expect(row.permitCondition).toBe("STANDARD");
  });

  it("keeps EVERY pin from pin_list, not just the first", () => {
    const row = permitsAdapter.normalize(base)!;
    expect(row.pins).toEqual(["2605112042", "2605112043"]);
    expect(row.pin).toBe("2605112042");
    const none = permitsAdapter.normalize({ ...base, pin_list: undefined })!;
    expect(none.pins).toEqual([]);
    expect(none.pin).toBeNull();
  });

  it("flags demolition permits from permit_type or work_type", () => {
    expect(
      permitsAdapter.normalize({ ...base, permit_type: "PERMIT - WRECKING/DEMOLITION" })!
        .isDemolition,
    ).toBe(true);
    expect(
      permitsAdapter.normalize({ ...base, permit_type: "permit - demolition" })!.isDemolition,
    ).toBe(true);
    expect(
      permitsAdapter.normalize({ ...base, permit_type: "PERMIT - EASY", work_type: "Demolition" })!
        .isDemolition,
    ).toBe(true);
    expect(permitsAdapter.normalize(base)!.isDemolition).toBe(false);
  });

  it("attaches provenance with the source key and raw record", () => {
    const row = permitsAdapter.normalize(base);
    expect(row!.provenance.source).toBe("building_permits");
    expect(row!.provenance.raw_json).toBe(base);
  });

  it("drops records with no permit id", () => {
    expect(permitsAdapter.normalize({ ...base, permit_: undefined })).toBeNull();
    expect(permitsAdapter.normalize({ ...base, permit_: "  " })).toBeNull();
  });

  // ── The un-geocoded fix ──
  // The pilot dropped every row without usable coordinates, including rows that
  // carried a PIN or a street address and were therefore still matchable.

  it("KEEPS an un-geocoded permit that still carries a PIN", () => {
    const row = permitsAdapter.normalize({
      ...base,
      latitude: undefined,
      longitude: undefined,
      street_number: undefined,
      street_direction: undefined,
      street_name: undefined,
    });
    expect(row).not.toBeNull();
    expect(row!.lat).toBeNull();
    expect(row!.lon).toBeNull();
    expect(row!.pins).toEqual(["2605112042", "2605112043"]);
  });

  it("KEEPS an un-geocoded permit that still carries a street address", () => {
    const row = permitsAdapter.normalize({
      ...base,
      latitude: "0",
      longitude: "0",
      pin_list: undefined,
    });
    expect(row).not.toBeNull();
    expect(row!.lat).toBeNull();
    expect(row!.address).toBe("3251 S 91ST ST");
  });

  it("treats out-of-bounds coordinates as ABSENT rather than trusting them", () => {
    const row = permitsAdapter.normalize({ ...base, latitude: "40.0" });
    expect(row).not.toBeNull();
    expect(row!.lat).toBeNull();
    expect(row!.lon).toBeNull();
    // The row survives on its PIN/address, which is the whole point.
    expect(row!.pins.length).toBeGreaterThan(0);
  });

  it("drops a record it can place by NOTHING — no coords, no pin, no address", () => {
    expect(
      permitsAdapter.normalize({
        permit_: "X1",
        latitude: undefined,
        longitude: undefined,
        pin_list: undefined,
      }),
    ).toBeNull();
  });

  it("leaves optional numeric/text fields null when absent", () => {
    const row = permitsAdapter.normalize({
      permit_: "X1",
      latitude: "41.73",
      longitude: "-87.54",
    });
    expect(row!.reportedCost).toBeNull();
    expect(row!.permitType).toBeNull();
    expect(row!.permitStatus).toBeNull();
    expect(row!.permitMilestone).toBeNull();
    expect(row!.workType).toBeNull();
    expect(row!.permitCondition).toBeNull();
    expect(row!.workDescription).toBeNull();
    expect(row!.issueDate).toBeNull();
    expect(row!.address).toBeNull();
    expect(row!.isDemolition).toBe(false);
  });

  it("always reports zip as null — ydr8-5enu has no ZIP column", () => {
    expect(permitsAdapter.normalize(base)!.zip).toBeNull();
  });
});

describe("parsePinList", () => {
  it("splits the live ' | ' separator", () => {
    expect(parsePinList("1733326038 | 1733326039 | 1733326040")).toEqual([
      "1733326038",
      "1733326039",
      "1733326040",
    ]);
  });

  it("also splits semicolons, commas and whitespace", () => {
    expect(parsePinList("1709119028;1709119029")).toEqual(["1709119028", "1709119029"]);
    expect(parsePinList("1709119028, 1709119029")).toEqual(["1709119028", "1709119029"]);
  });

  it("drops the all-zero placeholder PIN", () => {
    expect(parsePinList("0000000000")).toEqual([]);
    expect(parsePinList("0000000000 | 1709119028")).toEqual(["1709119028"]);
  });

  it("drops tokens that are not a plausible PIN length", () => {
    expect(parsePinList("123 | 1709119028 | 999999999999999999")).toEqual(["1709119028"]);
  });

  it("de-duplicates while preserving order", () => {
    expect(parsePinList("1709119028 | 1709119029 | 1709119028")).toEqual([
      "1709119028",
      "1709119029",
    ]);
  });

  it("accepts the 14-digit form too", () => {
    expect(parsePinList("16-11-105-004-0000")).toEqual(["16111050040000"]);
  });

  it("returns an empty list for absent or unusable input", () => {
    expect(parsePinList(undefined)).toEqual([]);
    expect(parsePinList("")).toEqual([]);
    expect(parsePinList("   ")).toEqual([]);
  });
});

describe("ingest window", () => {
  it("re-exports the single source of truth so the UI cannot claim a window we did not query", () => {
    expect(SINCE_DATE).toBe(PERMIT_SINCE_DATE);
    expect(SINCE_DATE).toBe("2015-01-01");
  });
});
