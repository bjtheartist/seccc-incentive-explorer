import { describe, expect, it } from "vitest";
import { SHORTLIST_CSV_HEADERS, overlaysCell, shortlistCsv, shortlistCsvFilename } from "../shortlist-csv";
import type { CandidateOverlays, DecoratedShortlistCandidate } from "../shortlist-engine";

describe("overlaysCell — review5 S2", () => {
  it("never prints 'None mapped' when every layer is unknown — prints 'Not checked' instead", () => {
    const cell = overlaysCell({
      ssa: { present: false, name: null, unknown: true },
      ccsa: { present: false, name: null, unknown: true },
      tif: { present: false, name: null, unknown: true },
      nof: { present: false, name: null, unknown: true },
    });
    expect(cell).toBe("Not checked");
    expect(cell).not.toMatch(/none mapped/i);
  });

  it("preserves a known positive AND discloses a different unknown layer in the same cell", () => {
    const cell = overlaysCell({
      ssa: { present: true, name: "Greater Chatham", unknown: false },
      ccsa: { present: false, name: null, unknown: false },
      tif: { present: false, name: null, unknown: true },
      nof: { present: false, name: null, unknown: false },
    });
    expect(cell).toContain("SSA: Greater Chatham");
    expect(cell).toContain("TIF not checked");
  });

  it("prints 'None mapped' only when every layer genuinely resolved and none matched", () => {
    const cell = overlaysCell({
      ssa: { present: false, name: null, unknown: false },
      ccsa: { present: false, name: null, unknown: false },
      tif: { present: false, name: null, unknown: false },
      nof: { present: false, name: null, unknown: false },
    });
    expect(cell).toBe("None mapped");
  });
});

function noOverlays(): CandidateOverlays {
  return {
    ssa: { present: false, name: null, unknown: false },
    ccsa: { present: false, name: null, unknown: false },
    tif: { present: false, name: null, unknown: false },
    nof: { present: false, name: null, unknown: false },
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
    overlays: { ...noOverlays(), ssa: { present: true, name: "Greater Chatham", unknown: false }, tif: { present: true, name: null, unknown: false } },
    transitScore: { networks: ["cta-rail"], stationName: "79th", stationSystem: "CTA", meters: 300, walkMinutes: 4, points: 25 },
    nearestRailDisplay: null,
    expresswayDisplay: { name: "Dan Ryan Expy (I-90/94)", miles: 0.4 },
    nearestSchool: { name: "Barnard", meters: 500 },
    nearestLibrary: { name: "Chatham-Avalon", meters: 700 },
    score: 25,
    recordCompletenessScore: 4,
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
          ssa: { present: true, name: "Greater Chatham", unknown: false },
          tif: { present: true, name: null, unknown: false },
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

  it("preserves independent County class and assessment failure states", () => {
    const unavailableClass = shortlistCsv([candidate()], {
      [candidate().key]: {
        countyClass: null,
        classGloss: null,
        countyClassStatus: "unavailable",
        lotAreaSqft: null,
        lotAreaStatus: "unavailable",
        assessorBuildingSqft: null,
        assessorBuildingYear: null,
        assessorBuildingAreaStatus: "unavailable",
        assessedValue: 6_900,
        assessedYear: "2025",
        assessedStage: "board",
        assessedValueStatus: "available",
        impliedMarketValue: null,
        activeLicenses: [],
      },
    });
    expect(unavailableClass.split("\n")[1].split(",").slice(7, 19)).toEqual([
      "Unavailable",
      "Unavailable",
      "Unavailable",
      "4000",
      "Published snapshot · current County check unavailable",
      "Unavailable",
      "Unavailable",
      "6900",
      "2025",
      "board",
      "Available",
      "Not published",
    ]);

    const unavailableAssessment = shortlistCsv([candidate()], {
      [candidate().key]: {
        countyClass: "517",
        classGloss: "Commercial building",
        countyClassStatus: "available",
        lotAreaSqft: 3125,
        lotAreaStatus: "available",
        assessorBuildingSqft: 1800,
        assessorBuildingYear: "2025",
        assessorBuildingAreaStatus: "available",
        assessedValue: null,
        assessedYear: null,
        assessedStage: null,
        assessedValueStatus: "unavailable",
        impliedMarketValue: null,
        activeLicenses: [],
      },
    });
    expect(unavailableAssessment.split("\n")[1].split(",").slice(7, 19)).toEqual([
      "517",
      "Available",
      "Commercial building",
      "1800",
      "Available · current County record",
      "3125",
      "Available · current County record",
      "Unavailable",
      "Unavailable",
      "Unavailable",
      "Unavailable",
      "Unavailable",
    ]);
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

  it("keeps saved and exact-current PIN provenance separate while exporting County and Google Maps links", () => {
    const row = candidate({ key: "coordinate-row", pin: null, address: "3040 S HOMAN AVE" });
    const csv = shortlistCsv(
      [row],
      {},
      {
        [row.key]: {
          status: "resolved",
          pin: "16264270400000",
          pinSource: "coordinate_exact",
          source: "cook_county_current_parcels",
          matchMethod: "exact_intersection",
          checkedAt: "2026-08-15T20:00:00.000Z",
        },
      },
      "60623",
    );
    const line = csv.split("\n")[1];
    expect(line).toContain(",,16-26-427-040-0000,Current County parcel resolved by exact map-point intersection,");
    expect(line).toContain("https://maps.cookcountyil.gov/cookviewer/?pin14=16264270400000");
    expect(line).toContain("https://www.cookcountyassessoril.gov/pin/16264270400000");
    expect(line).toContain("https://crs.cookcountyclerkil.gov/Search/ResultByPin?id1=16264270400000");
    expect(line).toContain("query=3040+S+HOMAN+AVE%2C+Chicago%2C+IL+60623");
  });

  it("exports Google Maps without a PIN and does not imply a County lookup occurred", () => {
    const row = candidate({ key: "unchecked-row", pin: null, address: "3040 S HOMAN AVE" });
    const csv = shortlistCsv([row], {}, {}, "60623");
    expect(csv).toContain("Not checked");
    expect(csv).toContain("query=3040+S+HOMAN+AVE%2C+Chicago%2C+IL+60623");
    expect(csv).not.toContain("Current County parcel resolved by exact map-point intersection");
  });

  it("exports leading-zero PINs as dashed text-safe identities for saved and exact-current records", () => {
    const saved = candidate({ key: "saved-leading-zero", pin: "01-23-456-789-0000" });
    const current = candidate({ key: "current-leading-zero", pin: null, address: "3040 S HOMAN AVE" });
    const csv = shortlistCsv(
      [saved, current],
      {},
      {
        [current.key]: {
          status: "resolved",
          pin: "01234567890000",
          pinSource: "coordinate_exact",
          source: "cook_county_current_parcels",
          matchMethod: "exact_intersection",
          checkedAt: "2026-08-15T20:00:00.000Z",
        },
      },
      "60623",
    );
    const [, savedLine, currentLine] = csv.split("\n");
    expect(savedLine).toContain(",01-23-456-789-0000,01-23-456-789-0000,Published in saved shortlist snapshot,");
    expect(currentLine).toContain(",,01-23-456-789-0000,Current County parcel resolved by exact map-point intersection,");
    expect(csv).not.toMatch(/,01234567890000,/);
    expect(csv).toContain("pin14=01234567890000");
  });

  it("does not let a truthy malformed saved PIN bypass the unresolved export state", () => {
    const row = candidate({ key: "bad-pin", pin: "not-a-pin", address: "3040 S HOMAN AVE" });
    const csv = shortlistCsv([row], {}, {}, "60623");
    const line = csv.split("\n")[1];
    expect(line).toContain("3040 S HOMAN AVE,,,Not checked,");
    expect(line).not.toContain("Published in saved shortlist snapshot");
    expect(line).not.toContain("not-a-pin");
    expect(line).toContain("query=3040+S+HOMAN+AVE%2C+Chicago%2C+IL+60623");
  });

  it("preserves exactly 20 ranked rows and neutralizes formula-leading source text", () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      candidate({
        key: `row-${index + 1}`,
        address: index === 0 ? '=HYPERLINK("https://attacker.invalid")' : `${index + 1} TEST ST`,
      }),
    );
    const csv = shortlistCsv(rows, {}, {}, "60623");
    expect(csv.split("\n")).toHaveLength(21);
    expect(csv.split("\n")[1]).toContain("'=");
    expect(csv.split("\n")[20].startsWith("20,")).toBe(true);
  });

  // ── DEMOTED (round 3): this test proves shortlistCsv's OWN serialization
  //    is order-preserving under adversarial enrichment — a real, narrow
  //    property of the CSV formatter, still worth keeping. It does NOT
  //    prove Finding 10's actual claim (that request-time enrichment cannot
  //    change SELECTION — which finalist rows are chosen and in what order
  //    BEFORE anything is ever serialized). This test runs entirely
  //    downstream of a finalist list `shortlistCsv` is simply handed —
  //    finalist selection has already happened by the time this file's code
  //    runs at all. Finding 10's actual proof now lives in
  //    lib/__tests__/shortlist-enrichment-blindness.test.ts (server-side,
  //    both a structural import-graph proof and, where applicable, a
  //    mocked-adversarial-module byte-identical-order proof) and in
  //    components/vacancy/__tests__/SiteShortlistResults.test.tsx (a
  //    component test proving adversarial enrichment delivered AFTER MOUNT
  //    changes only card FACTS, never DOM order/membership).
  it("shortlistCsv's OWN row order is unaffected by adversarial enrichment values (narrower than Finding 10 — serialization purity only)", () => {
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
