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

import { cdgQueryCandidates, sourcePublishedCommunityArea } from "../../scripts/export-community-investment";

describe("cdgQueryCandidates — mechanical rewrites of published text only", () => {
  const q = (a: string) => `${a.trim()}, Chicago, IL`;

  it("puts the published text first so a variant can never shadow an exact match", () => {
    const c = cdgQueryCandidates("13016 S. Rhodes Ave.", q);
    expect(c[0]).toBe("13016 S. Rhodes Ave., Chicago, IL");
    expect(c).toContain("13016 S Rhodes Ave, Chicago, IL");
  });

  it("collapses a leading street-number range to its first number", () => {
    expect(cdgQueryCandidates("2640-46 W. Madison St.", q)).toContain(
      "2640 W Madison St, Chicago, IL",
    );
  });

  it("splits a slash compound into its component published addresses", () => {
    const c = cdgQueryCandidates("8700 S Ashland/1607 W 87th", q);
    expect(c).toContain("8700 S Ashland, Chicago, IL");
    expect(c).toContain("1607 W 87th, Chicago, IL");
  });

  it("never invents a street name, suffix, or number", () => {
    for (const v of cdgQueryCandidates("4100 S Packers", q)) {
      // every variant must be a substring-preserving rewrite: same digits, no new words
      expect(v.replace(", Chicago, IL", "")).toMatch(/^4100 S Packers$/);
    }
  });
});

describe("sourcePublishedCommunityArea — the source's own claim or nothing", () => {
  it("parses the exporter's held-row convention", () => {
    expect(
      sourcePublishedCommunityArea(
        "South Lawndale (Little Village) -- exact street address not published",
      ),
    ).toBe("South Lawndale");
    expect(
      sourcePublishedCommunityArea("New City -- exact street address not published"),
    ).toBe("New City");
  });

  it("returns null for a street address — never inferred", () => {
    expect(sourcePublishedCommunityArea("13016 S. Rhodes Ave.")).toBeNull();
    expect(sourcePublishedCommunityArea("4100 S Packers")).toBeNull();
  });
});

describe("mapCdgAwards — variant hits and source-published areas", () => {
  const q = (a: string) => `${a.trim()}, Chicago, IL`;

  it("plots a row whose verbatim query misses but whose variant matches", () => {
    const rows = [{ recipient: "Williams Chicken", address: "8700 S Ashland/1607 W 87th", amount: "250000", round: "January 2026", log_line: "", source_url: "" }];
    // cache holds ONLY the compound's second component — the real-world shape
    const geo = new Map([["1607 W 87th, Chicago, IL", { lat: 41.735, lng: -87.663 }]]);
    const out = mapCdgAwards(rows, geo, q);
    expect(out.records[0].geometry.kind).toBe("point");
    expect(out.pointRecords).toBe(1);
    expect(out.heldCitywideDollars).toBe(0);
    // published text is untouched
    expect(out.records[0].address).toBe("8700 S Ashland/1607 W 87th");
  });

  it("stamps the source-published community area on a truly address-less hold", () => {
    const rows = [{ recipient: "Black Fire Brigade First Responder Training Academy", address: "New City -- exact street address not published", amount: "3900000", round: "June 2026", log_line: "", source_url: "" }];
    const out = mapCdgAwards(rows, new Map(), q);
    expect(out.records[0].geometry.kind).toBe("citywide");
    expect(out.records[0].communityArea).toBe("New City");
    expect(out.heldCitywideDollars).toBe(3_900_000);
  });

  it("never stamps an area from a street address that merely failed to geocode", () => {
    const rows = [{ recipient: "Yellow Banana - Altgeld", address: "13016 S. Rhodes Ave.", amount: "4870000", round: "February 2023", log_line: "", source_url: "" }];
    const out = mapCdgAwards(rows, new Map(), q);
    expect(out.records[0].geometry.kind).toBe("citywide");
    expect(out.records[0].communityArea).toBeUndefined();
  });
});
