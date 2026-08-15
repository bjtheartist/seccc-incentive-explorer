import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  RANKING_MODEL_VERSION,
  SHORTLIST_TOP_N,
  ZONING_BADGE_LABELS,
  ZONING_SCREENING_NOTE,
  assertShortlistDispatchCoverage,
  decorateShortlistDisplayFacts,
  matchesPropertyTypeEvidence,
  passesFootprintScreen,
  runShortlistEngine,
  screeningAreaSqft,
  selectedTransitNetwork,
  transitScoreFor,
  transitScreenMeters,
  zoningBadgeFor,
  zoningBadgeNote,
  type RankedShortlistCandidate,
} from "../shortlist-engine";
import { RECORD_COMPLETENESS_WEIGHTS, shortlistCriteriaByBehavior } from "../shortlist-criteria";
import { RANKING_INPUTS_VERSION } from "../shortlist-universe-schema";
import type { ShortlistUniverseRow } from "../shortlist-universe-schema";
import { createEmptySiteMatchCriteria, type SiteMatchCriteria, type SiteProjectUse } from "../site-matchmaker";
import type { ShortlistStation } from "../site-shortlist";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_LAT = 41.75;
const BASE_LON = -87.605;

function noOverlays(): ShortlistUniverseRow["overlays"] {
  return {
    ssa: { present: false, name: null, unknown: false },
    ccsa: { present: false, name: null, unknown: false },
    tif: { present: false, name: null, unknown: false },
    nof: { present: false, name: null, unknown: false },
  };
}

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
    overlays: noOverlays(),
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

const ZERO_EVIDENCE_COUNTS = { city_land: 0, "311_building": 0, "311_land": 0, assessor_vacant_land: 0 };

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

/** Runs the engine with sourceRecordsByEvidenceType defaulted to all-zero —
 *  fine for every test that only cares about screening/scoring/ordering,
 *  not the funnel's `trackedEvidence` stage (which has its own dedicated
 *  tests below). */
function engine(rows: ShortlistUniverseRow[], request: SiteMatchCriteria, stations: ShortlistStation[] = []) {
  return runShortlistEngine({ rows, criteria: request, stations, sourceRecordsByEvidenceType: ZERO_EVIDENCE_COUNTS });
}

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
    const conflicted = row({
      propertyType: "vacant_land",
      hasVacantBuildingEvidence: true,
      hasVacantLandEvidence: true,
      conflictingPropertyTypes: true,
    });
    expect(matchesPropertyTypeEvidence(conflicted, "existing-building")).toBe(true);
  });
});

describe("screeningAreaSqft — resolved from the REQUESTED property type (Finding 3)", () => {
  it("reads buildingSqft for a building request, lotSqft for a land request — regardless of the row's own resolved propertyType", () => {
    expect(screeningAreaSqft(row(), "existing-building")).toBe(4000);
    expect(screeningAreaSqft(row(), "vacant-land")).toBe(6000);
  });

  it("REGRESSION (Finding 3): a site admitted into a LAND search via hasVacantLandEvidence is screened on lotSqft even when its resolved propertyType is 'vacant_building'", () => {
    // canonical-sites.ts resolves propertyType to "vacant_building" whenever
    // BOTH evidences are present (building evidence wins resolution) — this
    // conflicted row therefore has propertyType: "vacant_building" but was
    // admitted into a land search via hasVacantLandEvidence. The old bug
    // (pre-fix) picked buildingSqft here regardless of which search admitted
    // the row; the fix must pick lotSqft for a "vacant-land" request.
    const conflicted = row({
      propertyType: "vacant_building", // building evidence won resolution
      hasVacantBuildingEvidence: true,
      hasVacantLandEvidence: true,
      conflictingPropertyTypes: true,
      buildingSqft: 999, // if this leaks into a land screen, the bug has regressed
      lotSqft: 12000,
    });
    expect(screeningAreaSqft(conflicted, "vacant-land")).toBe(12000);
    expect(screeningAreaSqft(conflicted, "existing-building")).toBe(999);
  });

  it("'either' prefers building area (falling back to lot area) when building evidence is present, else lot area", () => {
    const bothWithBuildingArea = row({ hasVacantBuildingEvidence: true, hasVacantLandEvidence: true, buildingSqft: 500, lotSqft: 9000 });
    expect(screeningAreaSqft(bothWithBuildingArea, "either")).toBe(500);

    const buildingEvidenceNoBuildingArea = row({ hasVacantBuildingEvidence: true, hasVacantLandEvidence: true, buildingSqft: null, lotSqft: 9000 });
    expect(screeningAreaSqft(buildingEvidenceNoBuildingArea, "either")).toBe(9000);

    const landOnly = row({ hasVacantBuildingEvidence: false, hasVacantLandEvidence: true, buildingSqft: 500, lotSqft: 9000 });
    expect(screeningAreaSqft(landOnly, "either")).toBe(9000);
  });

  it("returns null for a missing or non-positive measurement", () => {
    expect(screeningAreaSqft(row({ buildingSqft: null }), "existing-building")).toBeNull();
    expect(screeningAreaSqft(row({ buildingSqft: 0 }), "existing-building")).toBeNull();
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

  it("screens a land search on lotSqft, not buildingSqft, even on a conflicted row (Finding 3)", () => {
    const conflicted = row({
      propertyType: "vacant_building",
      hasVacantBuildingEvidence: true,
      hasVacantLandEvidence: true,
      buildingSqft: 100, // would fail a 1000+ sqft band if wrongly used
      lotSqft: 5000,
    });
    expect(passesFootprintScreen(conflicted, criteria({ propertyType: "vacant-land", minSquareFeet: 1000 }))).toBe(true);
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

// ── Scoring ──────────────────────────────────────────────────────────────────

describe("transitScoreFor — the ONE v1 score component (Finding 1: no baseline)", () => {
  it("is null (zero effect) when no transit network was selected", () => {
    expect(transitScoreFor(row(), null)).toBeNull();
  });

  it("scores only against the selected network's stations, never the nearest station on any system", () => {
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

  // ── Finding 9 ──────────────────────────────────────────────────────────
  it("NEVER reads a PMD as not-aligned for ANY use, including production-manufacturing — Finding 9", () => {
    const allUses: (SiteProjectUse | null)[] = [
      ...commercialUses,
      "production-manufacturing",
      "distribution-logistics",
      "housing-mixed-use",
      null,
    ];
    for (const use of allUses) {
      expect(zoningBadgeFor(use, { status: "resolved", district: "PMD 11" })).not.toBe("not-aligned");
      expect(zoningBadgeFor(use, { status: "resolved", district: "PMD-11" })).not.toBe("not-aligned");
    }
  });

  it("gives PMD the SAME neutral site-specific badge as PD — Finding 9", () => {
    for (const use of [...commercialUses, "production-manufacturing"] as const) {
      expect(zoningBadgeFor(use, { status: "resolved", district: "PMD 11" })).toBe("planned-development");
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

  it("never predicts Special Use, a timeline, or blanket ZBA routing for ANY badge, including PMD's", () => {
    for (const [badge, district] of [
      ["aligned", "B3-2"],
      ["not-aligned", "RS-3"],
      ["planned-development", "PD 123"],
      ["planned-development", "PMD 11"],
      ["unresolved", null],
    ] as const) {
      const note = zoningBadgeNote(badge, district);
      expect(note).not.toMatch(/special use/i);
      expect(note).not.toMatch(/3 to 5|3-5/);
      expect(note).not.toMatch(/zoning board of appeals|zba/i);
    }
  });

  it("gives PMD its OWN honest sentence, never calling it a 'Planned Development' (Finding 9)", () => {
    const pmdNote = zoningBadgeNote("planned-development", "PMD 11");
    expect(pmdNote).toMatch(/manufacturing/i);
    expect(pmdNote).not.toMatch(/planned development/i);

    const pdNote = zoningBadgeNote("planned-development", "PD 123");
    expect(pdNote).toMatch(/planned development/i);
  });

  it("matches the spec's verbatim card copy for aligned/not-aligned/unresolved", () => {
    expect(zoningBadgeNote("aligned")).toBe(
      "The mapped district family is broadly aligned with this project category. Verify the exact use and all applicable standards before relying on this screen.",
    );
    expect(zoningBadgeNote("not-aligned")).toBe(
      "The mapped district family is not broadly aligned with this project category. The required approval path has not been determined.",
    );
    expect(zoningBadgeNote("unresolved")).toBe("District unresolved; no zoning screen was performed.");
  });

  it("carries the four badge labels the spec names for the client-side filter", () => {
    expect(ZONING_BADGE_LABELS).toEqual({
      aligned: "Broad family alignment",
      "not-aligned": "No broad family alignment",
      "planned-development": "Site-specific district (PD/PMD)",
      unresolved: "District unresolved",
    });
  });
});

// ── Registry-driven dispatch (Finding 2) ─────────────────────────────────────

describe("registry-driven dispatch coverage", () => {
  it("the current registry and engine dispatch tables agree (already proven at every module import; pinned here for a readable failure message)", () => {
    expect(() => assertShortlistDispatchCoverage()).not.toThrow();
  });

  it("the engine's screen pipeline is driven by the registry's own SCREEN ids, in registry order", () => {
    const registryScreenIds = shortlistCriteriaByBehavior("screen").map((e) => e.id);
    expect(registryScreenIds).toEqual(["property-type", "square-footage", "transportation-distance"]);
  });

  it("the engine's transit scoring is driven by the registry's own SCORE ids", () => {
    const registryScoreIds = shortlistCriteriaByBehavior("score").map((e) => e.id);
    expect(registryScoreIds.sort()).toEqual(["cta-rail", "metra"]);
  });

});

// ── Finding 14 (re-review): drift is caught at REQUEST time, never at ──────
//    module import — see lib/shortlist-engine.ts's header for why throwing
//    at import time turns a registry/engine drift into a process-wide crash
//    (every request 500s the instant anything imports the module) rather
//    than degrading the one request that hit it.

describe("dispatch-coverage drift degrades one request, never crashes the module (Finding 14)", () => {
  it("importing the engine module SUCCEEDS even when the registry carries a SCREEN entry with no matching handler", async () => {
    vi.resetModules();
    vi.doMock("../shortlist-criteria", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../shortlist-criteria")>();
      return {
        ...actual,
        shortlistCriteriaByBehavior: (behavior: string) => {
          const base = actual.shortlistCriteriaByBehavior(behavior as never);
          if (behavior !== "screen") return base;
          return [
            ...base,
            { id: "made-up-screen", label: "x", behavior: "screen", source: "x", vintage: null, explanation: "x" },
          ];
        },
      };
    });

    // The import itself must resolve — no throw at module load.
    const mod = await import("../shortlist-engine");
    expect(mod.runShortlistEngine).toBeTypeOf("function");

    // The drift is real (the underlying assertion still throws when called
    // directly) — but a REQUEST through runShortlistEngine degrades to the
    // fail-closed flag instead of propagating the throw.
    expect(() => mod.assertShortlistDispatchCoverage()).toThrow(/made-up-screen/);
    const result = mod.runShortlistEngine({
      rows: [row()],
      criteria: criteria(),
      stations: [],
      sourceRecordsByEvidenceType: ZERO_EVIDENCE_COUNTS,
    });
    expect(result.dispatchCoverageBroken).toBe(true);
    expect(result.ranked).toEqual([]);
    expect(result.scored).toBe(false);
    expect(result.railDataUnavailable).toBe(false);
    expect(result.funnel).toEqual({
      trackedEvidence: 0,
      canonicalSites: 0,
      withResolvedPin: 0,
      withMeasuredArea: 0,
      insideBand: 0,
      survivingTransitScreen: 0,
    });

    vi.doUnmock("../shortlist-criteria");
    vi.resetModules();
  });

  it("same for a registry SCORE entry with no scoring implementation — import succeeds, the request degrades", async () => {
    vi.resetModules();
    vi.doMock("../shortlist-criteria", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../shortlist-criteria")>();
      return {
        ...actual,
        shortlistCriteriaByBehavior: (behavior: string) => {
          const base = actual.shortlistCriteriaByBehavior(behavior as never);
          if (behavior !== "score") return base;
          return [
            ...base,
            { id: "expressway", label: "x", behavior: "score", source: "x", vintage: null, explanation: "x" },
          ];
        },
      };
    });

    const mod = await import("../shortlist-engine");
    expect(mod.runShortlistEngine).toBeTypeOf("function");
    expect(() => mod.assertShortlistDispatchCoverage()).toThrow(/expressway/);

    const result = mod.runShortlistEngine({
      rows: [row()],
      criteria: criteria({ transportation: ["cta-rail"] }),
      stations: STATIONS,
      sourceRecordsByEvidenceType: ZERO_EVIDENCE_COUNTS,
    });
    expect(result.dispatchCoverageBroken).toBe(true);
    // Even with a transit criterion selected and stations available, a
    // broken dispatch table must never report scored: true — an empty,
    // clearly-flagged result, not a half-computed one.
    expect(result.scored).toBe(false);

    vi.doUnmock("../shortlist-criteria");
    vi.resetModules();
  });
});

// ── Engine integration ───────────────────────────────────────────────────────

describe("runShortlistEngine", () => {
  it("is deterministic — identical input yields identical output, in order", () => {
    const rows = [
      row({ canonicalKey: "a", pin: "1", address: "9000 S ASHLAND AVE" }),
      row({ canonicalKey: "b", pin: "2", address: "1000 S ASHLAND AVE" }),
    ];
    const first = engine(rows, criteria());
    const second = engine(rows, criteria());
    expect(second.ranked.map((c) => [c.key, c.score])).toEqual(first.ranked.map((c) => [c.key, c.score]));
  });

  it("orders by score descending, tiebreaking on canonicalKey ascending — never address (Finding 1)", () => {
    const rows = [
      row({ canonicalKey: "zzz-key", pin: "1", address: "1000 S ASHLAND AVE", buildingSqft: 4000 }),
      row({ canonicalKey: "aaa-key", pin: "2", address: "9000 S ASHLAND AVE", buildingSqft: 4000 }),
    ];
    // No scoring criterion selected -> both score 0 -> pure canonicalKey order.
    const { ranked } = engine(rows, criteria());
    expect(ranked.map((c) => c.key)).toEqual(["aaa-key", "zzz-key"]);
    expect(ranked.every((c) => c.score === 0)).toBe(true);
  });

  it("NO BASELINE: an unmeasured, PIN-less, unresolved-zoning row scores identically to a complete one when no scoring criterion is selected (Finding 1)", () => {
    const complete = row({ canonicalKey: "complete", pin: "1", buildingSqft: 4000, zoning: { status: "resolved", district: "B3-2", zoneType: 1, pdNum: null, pmdSubArea: null } });
    const bare = row({
      canonicalKey: "bare",
      pin: null,
      buildingSqft: null,
      lotSqft: null,
      zoning: { status: "unresolved", district: null, zoneType: null, pdNum: null, pmdSubArea: null },
      ownerConfidence: "needs_verification",
    });
    const { ranked } = engine([complete, bare], criteria());
    expect(ranked.find((c) => c.key === "complete")!.score).toBe(0);
    expect(ranked.find((c) => c.key === "bare")!.score).toBe(0);
  });

  it("excludes a row with no evidence for the selected property type", () => {
    const rows = [row({ canonicalKey: "land-only", hasVacantBuildingEvidence: false, hasVacantLandEvidence: true, propertyType: "vacant_land" })];
    const { ranked } = engine(rows, criteria({ propertyType: "existing-building" }));
    expect(ranked).toHaveLength(0);
  });

  it("keeps a building row with no PIN and no measurement when no band is set — the actual false-zero fix", () => {
    const rows = [row({ canonicalKey: "thin", pin: null, buildingSqft: null, lotSqft: null })];
    const { ranked } = engine(rows, criteria());
    expect(ranked).toHaveLength(1);
    expect(ranked[0].pin).toBeNull();
  });

  it("excludes an unmeasured row once a size band is set", () => {
    const rows = [row({ canonicalKey: "thin", buildingSqft: null })];
    const { ranked } = engine(rows, criteria({ minSquareFeet: 1000 }));
    expect(ranked).toHaveLength(0);
  });

  it("screens against the selected transit network's distance only", () => {
    const rows = [row({ canonicalKey: "near-metra", lat: METRA_NEAR.lat, lon: METRA_NEAR.lon })];
    const ctaOnly = engine(
      rows,
      criteria({ transportation: ["cta-rail"], transportationDistance: "quarter-mile" }),
      [CTA_FAR],
    );
    expect(ctaOnly.ranked).toHaveLength(0);

    const metraOnly = engine(
      rows,
      criteria({ transportation: ["metra"], transportationDistance: "quarter-mile" }),
      [METRA_NEAR],
    );
    expect(metraOnly.ranked).toHaveLength(1);
  });

  it("reports conflictingPropertyTypes on the candidate (Finding 3: explicit reporting)", () => {
    const conflicted = row({
      canonicalKey: "conflicted",
      hasVacantBuildingEvidence: true,
      hasVacantLandEvidence: true,
      conflictingPropertyTypes: true,
    });
    const { ranked } = engine([conflicted], criteria());
    expect(ranked[0].conflictingPropertyTypes).toBe(true);
  });

  it("caps at SHORTLIST_TOP_N only at the CALLER level — the engine itself returns every screened candidate", () => {
    const rows = Array.from({ length: SHORTLIST_TOP_N + 5 }, (_, i) =>
      row({ canonicalKey: `k-${i}`, pin: String(i), address: `${i} S ASHLAND AVE` }),
    );
    const { ranked } = engine(rows, criteria());
    expect(ranked.length).toBe(SHORTLIST_TOP_N + 5);
  });

  // ── Finding 8: rail data unavailable ────────────────────────────────────

  it("railDataUnavailable is true when a transit network is selected but the station SOURCE is empty", () => {
    const { railDataUnavailable } = engine(
      [row()],
      criteria({ transportation: ["cta-rail"], transportationDistance: "half-mile" }),
      [], // simulates a rail-stations.ts load failure
    );
    expect(railDataUnavailable).toBe(true);
  });

  it("railDataUnavailable is false when no transit network was selected, even with an empty station source", () => {
    const { railDataUnavailable } = engine([row()], criteria(), []);
    expect(railDataUnavailable).toBe(false);
  });

  it("railDataUnavailable is false when the station source has data, even if none are nearby", () => {
    const { railDataUnavailable } = engine(
      [row()],
      criteria({ transportation: ["cta-rail"], transportationDistance: "half-mile" }),
      [CTA_FAR],
    );
    expect(railDataUnavailable).toBe(false);
  });

  // ── Finding 8 (re-review): checked PER SELECTED NETWORK, not by whether
  //    the whole stations array is empty — a Metra-only file is non-empty,
  //    but a CTA selection against it still has zero CTA stations to screen
  //    or score against, and the reverse. Both directions are asserted here
  //    explicitly, against single-network station files (never STATIONS,
  //    which carries both).

  it("Finding 8, direction 1: selecting CTA against a Metra-ONLY station file fails closed, even though the file itself is non-empty", () => {
    const metraOnlyFile: ShortlistStation[] = [METRA_NEAR];
    const { railDataUnavailable } = engine(
      [row()],
      criteria({ transportation: ["cta-rail"], transportationDistance: "half-mile" }),
      metraOnlyFile,
    );
    expect(railDataUnavailable).toBe(true);
  });

  it("Finding 8, direction 2: selecting Metra against a CTA-ONLY station file fails closed — the reverse direction", () => {
    const ctaOnlyFile: ShortlistStation[] = [CTA_NEAR, CTA_FAR];
    const { railDataUnavailable } = engine(
      [row()],
      criteria({ transportation: ["metra"], transportationDistance: "half-mile" }),
      ctaOnlyFile,
    );
    expect(railDataUnavailable).toBe(true);
  });

  it("Finding 8: selecting a network the file DOES carry does not fail closed merely because the OTHER network is missing", () => {
    const ctaOnlyFile: ShortlistStation[] = [CTA_NEAR, CTA_FAR];
    const { railDataUnavailable: ctaAgainstCtaOnly } = engine(
      [row()],
      criteria({ transportation: ["cta-rail"], transportationDistance: "half-mile" }),
      ctaOnlyFile,
    );
    expect(ctaAgainstCtaOnly).toBe(false);

    const metraOnlyFile: ShortlistStation[] = [METRA_NEAR];
    const { railDataUnavailable: metraAgainstMetraOnly } = engine(
      [row()],
      criteria({ transportation: ["metra"], transportationDistance: "half-mile" }),
      metraOnlyFile,
    );
    expect(metraAgainstMetraOnly).toBe(false);
  });

  it("Finding 8: selecting BOTH CTA and Metra against a CTA-only file fails closed — the Metra half is still unavailable even though CTA is fine", () => {
    const ctaOnlyFile: ShortlistStation[] = [CTA_NEAR, CTA_FAR];
    const { railDataUnavailable } = engine(
      [row()],
      criteria({ transportation: ["cta-rail", "metra"], transportationDistance: "half-mile" }),
      ctaOnlyFile,
    );
    expect(railDataUnavailable).toBe(true);
  });

  // ── Finding 13: `scored` is true only when a real transit score is active ──

  it("Finding 13: scored is false when no transportation criterion was selected — ranked's order is stable, never a ranking claim", () => {
    const { scored } = engine([row()], criteria());
    expect(scored).toBe(false);
  });

  it("Finding 13: scored is false when a transit criterion was selected but matched zero stations (mirrors railDataUnavailable)", () => {
    const { scored, railDataUnavailable } = engine(
      [row()],
      criteria({ transportation: ["cta-rail"] }),
      [], // no stations at all -> selectedTransitNetwork returns null
    );
    expect(railDataUnavailable).toBe(true);
    expect(scored).toBe(false);
  });

  it("Finding 13: scored is true when a transit network was selected AND matched at least one station", () => {
    const { scored } = engine([row()], criteria({ transportation: ["cta-rail"] }), STATIONS);
    expect(scored).toBe(true);
  });

  it("Finding 13: scored is true for Metra alone, independent of whether CTA was also selected", () => {
    const { scored: metraOnly } = engine([row()], criteria({ transportation: ["metra"] }), STATIONS);
    expect(metraOnly).toBe(true);
    const { scored: both } = engine([row()], criteria({ transportation: ["cta-rail", "metra"] }), STATIONS);
    expect(both).toBe(true);
  });

  // ── Finding 3 (re-review): the CANDIDATE reports the type it was ────────
  //    actually SCREENED as, distinct from its resolved `propertyType`, on
  //    a conflicted row admitted via the "other" evidence.

  it("Finding 3: a conflicted row admitted into a LAND search reports screenedPropertyType 'vacant_land' even though its resolved propertyType is 'vacant_building'", () => {
    const conflicted = row({
      canonicalKey: "conflicted-land-search",
      propertyType: "vacant_building", // building evidence won resolution
      hasVacantBuildingEvidence: true,
      hasVacantLandEvidence: true,
      conflictingPropertyTypes: true,
      lotSqft: 8000,
    });
    const { ranked } = engine([conflicted], criteria({ propertyType: "vacant-land" }));
    expect(ranked).toHaveLength(1);
    expect(ranked[0].propertyType).toBe("vacant_building"); // resolved type, unchanged
    expect(ranked[0].screenedPropertyType).toBe("vacant_land"); // what THIS search actually screened it as
  });

  it("Finding 3: the SAME conflicted row reports screenedPropertyType 'vacant_building' in a building search — the field tracks the REQUEST, not a fixed row property", () => {
    const conflicted = row({
      canonicalKey: "conflicted-building-search",
      propertyType: "vacant_building",
      hasVacantBuildingEvidence: true,
      hasVacantLandEvidence: true,
      conflictingPropertyTypes: true,
      buildingSqft: 3000,
    });
    const { ranked } = engine([conflicted], criteria({ propertyType: "existing-building" }));
    expect(ranked[0].screenedPropertyType).toBe("vacant_building");
  });

  // ── Criteria-relative negatives (the whole point of PR2) ──────────────────

  it("NEGATIVE: selecting a transit network scores ONLY that network, and never falls back to the OTHER (unselected) network's proximity", () => {
    const rows = [
      row({ canonicalKey: "near-cta", lat: CTA_NEAR.lat, lon: CTA_NEAR.lon }),
      row({ canonicalKey: "near-metra", lat: METRA_NEAR.lat, lon: METRA_NEAR.lon }),
    ];
    const { ranked } = engine(rows, criteria({ transportation: ["cta-rail"] }), STATIONS);
    const nearCta = ranked.find((c) => c.key === "near-cta")!;
    const nearMetra = ranked.find((c) => c.key === "near-metra")!;
    expect(nearCta.transitScore).not.toBeNull();
    expect(nearCta.transitScore!.points).toBeGreaterThan(0);
    expect(nearMetra.transitScore?.points ?? 0).toBe(0);
    expect(nearCta.score).toBeGreaterThan(nearMetra.score);
  });

  it("NEGATIVE: changing projectUse (a display-only criterion) changes badges but NEVER changes membership or order", () => {
    const rows = [
      row({ canonicalKey: "a", zoning: { status: "resolved", district: "B3-2", zoneType: 1, pdNum: null, pmdSubArea: null } }),
      row({ canonicalKey: "b", pin: "2", address: "2 A ST", zoning: { status: "resolved", district: "RS-3", zoneType: 4, pdNum: null, pmdSubArea: null } }),
    ];
    const retail = engine(rows, criteria({ projectUse: "retail-service" }));
    const housing = engine(rows, criteria({ projectUse: "housing-mixed-use" }));
    expect(retail.ranked.map((c) => [c.key, c.score])).toEqual(housing.ranked.map((c) => [c.key, c.score]));
    // Badges DID change (proving the criterion has SOME effect — just not on ranking).
    expect(retail.ranked.find((c) => c.key === "b")!.badge).toBe("not-aligned");
    expect(housing.ranked.find((c) => c.key === "b")!.badge).toBe("aligned");
  });

  it("NEGATIVE: enrichment cannot change membership or order, because the engine's own signature never accepts it", () => {
    // Structural proof: runShortlistEngine's parameter type has no slot for
    // county-class/assessed-value/license facts at all — there is no code
    // path by which they COULD reach screening, scoring, or ordering. Two
    // runs with identical rows/criteria/stations, standing in for "before"
    // and "after" a hypothetical enrichment pass, must be byte-identical.
    const rows = [row({ canonicalKey: "a" }), row({ canonicalKey: "b", pin: "2", address: "2 A ST" })];
    const before = engine(rows, criteria({ transportation: ["cta-rail"] }), STATIONS);
    const after = engine(rows, criteria({ transportation: ["cta-rail"] }), STATIONS);
    expect(after.ranked).toEqual(before.ranked);
  });

  // ── Registry-wide behavior coverage (Finding 10) ───────────────────────
  //
  // For every registry entry that is NOT a screen/score criterion (i.e.
  // every UNSUPPORTED and DISPLAY-ONLY entry), selecting it must leave the
  // core engine's ranked output byte-identical to not selecting it. This is
  // the generic, registry-wide version of the criteria-relative negative —
  // one test per entry, all driven off the SAME registry the engine reads.

  const NON_SCORING_MUTATORS: Record<string, (base: SiteMatchCriteria) => SiteMatchCriteria> = {
    "project-use": (base) => ({ ...base, projectUse: "retail-service" }),
    context: (base) => ({ ...base, context: "commercial-corridor" }),
    walkability: (base) => ({ ...base, walkability: "important" }),
    "pedestrian-activity": (base) => ({ ...base, pedestrianActivity: "important" }),
    "cta-bus": (base) => ({ ...base, transportation: [...base.transportation, "cta-bus"] }),
    expressway: (base) => ({ ...base, transportation: [...base.transportation, "expressway"] }),
    "freight-rail": (base) => ({ ...base, transportation: [...base.transportation, "freight-rail"] }),
    "bike-routes": (base) => ({ ...base, transportation: [...base.transportation, "bike-routes"] }),
    "restaurants-retail": (base) => ({ ...base, amenities: [...base.amenities, "restaurants-retail"] }),
    grocery: (base) => ({ ...base, amenities: [...base.amenities, "grocery"] }),
    "medical-health": (base) => ({ ...base, amenities: [...base.amenities, "medical-health"] }),
    schools: (base) => ({ ...base, amenities: [...base.amenities, "schools"] }),
    libraries: (base) => ({ ...base, amenities: [...base.amenities, "libraries"] }),
    "parks-open-space": (base) => ({ ...base, amenities: [...base.amenities, "parks-open-space"] }),
  };

  const nonScoringEntries = [
    ...shortlistCriteriaByBehavior("unsupported"),
    ...shortlistCriteriaByBehavior("display-only"),
  ];

  it("the mutator table covers every UNSUPPORTED/DISPLAY-ONLY registry entry — so the coverage test below cannot silently skip one", () => {
    const covered = Object.keys(NON_SCORING_MUTATORS).sort();
    const required = nonScoringEntries.map((e) => e.id).sort();
    expect(covered).toEqual(required);
  });

  it.each(nonScoringEntries.map((e) => e.id))(
    "REGISTRY-WIDE NEGATIVE: selecting '%s' (unsupported/display-only) has ZERO effect on core engine output",
    (id) => {
      const rows = [
        row({ canonicalKey: "a" }),
        row({ canonicalKey: "b", pin: "2", address: "2 A ST", zoning: { status: "resolved", district: "RS-3", zoneType: 4, pdNum: null, pmdSubArea: null } }),
      ];
      const base = criteria();
      const mutated = NON_SCORING_MUTATORS[id](base);
      const baseline = engine(rows, base);
      const withCriterion = engine(rows, mutated);
      expect(withCriterion.ranked.map((c) => [c.key, c.score])).toEqual(
        baseline.ranked.map((c) => [c.key, c.score]),
      );
    },
  );

  // ── Finding 13 (round 3): RECORD-COMPLETENESS ordering, UNSCORED path ────

  it("UNSCORED order (i), expected-order oracle: matches a HAND-COMPUTED record-completeness score for every row, exactly — full(4) > tied-at-3(alpha) > area-only(2) > bare(0)", () => {
    const rows = [
      // full: measured area (2) + resolved pin (1) + resolved zoning (1) = 4
      row({
        canonicalKey: "full",
        pin: "1",
        buildingSqft: 4000,
        zoning: { status: "resolved", district: "B3-2", zoneType: 1, pdNum: null, pmdSubArea: null },
      }),
      // no-pin: measured area (2) + resolved zoning (1), no pin = 3
      row({
        canonicalKey: "no-pin",
        pin: null,
        buildingSqft: 4000,
        zoning: { status: "resolved", district: "B3-2", zoneType: 1, pdNum: null, pmdSubArea: null },
      }),
      // no-zoning: measured area (2) + resolved pin (1), unresolved zoning = 3
      // — ties with no-pin; canonicalKey "no-pin" < "no-zoning" alphabetically.
      row({
        canonicalKey: "no-zoning",
        pin: "3",
        buildingSqft: 4000,
        zoning: { status: "unresolved", district: null, zoneType: null, pdNum: null, pmdSubArea: null },
      }),
      // no-area: resolved pin (1) + resolved zoning (1), no measured area = 2
      row({
        canonicalKey: "no-area",
        pin: "4",
        buildingSqft: null,
        lotSqft: null,
        zoning: { status: "resolved", district: "B3-2", zoneType: 1, pdNum: null, pmdSubArea: null },
      }),
      // bare: nothing published = 0
      row({
        canonicalKey: "bare",
        pin: null,
        buildingSqft: null,
        lotSqft: null,
        zoning: { status: "unresolved", district: null, zoneType: null, pdNum: null, pmdSubArea: null },
      }),
    ];
    const { ranked, scored } = engine(rows, criteria());
    expect(scored).toBe(false);
    expect(ranked.map((c) => [c.key, c.recordCompletenessScore])).toEqual([
      ["full", 4],
      ["no-pin", 3],
      ["no-zoning", 3],
      ["no-area", 2],
      ["bare", 0],
    ]);
  });

  it("UNSCORED order (ii), ADVERSARIAL criteria-independence: flipping ANY non-scoring criterion — or all of them at once — leaves the unscored order byte-identical", () => {
    const rows = [
      row({
        canonicalKey: "full",
        pin: "1",
        buildingSqft: 4000,
        zoning: { status: "resolved", district: "B3-2", zoneType: 1, pdNum: null, pmdSubArea: null },
      }),
      row({
        canonicalKey: "partial",
        pin: "2",
        buildingSqft: null,
        lotSqft: null,
        zoning: { status: "resolved", district: "RS-3", zoneType: 4, pdNum: null, pmdSubArea: null },
      }),
      row({
        canonicalKey: "bare",
        pin: null,
        buildingSqft: null,
        lotSqft: null,
        zoning: { status: "unresolved", district: null, zoneType: null, pdNum: null, pmdSubArea: null },
      }),
    ];
    const baseline = engine(rows, criteria());
    const baselineOrder = baseline.ranked.map((c) => [c.key, c.recordCompletenessScore]);
    expect(baselineOrder.map(([key]) => key)).toEqual(["full", "partial", "bare"]); // sanity: genuinely distinct scores

    // Every individual non-scoring (unsupported/display-only) criterion,
    // flipped ONE AT A TIME.
    for (const id of nonScoringEntries.map((e) => e.id)) {
      const withOneCriterion = engine(rows, NON_SCORING_MUTATORS[id](criteria()));
      expect(withOneCriterion.ranked.map((c) => [c.key, c.recordCompletenessScore])).toEqual(baselineOrder);
    }

    // The strongest adversarial flip: EVERY unsupported/display-only
    // criterion selected simultaneously.
    const everythingFlipped = nonScoringEntries.reduce(
      (acc, entry) => NON_SCORING_MUTATORS[entry.id](acc),
      criteria(),
    );
    const withEverythingFlipped = engine(rows, everythingFlipped);
    expect(withEverythingFlipped.ranked.map((c) => [c.key, c.recordCompletenessScore])).toEqual(baselineOrder);
  });

  it("does not reward, render, or screen a source sentinel zero as measured area", () => {
    const zero = row({
      canonicalKey: "a-zero",
      pin: null,
      buildingSqft: 0,
      lotSqft: 0,
      zoning: { status: "unresolved", district: null, zoneType: null, pdNum: null, pmdSubArea: null },
    });
    const measured = row({
      canonicalKey: "z-measured",
      pin: null,
      buildingSqft: 0.25,
      lotSqft: null,
      zoning: { status: "unresolved", district: null, zoneType: null, pdNum: null, pmdSubArea: null },
    });

    const unscored = engine([zero, measured], criteria({ propertyType: "either" }));
    expect(unscored.ranked.map((candidate) => [candidate.key, candidate.recordCompletenessScore])).toEqual([
      ["z-measured", 2],
      ["a-zero", 0],
    ]);
    expect(unscored.ranked.find((candidate) => candidate.key === "a-zero")?.buildingSqft).toBeNull();
    expect(unscored.ranked.find((candidate) => candidate.key === "a-zero")?.lotSqft).toBeNull();

    const screened = engine(
      [zero, measured],
      criteria({ propertyType: "existing-building", minSquareFeet: 0.1 }),
    );
    expect(screened.ranked.map((candidate) => candidate.key)).toEqual(["z-measured"]);
  });

  it("UNSCORED order (round 4, finding 13): conflicted rows with building-only vs land-only measurements keep IDENTICAL order and completeness scores across building, land, and either briefs", () => {
    // Both rows carry BOTH evidence types (conflicted), so they survive any
    // property-type screen. One measures only its building, the other only
    // its lot. Before the round-4 fix, completeness read the measurement
    // through the REQUESTED property type, so flipping the brief reversed
    // their order. Now ANY measured area counts, request-independently.
    const conflicted = (overrides: Partial<ShortlistUniverseRow>) =>
      row({
        evidenceTypes: ["city_land", "311_building"],
        hasVacantLandEvidence: true,
        hasVacantBuildingEvidence: true,
        conflictingPropertyTypes: true,
        pin: null,
        zoning: { status: "unresolved", district: null, zoneType: null, pdNum: null, pmdSubArea: null },
        ...overrides,
      });
    const buildingMeasured = conflicted({
      canonicalKey: "addr:building-measured",
      buildingSqft: 4000,
      lotSqft: null,
      lotSqftSource: null,
    });
    const landMeasured = conflicted({
      canonicalKey: "addr:land-measured",
      buildingSqft: null,
      buildingSqftSource: null,
      lotSqft: 6000,
    });
    const rows = [landMeasured, buildingMeasured];

    const briefs = ["existing-building", "vacant-land", "either"] as const;
    const results = briefs.map((propertyType) =>
      engine(rows, criteria({ propertyType })).ranked.map((c) => [c.key, c.recordCompletenessScore]),
    );
    // Same measuredArea weight for both rows under every brief -> tie ->
    // canonicalKey ascending decides, identically, everywhere.
    for (const order of results) {
      expect(order).toEqual([
        ["addr:building-measured", RECORD_COMPLETENESS_WEIGHTS.measuredArea],
        ["addr:land-measured", RECORD_COMPLETENESS_WEIGHTS.measuredArea],
      ]);
    }
  });

  it("SCORED path (iii) is untouched by record completeness: with a transit network active, order follows score ONLY, even when completeness would reverse it", () => {
    // "sparse": zero record completeness (no pin, no measured area,
    // unresolved zoning) but placed RIGHT AT a CTA station — high transit
    // score.
    const sparse = row({
      canonicalKey: "sparse",
      pin: null,
      buildingSqft: null,
      lotSqft: null,
      zoning: { status: "unresolved", district: null, zoneType: null, pdNum: null, pmdSubArea: null },
      lat: CTA_NEAR.lat,
      lon: CTA_NEAR.lon,
    });
    // "dense": maximum record completeness (pin, measured area, resolved
    // zoning) but placed far outside the transit-score horizon — zero
    // transit score.
    const dense = row({
      canonicalKey: "dense",
      pin: "9",
      buildingSqft: 4000,
      zoning: { status: "resolved", district: "B3-2", zoneType: 1, pdNum: null, pmdSubArea: null },
      lat: BASE_LAT + 0.5,
      lon: BASE_LON,
    });
    const { ranked, scored } = engine([sparse, dense], criteria({ transportation: ["cta-rail"] }), [CTA_NEAR]);
    expect(scored).toBe(true);
    expect(ranked.map((c) => c.recordCompletenessScore)).toEqual([0, 4]); // sparse first, dense second
    // If completeness had ANY influence on the scored comparator, "dense"
    // (completeness 4) would outrank "sparse" (completeness 0) despite
    // scoring zero on transit — it does not.
    expect(ranked[0].key).toBe("sparse");
    expect(ranked[0].score).toBeGreaterThan(0);
    expect(ranked[1].key).toBe("dense");
    expect(ranked[1].score).toBe(0);
  });

  // ── Funnel ──────────────────────────────────────────────────────────────

  it("funnel: trackedEvidence (raw) is genuinely distinct from canonicalSites (deduped) — Finding 6", () => {
    const rows = [row({ canonicalKey: "a" }), row({ canonicalKey: "b", pin: "2", address: "2 A ST" })];
    const { funnel } = runShortlistEngine({
      rows,
      criteria: criteria(),
      stations: [],
      sourceRecordsByEvidenceType: { city_land: 0, "311_building": 9, "311_land": 0, assessor_vacant_land: 0 },
    });
    expect(funnel.trackedEvidence).toBe(9); // raw pre-dedup count from the envelope
    expect(funnel.canonicalSites).toBe(2); // post-dedup row count
    expect(funnel.trackedEvidence).not.toBe(funnel.canonicalSites);
  });

  it("funnel: withMeasuredArea is diagnostic only and does not gate insideBand when no band is set", () => {
    const rows = [
      row({ canonicalKey: "measured", buildingSqft: 4000 }),
      row({ canonicalKey: "unmeasured", buildingSqft: null, lotSqft: null }),
    ];
    const { funnel } = engine(rows, criteria());
    expect(funnel.canonicalSites).toBe(2);
    expect(funnel.withMeasuredArea).toBe(1);
    // No band set -> BOTH rows survive to insideBand, exceeding withMeasuredArea.
    expect(funnel.insideBand).toBe(2);
  });

  it("funnel: insideBand narrows to the measured row once a band IS set", () => {
    const rows = [
      row({ canonicalKey: "measured", buildingSqft: 4000 }),
      row({ canonicalKey: "unmeasured", buildingSqft: null, lotSqft: null }),
    ];
    const { funnel } = engine(rows, criteria({ minSquareFeet: 1000 }));
    expect(funnel.insideBand).toBe(1);
  });

  it("funnel's final stage always equals the ranked list length", () => {
    const rows = [row({ canonicalKey: "a" }), row({ canonicalKey: "b", pin: "9", address: "9 S X ST" })];
    const { ranked, funnel } = engine(rows, criteria());
    expect(funnel.survivingTransitScreen).toBe(ranked.length);
  });
});

// ── Display-fact decoration (Finding 11) ─────────────────────────────────────

describe("decorateShortlistDisplayFacts", () => {
  function baseCandidate(overrides: Partial<RankedShortlistCandidate> = {}): RankedShortlistCandidate {
    return {
      key: "a",
      address: "8000 S COTTAGE GROVE AVE",
      pin: "1",
      lat: BASE_LAT,
      lon: BASE_LON,
      propertyType: "vacant_building",
      screenedPropertyType: "vacant_building",
      buildingSqft: 4000,
      lotSqft: null,
      zoningDistrict: "B3-2",
      zoningStatus: "resolved",
      badge: "aligned",
      badgeNote: "note",
      ownerLabel: "label",
      incentiveCount: 0,
      saleYear: null,
      violation: false,
      conflictingPropertyTypes: false,
      overlays: noOverlays(),
      transitScore: null,
      score: 0,
      recordCompletenessScore: 4,
      ...overrides,
    };
  }

  it("adds nearestRailDisplay only when no transit network is active", () => {
    const [withoutNetwork] = decorateShortlistDisplayFacts([baseCandidate()], { stations: STATIONS, network: null });
    expect(withoutNetwork.nearestRailDisplay).not.toBeNull();

    const network = selectedTransitNetwork(criteria({ transportation: ["cta-rail"] }), STATIONS);
    const [withNetwork] = decorateShortlistDisplayFacts([baseCandidate()], { stations: STATIONS, network });
    expect(withNetwork.nearestRailDisplay).toBeNull();
  });

  it("adds nearest school/library facts from the supplied points, and null when none supplied", () => {
    const [decorated] = decorateShortlistDisplayFacts([baseCandidate()], {
      stations: [],
      network: null,
      schoolPoints: [{ name: "Barnard", lat: BASE_LAT, lon: BASE_LON }],
      libraryPoints: [],
    });
    expect(decorated.nearestSchool?.name).toBe("Barnard");
    expect(decorated.nearestLibrary).toBeNull();
  });

  it("adds the expressway fact by contextKey, honest null when the key has no entry", () => {
    const map = new Map([["pin:1", { name: "Dan Ryan Expy (I-90/94)", miles: 0.3 }]]);
    const [decorated] = decorateShortlistDisplayFacts([baseCandidate({ pin: "1" })], {
      stations: [],
      network: null,
      expresswayContextByKey: map,
    });
    expect(decorated.expresswayDisplay?.miles).toBe(0.3);

    const [noMatch] = decorateShortlistDisplayFacts([baseCandidate({ pin: "999" })], {
      stations: [],
      network: null,
      expresswayContextByKey: map,
    });
    expect(noMatch.expresswayDisplay).toBeNull();
  });

  it("preserves every core field unchanged — decoration only ADDS fields, never mutates ranking-relevant ones", () => {
    const base = baseCandidate();
    const [decorated] = decorateShortlistDisplayFacts([base], { stations: [], network: null });
    const { nearestRailDisplay: _a, expresswayDisplay: _b, nearestSchool: _c, nearestLibrary: _d, ...core } = decorated;
    expect(core).toEqual(base);
  });

  // ── Performance guard (Finding 11) ────────────────────────────────────

  it("PERFORMANCE GUARD: decoration cost scales with the DECORATED count, not the full screened universe — 20 candidates against thousands of amenity points stays fast", () => {
    const manyCandidates = Array.from({ length: SHORTLIST_TOP_N }, (_, i) => baseCandidate({ key: `k-${i}`, pin: String(i) }));
    const manySchools = Array.from({ length: 5000 }, (_, i) => ({ name: `School ${i}`, lat: BASE_LAT + i * 0.0001, lon: BASE_LON }));
    const manyLibraries = Array.from({ length: 5000 }, (_, i) => ({ name: `Library ${i}`, lat: BASE_LAT + i * 0.0001, lon: BASE_LON }));

    const start = performance.now();
    decorateShortlistDisplayFacts(manyCandidates, {
      stations: STATIONS,
      network: null,
      schoolPoints: manySchools,
      libraryPoints: manyLibraries,
    });
    const elapsedMs = performance.now() - start;
    // Generous budget (this is 20 candidates x 10,000 points = 200,000
    // distance calcs — should be single-digit ms in practice). Catches a
    // regression that reintroduces an O(rows) pass, not micro-timing noise.
    expect(elapsedMs).toBeLessThan(500);
  });

  it("PERFORMANCE GUARD: the core engine pass (screen + score + order) over the largest committed ZIP's row count completes quickly with zero amenity geometry", () => {
    const manyRows = Array.from({ length: 6500 }, (_, i) =>
      row({ canonicalKey: `k-${i}`, pin: String(i), address: `${i} S ASHLAND AVE`, lat: BASE_LAT + (i % 100) * 0.0003, lon: BASE_LON }),
    );
    const start = performance.now();
    engine(manyRows, criteria({ transportation: ["cta-rail"], transportationDistance: "half-mile" }), STATIONS);
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(500);
  });
});

describe("page wiring: slice happens BEFORE decoration (Finding 11)", () => {
  it("app/vacancy/[zip]/shortlist/page.tsx slices to SHORTLIST_TOP_N before calling decorateShortlistDisplayFacts", () => {
    const source = readFileSync(
      path.join(process.cwd(), "app/vacancy/[zip]/shortlist/page.tsx"),
      "utf8",
    );
    const sliceIndex = source.indexOf("allRanked.slice(0, SHORTLIST_TOP_N)");
    const decorateCallIndex = source.indexOf("decorateShortlistDisplayFacts(");
    expect(sliceIndex).toBeGreaterThan(-1);
    expect(decorateCallIndex).toBeGreaterThan(-1);
    // The slice must appear as an ARGUMENT to decorateShortlistDisplayFacts —
    // i.e. textually between the call's opening paren and its first line —
    // not merely "somewhere earlier in the file."
    expect(sliceIndex).toBeGreaterThan(decorateCallIndex);
    expect(sliceIndex).toBeLessThan(source.indexOf(")", decorateCallIndex) + 200);
  });
});

// ── Exhaustive oracle: brute-force membership + INDEPENDENT expected-score
//    order (Finding 10: not merely engine-derived) ────────────────────────

describe("exhaustive oracle — brute-force winner-set parity + independent score oracle", () => {
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

      // Independently resolve the screening area from the REQUESTED type
      // (Finding 3) — mirrors the fix, but re-derived rather than calling
      // screeningAreaSqft.
      let area: number | null;
      if (request.propertyType === "existing-building") area = candidate.buildingSqft;
      else if (request.propertyType === "vacant-land") area = candidate.lotSqft;
      else area = candidate.hasVacantBuildingEvidence ? (candidate.buildingSqft ?? candidate.lotSqft) : candidate.lotSqft;

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

  /** Independent expected-score computation — re-derives the transit-score
   *  formula from scratch (1600m horizon, 40pt weight) rather than calling
   *  transitScoreFor, so this is a genuine second implementation the engine
   *  is checked AGAINST, not merely self-consistency of the engine's own
   *  output (Finding 10). */
  function independentExpectedScore(
    candidateRow: ShortlistUniverseRow,
    request: SiteMatchCriteria,
    stations: readonly ShortlistStation[],
  ): number {
    const wantsCta = request.transportation.includes("cta-rail");
    const wantsMetra = request.transportation.includes("metra");
    if (!wantsCta && !wantsMetra) return 0;
    if (candidateRow.lat == null || candidateRow.lon == null) return 0;
    const subset = stations.filter(
      (s) => (wantsCta && s.system.toUpperCase().startsWith("CTA")) || (wantsMetra && s.system.toUpperCase().startsWith("METRA")),
    );
    if (subset.length === 0) return 0;
    let nearestMeters = Infinity;
    for (const station of subset) {
      const dx = (station.lon - candidateRow.lon) * Math.cos((candidateRow.lat * Math.PI) / 180) * 111_320;
      const dy = (station.lat - candidateRow.lat) * 110_540;
      // Round PER STATION to whole metres before comparing — mirrors
      // lib/site-shortlist.ts's nearestStation exactly (it rounds each
      // station's distance individually, then keeps the smallest rounded
      // value), so this independent oracle cannot drift by a rounding
      // half-step from the real pipeline it is checking.
      nearestMeters = Math.min(nearestMeters, Math.round(Math.hypot(dx, dy)));
    }
    const HORIZON = 1600;
    const WEIGHT = 40;
    const points = (Math.max(0, HORIZON - nearestMeters) / HORIZON) * WEIGHT;
    return Math.round(points * 100) / 100;
  }

  const scenarios: { label: string; request: SiteMatchCriteria; stations: ShortlistStation[] }[] = [
    { label: "building search, no band, no transit", request: criteria(), stations: [] },
    { label: "building search with a size band", request: criteria({ minSquareFeet: 3500, maxSquareFeet: 5000 }), stations: [] },
    { label: "land search", request: criteria({ propertyType: "vacant-land" }), stations: [] },
    { label: "either, no filters", request: criteria({ propertyType: "either" }), stations: [] },
    {
      label: "building search screened AND scored on CTA rail within a quarter mile",
      request: criteria({ transportation: ["cta-rail"], transportationDistance: "quarter-mile" }),
      stations: STATIONS,
    },
    {
      label: "either, scored on CTA rail with no distance screen",
      request: criteria({ propertyType: "either", transportation: ["cta-rail"] }),
      stations: STATIONS,
    },
  ];

  it.each(scenarios)("winner-set parity: $label", ({ request, stations }) => {
    const oracleKeys = bruteForceSurvivingKeys(fixtureRows, request, stations);
    const { ranked } = engine(fixtureRows, request, stations);
    const engineKeys = new Set(ranked.map((c) => c.key));
    expect(engineKeys).toEqual(oracleKeys);
  });

  it.each(scenarios)("independent expected-score oracle: $label", ({ request, stations }) => {
    const { ranked } = engine(fixtureRows, request, stations);
    for (const candidate of ranked) {
      const sourceRow = fixtureRows.find((r) => r.canonicalKey === candidate.key)!;
      const expected = independentExpectedScore(sourceRow, request, stations);
      expect(candidate.score).toBe(expected);
    }
  });

  it("order contract, SCORED path: scores are non-increasing and ties break by canonicalKey ascending", () => {
    const { ranked, scored } = engine(
      fixtureRows,
      criteria({ propertyType: "either", transportation: ["cta-rail"] }),
      STATIONS,
    );
    expect(scored).toBe(true);
    for (let i = 1; i < ranked.length; i++) {
      const prev = ranked[i - 1];
      const curr = ranked[i];
      expect(prev.score).toBeGreaterThanOrEqual(curr.score);
      if (prev.score === curr.score) {
        expect(prev.key < curr.key).toBe(true);
      }
    }
  });

  // Finding 13 (round 3): the UNSCORED path no longer orders on a bare
  // canonicalKey shuffle — it orders on recordCompletenessScore, tiebreaking
  // on canonicalKey only when completeness itself ties.
  it("order contract, UNSCORED path: recordCompletenessScore is non-increasing and ties break by canonicalKey ascending", () => {
    const { ranked, scored } = engine(fixtureRows, criteria({ propertyType: "either" }), STATIONS);
    expect(scored).toBe(false);
    for (let i = 1; i < ranked.length; i++) {
      const prev = ranked[i - 1];
      const curr = ranked[i];
      expect(prev.recordCompletenessScore).toBeGreaterThanOrEqual(curr.recordCompletenessScore);
      if (prev.recordCompletenessScore === curr.recordCompletenessScore) {
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

  const universe = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    rows: ShortlistUniverseRow[];
    counts: { sourceRecordsByEvidenceType: Record<string, number> };
  };

  it("carries a nonzero count of canonical building sites — never a bare zero", () => {
    const buildingRows = universe.rows.filter((r) => r.hasVacantBuildingEvidence);
    expect(buildingRows.length).toBeGreaterThan(0);
  });

  it("the RAW tracked-evidence count and the DEDUPED canonical count are genuinely different, exact values (Finding 6)", () => {
    const { funnel } = runShortlistEngine({
      rows: universe.rows,
      criteria: criteria({ zip: "60621", propertyType: "existing-building" }),
      stations: [],
      sourceRecordsByEvidenceType: universe.counts.sourceRecordsByEvidenceType as never,
    });
    // Exact values from the committed export (regenerated in this PR):
    // raw 311_building records = 685; deduped canonical building sites = 645.
    expect(funnel.trackedEvidence).toBe(685);
    expect(funnel.canonicalSites).toBe(645);
    expect(funnel.trackedEvidence).toBeGreaterThan(funnel.canonicalSites);
  });

  it("running the full engine (no PIN/measurement requirement) surfaces real ranked candidates, not just an honest funnel", () => {
    const { ranked } = runShortlistEngine({
      rows: universe.rows,
      criteria: criteria({ zip: "60621", propertyType: "existing-building" }),
      stations: [],
      sourceRecordsByEvidenceType: universe.counts.sourceRecordsByEvidenceType as never,
    });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.length).toBe(645);
  });

  // ── Finding 6, round 3: the BUILDING search's own exact successive stage
  //    counts — Sol's round-2 re-review specifically flagged that switching
  //    to a land search for the "exact successive counts" test dodged the
  //    actual regression case: 60621's BUILDING search, not its land
  //    search, is the canonical false-zero scenario this entire PR exists
  //    for. This test pins that scenario's real numbers directly.
  //
  //  A HONEST NOTE ON WHAT "NARROWING" MEANS HERE, because the real data
  //  makes a naive "every single stage strictly smaller than the last"
  //  claim FALSE, and asserting it anyway would be exactly the kind of
  //  invented precision this PR was built to eliminate:
  //   - trackedEvidence(685) -> canonicalSites(645): a REAL, strict
  //     narrowing (dedup).
  //   - canonicalSites(645) -> withResolvedPin(0): a REAL, strict
  //     narrowing — and the steepest one in this chain.
  //   - withResolvedPin(0) -> withMeasuredArea(0): NOT a narrowing, an
  //     EXACT TIE at zero. This is not a test weakness — it is the precise,
  //     accurately-reported fact that makes 60621's building search THE
  //     false-zero regression case: every single 311_building complaint
  //     record in this ZIP carries neither a resolved PIN nor a published
  //     measurement. Asserting anything other than 0/0 here would misstate
  //     the real data this test exists to pin.
  //   - withMeasuredArea(0) -> insideBand(645): an INCREASE, by contract —
  //     see the funnel's own documented rule (and its dedicated test above)
  //     that insideBand equals canonicalSites, unconstrained, whenever NO
  //     size band is selected; a band CANNOT be selected in this scenario
  //     without instantly zeroing every single row (since zero rows carry
  //     any measurement at all) — which would make the funnel's FINAL,
  //     real screening stage a degenerate, uninformative 0/0, defeating the
  //     entire point of pinning a genuine narrowing chain. Leaving the band
  //     unset — the same choice the false-zero fix itself depends on — is
  //     what keeps the building search meaningful at all.
  //   - insideBand(645) -> survivingTransitScreen(468): a REAL, strict
  //     narrowing, via a transit screen (the one screen that CAN apply
  //     here, since every row still carries real coordinates even without
  //     PIN/measurement).
  it("EXACT successive 60621 funnel stage counts for the BUILDING search (the canonical false-zero regression case) — every REAL screening stage narrows strictly; the two diagnostic-only stages tie at the exact, honestly-reported zero this ZIP's data actually has (Finding 6, round 3)", () => {
    const centroidStation: ShortlistStation = {
      name: "Test Centroid Stop",
      system: "CTA",
      lat: 41.7779,
      lon: -87.6421,
    };
    const { funnel, ranked, scored } = runShortlistEngine({
      rows: universe.rows,
      criteria: criteria({
        zip: "60621",
        propertyType: "existing-building",
        // Deliberately NO size band — see the comment above for why one
        // would collapse this specific scenario to a degenerate 0/0.
        transportation: ["cta-rail"],
        transportationDistance: "one-mile",
      }),
      stations: [centroidStation],
      sourceRecordsByEvidenceType: universe.counts.sourceRecordsByEvidenceType as never,
    });

    // Exact values from the committed 60621 export (regenerated in this PR).
    expect(funnel.trackedEvidence).toBe(685);
    expect(funnel.canonicalSites).toBe(645);
    expect(funnel.withResolvedPin).toBe(0);
    expect(funnel.withMeasuredArea).toBe(0);
    expect(funnel.insideBand).toBe(645);
    expect(funnel.survivingTransitScreen).toBe(468);

    // The REAL screening stages narrow strictly, pairwise.
    expect(funnel.trackedEvidence).toBeGreaterThan(funnel.canonicalSites);
    expect(funnel.canonicalSites).toBeGreaterThan(funnel.withResolvedPin);
    expect(funnel.insideBand).toBeGreaterThan(funnel.survivingTransitScreen);
    // The two diagnostic-only stages are an EXACT, documented tie — not a
    // silent gap in this test's coverage.
    expect(funnel.withResolvedPin).toBe(funnel.withMeasuredArea);
    // withMeasuredArea -> insideBand is a documented INCREASE (no band set,
    // per the funnel's own contract), never mistaken for a narrowing step.
    expect(funnel.insideBand).toBeGreaterThan(funnel.withMeasuredArea);
    expect(funnel.insideBand).toBe(funnel.canonicalSites); // unconstrained: no band selected

    expect(ranked.length).toBe(468);
    expect(funnel.survivingTransitScreen).toBe(ranked.length);
    expect(scored).toBe(true);
  });

  // ── Finding 6 (re-review): EXACT successive stage counts, a genuine ───────
  //    narrowing CHAIN — not four independent diagnostics that happen to
  //    share one funnel object. The pre-fix test only proved
  //    trackedEvidence != canonicalSites; it said nothing about whether
  //    withResolvedPin / withMeasuredArea / insideBand /
  //    survivingTransitScreen actually narrow each other in sequence on
  //    real data. This second scenario runs a LAND search — 60621's LAND
  //    evidence, unlike its building evidence, genuinely DOES carry PINs
  //    and some measurements, so it is the scenario that can show every
  //    single stage narrowing strictly, with no ties anywhere — kept here
  //    as the complementary case to the building search above, per Sol's
  //    round-3 direction to keep both.
  it("EXACT successive 60621 funnel stage counts for a land search with a band AND a transit screen — PIN -> measurement -> band -> transit as a genuine narrowing chain, no ties anywhere (Finding 6)", () => {
    // A synthetic CTA station placed at the ZIP's real geographic centroid
    // (computed from the committed export's own lat/lon range) — not the
    // real committed rail-stations.ts file, so this scenario's exact
    // numbers depend only on the committed universe data and this test's
    // own station placement, never on an unrelated future edit to the rail
    // roster shifting a station's coordinates.
    const centroidStation: ShortlistStation = {
      name: "Test Centroid Stop",
      system: "CTA",
      lat: 41.7779,
      lon: -87.6421,
    };
    const { funnel, ranked, scored } = runShortlistEngine({
      rows: universe.rows,
      criteria: criteria({
        zip: "60621",
        propertyType: "vacant-land",
        minSquareFeet: 1000,
        transportation: ["cta-rail"],
        transportationDistance: "one-mile",
      }),
      stations: [centroidStation],
      sourceRecordsByEvidenceType: universe.counts.sourceRecordsByEvidenceType as never,
    });

    // Exact values from the committed 60621 export (regenerated in this
    // PR) for this exact scenario. Each assertion below is a DIFFERENT
    // number from the one before it — a real chain, not a repeated total
    // under five labels.
    expect(funnel.trackedEvidence).toBe(6116);
    expect(funnel.canonicalSites).toBe(5722); // land evidence, deduped
    expect(funnel.withResolvedPin).toBe(4864); // PIN stage (diagnostic)
    expect(funnel.withMeasuredArea).toBe(287); // measurement stage (diagnostic)
    expect(funnel.insideBand).toBe(285); // band stage — REAL screen
    expect(funnel.survivingTransitScreen).toBe(227); // transit stage — REAL screen, the final stage

    // The chain narrows at every single step — never flat, never reversed.
    expect(funnel.trackedEvidence).toBeGreaterThan(funnel.canonicalSites);
    expect(funnel.canonicalSites).toBeGreaterThan(funnel.withResolvedPin);
    expect(funnel.withResolvedPin).toBeGreaterThan(funnel.withMeasuredArea);
    expect(funnel.withMeasuredArea).toBeGreaterThan(funnel.insideBand);
    expect(funnel.insideBand).toBeGreaterThan(funnel.survivingTransitScreen);

    // The funnel's final stage is exactly the ranked list length, and a
    // real transit network was active (scored, not merely stable order).
    expect(ranked.length).toBe(227);
    expect(funnel.survivingTransitScreen).toBe(ranked.length);
    expect(scored).toBe(true);
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

  const universe = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    rows: ShortlistUniverseRow[];
    counts: { sourceRecordsByEvidenceType: Record<string, number> };
  };

  it("runs the full engine for both property types without throwing, and the funnel's final stage always equals the ranked count", () => {
    for (const propertyType of ["existing-building", "vacant-land", "either"] as const) {
      const { ranked, funnel } = runShortlistEngine({
        rows: universe.rows,
        criteria: criteria({ zip: "60636", propertyType }),
        stations: [],
        sourceRecordsByEvidenceType: universe.counts.sourceRecordsByEvidenceType as never,
      });
      expect(funnel.survivingTransitScreen).toBe(ranked.length);
      expect(funnel.canonicalSites).toBeGreaterThanOrEqual(funnel.insideBand);
    }
  });

  it("exact raw-vs-deduped funnel counts for 60636 building search (Finding 6)", () => {
    const { funnel } = runShortlistEngine({
      rows: universe.rows,
      criteria: criteria({ zip: "60636", propertyType: "existing-building" }),
      stations: [],
      sourceRecordsByEvidenceType: universe.counts.sourceRecordsByEvidenceType as never,
    });
    expect(funnel.trackedEvidence).toBe(842);
    expect(funnel.canonicalSites).toBe(776);
  });

  it("produces a deterministic top-N slice stable across repeated runs", () => {
    const run = () =>
      runShortlistEngine({
        rows: universe.rows,
        criteria: criteria({ zip: "60636", propertyType: "existing-building" }),
        stations: [],
        sourceRecordsByEvidenceType: universe.counts.sourceRecordsByEvidenceType as never,
      }).ranked.slice(0, SHORTLIST_TOP_N).map((c) => c.key);
    expect(run()).toEqual(run());
  });
});
