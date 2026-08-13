import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RANKING_MODEL_VERSION,
  SHORTLIST_TOP_N,
  ZONING_BADGE_LABELS,
  ZONING_SCREENING_NOTE,
  baselineScoreFor,
  matchesPropertyTypeEvidence,
  passesFootprintScreen,
  passesTransitScreen,
  runShortlistEngine,
  screeningAreaSqft,
  selectedTransitNetwork,
  transitScoreFor,
  transitScreenMeters,
  zoningBadgeFor,
  zoningBadgeNote,
} from "../shortlist-engine";
import { RANKING_INPUTS_VERSION } from "../shortlist-universe-schema";
import type { ShortlistUniverseRow } from "../shortlist-universe-schema";
import { createEmptySiteMatchCriteria, type SiteMatchCriteria, type SiteProjectUse } from "../site-matchmaker";
import type { ShortlistStation } from "../site-shortlist";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_LAT = 41.75;
const BASE_LON = -87.605;

function row(overrides: Partial<ShortlistUniverseRow> = {}): ShortlistUniverseRow {
  return {
    canonicalKey: "pin:20363230080000",
    pin: "20363230080000",
    address: "8000 S COTTAGE GROVE AVE",
    lat: BASE_LAT,
    lon: BASE_LON,
    evidenceTypes: ["city_land"],
    hasVacantLandEvidence: false,
    hasVacantBuildingEvidence: true,
    conflictingPropertyTypes: false,
    propertyType: "vacant_building",
    buildingSqft: 4000,
    buildingSqftSource: "city_land",
    lotSqft: 6000,
    lotSqftSource: "city_land",
    ownerStructure: "corporate_llc",
    ownerGeography: "out_of_state",
    ownerConfidence: "pin_matched",
    saleYear: null,
    violation: false,
    zoning: { status: "resolved", district: "B3-2", zoneType: 1, pdNum: null, pmdSubArea: null },
    overlays: { ssa: false, ccsa: false, tif: false, nof: false },
    incentiveCount: 3,
    ...overrides,
  };
}

function criteria(overrides: Partial<SiteMatchCriteria> = {}): SiteMatchCriteria {
  return {
    ...createEmptySiteMatchCriteria(),
    zip: "60619",
    projectUse: "community-facility",
    propertyType: "existing-building",
    ...overrides,
  };
}

const CTA_NEAR: ShortlistStation = { name: "79th", system: "CTA", lat: BASE_LAT + 0.001, lon: BASE_LON };
const CTA_FAR: ShortlistStation = { name: "95th", system: "CTA", lat: BASE_LAT + 0.05, lon: BASE_LON };
// Far from BOTH CTA stations (west, not north), so a row placed here is
// genuinely near Metra only — never accidentally also near a CTA station.
const METRA_NEAR: ShortlistStation = {
  name: "83rd Street",
  system: "Metra Electric",
  lat: BASE_LAT,
  lon: BASE_LON - 0.05,
};
const STATIONS = [CTA_NEAR, CTA_FAR, METRA_NEAR];

// ── Screens ──────────────────────────────────────────────────────────────────

describe("matchesPropertyTypeEvidence", () => {
  it("matches building evidence for existing-building, regardless of resolved propertyType", () => {
    expect(matchesPropertyTypeEvidence(row({ hasVacantBuildingEvidence: true }), "existing-building")).toBe(true);
    expect(matchesPropertyTypeEvidence(row({ hasVacantBuildingEvidence: false }), "existing-building")).toBe(false);
  });

  it("matches land evidence for vacant-land", () => {
    expect(
      matchesPropertyTypeEvidence(
        row({ hasVacantLandEvidence: true, hasVacantBuildingEvidence: false, propertyType: "vacant_land" }),
        "vacant-land",
      ),
    ).toBe(true);
    expect(matchesPropertyTypeEvidence(row({ hasVacantLandEvidence: false }), "vacant-land")).toBe(false);
  });

  it("matches either evidence type for 'either'", () => {
    expect(
      matchesPropertyTypeEvidence(row({ hasVacantBuildingEvidence: true, hasVacantLandEvidence: false }), "either"),
    ).toBe(true);
    expect(
      matchesPropertyTypeEvidence(row({ hasVacantBuildingEvidence: false, hasVacantLandEvidence: true }), "either"),
    ).toBe(true);
    expect(
      matchesPropertyTypeEvidence(row({ hasVacantBuildingEvidence: false, hasVacantLandEvidence: false }), "either"),
    ).toBe(false);
  });

  it("keeps a site carrying BOTH evidence types for a building search, via the evidence field — never the single resolved propertyType string", () => {
    // Land-resolved but still carries building evidence: must still count.
    const conflicted = row({
      propertyType: "vacant_land",
      hasVacantBuildingEvidence: true,
      hasVacantLandEvidence: true,
      conflictingPropertyTypes: true,
    });
    expect(matchesPropertyTypeEvidence(conflicted, "existing-building")).toBe(true);
  });
});

describe("screeningAreaSqft", () => {
  it("reads buildingSqft for a resolved building, lotSqft for resolved land", () => {
    expect(screeningAreaSqft(row())).toBe(4000);
    expect(screeningAreaSqft(row({ propertyType: "vacant_land", lotSqft: 6000 }))).toBe(6000);
  });

  it("returns null for a missing or non-positive measurement", () => {
    expect(screeningAreaSqft(row({ buildingSqft: null }))).toBeNull();
    expect(screeningAreaSqft(row({ buildingSqft: 0 }))).toBeNull();
  });
});

describe("passesFootprintScreen — the band screen, and ONLY the band screen", () => {
  it("passes everything, including unmeasured rows, when no band is set", () => {
    expect(passesFootprintScreen(row({ buildingSqft: null }), criteria())).toBe(true);
  });

  it("excludes an unmeasured row once a band IS set — a card asserts a size", () => {
    expect(passesFootprintScreen(row({ buildingSqft: null }), criteria({ minSquareFeet: 1000 }))).toBe(false);
  });

  it("honors a minimum and a maximum, inclusive at both ends", () => {
    expect(passesFootprintScreen(row({ buildingSqft: 5000 }), criteria({ minSquareFeet: 5000 }))).toBe(true);
    expect(passesFootprintScreen(row({ buildingSqft: 4999 }), criteria({ minSquareFeet: 5000 }))).toBe(false);
    expect(passesFootprintScreen(row({ buildingSqft: 4000 }), criteria({ maxSquareFeet: 3000 }))).toBe(false);
  });
});

describe("selectedTransitNetwork / transitScreenMeters", () => {
  it("is null when neither CTA rail nor Metra was selected", () => {
    expect(selectedTransitNetwork(criteria({ transportation: ["cta-bus"] }), STATIONS)).toBeNull();
    expect(selectedTransitNetwork(criteria({ transportation: [] }), STATIONS)).toBeNull();
  });

  it("scopes the station subset to ONLY the selected network(s)", () => {
    const cta = selectedTransitNetwork(criteria({ transportation: ["cta-rail"] }), STATIONS);
    expect(cta?.stations.map((s) => s.name).sort()).toEqual(["79th", "95th"]);

    const metra = selectedTransitNetwork(criteria({ transportation: ["metra"] }), STATIONS);
    expect(metra?.stations.map((s) => s.name)).toEqual(["83rd Street"]);

    const both = selectedTransitNetwork(criteria({ transportation: ["cta-rail", "metra"] }), STATIONS);
    expect(both?.stations).toHaveLength(3);
  });

  it("maps each distance option to its metre radius, null for flexible or unset", () => {
    expect(transitScreenMeters(criteria({ transportationDistance: "quarter-mile" }))).toBe(400);
    expect(transitScreenMeters(criteria({ transportationDistance: "half-mile" }))).toBe(800);
    expect(transitScreenMeters(criteria({ transportationDistance: "one-mile" }))).toBe(1600);
    expect(transitScreenMeters(criteria({ transportationDistance: "flexible" }))).toBeNull();
    expect(transitScreenMeters(criteria())).toBeNull();
  });
});

describe("passesTransitScreen", () => {
  it("passes a row inside the radius and fails one outside it", () => {
    const network = selectedTransitNetwork(criteria({ transportation: ["cta-rail"] }), [CTA_NEAR])!;
    expect(passesTransitScreen(row({ lat: BASE_LAT, lon: BASE_LON }), network, 400)).toBe(true);
    expect(passesTransitScreen(row({ lat: BASE_LAT + 0.05, lon: BASE_LON }), network, 50)).toBe(false);
  });

  it("fails a row with no usable coordinate", () => {
    const network = selectedTransitNetwork(criteria({ transportation: ["cta-rail"] }), STATIONS)!;
    expect(passesTransitScreen(row({ lat: null, lon: null }), network, 1600)).toBe(false);
  });
});

// ── Scoring ──────────────────────────────────────────────────────────────────

describe("transitScoreFor — the ONE v1 score component", () => {
  it("is null (zero effect) when no transit network was selected", () => {
    expect(transitScoreFor(row(), null)).toBeNull();
  });

  it("scores only against the selected network's stations, never the nearest station on any system", () => {
    // Row sits right next to the CTA station. Selecting ONLY Metra must score
    // against the (much farther) Metra station, not the near CTA one.
    const metraOnly = selectedTransitNetwork(criteria({ transportation: ["metra"] }), STATIONS);
    const fact = transitScoreFor(row({ lat: BASE_LAT, lon: BASE_LON }), metraOnly);
    expect(fact?.stationSystem).toBe("Metra Electric");
    expect(fact?.networks).toEqual(["metra"]);
  });

  it("awards more points the closer the candidate sits to the selected network", () => {
    const network = selectedTransitNetwork(criteria({ transportation: ["cta-rail"] }), [CTA_NEAR]);
    const near = transitScoreFor(row({ lat: BASE_LAT, lon: BASE_LON }), network);
    const far = transitScoreFor(row({ lat: BASE_LAT + 0.05, lon: BASE_LON }), network);
    expect(near!.points).toBeGreaterThan(far!.points);
  });
});

describe("baselineScoreFor — deterministic and criteria-independent", () => {
  it("gives more area-fit credit the closer a measured area sits to the band midpoint", () => {
    const request = criteria({ minSquareFeet: 2000, maxSquareFeet: 6000 });
    const midpointish = baselineScoreFor(row({ buildingSqft: 4400 }), request);
    const farOff = baselineScoreFor(row({ buildingSqft: 100000 }), request);
    expect(midpointish.areaFitPoints).toBeGreaterThan(farOff.areaFitPoints);
  });

  it("gives zero area-fit credit to an unmeasured row — no credit for what is not known", () => {
    expect(baselineScoreFor(row({ buildingSqft: null }), criteria()).areaFitPoints).toBe(0);
  });

  it("rewards completeness: PIN, measurement, resolved zoning, pin-matched owner confidence", () => {
    const bare = baselineScoreFor(
      row({ pin: null, buildingSqft: null, zoning: { status: "unresolved", district: null, zoneType: null, pdNum: null, pmdSubArea: null }, ownerConfidence: "needs_verification" }),
      criteria(),
    );
    const complete = baselineScoreFor(row(), criteria());
    expect(complete.completenessPoints).toBeGreaterThan(bare.completenessPoints);
  });

  it("does NOT depend on which scoring criteria (transit) were selected — only on the row and the size band", () => {
    const withoutTransit = baselineScoreFor(row(), criteria({ transportation: [] }));
    const withTransit = baselineScoreFor(row(), criteria({ transportation: ["cta-rail"], transportationDistance: "quarter-mile" }));
    expect(withoutTransit).toEqual(withTransit);
  });
});

// ── Zoning badge ─────────────────────────────────────────────────────────────

describe("zoningBadgeFor", () => {
  const commercialUses: SiteProjectUse[] = [
    "retail-service",
    "food-hospitality",
    "office-professional",
    "community-facility",
    "other-commercial",
  ];

  it("reads B* and C* as aligned for the commercial-family uses", () => {
    for (const use of commercialUses) {
      expect(zoningBadgeFor(use, { status: "resolved", district: "B3-2" })).toBe("aligned");
      expect(zoningBadgeFor(use, { status: "resolved", district: "C1-1" })).toBe("aligned");
      expect(zoningBadgeFor(use, { status: "resolved", district: "RS-3" })).toBe("not-aligned");
      expect(zoningBadgeFor(use, { status: "resolved", district: "M1-2" })).toBe("not-aligned");
    }
  });

  it("reads M* and C3* as aligned for production and logistics", () => {
    for (const use of ["production-manufacturing", "distribution-logistics"] as const) {
      expect(zoningBadgeFor(use, { status: "resolved", district: "M1-1" })).toBe("aligned");
      expect(zoningBadgeFor(use, { status: "resolved", district: "C3-2" })).toBe("aligned");
      expect(zoningBadgeFor(use, { status: "resolved", district: "B3-2" })).toBe("not-aligned");
    }
  });

  it("reads R*, D*, and B* at intensity >= 2 as aligned for housing/mixed use", () => {
    expect(zoningBadgeFor("housing-mixed-use", { status: "resolved", district: "RS-3" })).toBe("aligned");
    expect(zoningBadgeFor("housing-mixed-use", { status: "resolved", district: "DX-5" })).toBe("aligned");
    expect(zoningBadgeFor("housing-mixed-use", { status: "resolved", district: "B3-2" })).toBe("aligned");
    expect(zoningBadgeFor("housing-mixed-use", { status: "resolved", district: "B1-1" })).toBe("not-aligned");
    expect(zoningBadgeFor("housing-mixed-use", { status: "resolved", district: "M1-1" })).toBe("not-aligned");
  });

  it("gives a bare 'PD' its own badge, distinct from 'not-aligned'", () => {
    for (const use of [...commercialUses, "housing-mixed-use"] as const) {
      expect(zoningBadgeFor(use, { status: "resolved", district: "PD 123" })).toBe("planned-development");
    }
  });

  it("never gives PMD the planned-development badge, and never reads it as aligned for any use", () => {
    for (const use of [...commercialUses, "production-manufacturing", "housing-mixed-use"] as const) {
      expect(zoningBadgeFor(use, { status: "resolved", district: "PMD 11" })).toBe("not-aligned");
      expect(zoningBadgeFor(use, { status: "resolved", district: "PMD-11" })).toBe("not-aligned");
    }
  });

  it("returns unresolved for an unresolved/ambiguous status or a blank district, never a family read", () => {
    expect(zoningBadgeFor("retail-service", { status: "unresolved", district: null })).toBe("unresolved");
    expect(zoningBadgeFor("retail-service", { status: "ambiguous", district: null })).toBe("unresolved");
    expect(zoningBadgeFor("retail-service", { status: "resolved", district: "   " })).toBe("unresolved");
  });

  it("declines to claim alignment when the project use is unknown", () => {
    expect(zoningBadgeFor(null, { status: "resolved", district: "B3-2" })).toBe("not-aligned");
  });
});

describe("zoning badge copy", () => {
  it("matches the spec's verbatim page-level screen note", () => {
    expect(ZONING_SCREENING_NOTE).toBe(
      "Broad district-family screen. Based only on the mapped zoning district and broad project category. This tool has not evaluated the ordinance use table, use-specific standards, overlays, the controlling Planned Development ordinance, existing approvals or legal nonconforming rights, or pending changes. It does not determine whether the proposed use is permitted or which approval path applies.",
    );
  });

  it("never predicts Special Use, a timeline, or blanket ZBA routing", () => {
    for (const badge of ["aligned", "not-aligned", "planned-development", "unresolved"] as const) {
      const note = zoningBadgeNote(badge);
      expect(note).not.toMatch(/special use/i);
      expect(note).not.toMatch(/3 to 5|3-5/);
      expect(note).not.toMatch(/zoning board of appeals|zba/i);
    }
  });

  it("matches the spec's verbatim card copy per badge", () => {
    expect(zoningBadgeNote("aligned")).toBe(
      "The mapped district family is broadly aligned with this project category. Verify the exact use and all applicable standards before relying on this screen.",
    );
    expect(zoningBadgeNote("not-aligned")).toBe(
      "The mapped district family is not broadly aligned with this project category. The required approval path has not been determined.",
    );
    expect(zoningBadgeNote("planned-development")).toBe(
      "Site-specific Planned Development. Review the controlling PD ordinance and applicable site-plan requirements.",
    );
    expect(zoningBadgeNote("unresolved")).toBe("District unresolved; no zoning screen was performed.");
  });

  it("carries the four badge labels the spec names for the client-side filter", () => {
    expect(ZONING_BADGE_LABELS).toEqual({
      aligned: "Broad family alignment",
      "not-aligned": "No broad family alignment",
      "planned-development": "Site-specific district (PD)",
      unresolved: "District unresolved",
    });
  });
});

// ── Engine integration ───────────────────────────────────────────────────────

describe("runShortlistEngine", () => {
  it("is deterministic — identical input yields identical output, in order", () => {
    const rows = [
      row({ canonicalKey: "a", pin: "1", address: "9000 S ASHLAND AVE" }),
      row({ canonicalKey: "b", pin: "2", address: "1000 S ASHLAND AVE" }),
    ];
    const inputs = { rows, criteria: criteria(), stations: STATIONS };
    const first = runShortlistEngine(inputs);
    const second = runShortlistEngine(inputs);
    expect(second.ranked.map((c) => [c.key, c.score])).toEqual(first.ranked.map((c) => [c.key, c.score]));
  });

  it("orders by score descending, tiebreaking on canonicalKey ascending — never address", () => {
    const rows = [
      row({ canonicalKey: "zzz-key", pin: "1", address: "1000 S ASHLAND AVE", buildingSqft: 4000 }),
      row({ canonicalKey: "aaa-key", pin: "2", address: "9000 S ASHLAND AVE", buildingSqft: 4000 }),
    ];
    // Identical baseline inputs -> identical score -> tiebreak must be by key.
    const { ranked } = runShortlistEngine({ rows, criteria: criteria(), stations: [] });
    expect(ranked.map((c) => c.key)).toEqual(["aaa-key", "zzz-key"]);
  });

  it("excludes a row with no evidence for the selected property type", () => {
    const rows = [row({ canonicalKey: "land-only", hasVacantBuildingEvidence: false, hasVacantLandEvidence: true, propertyType: "vacant_land" })];
    const { ranked } = runShortlistEngine({ rows, criteria: criteria({ propertyType: "existing-building" }), stations: [] });
    expect(ranked).toHaveLength(0);
  });

  it("keeps a building row with no PIN and no measurement when no band is set — the actual false-zero fix", () => {
    const rows = [row({ canonicalKey: "thin", pin: null, buildingSqft: null, lotSqft: null })];
    const { ranked } = runShortlistEngine({ rows, criteria: criteria(), stations: [] });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].pin).toBeNull();
  });

  it("excludes an unmeasured row once a size band is set", () => {
    const rows = [row({ canonicalKey: "thin", buildingSqft: null })];
    const { ranked } = runShortlistEngine({
      rows,
      criteria: criteria({ minSquareFeet: 1000 }),
      stations: [],
    });
    expect(ranked).toHaveLength(0);
  });

  it("screens against the selected transit network's distance only", () => {
    const rows = [row({ canonicalKey: "near-metra", lat: METRA_NEAR.lat, lon: METRA_NEAR.lon })];
    // This row is near Metra but far from CTA (relatively). Screening on CTA
    // rail only at a quarter mile must drop it even though it is transit-near
    // via a different system.
    const ctaOnly = runShortlistEngine({
      rows,
      criteria: criteria({ transportation: ["cta-rail"], transportationDistance: "quarter-mile" }),
      stations: [CTA_FAR],
    });
    expect(ctaOnly.ranked).toHaveLength(0);

    const metraOnly = runShortlistEngine({
      rows,
      criteria: criteria({ transportation: ["metra"], transportationDistance: "quarter-mile" }),
      stations: [METRA_NEAR],
    });
    expect(metraOnly.ranked).toHaveLength(1);
  });

  // ── Criteria-relative negatives (the whole point of PR2) ──────────────────

  it("NEGATIVE: an unselected criterion cannot change score, membership, or order", () => {
    const rows = [
      row({ canonicalKey: "a", pin: "1", address: "A" }),
      row({ canonicalKey: "b", pin: "2", address: "B", buildingSqft: 9000 }),
    ];
    const withoutAmenities = runShortlistEngine({ rows, criteria: criteria(), stations: STATIONS });
    const withUnselectedAmenities = runShortlistEngine({
      rows,
      // Amenities/context/walkability set on the criteria object itself would
      // never happen via a real selection here (amenities is only ever what
      // the reader picked) — this test instead proves the CTA/Metra network
      // being present in a *different, unselected* form (bus) has no effect.
      criteria: criteria({ transportation: ["cta-bus"] }),
      stations: STATIONS,
    });
    expect(withUnselectedAmenities.ranked.map((c) => [c.key, c.score])).toEqual(
      withoutAmenities.ranked.map((c) => [c.key, c.score]),
    );
  });

  it("NEGATIVE: selecting a transit network scores ONLY that network, leaving the other candidate's score untouched by proximity to the OTHER network", () => {
    const rows = [
      row({ canonicalKey: "near-cta", lat: CTA_NEAR.lat, lon: CTA_NEAR.lon }),
      row({ canonicalKey: "near-metra", lat: METRA_NEAR.lat, lon: METRA_NEAR.lon }),
    ];
    const { ranked } = runShortlistEngine({
      rows,
      criteria: criteria({ transportation: ["cta-rail"] }),
      stations: STATIONS,
    });
    const nearCta = ranked.find((c) => c.key === "near-cta")!;
    const nearMetra = ranked.find((c) => c.key === "near-metra")!;
    // Both carry a transitScore FACT (proximity to the selected CTA network
    // is always measured), but the row that is actually far from every CTA
    // station earns zero points from it — the selection never falls back to
    // scoring it against the (unselected) Metra station it happens to sit
    // next to.
    expect(nearCta.transitScore).not.toBeNull();
    expect(nearCta.transitScore!.points).toBeGreaterThan(0);
    expect(nearMetra.transitScore?.points ?? 0).toBe(0);
    expect(nearCta.score).toBeGreaterThan(nearMetra.score);
  });

  it("NEGATIVE: display-only facts (expressway, school, library) cannot alter membership or order", () => {
    const rows = [
      row({ canonicalKey: "a", lat: BASE_LAT, lon: BASE_LON }),
      row({ canonicalKey: "b", lat: BASE_LAT + 0.2, lon: BASE_LON + 0.2 }), // far from any amenity
    ];
    const withSchool = runShortlistEngine({
      rows,
      criteria: criteria(),
      stations: [],
      schoolPoints: [{ name: "Nearby School", lat: BASE_LAT, lon: BASE_LON }],
    });
    const withoutSchool = runShortlistEngine({ rows, criteria: criteria(), stations: [] });
    expect(withSchool.ranked.map((c) => [c.key, c.score])).toEqual(
      withoutSchool.ranked.map((c) => [c.key, c.score]),
    );
    // The display fact itself IS present on the row nearest the school —
    // proving it was measured, just never scored.
    expect(withSchool.ranked.find((c) => c.key === "a")?.nearestSchool?.name).toBe("Nearby School");
  });

  it("populates nearestRailDisplay ONLY when no transit criterion was selected, never alongside a scored transitScore", () => {
    const rows = [row({ canonicalKey: "a" })];
    const noTransit = runShortlistEngine({ rows, criteria: criteria(), stations: STATIONS });
    expect(noTransit.ranked[0].nearestRailDisplay).not.toBeNull();
    expect(noTransit.ranked[0].transitScore).toBeNull();

    const withTransit = runShortlistEngine({
      rows,
      criteria: criteria({ transportation: ["cta-rail"] }),
      stations: STATIONS,
    });
    expect(withTransit.ranked[0].transitScore).not.toBeNull();
    expect(withTransit.ranked[0].nearestRailDisplay).toBeNull();
  });

  it("caps at SHORTLIST_TOP_N only at the CALLER level — the engine itself returns every screened candidate", () => {
    const rows = Array.from({ length: SHORTLIST_TOP_N + 5 }, (_, i) =>
      row({ canonicalKey: `k-${i}`, pin: String(i), address: `${i} S ASHLAND AVE` }),
    );
    const { ranked } = runShortlistEngine({ rows, criteria: criteria(), stations: [] });
    expect(ranked.length).toBe(SHORTLIST_TOP_N + 5);
    expect(ranked.slice(0, SHORTLIST_TOP_N)).toHaveLength(SHORTLIST_TOP_N);
  });

  // ── Funnel ──────────────────────────────────────────────────────────────

  it("funnel: withMeasuredArea is diagnostic only and does not gate insideBand when no band is set", () => {
    const rows = [
      row({ canonicalKey: "measured", buildingSqft: 4000 }),
      row({ canonicalKey: "unmeasured", buildingSqft: null, lotSqft: null }),
    ];
    const { funnel } = runShortlistEngine({ rows, criteria: criteria(), stations: [] });
    expect(funnel.trackedEvidence).toBe(2);
    expect(funnel.withMeasuredArea).toBe(1);
    // No band set -> BOTH rows survive to insideBand, exceeding withMeasuredArea.
    expect(funnel.insideBand).toBe(2);
  });

  it("funnel: insideBand narrows to the measured row once a band IS set", () => {
    const rows = [
      row({ canonicalKey: "measured", buildingSqft: 4000 }),
      row({ canonicalKey: "unmeasured", buildingSqft: null, lotSqft: null }),
    ];
    const { funnel } = runShortlistEngine({
      rows,
      criteria: criteria({ minSquareFeet: 1000 }),
      stations: [],
    });
    expect(funnel.insideBand).toBe(1);
  });

  it("funnel's final stage always equals the ranked list length", () => {
    const rows = [row({ canonicalKey: "a" }), row({ canonicalKey: "b", pin: "9", address: "9 S X ST" })];
    const { ranked, funnel } = runShortlistEngine({ rows, criteria: criteria(), stations: [] });
    expect(funnel.survivingTransitScreen).toBe(ranked.length);
  });

  it("never claims zero canonical sites when tracked evidence exists but the property type doesn't match", () => {
    const rows = [row({ canonicalKey: "land", hasVacantBuildingEvidence: false, hasVacantLandEvidence: true, propertyType: "vacant_land" })];
    const { funnel } = runShortlistEngine({ rows, criteria: criteria({ propertyType: "vacant-land" }), stations: [] });
    expect(funnel.trackedEvidence).toBeGreaterThan(0);
  });
});

// ── Exhaustive oracle: brute-force membership + order-contract check ────────

describe("exhaustive oracle — brute-force winner-set parity", () => {
  const fixtureRows: ShortlistUniverseRow[] = [
    row({ canonicalKey: "b-building-measured-pin", pin: "1", address: "1 A ST", buildingSqft: 4000, lat: CTA_NEAR.lat, lon: CTA_NEAR.lon }),
    row({ canonicalKey: "b-building-unmeasured-nopin", pin: null, address: "2 A ST", buildingSqft: null, lotSqft: null, lat: BASE_LAT + 0.02, lon: BASE_LON }),
    row({
      canonicalKey: "c-land",
      pin: "3",
      address: "3 A ST",
      propertyType: "vacant_land",
      hasVacantBuildingEvidence: false,
      hasVacantLandEvidence: true,
      buildingSqft: null,
      lotSqft: 8000,
      lat: BASE_LAT + 0.01,
      lon: BASE_LON,
    }),
    row({
      canonicalKey: "d-both-evidence-land-resolved",
      pin: "4",
      address: "4 A ST",
      propertyType: "vacant_land",
      hasVacantBuildingEvidence: true,
      hasVacantLandEvidence: true,
      conflictingPropertyTypes: true,
      buildingSqft: 3000,
      lotSqft: 5000,
      lat: BASE_LAT + 0.005,
      lon: BASE_LON,
    }),
    row({ canonicalKey: "e-far-from-transit", pin: "5", address: "5 A ST", buildingSqft: 5000, lat: BASE_LAT + 0.2, lon: BASE_LON }),
    row({ canonicalKey: "f-unresolved-zoning", pin: "6", address: "6 A ST", buildingSqft: 4500, zoning: { status: "unresolved", district: null, zoneType: null, pdNum: null, pmdSubArea: null } }),
  ];

  /** Independent, brute-force re-derivation of which canonicalKeys survive
   *  the REAL screens (evidence, band, transit) — deliberately re-derived
   *  from the fixture data rather than delegating to the engine's own
   *  screen helpers, so this is a genuine second implementation. */
  function bruteForceSurvivingKeys(
    rows: readonly ShortlistUniverseRow[],
    request: SiteMatchCriteria,
    stations: readonly ShortlistStation[],
  ): Set<string> {
    const survivors = new Set<string>();
    for (const candidate of rows) {
      const evidenceOk =
        request.propertyType === "existing-building"
          ? candidate.hasVacantBuildingEvidence
          : request.propertyType === "vacant-land"
            ? candidate.hasVacantLandEvidence
            : candidate.hasVacantBuildingEvidence || candidate.hasVacantLandEvidence;
      if (!evidenceOk) continue;

      const area = candidate.propertyType === "vacant_building" ? candidate.buildingSqft : candidate.lotSqft;
      const bandSet = request.minSquareFeet != null || request.maxSquareFeet != null;
      if (bandSet) {
        if (area == null || area <= 0) continue;
        if (request.minSquareFeet != null && area < request.minSquareFeet) continue;
        if (request.maxSquareFeet != null && area > request.maxSquareFeet) continue;
      }

      const wantsCta = request.transportation.includes("cta-rail");
      const wantsMetra = request.transportation.includes("metra");
      if ((wantsCta || wantsMetra) && request.transportationDistance && request.transportationDistance !== "flexible") {
        const radius = { "quarter-mile": 400, "half-mile": 800, "one-mile": 1600 }[request.transportationDistance];
        const subset = stations.filter(
          (s) => (wantsCta && s.system.toUpperCase().startsWith("CTA")) || (wantsMetra && s.system.toUpperCase().startsWith("METRA")),
        );
        if (subset.length === 0 || candidate.lat == null || candidate.lon == null) continue;
        let nearestMeters = Infinity;
        for (const station of subset) {
          const dx = (station.lon - candidate.lon) * Math.cos((candidate.lat * Math.PI) / 180) * 111_320;
          const dy = (station.lat - candidate.lat) * 110_540;
          nearestMeters = Math.min(nearestMeters, Math.hypot(dx, dy));
        }
        if (nearestMeters > radius) continue;
      }

      survivors.add(candidate.canonicalKey);
    }
    return survivors;
  }

  const scenarios: { label: string; request: SiteMatchCriteria; stations: ShortlistStation[] }[] = [
    { label: "building search, no band, no transit", request: criteria(), stations: [] },
    { label: "building search with a size band", request: criteria({ minSquareFeet: 3500, maxSquareFeet: 5000 }), stations: [] },
    { label: "land search", request: criteria({ propertyType: "vacant-land" }), stations: [] },
    { label: "either, no filters", request: criteria({ propertyType: "either" }), stations: [] },
    {
      label: "building search screened to CTA rail within a quarter mile",
      request: criteria({ transportation: ["cta-rail"], transportationDistance: "quarter-mile" }),
      stations: STATIONS,
    },
  ];

  it.each(scenarios)("winner-set parity: $label", ({ request, stations }) => {
    const oracleKeys = bruteForceSurvivingKeys(fixtureRows, request, stations);
    const { ranked } = runShortlistEngine({ rows: fixtureRows, criteria: request, stations });
    const engineKeys = new Set(ranked.map((c) => c.key));
    expect(engineKeys).toEqual(oracleKeys);
  });

  it("order contract: scores are non-increasing and ties break by canonicalKey ascending", () => {
    const { ranked } = runShortlistEngine({ rows: fixtureRows, criteria: criteria({ propertyType: "either" }), stations: STATIONS });
    for (let i = 1; i < ranked.length; i++) {
      const prev = ranked[i - 1];
      const curr = ranked[i];
      expect(prev.score).toBeGreaterThanOrEqual(curr.score);
      if (prev.score === curr.score) {
        expect(prev.key < curr.key).toBe(true);
      }
    }
  });
});

// ── Ranking model version ────────────────────────────────────────────────────

describe("RANKING_MODEL_VERSION", () => {
  it("matches the universe schema's rankingInputsVersion so the page's cross-check is meaningful", () => {
    expect(RANKING_MODEL_VERSION).toBe(RANKING_INPUTS_VERSION);
  });
});

// ── False-zero guard: 60621 building search on the REAL committed universe ──

describe("false-zero guard — 60621 building search (the canonical regression case)", () => {
  const fixturePath = path.join(process.cwd(), "data/exports/shortlist-universe/60621.json");
  const exists = existsSync(fixturePath);

  it("the committed 60621 universe file exists", () => {
    expect(exists).toBe(true);
  });

  if (!exists) return;

  const universe = JSON.parse(readFileSync(fixturePath, "utf8")) as { rows: ShortlistUniverseRow[] };

  it("carries a nonzero count of canonical building sites — never a bare zero", () => {
    const buildingRows = universe.rows.filter((r) => r.hasVacantBuildingEvidence);
    expect(buildingRows.length).toBeGreaterThan(0);
  });

  it("the engine's funnel reports the same nonzero tracked-evidence count for a building search", () => {
    const { funnel } = runShortlistEngine({
      rows: universe.rows,
      criteria: criteria({ zip: "60621", propertyType: "existing-building" }),
      stations: [],
    });
    expect(funnel.trackedEvidence).toBeGreaterThan(0);
    expect(funnel.canonicalSites).toBe(funnel.trackedEvidence);
  });

  it("running the full engine (no PIN/measurement requirement) surfaces real ranked candidates, not just an honest funnel", () => {
    const { ranked } = runShortlistEngine({
      rows: universe.rows,
      criteria: criteria({ zip: "60621", propertyType: "existing-building" }),
      stations: [],
    });
    // This is the actual fix, not merely an explanation: PIN/measurement are
    // funnel diagnostics in v1, not screens, so buildings lacking them still
    // reach the ranked list.
    expect(ranked.length).toBeGreaterThan(0);
  });
});

// ── 60636 fixture: the other pilot ZIP explicitly checked by the PR2 spec ───

describe("60636 fixture — building and land search sanity", () => {
  const fixturePath = path.join(process.cwd(), "data/exports/shortlist-universe/60636.json");
  const exists = existsSync(fixturePath);

  it("the committed 60636 universe file exists", () => {
    expect(exists).toBe(true);
  });

  if (!exists) return;

  const universe = JSON.parse(readFileSync(fixturePath, "utf8")) as { rows: ShortlistUniverseRow[] };

  it("runs the full engine for both property types without throwing, and the funnel's final stage always equals the ranked count", () => {
    for (const propertyType of ["existing-building", "vacant-land", "either"] as const) {
      const { ranked, funnel } = runShortlistEngine({
        rows: universe.rows,
        criteria: criteria({ zip: "60636", propertyType }),
        stations: [],
      });
      expect(funnel.survivingTransitScreen).toBe(ranked.length);
      expect(funnel.trackedEvidence).toBeGreaterThanOrEqual(funnel.insideBand);
    }
  });

  it("produces a deterministic top-N slice stable across repeated runs", () => {
    const run = () =>
      runShortlistEngine({
        rows: universe.rows,
        criteria: criteria({ zip: "60636", propertyType: "existing-building" }),
        stations: [],
      }).ranked.slice(0, SHORTLIST_TOP_N).map((c) => c.key);
    expect(run()).toEqual(run());
  });
});
