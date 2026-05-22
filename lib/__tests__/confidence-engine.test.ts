import { describe, it, expect } from "vitest";
import {
  runConfidenceEngine,
  computeTopActions,
  isStaleProgramData,
} from "../confidence-engine";
import { encodeCheckState, decodeCheckState } from "../url-state";
import type { Program, SurveyAnswers } from "../types";

/* ── Test fixtures ────────────────────────── */

function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: "test-program",
    name: "Test Program",
    level: "City",
    zoneKey: "tif",
    summary: "A test program",
    whoQualifies: "Anyone",
    benefits: ["Tax break"],
    howToApply: ["Apply online"],
    requiredDocs: ["ID"],
    contact: "test@test.com",
    url: "https://test.com",
    contacts: [
      {
        agency: "Test Agency",
        abbreviation: "TA",
        phone: "312-555-0000",
      },
    ],
    eligibilityRules: [
      {
        criterion: "location",
        description: "Must be in a TIF district",
        verifiedBy: "location",
        required: true,
      },
    ],
    lastVerifiedAt: new Date().toISOString(),
    benefitRange: "$10K-$50K",
    fastestConfirmingStep: "Call 312-555-0000",
    ...overrides,
  };
}

const ZONES_MATCH: Record<string, boolean> = { tif: true, ssa: true };
const ZONES_NO_MATCH: Record<string, boolean> = { ssa: true };
const ZONE_NAMES: Record<string, string> = {
  tif: "Stony Island TIF",
  ssa: "Calumet Heights SSA",
};

/* ── runConfidenceEngine tests ────────────── */

describe("runConfidenceEngine", () => {
  it("returns location_eligible when location matches and no survey", () => {
    const programs = [makeProgram()];
    const results = runConfidenceEngine(programs, ZONES_MATCH, ZONE_NAMES);
    // Staleness may downgrade if lastVerifiedAt is current → should be location_eligible or may_qualify
    // Since we set lastVerifiedAt to now(), no staleness
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe("location_eligible");
  });

  it("returns appears_eligible with location match + confirming survey", () => {
    const programs = [
      makeProgram({
        eligibilityRules: [
          { criterion: "location", description: "In TIF", verifiedBy: "location", required: true },
          { criterion: "industry", description: "Any industry", verifiedBy: "survey", required: false },
        ],
      }),
    ];
    const survey: SurveyAnswers = { industry: "retail" };
    const results = runConfidenceEngine(programs, ZONES_MATCH, ZONE_NAMES, survey);
    expect(results[0].confidence).toBe("appears_eligible");
  });

  it("returns not_applicable when location required but no match", () => {
    const programs = [makeProgram()];
    const results = runConfidenceEngine(programs, ZONES_NO_MATCH, ZONE_NAMES);
    expect(results[0].confidence).toBe("not_applicable");
  });

  it("returns worth_exploring for no zone requirement and no survey", () => {
    const programs = [
      makeProgram({
        id: "county-prog",
        zoneKey: "",
        eligibilityRules: [],
      }),
    ];
    const results = runConfidenceEngine(programs, {}, ZONE_NAMES);
    expect(results[0].confidence).toBe("worth_exploring");
    expect(results[0].whyOneLine).toContain("Available to businesses in Cook County");
    expect(results[0].whyOneLine).not.toContain("qualifying zone");
  });

  it("returns may_qualify for partial survey with location match", () => {
    const programs = [
      makeProgram({
        eligibilityRules: [
          { criterion: "location", description: "In TIF", verifiedBy: "location", required: true },
          { criterion: "propertyType", description: "Own property", verifiedBy: "survey", required: false },
        ],
      }),
    ];
    // Survey has industry but not property — the property rule won't match
    const survey: SurveyAnswers = { industry: "retail" };
    const results = runConfidenceEngine(programs, ZONES_MATCH, ZONE_NAMES, survey);
    expect(results[0].confidence).toBe("may_qualify");
  });

  it("downgrades confidence for stale program (>6mo)", () => {
    const staleDate = new Date();
    staleDate.setMonth(staleDate.getMonth() - 8);
    const programs = [
      makeProgram({ lastVerifiedAt: staleDate.toISOString() }),
    ];
    const results = runConfidenceEngine(programs, ZONES_MATCH, ZONE_NAMES);
    // Would be location_eligible, but staleness downgrades to may_qualify
    expect(results[0].confidence).toBe("may_qualify");
    expect(results[0].whyOneLine).toContain("data not recently verified");
  });

  it("handles empty programs array", () => {
    const results = runConfidenceEngine([], {}, {});
    expect(results).toEqual([]);
  });

  it("sorts results by confidence (most confident first)", () => {
    const programs = [
      makeProgram({ id: "a", zoneKey: "ssa" }),  // not_applicable (ssa not in zones for this test)
      makeProgram({ id: "b", zoneKey: "tif" }),  // location_eligible (tif matches)
    ];
    // Only tif matches — a should be not_applicable, b should be location_eligible
    const results = runConfidenceEngine(programs, { tif: true }, ZONE_NAMES);
    const ids = results.map((r) => r.programId);
    // b (location_eligible) should come before a (not_applicable)
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("a"));
  });
});

/* ── computeTopActions tests ──────────────── */

describe("computeTopActions", () => {
  it("returns max 3 actions", () => {
    const programs = Array.from({ length: 5 }, (_, i) =>
      makeProgram({ id: `prog-${i}`, name: `Program ${i}` })
    );
    const results = runConfidenceEngine(programs, ZONES_MATCH, ZONE_NAMES);
    const actions = computeTopActions(results);
    expect(actions.length).toBeLessThanOrEqual(3);
  });

  it("includes low-regret book advising fallback", () => {
    const programs = [
      makeProgram({ id: "tif-main" }),
      makeProgram({
        id: "smallBizSource",
        name: "Small Business Source",
        zoneKey: "",
        eligibilityRules: [],
        contacts: [{ agency: "SBS", abbreviation: "SBS", phone: "312-555-1234" }],
      }),
    ];
    const results = runConfidenceEngine(programs, ZONES_MATCH, ZONE_NAMES);
    const actions = computeTopActions(results);
    const hasBook = actions.some((a) => a.type === "book");
    expect(hasBook).toBe(true);
  });

  it("prioritizes highest-confidence programs", () => {
    const programs = [
      makeProgram({ id: "eligible-prog", zoneKey: "tif" }),
      makeProgram({ id: "exploring-prog", zoneKey: "", eligibilityRules: [] }),
    ];
    const results = runConfidenceEngine(programs, ZONES_MATCH, ZONE_NAMES);
    const actions = computeTopActions(results);
    if (actions.length > 0 && actions[0].type === "call") {
      expect(actions[0].programId).toBe("eligible-prog");
    }
  });
});

/* ── isStaleProgramData tests ─────────────── */

describe("isStaleProgramData", () => {
  it("returns true when lastVerifiedAt is null", () => {
    expect(isStaleProgramData(makeProgram({ lastVerifiedAt: null }))).toBe(true);
  });

  it("returns true when lastVerifiedAt is undefined", () => {
    expect(isStaleProgramData(makeProgram({ lastVerifiedAt: undefined }))).toBe(true);
  });

  it("returns false when recently verified", () => {
    expect(isStaleProgramData(makeProgram({ lastVerifiedAt: new Date().toISOString() }))).toBe(false);
  });

  it("returns true when older than 6 months", () => {
    const old = new Date();
    old.setMonth(old.getMonth() - 7);
    expect(isStaleProgramData(makeProgram({ lastVerifiedAt: old.toISOString() }))).toBe(true);
  });
});

/* ── URL state roundtrip tests ────────────── */

describe("URL state roundtrip", () => {
  it("encodeCheckState → decodeCheckState preserves all fields", () => {
    const state = {
      lat: 41.74432,
      lon: -87.57735,
      address: "8751 S Houston Ave",
      sector: "manufacturing",
      surveyAnswers: { industry: "manufacturing", property: "own" } as SurveyAnswers,
    };
    const encoded = encodeCheckState(state);
    const params = new URLSearchParams(encoded);
    const decoded = decodeCheckState(params);

    expect(decoded).not.toBeNull();
    expect(decoded!.lat).toBeCloseTo(state.lat, 4);
    expect(decoded!.lon).toBeCloseTo(state.lon, 4);
    expect(decoded!.address).toBe(state.address);
    expect(decoded!.sector).toBe(state.sector);
    expect(decoded!.surveyAnswers).toEqual(state.surveyAnswers);
  });

  it("includes v=1 in encoded URL", () => {
    const state = { lat: 41.7, lon: -87.5, address: "test" };
    const encoded = encodeCheckState(state);
    expect(encoded).toContain("v=1");
  });

  it("returns null when lat/lon missing", () => {
    const params = new URLSearchParams({ addr: "123 Main St" });
    expect(decodeCheckState(params)).toBeNull();
  });

  it("gracefully ignores invalid base64 survey", () => {
    const params = new URLSearchParams({
      lat: "41.7",
      lon: "-87.5",
      sa: "not-valid-base64!!!",
    });
    const decoded = decodeCheckState(params);
    expect(decoded).not.toBeNull();
    expect(decoded!.surveyAnswers).toBeUndefined();
  });

  it("decodes URLs without version param (backward compat)", () => {
    const params = new URLSearchParams({
      lat: "41.7",
      lon: "-87.5",
      addr: "test",
    });
    const decoded = decodeCheckState(params);
    expect(decoded).not.toBeNull();
    expect(decoded!.lat).toBeCloseTo(41.7);
  });
});
