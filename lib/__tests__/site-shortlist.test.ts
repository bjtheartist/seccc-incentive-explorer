import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTERIAL_TOKENS,
  CONDITION_VERIFICATION_NOTE,
  DEFAULT_SWEET_SPOT_SQFT,
  OVERLAY_ENRICH_LIMIT,
  SHORTLIST_SNAPSHOT_SOURCE,
  TIER_1_CAP,
  TIER_2_CAP,
  VIOLATION_FLAG,
  ZONING_SCREENING_NOTE,
  accessibilityNoteFor,
  activeLicenseFlag,
  approxDistanceMeters,
  assembleShortlist,
  countyClassGloss,
  impliedMarketValue,
  nearestStation,
  onArterial,
  ownerAxesLabel,
  passesFootprintScreen,
  passesPropertyTypeScreen,
  railScreenFor,
  screenShortlistSites,
  screeningAreaSqft,
  shortlistCsv,
  shortlistCsvFilename,
  shortlistSnapshotHref,
  sweetSpotFor,
  taxSaleFlag,
  zoningStatusFor,
  zoningStatusNote,
  type ScreenedSite,
  type ShortlistSourceSite,
  type ShortlistStation,
} from "../site-shortlist";
import {
  createEmptySiteMatchCriteria,
  type SiteMatchCriteria,
  type SiteProjectUse,
} from "../site-matchmaker";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** 79th & Cottage Grove-ish; the Chatham corridor the pipeline was born on. */
const BASE_LAT = 41.75;
const BASE_LON = -87.605;

function criteria(overrides: Partial<SiteMatchCriteria> = {}): SiteMatchCriteria {
  return {
    ...createEmptySiteMatchCriteria(),
    zip: "60619",
    projectUse: "community-facility",
    propertyType: "existing-building",
    ...overrides,
  };
}

function site(overrides: Partial<ShortlistSourceSite> = {}): ShortlistSourceSite {
  return {
    address: "8000 S COTTAGE GROVE AVE",
    pin: "20363230080000",
    lat: BASE_LAT,
    lon: BASE_LON,
    propertyType: "vacant_building",
    zoningClass: "B3-2",
    space: { assessorBuildingSqft: 4000, lotAreaSqft: 6000 },
    ownerStructure: "corporate_llc",
    ownerGeography: "out_of_state",
    incentiveCount: 3,
    saleYear: null,
    violation: false,
    ...overrides,
  };
}

const CTA_NEAR: ShortlistStation = {
  name: "79th",
  system: "CTA",
  lat: BASE_LAT + 0.001,
  lon: BASE_LON,
};
const METRA_FAR: ShortlistStation = {
  name: "83rd Street",
  system: "Metra Electric",
  lat: BASE_LAT + 0.05,
  lon: BASE_LON,
};
const STATIONS = [CTA_NEAR, METRA_FAR];

// ── Geometry ─────────────────────────────────────────────────────────────────

describe("approxDistanceMeters", () => {
  it("returns zero for the same point", () => {
    expect(approxDistanceMeters(BASE_LAT, BASE_LON, BASE_LAT, BASE_LON)).toBe(0);
  });

  it("approximates a 0.001-degree latitude step as ~110 m", () => {
    const meters = approxDistanceMeters(BASE_LAT, BASE_LON, BASE_LAT + 0.001, BASE_LON);
    expect(meters).toBeGreaterThan(105);
    expect(meters).toBeLessThan(116);
  });

  it("is symmetric to within a metre", () => {
    const a = approxDistanceMeters(BASE_LAT, BASE_LON, 41.8, -87.62);
    const b = approxDistanceMeters(41.8, -87.62, BASE_LAT, BASE_LON);
    expect(Math.abs(a - b)).toBeLessThan(1);
  });
});

describe("nearestStation", () => {
  it("picks the closest station and reports a walk estimate", () => {
    const nearest = nearestStation(BASE_LAT, BASE_LON, STATIONS);
    expect(nearest?.name).toBe("79th");
    expect(nearest?.meters).toBeLessThan(120);
    expect(nearest?.walkMinutes).toBeGreaterThanOrEqual(1);
  });

  it("returns null when no stations are available", () => {
    expect(nearestStation(BASE_LAT, BASE_LON, [])).toBeNull();
  });

  it("skips stations with non-finite coordinates", () => {
    const broken = [{ name: "Broken", system: "CTA", lat: Number.NaN, lon: BASE_LON }];
    expect(nearestStation(BASE_LAT, BASE_LON, broken)).toBeNull();
  });
});

// ── Screens ──────────────────────────────────────────────────────────────────

describe("passesPropertyTypeScreen", () => {
  it("keeps a PIN-and-space building for existing-building", () => {
    expect(passesPropertyTypeScreen(site(), criteria())).toBe(true);
  });

  it("drops a building with no PIN for existing-building", () => {
    expect(passesPropertyTypeScreen(site({ pin: null }), criteria())).toBe(false);
  });

  it("drops a building with no space record for existing-building", () => {
    expect(passesPropertyTypeScreen(site({ space: undefined }), criteria())).toBe(false);
  });

  it("drops land for existing-building", () => {
    const land = site({ propertyType: "vacant_land" });
    expect(passesPropertyTypeScreen(land, criteria())).toBe(false);
  });

  it("keeps only land for vacant-land, PIN or not", () => {
    const request = criteria({ propertyType: "vacant-land" });
    expect(
      passesPropertyTypeScreen(site({ propertyType: "vacant_land", pin: null }), request),
    ).toBe(true);
    expect(passesPropertyTypeScreen(site(), request)).toBe(false);
  });

  it("keeps both for either, still requiring PIN + space on buildings", () => {
    const request = criteria({ propertyType: "either" });
    expect(passesPropertyTypeScreen(site(), request)).toBe(true);
    expect(passesPropertyTypeScreen(site({ propertyType: "vacant_land" }), request)).toBe(true);
    expect(passesPropertyTypeScreen(site({ pin: null }), request)).toBe(false);
  });
});

describe("screeningAreaSqft", () => {
  it("uses assessor building area for a building", () => {
    expect(screeningAreaSqft(site())).toBe(4000);
  });

  it("uses lot area for land", () => {
    expect(screeningAreaSqft(site({ propertyType: "vacant_land" }))).toBe(6000);
  });

  it("returns null for a missing or non-positive measurement", () => {
    expect(screeningAreaSqft(site({ space: {} }))).toBeNull();
    expect(screeningAreaSqft(site({ space: { assessorBuildingSqft: 0 } }))).toBeNull();
  });
});

describe("passesFootprintScreen", () => {
  it("passes everything when no bound is set", () => {
    expect(passesFootprintScreen(site({ space: {} }), criteria())).toBe(true);
  });

  it("honors a minimum", () => {
    const request = criteria({ minSquareFeet: 5000 });
    expect(passesFootprintScreen(site(), request)).toBe(false);
    expect(passesFootprintScreen(site({ space: { assessorBuildingSqft: 5000 } }), request)).toBe(true);
  });

  it("honors a maximum", () => {
    const request = criteria({ maxSquareFeet: 3000 });
    expect(passesFootprintScreen(site(), request)).toBe(false);
  });

  it("drops an unmeasured site once a bound is set — a card asserts a size", () => {
    const request = criteria({ minSquareFeet: 1000 });
    expect(passesFootprintScreen(site({ space: {} }), request)).toBe(false);
  });

  it("treats the band as inclusive at both ends", () => {
    const request = criteria({ minSquareFeet: 4000, maxSquareFeet: 4000 });
    expect(passesFootprintScreen(site(), request)).toBe(true);
  });
});

describe("railScreenFor", () => {
  it("runs no screen when neither rail mode is requested", () => {
    const request = criteria({
      transportation: ["cta-bus"],
      transportationDistance: "quarter-mile",
    });
    expect(railScreenFor(request, STATIONS)).toBeNull();
  });

  it("runs no screen for a flexible distance, even with rail selected", () => {
    const request = criteria({
      transportation: ["cta-rail"],
      transportationDistance: "flexible",
    });
    expect(railScreenFor(request, STATIONS)).toBeNull();
  });

  it("runs no screen when a distance was never chosen", () => {
    const request = criteria({ transportation: ["cta-rail"] });
    expect(railScreenFor(request, STATIONS)).toBeNull();
  });

  it("maps each distance option to its metre radius", () => {
    for (const [option, meters] of [
      ["quarter-mile", 400],
      ["half-mile", 800],
      ["one-mile", 1600],
    ] as const) {
      const request = criteria({
        transportation: ["cta-rail"],
        transportationDistance: option,
      });
      expect(railScreenFor(request, STATIONS)?.meters).toBe(meters);
    }
  });

  it("scopes the station subset to the requested systems", () => {
    const cta = railScreenFor(
      criteria({ transportation: ["cta-rail"], transportationDistance: "half-mile" }),
      STATIONS,
    );
    expect(cta?.stations.map((s) => s.name)).toEqual(["79th"]);

    const metra = railScreenFor(
      criteria({ transportation: ["metra"], transportationDistance: "half-mile" }),
      STATIONS,
    );
    expect(metra?.stations.map((s) => s.name)).toEqual(["83rd Street"]);

    const both = railScreenFor(
      criteria({
        transportation: ["cta-rail", "metra"],
        transportationDistance: "half-mile",
      }),
      STATIONS,
    );
    expect(both?.stations).toHaveLength(2);
  });
});

describe("onArterial", () => {
  it("matches a ported arterial token", () => {
    expect(onArterial("8000 S COTTAGE GROVE AVE")).toBe(true);
    expect(onArterial("1200 W 79TH ST")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(onArterial("1200 w 79th st")).toBe(true);
  });

  it("returns false off-arterial and for a null address", () => {
    expect(onArterial("4411 S CALUMET AVE")).toBe(false);
    expect(onArterial(null)).toBe(false);
  });

  it("carries the ported token list", () => {
    expect(ARTERIAL_TOKENS).toContain("COTTAGE GROVE");
    expect(ARTERIAL_TOKENS).toContain("STONY ISLAND");
    expect(ARTERIAL_TOKENS.length).toBeGreaterThan(30);
  });
});

describe("sweetSpotFor", () => {
  it("uses the middle 40-80% of a closed band", () => {
    const spot = sweetSpotFor(criteria({ minSquareFeet: 1000, maxSquareFeet: 11000 }));
    expect(spot).toEqual({ min: 5000, max: 9000 });
  });

  it("falls back to the reference default when the band is open", () => {
    expect(sweetSpotFor(criteria())).toEqual({
      min: DEFAULT_SWEET_SPOT_SQFT.min,
      max: DEFAULT_SWEET_SPOT_SQFT.max,
    });
    expect(sweetSpotFor(criteria({ minSquareFeet: 2000 }))).toEqual({
      min: DEFAULT_SWEET_SPOT_SQFT.min,
      max: DEFAULT_SWEET_SPOT_SQFT.max,
    });
  });
});

// ── Scoring ──────────────────────────────────────────────────────────────────

describe("screenShortlistSites scoring", () => {
  it("is deterministic — the same input scores identically every run", () => {
    const input = [site(), site({ address: "1200 W 79TH ST", pin: "20363230080001" })];
    const first = screenShortlistSites(input, criteria(), STATIONS);
    const second = screenShortlistSites(input, criteria(), STATIONS);
    expect(second.candidates.map((c) => [c.key, c.baseScore])).toEqual(
      first.candidates.map((c) => [c.key, c.baseScore]),
    );
  });

  it("awards the arterial bonus over the off-arterial floor", () => {
    const arterial = screenShortlistSites([site()], criteria(), STATIONS).candidates[0];
    const off = screenShortlistSites(
      [site({ address: "4411 S CALUMET AVE" })],
      criteria(),
      STATIONS,
    ).candidates[0];
    expect(arterial.onArterial).toBe(true);
    expect(off.onArterial).toBe(false);
    expect(arterial.baseScore - off.baseScore).toBeCloseTo(12, 5);
  });

  it("caps the incentive weight at 20 points (10 geographies x 2)", () => {
    const ten = screenShortlistSites([site({ incentiveCount: 10 })], criteria(), STATIONS)
      .candidates[0];
    const forty = screenShortlistSites([site({ incentiveCount: 40 })], criteria(), STATIONS)
      .candidates[0];
    expect(forty.baseScore).toBe(ten.baseScore);
  });

  it("decays the rail weight to zero beyond the 800 m horizon", () => {
    const far = screenShortlistSites(
      [site({ lat: BASE_LAT + 0.05 })],
      criteria(),
      [CTA_NEAR],
    ).candidates[0];
    const near = screenShortlistSites([site()], criteria(), [CTA_NEAR]).candidates[0];
    expect(near.baseScore - far.baseScore).toBeGreaterThan(25);
  });

  it("adds the sweet-spot bonus only inside the band", () => {
    const inside = screenShortlistSites([site()], criteria(), STATIONS).candidates[0];
    const outside = screenShortlistSites(
      [site({ space: { assessorBuildingSqft: 14000, lotAreaSqft: 6000 } })],
      criteria(),
      STATIONS,
    ).candidates[0];
    expect(inside.baseScore - outside.baseScore).toBeCloseTo(8, 5);
  });

  it("adds the distress-leverage bonus for a tax sale or a violation", () => {
    const clean = screenShortlistSites([site()], criteria(), STATIONS).candidates[0];
    const sale = screenShortlistSites([site({ saleYear: 2019 })], criteria(), STATIONS)
      .candidates[0];
    const violation = screenShortlistSites([site({ violation: true })], criteria(), STATIONS)
      .candidates[0];
    expect(sale.baseScore - clean.baseScore).toBeCloseTo(5, 5);
    expect(violation.baseScore - clean.baseScore).toBeCloseTo(5, 5);
    // Not additive — one distress signal, one bonus (ported behavior).
    const both = screenShortlistSites(
      [site({ saleYear: 2019, violation: true })],
      criteria(),
      STATIONS,
    ).candidates[0];
    expect(both.baseScore - clean.baseScore).toBeCloseTo(5, 5);
  });

  it("applies the rail screen only when one is configured", () => {
    const distant = site({ lat: BASE_LAT + 0.05, address: "9500 S COTTAGE GROVE AVE" });
    const unscreened = screenShortlistSites([distant], criteria(), STATIONS);
    expect(unscreened.candidates).toHaveLength(1);
    expect(unscreened.stats.railScreenMeters).toBeNull();

    const screened = screenShortlistSites(
      [distant],
      criteria({ transportation: ["cta-rail"], transportationDistance: "quarter-mile" }),
      STATIONS,
    );
    expect(screened.candidates).toHaveLength(0);
    expect(screened.stats.railScreenMeters).toBe(400);
  });

  it("does not screen on a bus-only transportation need", () => {
    const distant = site({ lat: BASE_LAT + 0.05 });
    const result = screenShortlistSites(
      [distant],
      criteria({ transportation: ["cta-bus"], transportationDistance: "quarter-mile" }),
      STATIONS,
    );
    expect(result.candidates).toHaveLength(1);
  });

  it("drops rows with no usable address or coordinate", () => {
    const result = screenShortlistSites(
      [site({ address: null }), site({ address: "   " }), site({ lat: Number.NaN })],
      criteria(),
      STATIONS,
    );
    expect(result.candidates).toHaveLength(0);
  });

  it("reports honest screen statistics", () => {
    const result = screenShortlistSites(
      [site(), site({ propertyType: "vacant_land" }), site({ space: { assessorBuildingSqft: 100 } })],
      criteria({ minSquareFeet: 1000 }),
      STATIONS,
    );
    expect(result.stats.loadedCount).toBe(3);
    expect(result.stats.propertyTypeKeptCount).toBe(2);
    expect(result.stats.footprintKeptCount).toBe(1);
    expect(result.stats.candidateCount).toBe(1);
  });

  it("orders candidates by score, breaking ties on address", () => {
    const result = screenShortlistSites(
      [
        site({ address: "9000 S ASHLAND AVE", pin: "1", incentiveCount: 0 }),
        site({ address: "1000 S ASHLAND AVE", pin: "2", incentiveCount: 0 }),
        site({ address: "5000 S ASHLAND AVE", pin: "3", incentiveCount: 9 }),
      ],
      criteria(),
      STATIONS,
    );
    expect(result.candidates.map((c) => c.address)).toEqual([
      "5000 S ASHLAND AVE",
      "1000 S ASHLAND AVE",
      "9000 S ASHLAND AVE",
    ]);
  });
});

// ── Tiering: the by-right matrix ─────────────────────────────────────────────

describe("zoningStatusFor", () => {
  const commercialUses: SiteProjectUse[] = [
    "retail-service",
    "food-hospitality",
    "office-professional",
    "community-facility",
    "other-commercial",
  ];

  it("reads B* and C* as by right for the commercial-family uses", () => {
    for (const use of commercialUses) {
      expect(zoningStatusFor(use, "B3-2")).toBe("by-right");
      expect(zoningStatusFor(use, "C1-1")).toBe("by-right");
      expect(zoningStatusFor(use, "RS-3")).toBe("relief-likely");
      expect(zoningStatusFor(use, "M1-2")).toBe("relief-likely");
      expect(zoningStatusFor(use, "DX-5")).toBe("relief-likely");
    }
  });

  it("reads M* and C3* as by right for production and logistics", () => {
    for (const use of ["production-manufacturing", "distribution-logistics"] as const) {
      expect(zoningStatusFor(use, "M1-1")).toBe("by-right");
      expect(zoningStatusFor(use, "M2-3")).toBe("by-right");
      expect(zoningStatusFor(use, "C3-2")).toBe("by-right");
      expect(zoningStatusFor(use, "C1-2")).toBe("relief-likely");
      expect(zoningStatusFor(use, "B3-2")).toBe("relief-likely");
      expect(zoningStatusFor(use, "RS-3")).toBe("relief-likely");
    }
  });

  it("reads R*, D*, and B* at intensity >= 2 as by right for housing/mixed use", () => {
    expect(zoningStatusFor("housing-mixed-use", "RS-3")).toBe("by-right");
    expect(zoningStatusFor("housing-mixed-use", "RM-5")).toBe("by-right");
    expect(zoningStatusFor("housing-mixed-use", "DX-5")).toBe("by-right");
    expect(zoningStatusFor("housing-mixed-use", "B3-2")).toBe("by-right");
    expect(zoningStatusFor("housing-mixed-use", "B1-1")).toBe("relief-likely");
    expect(zoningStatusFor("housing-mixed-use", "B3")).toBe("relief-likely");
    expect(zoningStatusFor("housing-mixed-use", "C1-2")).toBe("relief-likely");
    expect(zoningStatusFor("housing-mixed-use", "M1-1")).toBe("relief-likely");
  });

  it("never places a PMD in Tier 1, for any use", () => {
    for (const use of [...commercialUses, "production-manufacturing", "housing-mixed-use"] as const) {
      expect(zoningStatusFor(use, "PMD 11")).toBe("relief-likely");
      expect(zoningStatusFor(use, "PMD-11")).toBe("relief-likely");
    }
  });

  it("returns unverified for a missing or blank district code", () => {
    expect(zoningStatusFor("retail-service", null)).toBe("unverified");
    expect(zoningStatusFor("retail-service", "   ")).toBe("unverified");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(zoningStatusFor("retail-service", " b3-2 ")).toBe("by-right");
  });

  it("declines to claim by right when the project use is unknown", () => {
    expect(zoningStatusFor(null, "B3-2")).toBe("relief-likely");
  });
});

describe("zoning copy", () => {
  it("names the Zoning Board of Appeals, never DPD", () => {
    const notes = [
      ZONING_SCREENING_NOTE,
      zoningStatusNote("by-right", "B3-2"),
      zoningStatusNote("relief-likely", "RS-3"),
      zoningStatusNote("unverified", null),
    ];
    for (const note of notes) {
      expect(note).toMatch(/Zoning Board of Appeals|Zoning Administrator/);
      expect(note).not.toMatch(/Planning and Development/i);
    }
  });

  it("frames Tier 2 as a Special Use approval with a time cost", () => {
    const note = zoningStatusNote("relief-likely", "RS-3");
    expect(note).toContain("Special Use approval from the Zoning Board of Appeals");
    expect(note).toContain("3 to 5 extra months");
  });

  it("never claims certainty on a by-right read", () => {
    expect(zoningStatusNote("by-right", "B3-2")).toContain("Screening signal only");
  });
});

describe("card flag copy routes to the owning authority", () => {
  it("routes vacant-building violations to the Department of Buildings", () => {
    expect(VIOLATION_FLAG).toContain("Department of Buildings");
    expect(VIOLATION_FLAG).not.toMatch(/Zoning Board|BACP/);
    expect(CONDITION_VERIFICATION_NOTE).toContain("Department of Buildings");
  });

  it("routes business licensing to BACP and never asserts occupancy", () => {
    const flag = activeLicenseFlag("Chatham Cafe");
    expect(flag).toContain("BACP");
    expect(flag).toContain("may be occupied");
    expect(flag).toContain("confirm before outreach");
    expect(flag).not.toMatch(/is occupied/);
  });

  it("frames a tax sale as leverage, not a listing", () => {
    const flag = taxSaleFlag(2019);
    expect(flag).toContain("2019");
    expect(flag).toContain("possible acquisition leverage");
    expect(flag).not.toMatch(/available|for sale/i);
  });
});

// ── Assembly, tiers, caps ────────────────────────────────────────────────────

function screened(overrides: Partial<ScreenedSite> = {}): ScreenedSite {
  return {
    key: overrides.key ?? "k",
    address: "8000 S COTTAGE GROVE AVE",
    pin: "20363230080000",
    lat: BASE_LAT,
    lon: BASE_LON,
    propertyType: "vacant_building",
    buildingSqft: 4000,
    lotSqft: 6000,
    zoning: "B3-2",
    ownerLabel: ownerAxesLabel("corporate_llc", "out_of_state"),
    incentiveCount: 3,
    saleYear: null,
    violation: false,
    nearestRail: { name: "79th", system: "CTA", meters: 300, walkMinutes: 4 },
    onArterial: true,
    baseScore: 50,
    ...overrides,
  };
}

describe("assembleShortlist", () => {
  it("scores non-TIF overlay hits at 10 points each and ignores TIF", () => {
    const [withTif] = assembleShortlist(
      [{ site: screened(), overlays: [{ layer: "TIF", name: "79th/Cottage Grove" }] }],
      criteria(),
    ).tier1;
    const [withSsa] = assembleShortlist(
      [{ site: screened(), overlays: [{ layer: "SSA", name: "Greater Chatham" }] }],
      criteria(),
    ).tier1;
    expect(withTif.score).toBe(50);
    expect(withSsa.score).toBe(60);
  });

  it("splits tiers on the by-right matrix", () => {
    const result = assembleShortlist(
      [
        { site: screened({ key: "a", zoning: "B3-2" }), overlays: [] },
        { site: screened({ key: "b", zoning: "RS-3" }), overlays: [] },
        { site: screened({ key: "c", zoning: null }), overlays: [] },
      ],
      criteria(),
    );
    expect(result.tier1.map((c) => c.key)).toEqual(["a"]);
    expect(result.tier2.map((c) => c.key).sort()).toEqual(["b", "c"]);
    expect(result.tier2.find((c) => c.key === "c")?.zoningStatus).toBe("unverified");
  });

  it("caps Tier 1 at 12 and Tier 2 at 8 while reporting the true totals", () => {
    const entries = [
      ...Array.from({ length: 20 }, (_, i) => ({
        site: screened({ key: `t1-${i}`, zoning: "B3-2", baseScore: 100 - i }),
        overlays: [],
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        site: screened({ key: `t2-${i}`, zoning: "RS-3", baseScore: 100 - i }),
        overlays: [],
      })),
    ];
    const result = assembleShortlist(entries, criteria());
    expect(result.tier1).toHaveLength(TIER_1_CAP);
    expect(result.tier2).toHaveLength(TIER_2_CAP);
    expect(result.tier1Total).toBe(20);
    expect(result.tier2Total).toBe(15);
  });

  it("keeps the highest scores when capping", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      site: screened({ key: `k-${i}`, zoning: "B3-2", baseScore: i }),
      overlays: [],
    }));
    const result = assembleShortlist(entries, criteria());
    expect(result.tier1[0].key).toBe("k-19");
    expect(result.tier1).toHaveLength(TIER_1_CAP);
    expect(result.tier1.every((c) => c.score >= 8)).toBe(true);
  });

  it("is deterministic, ordering by score then address", () => {
    const entries = [
      { site: screened({ key: "b", address: "9000 S ASHLAND AVE", baseScore: 40 }), overlays: [] },
      { site: screened({ key: "a", address: "1000 S ASHLAND AVE", baseScore: 40 }), overlays: [] },
    ];
    expect(assembleShortlist(entries, criteria()).tier1.map((c) => c.key)).toEqual(["a", "b"]);
  });

  it("flags the accessibility note only for a community-facility project", () => {
    const entries = [{ site: screened(), overlays: [] }];
    expect(assembleShortlist(entries, criteria()).tier1[0].showAccessibility).toBe(true);
    expect(
      assembleShortlist(entries, criteria({ projectUse: "retail-service" })).tier1[0]
        .showAccessibility,
    ).toBe(false);
  });

  it("keeps the overlay enrichment limit above the combined caps", () => {
    expect(OVERLAY_ENRICH_LIMIT).toBeGreaterThan(TIER_1_CAP + TIER_2_CAP);
  });
});

// ── County class + implied value ─────────────────────────────────────────────

describe("impliedMarketValue", () => {
  it("grosses up commercial 5xx at the 25% assessment level (x4)", () => {
    expect(impliedMarketValue("517", 50_000)).toBe(200_000);
    expect(impliedMarketValue("522", 12_345)).toBe(49_380);
  });

  it("grosses up residential and mixed-use 2xx/3xx at 10% (x10)", () => {
    expect(impliedMarketValue("212", 20_000)).toBe(200_000);
    expect(impliedMarketValue("314", 7_500)).toBe(75_000);
  });

  it("returns null for exempt owners and county vacant-land class 100", () => {
    expect(impliedMarketValue("EX", 90_000)).toBeNull();
    expect(impliedMarketValue("100", 4_000)).toBeNull();
  });

  it("returns null when the class or value is missing or non-positive", () => {
    expect(impliedMarketValue(null, 50_000)).toBeNull();
    expect(impliedMarketValue("517", null)).toBeNull();
    expect(impliedMarketValue("517", 0)).toBeNull();
    expect(impliedMarketValue("517", Number.NaN)).toBeNull();
  });

  it("returns null for a class family it cannot convert", () => {
    expect(impliedMarketValue("900", 50_000)).toBeNull();
  });
});

describe("countyClassGloss", () => {
  it("glosses the classes this workflow meets", () => {
    expect(countyClassGloss("517")).toBe("One-story commercial building");
    expect(countyClassGloss("212")).toBe(
      "Mixed-use storefront with apartments (6 units or fewer)",
    );
  });

  it("falls back to a literal class label, never a guess", () => {
    expect(countyClassGloss("790")).toBe("County class 790");
  });

  it("returns null with no class", () => {
    expect(countyClassGloss(null)).toBeNull();
  });
});

describe("accessibilityNoteFor", () => {
  it("calls single-story commercial classes the strongest at-grade layout", () => {
    for (const cls of ["517", "522", "511"]) {
      expect(accessibilityNoteFor(cls)?.level).toBe("at-grade");
    }
  });

  it("calls 212 ground-floor usable", () => {
    expect(accessibilityNoteFor("212")?.level).toBe("ground-floor");
  });

  it("warns about stairs on 3xx walk-ups", () => {
    expect(accessibilityNoteFor("314")?.level).toBe("stairs");
    expect(accessibilityNoteFor("313")?.text).toContain("stairs");
  });

  it("asks for verification on anything else, and returns null with no class", () => {
    expect(accessibilityNoteFor("EX")?.level).toBe("verify");
    expect(accessibilityNoteFor(null)).toBeNull();
  });
});

describe("ownerAxesLabel", () => {
  it("reports ownership as unverified, never as privately held", () => {
    const label = ownerAxesLabel("corporate_llc", "out_of_state");
    expect(label).toBe("Corporate / LLC · out-of-state mailing address (unverified)");
    expect(label).not.toMatch(/privately held/i);
  });

  it("humanizes an unmapped axis value rather than dropping it", () => {
    expect(ownerAxesLabel("some_new_axis", "elsewhere")).toBe(
      "Some new axis · elsewhere (unverified)",
    );
  });
});

// ── CSV ──────────────────────────────────────────────────────────────────────

describe("shortlistCsv", () => {
  const result = assembleShortlist(
    [
      {
        site: screened({ key: "a", zoning: "B3-2", saleYear: 2019 }),
        overlays: [{ layer: "SSA", name: "Greater Chatham" }],
      },
      { site: screened({ key: "b", zoning: "RS-3", address: "4411 S CALUMET AVE" }), overlays: [] },
    ],
    criteria(),
  );

  it("emits a header plus one row per rendered card", () => {
    const lines = shortlistCsv(result).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Assessor-implied market value");
    expect(lines[1]).toContain("1 - reads as by right");
    expect(lines[2]).toContain("2 - zoning relief likely");
  });

  it("numbers Tier 2 continuing from Tier 1", () => {
    const rows = shortlistCsv(result).split("\n").slice(1);
    expect(rows[0].split(",")[1]).toBe("1");
    expect(rows[1].split(",")[1]).toBe("2");
  });

  it("folds enrichment facts in when present", () => {
    const csv = shortlistCsv(result, {
      a: {
        countyClass: "517",
        classGloss: "One-story commercial building",
        assessedValue: 50_000,
        assessedYear: "2024",
        impliedMarketValue: 200_000,
        activeLicenses: [{ name: "Chatham Cafe", description: "Retail Food" }],
      },
    });
    expect(csv).toContain("200000");
    expect(csv).toContain("Chatham Cafe");
  });

  it("quotes cells containing commas or quotes", () => {
    const csv = shortlistCsv(result, {
      a: {
        countyClass: "212",
        classGloss: "Mixed-use storefront with apartments (6 units or fewer)",
        assessedValue: null,
        assessedYear: null,
        impliedMarketValue: null,
        activeLicenses: [{ name: 'The "Corner" Shop, Inc', description: "" }],
      },
    });
    expect(csv).toContain('"The ""Corner"" Shop, Inc"');
  });

  it("names the file per ZIP", () => {
    expect(shortlistCsvFilename("60619")).toBe("Site-Shortlist-60619.csv");
  });
});

// ── Incentive-snapshot link ─────────────────────────────────────────────────

describe("shortlistSnapshotHref", () => {
  it("builds an instant-mode /report link with the record's coordinates", () => {
    expect(
      shortlistSnapshotHref({ lat: 41.75, lon: -87.605, address: "8000 S COTTAGE GROVE AVE" }),
    ).toBe(
      "/report?instant=true&lat=41.75000&lon=-87.60500&addr=8000+S+COTTAGE+GROVE+AVE&src=site_shortlist",
    );
  });

  it("uses `addr`, the parameter /report actually reads — never `address`", () => {
    // app/report/page.tsx reads searchParams.get("addr"). An `address` param
    // would leave the wizard with an empty address and no error to notice.
    const href = shortlistSnapshotHref({ lat: 41.7, lon: -87.6, address: "1 N State St" });
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("addr")).toBe("1 N State St");
    expect(params.has("address")).toBe(false);
  });

  it("encodes addresses containing separators", () => {
    const href = shortlistSnapshotHref({
      lat: 41.7,
      lon: -87.6,
      address: "100 W 63rd St, Chicago, IL & Co",
    });
    expect(href).not.toMatch(/\s/);
    expect(new URLSearchParams(href.split("?")[1]).get("addr")).toBe(
      "100 W 63rd St, Chicago, IL & Co",
    );
  });

  it("fixes coordinates to five decimals so the URL stays cache-bucketable", () => {
    const params = new URLSearchParams(
      shortlistSnapshotHref({ lat: 41.7368312345, lon: -87.5777612345, address: "x" }).split("?")[1],
    );
    expect(params.get("lat")).toBe("41.73683");
    expect(params.get("lon")).toBe("-87.57776");
  });

  it("stamps the registered attribution source", () => {
    expect(SHORTLIST_SNAPSHOT_SOURCE).toBe("site_shortlist");
    expect(shortlistSnapshotHref({ lat: 41.7, lon: -87.6, address: "x" })).toContain(
      "src=site_shortlist",
    );
  });

  it("is registered in /report's source allowlist, so attribution is not silently dropped", () => {
    // cleanReportSource() collapses any unlisted src into the generic
    // instant_report bucket. This guard is the only thing that would catch the
    // allowlist and the constant drifting apart.
    const source = readFileSync(path.join(process.cwd(), "app/report/page.tsx"), "utf8");
    const allowlist = source.slice(
      source.indexOf("const ALLOWED_REPORT_SOURCES"),
      source.indexOf("function cleanReportSource"),
    );
    expect(allowlist).toContain(`"${SHORTLIST_SNAPSHOT_SOURCE}"`);
  });
});
