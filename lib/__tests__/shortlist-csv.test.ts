import { describe, expect, it } from "vitest";
import { SHORTLIST_CSV_HEADERS, shortlistCsv, shortlistCsvFilename } from "../shortlist-csv";
import type { CandidateOverlays, DecoratedShortlistCandidate } from "../shortlist-engine";

function noOverlays(): CandidateOverlays {
  return {
    ssa: { present: false, name: null },
    ccsa: { present: false, name: null },
    tif: { present: false, name: null },
    nof: { present: false, name: null },
  };
}

function candidate(overrides: Partial<DecoratedShortlistCandidate> = {}): DecoratedShortlistCandidate {
  return {
    key: "pin:20363230080000",
    address: "8000 S COTTAGE GROVE AVE",
    pin: "20363230080000",
    lat: 41.75,
    lon: -87.605,
    propertyType: "vacant_building",
    buildingSqft: 4000,
    lotSqft: null,
    zoningDistrict: "B3-2",
    zoningStatus: "resolved",
    badge: "aligned",
    badgeNote: "Aligned note",
    ownerLabel: "Corporate / LLC · out-of-state mailing address (unverified)",
    incentiveCount: 2,
    saleYear: null,
    violation: false,
    conflictingPropertyTypes: false,
    screenedPropertyType: "vacant_building",
    overlays: { ...noOverlays(), ssa: { present: true, name: "Greater Chatham" }, tif: { present: true, name: null } },
    transitScore: { networks: ["cta-rail"], stationName: "79th", stationSystem: "CTA", meters: 300, walkMinutes: 4, points: 25 },
    nearestRailDisplay: null,
    expresswayDisplay: { name: "Dan Ryan Expy (I-90/94)", miles: 0.4 },
    nearestSchool: { name: "Barnard", meters: 500 },
    nearestLibrary: { name: "Chatham-Avalon", meters: 700 },
    score: 25,
    ...overrides,
  };
}

describe("shortlistCsv", () => {
  it("emits a header plus one row per candidate, in the given order", () => {
    const rows = [candidate({ key: "a" }), candidate({ key: "b", address: "4411 S CALUMET AVE" })];
    const lines = shortlistCsv(rows).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(SHORTLIST_CSV_HEADERS[0]);
    expect(lines[0].split(",").length).toBeGreaterThanOrEqual(SHORTLIST_CSV_HEADERS.length);
    expect(lines[1].split(",")[0]).toBe("1");
    expect(lines[2].split(",")[0]).toBe("2");
  });

  it("lists only the active overlays with their names (Finding 12), and 'None mapped' when none are set", () => {
    const withOverlays = shortlistCsv([
      candidate({
        overlays: {
          ...noOverlays(),
          ssa: { present: true, name: "Greater Chatham" },
          tif: { present: true, name: null },
        },
      }),
    ]);
    expect(withOverlays).toContain("SSA: Greater Chatham; TIF");
    const withoutOverlays = shortlistCsv([candidate({ overlays: noOverlays() })]);
    expect(withoutOverlays).toContain("None mapped");
  });

  it("shows the zoning badge label, not the raw badge id", () => {
    const csv = shortlistCsv([candidate({ badge: "not-aligned" })]);
    expect(csv).toContain("No broad family alignment");
    expect(csv).not.toContain("not-aligned");
  });

  it("folds enrichment facts in when present, without changing row order or count", () => {
    const rows = [candidate({ key: "a" }), candidate({ key: "b" })];
    const csv = shortlistCsv(rows, {
      a: {
        countyClass: "517",
        classGloss: "One-story commercial building",
        assessedValue: 50_000,
        assessedYear: "2024",
        impliedMarketValue: 200_000,
        activeLicenses: [{ name: "Chatham Cafe", description: "Retail Food" }],
      },
    });
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows, still — enrichment never adds/removes rows.
    expect(csv).toContain("200000");
    expect(csv).toContain("Chatham Cafe");
  });

  it("quotes cells containing commas or quotes", () => {
    const csv = shortlistCsv([
      candidate({
        key: "a",
        expresswayDisplay: { name: 'Some "Named" Expy, Segment', miles: 0.2 },
      }),
    ]);
    expect(csv).toContain('"Some ""Named"" Expy, Segment');
  });

  it("shows the scored transit fact when present, and the display-only nearest-rail fact otherwise — never both", () => {
    const scored = shortlistCsv([candidate()]);
    expect(scored).toContain("79th (CTA)");

    const displayOnly = shortlistCsv([
      candidate({
        transitScore: null,
        nearestRailDisplay: { name: "63rd", system: "CTA", meters: 900, walkMinutes: 11 },
      }),
    ]);
    expect(displayOnly).toContain("63rd (CTA)");
  });

  it("names the file per ZIP", () => {
    expect(shortlistCsvFilename("60619")).toBe("Site-Shortlist-60619.csv");
  });

  it("returns just the header for an empty candidate list", () => {
    expect(shortlistCsv([]).split("\n")).toHaveLength(1);
  });

  // ── Finding 10 (re-review): ADVERSARIAL enrichment invariance ────────────
  //
  // The pre-fix "invariance" test only proved row COUNT/order stayed put
  // between two runs with NO enrichment injected at all — tautological,
  // since nothing was ever different between the two calls. This test
  // injects enrichment values deliberately CRAFTED to tempt a
  // value-sorted reordering if enrichment and ranking were ever coupled:
  // the LAST-ranked candidate gets the highest assessed value / implied
  // market value / license count, and the FIRST-ranked candidate gets
  // nothing. If shortlistCsv (or anything downstream) ever started
  // re-sorting by a "richer" enrichment fact, this is exactly the input
  // that would flip the order — and it must not.
  it("ADVERSARIAL: enrichment crafted to tempt a value-based reorder changes NEITHER membership NOR order", () => {
    const ranked = [
      candidate({ key: "first", address: "1 FIRST ST", score: 40 }),
      candidate({ key: "second", address: "2 SECOND ST", score: 20 }),
      candidate({ key: "last", address: "3 LAST ST", score: 0 }),
    ];

    const unenriched = shortlistCsv(ranked);

    // Adversarial: the LAST-ranked candidate looks like the most valuable,
    // most "interesting" record by every enrichment fact — the temptation
    // a coupled implementation would have to move it to the top.
    const adversarial = shortlistCsv(ranked, {
      last: {
        countyClass: "517",
        classGloss: "One-story commercial building",
        assessedValue: 50_000_000,
        assessedYear: "2024",
        impliedMarketValue: 200_000_000,
        activeLicenses: [
          { name: "A", description: "" },
          { name: "B", description: "" },
          { name: "C", description: "" },
        ],
      },
      first: {
        countyClass: null,
        classGloss: null,
        assessedValue: null,
        assessedYear: null,
        impliedMarketValue: null,
        activeLicenses: [],
      },
    });

    const rowsOf = (csv: string) =>
      csv
        .split("\n")
        .slice(1)
        .map((line) => line.split(",").slice(0, 2).join(",")); // [rank, address]

    // Row 1..3 addresses are in the SAME order regardless of the
    // adversarial enrichment — membership AND order both unchanged.
    expect(rowsOf(adversarial)).toEqual(rowsOf(unenriched));
    expect(rowsOf(adversarial).map((r) => r.split(",")[0])).toEqual(["1", "2", "3"]);
    // Sanity: the adversarial values really did make it into the CSV (so
    // this test would actually catch a reorder if one occurred — it isn't
    // passing merely because the enrichment was silently dropped).
    expect(adversarial).toContain("200000000");
  });
});
