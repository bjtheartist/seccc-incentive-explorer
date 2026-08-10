import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapCdgAwards, parseDelimited } from "../../scripts/export-community-investment";

/**
 * The CDG block of the Community Investment export used to DROP any award row
 * whose address did not geocode, incrementing one global meta.droppedNoGeocode
 * integer and nothing else. That silently deleted 11 real, published awards
 * worth $16,258,316 — among them the June-2026 round's largest single grant
 * ($5,000,000) and a $4,870,000 grocery award — from a headline the dataset
 * presents as the city's community-investment total. An absence of evidence
 * (no Census match for a street address the city never published) was being
 * shipped as evidence of absence (the money is not in the file).
 *
 * These tests pin the replacement rule: a CDG row is NEVER dropped. It is
 * plotted when it geocodes and held citywide — unplotted, but present, with its
 * amount and its address text — when it does not.
 */

const INPUT_DIR = path.join(process.cwd(), "data", "curated", "investment-inputs");
const CDG_FILE = "cdg_awards.csv";

const cdgRows = parseDelimited(readFileSync(path.join(INPUT_DIR, CDG_FILE), "utf8"), ",");
const query = (addr: string) => `${addr.trim()}, Chicago, IL`;

/** The cache the exporter itself geocodes from — no network, fully deterministic. */
const geocodeCache: Record<string, { lat: number; lng: number }> = JSON.parse(
  readFileSync(path.join(INPUT_DIR, "geocode-cache.json"), "utf8"),
);
const curatedGeocodes = new Map<string, { lat: number; lng: number } | null>(
  Object.entries(geocodeCache),
);

const sumAmounts = (values: (number | null)[]) =>
  values.reduce<number>((total, v) => total + (v ?? 0), 0);

describe("mapCdgAwards — an ungeocodable award is held, not deleted", () => {
  const rows = [
    { address: "10700 S Halsted St", recipient: "Geocodes Fine", amount: "100000", round: "Summer 2022", log_line: "", source_url: "" },
    {
      address: "South Lawndale (Little Village) -- exact street address not published",
      recipient: "No Street Address Published",
      amount: "5000000",
      round: "June 2026",
      log_line: "Largest single grant in the round.",
      source_url: "https://example.org/round",
    },
    { address: "", recipient: "No Address At All", amount: "250000", round: "Fall 2022", log_line: "", source_url: "" },
  ];
  const geo = new Map<string, { lat: number; lng: number } | null>([
    [query("10700 S Halsted St"), { lat: 41.699, lng: -87.643 }],
  ]);

  it("emits one record per input row — nothing is dropped for want of a geocode", () => {
    const out = mapCdgAwards(rows, geo, query);
    expect(out.records).toHaveLength(rows.length);
    expect(out.records.map((r) => r.recipient)).toEqual([
      "Geocodes Fine",
      "No Street Address Published",
      "No Address At All",
    ]);
  });

  it("plots the geocoded row and holds the other two citywide", () => {
    const out = mapCdgAwards(rows, geo, query);
    expect(out.records.map((r) => r.geometry.kind)).toEqual(["point", "citywide", "citywide"]);
    expect(out.pointRecords).toBe(1);
    expect(out.citywideRecords).toBe(2);
  });

  it("keeps the awarded dollars of the unplotted rows and reports them", () => {
    const out = mapCdgAwards(rows, geo, query);
    expect(sumAmounts(out.records.map((r) => r.amountAwarded))).toBe(5_350_000);
    expect(out.heldCitywideDollars).toBe(5_250_000);
  });

  it("preserves the published address text of an unplotted row rather than blanking it", () => {
    const out = mapCdgAwards(rows, geo, query);
    expect(out.records[1].address).toBe(
      "South Lawndale (Little Village) -- exact street address not published",
    );
    expect(out.records[2].address).toBeNull();
  });

  it("counts a published address that returned no geocoder match as a miss, and a blank one as neither", () => {
    const out = mapCdgAwards(rows, geo, query);
    expect(out.addressGeocodeMisses).toBe(1); // the placeholder-address row only
  });

  it("never invents coordinates for an unplotted row", () => {
    const out = mapCdgAwards(rows, geo, query);
    for (const record of out.records.slice(1)) {
      expect(record.geometry).toEqual({ kind: "citywide" });
    }
  });
});

describe("cdg_awards.csv — the curated file reaches the export whole", () => {
  const out = mapCdgAwards(cdgRows, curatedGeocodes, query);

  it("produces a record for every curated row", () => {
    expect(cdgRows.length).toBeGreaterThan(300);
    expect(out.records).toHaveLength(cdgRows.length);
  });

  it("carries the file's ENTIRE published award total, geocoded or not", () => {
    const csvTotal = sumAmounts(
      cdgRows.map((r) => (r.amount.trim() === "" ? null : Number(r.amount.replace(/[$,]/g, "")))),
    );
    expect(sumAmounts(out.records.map((r) => r.amountAwarded))).toBe(csvTotal);
  });

  it("keeps the two June-2026 awards the city published without a street address", () => {
    // $8.9M that the drop-on-geocode-miss rule used to delete outright.
    const byRecipient = new Map(out.records.map((r) => [r.recipient, r]));
    expect(byRecipient.get("Floreciendo: La Villita / Erie House Community Center")?.amountAwarded)
      .toBe(5_000_000);
    expect(byRecipient.get("Black Fire Brigade First Responder Training Academy")?.amountAwarded)
      .toBe(3_900_000);
  });
});
