import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvestmentPointFeature } from "@/lib/community-investment-layer";
import type { FunderType } from "@/lib/community-investment";
import {
  ARC_WIDTH_MAX,
  ARC_WIDTH_MIN,
  DEFAULT_INVESTMENT_VIEW_MODE,
  DENSITY_COLOR_RANGE,
  DENSITY_RAMP_HEXES,
  densityColorWeight,
  densityRecordWeight,
  densityWeightForMetric,
  INVESTMENT_DENSITY_METRICS,
  INVESTMENT_VIEW_MODES,
  INVESTMENT_VIEW_MODE_STORAGE_KEY,
  makeArcWidthScale,
  buildInvestmentArcData,
  hexToRgbArray,
  indexFunderHqsByName,
  isInvestmentViewMode,
  loadStoredInvestmentViewMode,
  normalizeFunderNameForHqJoin,
  parseFunderHqCsv,
  storeInvestmentViewMode,
  type FunderHq,
} from "@/lib/investment-deck-modes";

/**
 * Pure-helper coverage for the admin view-mode model (components/map). No map is
 * rendered — the deck.gl WebGL layers themselves cannot be verified in a
 * sandboxed pane (see the task caveat), so the STATE + DATA transforms they are
 * fed are what is unit-tested here.
 */

function feature(overrides: {
  id?: string;
  recipient?: string;
  funderName?: string;
  funderType?: FunderType;
  capitalClass?: import("@/lib/community-investment").CapitalClass;
  amountAwarded?: number | null;
  authorizedAmount?: number | null;
  creditAmount?: number | null;
  announcedInvestment?: number | null;
  communityArea?: string;
  lng?: number;
  lat?: number;
}): InvestmentPointFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [overrides.lng ?? -87.6, overrides.lat ?? 41.75] },
    properties: {
      id: overrides.id ?? "f-1",
      recipient: overrides.recipient ?? "Example Recipient",
      funderName: overrides.funderName ?? "Joyce Foundation",
      funderType: overrides.funderType ?? "philanthropic",
      capitalClass: overrides.capitalClass ?? "grant",
      amountAwarded: "amountAwarded" in overrides ? (overrides.amountAwarded ?? null) : 100_000,
      authorizedAmount: overrides.authorizedAmount ?? null,
      creditAmount: overrides.creditAmount ?? null,
      announcedInvestment: overrides.announcedInvestment ?? null,
      communityArea: overrides.communityArea ?? "",
      logLine: null,
      year: 2021,
      status: "awarded",
      sourceLink: "",
    },
  };
}

// ── Mode persistence key ──────────────────────────────────────────────────────

describe("investment view-mode state", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exposes exactly four modes with dots as the default and megaprojects last", () => {
    expect(INVESTMENT_VIEW_MODES).toEqual(["dots", "arcs", "density", "megaprojects"]);
    expect(DEFAULT_INVESTMENT_VIEW_MODE).toBe("dots");
  });

  it("uses a stable, tab-scoped storage key distinct from the toggle key", () => {
    expect(INVESTMENT_VIEW_MODE_STORAGE_KEY).toBe("cie_investment_view_mode");
    expect(INVESTMENT_VIEW_MODE_STORAGE_KEY).not.toBe("cie_community_investment_visible");
  });

  it("guards the mode enum", () => {
    expect(isInvestmentViewMode("arcs")).toBe(true);
    expect(isInvestmentViewMode("density")).toBe(true);
    expect(isInvestmentViewMode("megaprojects")).toBe(true);
    expect(isInvestmentViewMode("heatmap")).toBe(false);
    expect(isInvestmentViewMode(null)).toBe(false);
    expect(isInvestmentViewMode(2)).toBe(false);
  });

  it("returns the default on SSR (no window)", () => {
    expect(loadStoredInvestmentViewMode()).toBe("dots");
  });

  it("round-trips a non-default mode and stores the default as key-removal", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
      },
    });

    storeInvestmentViewMode("arcs");
    expect(store.get(INVESTMENT_VIEW_MODE_STORAGE_KEY)).toBe("arcs");
    expect(loadStoredInvestmentViewMode()).toBe("arcs");

    // The fourth mode round-trips identically (the deep-link mode=megaprojects seam).
    storeInvestmentViewMode("megaprojects");
    expect(store.get(INVESTMENT_VIEW_MODE_STORAGE_KEY)).toBe("megaprojects");
    expect(loadStoredInvestmentViewMode()).toBe("megaprojects");

    // Default is persisted as REMOVAL (mirrors the toggle's "off = removed").
    storeInvestmentViewMode("dots");
    expect(store.has(INVESTMENT_VIEW_MODE_STORAGE_KEY)).toBe(false);
    expect(loadStoredInvestmentViewMode()).toBe("dots");
  });

  it("falls back to the default when the stored value is corrupt", () => {
    const store = new Map<string, string>([[INVESTMENT_VIEW_MODE_STORAGE_KEY, "bogus"]]);
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(loadStoredInvestmentViewMode()).toBe("dots");
  });
});

// ── Funder-HQ CSV parse ───────────────────────────────────────────────────────

describe("parseFunderHqCsv", () => {
  const csv = [
    "foundation,ein,street,city,state,zip,lat,lng",
    "Joyce Foundation,366079185,321 N CLARK,CHICAGO,IL,60654,41.888,-87.631",
    "MacArthur Foundation,237093598,140 S DEARBORN,CHICAGO,IL,60603,41.8798,-87.6294",
    ",000,No name,CHICAGO,IL,60601,41.0,-87.0", // no foundation name → skipped
    "Bad Coords,000,X,CHICAGO,IL,60601,not-a-number,-87.0", // bad lat → skipped
  ].join("\n");

  it("reads foundation/lat/lng by header position and skips unusable rows", () => {
    const hqs = parseFunderHqCsv(csv);
    expect(hqs).toHaveLength(2);
    expect(hqs[0]).toEqual({ foundation: "Joyce Foundation", lat: 41.888, lng: -87.631 });
    expect(hqs.map((h) => h.foundation)).not.toContain("Bad Coords");
  });

  it("returns [] for empty text or a header lacking required columns", () => {
    expect(parseFunderHqCsv("")).toEqual([]);
    expect(parseFunderHqCsv("foundation,ein\nJoyce,1")).toEqual([]);
  });
});

// ── Normalized-name join + hq-missing fallback counting ───────────────────────

describe("funder-name normalization + HQ join", () => {
  it("folds punctuation and casing to one join key", () => {
    expect(normalizeFunderNameForHqJoin("Robert R. McCormick Foundation")).toBe(
      "ROBERT R MCCORMICK FOUNDATION"
    );
    expect(normalizeFunderNameForHqJoin("Robert R McCormick Foundation")).toBe(
      "ROBERT R MCCORMICK FOUNDATION"
    );
    expect(normalizeFunderNameForHqJoin(null)).toBe("");
    expect(normalizeFunderNameForHqJoin("   ")).toBe("");
  });

  const hqs: FunderHq[] = [
    { foundation: "Joyce Foundation", lat: 41.888, lng: -87.631 },
    { foundation: "MacArthur Foundation", lat: 41.8798, lng: -87.6294 },
  ];

  it("joins philanthropic points to their funder HQ by normalized name", () => {
    const index = indexFunderHqsByName(hqs);
    const features = [
      feature({ id: "a", funderName: "Joyce Foundation", lng: -87.6, lat: 41.7 }),
      feature({ id: "b", funderName: "MacArthur Foundation", lng: -87.5, lat: 41.8 }),
    ];
    const { arcs, fallbackFeatures, missingHqCount } = buildInvestmentArcData(features, index);

    expect(arcs).toHaveLength(2);
    expect(fallbackFeatures).toHaveLength(0);
    expect(missingHqCount).toBe(0);
    // Source = HQ, target = recipient point.
    expect(arcs[0].sourcePosition).toEqual([-87.631, 41.888]);
    expect(arcs[0].targetPosition).toEqual([-87.6, 41.7]);
  });

  it("counts philanthropic grants with no HQ row as dot fallbacks", () => {
    const index = indexFunderHqsByName(hqs);
    const features = [
      feature({ id: "matched", funderName: "Joyce Foundation" }),
      feature({ id: "orphan", funderName: "Unmapped Family Fund" }),
      feature({ id: "blank", funderName: "" }),
    ];
    const { arcs, fallbackFeatures, missingHqCount } = buildInvestmentArcData(features, index);

    expect(arcs.map((a) => a.id)).toEqual(["matched"]);
    expect(fallbackFeatures.map((f) => f.properties.id)).toEqual(["orphan", "blank"]);
    expect(missingHqCount).toBe(2);
    expect(missingHqCount).toBe(fallbackFeatures.length);
  });

  it("ignores non-philanthropic records entirely (arcs are philanthropic-only)", () => {
    const index = indexFunderHqsByName(hqs);
    const features = [
      feature({ id: "gov", funderType: "government", funderName: "Joyce Foundation" }),
      feature({ id: "dev", funderType: "private_development", funderName: "Joyce Foundation" }),
      feature({ id: "phil", funderType: "philanthropic", funderName: "Joyce Foundation" }),
    ];
    const { arcs, fallbackFeatures, missingHqCount } = buildInvestmentArcData(features, index);
    expect(arcs.map((a) => a.id)).toEqual(["phil"]);
    expect(fallbackFeatures).toHaveLength(0);
    expect(missingHqCount).toBe(0);
  });
});

// ── Arc width clamp ───────────────────────────────────────────────────────────

describe("makeArcWidthScale", () => {
  it("spreads widths across the actual sqrt-dollar domain", () => {
    const scale = makeArcWidthScale([10_000, 250_000, 1_000_000]);
    expect(scale(10_000)).toBe(ARC_WIDTH_MIN); // domain min -> 1px
    expect(scale(1_000_000)).toBe(ARC_WIDTH_MAX); // domain max -> 8px
    const mid = scale(250_000);
    expect(mid).toBeGreaterThan(ARC_WIDTH_MIN);
    expect(mid).toBeLessThan(ARC_WIDTH_MAX);
  });

  it("degenerate domains render at the midpoint width", () => {
    const single = makeArcWidthScale([500_000]);
    expect(single(500_000)).toBe((ARC_WIDTH_MIN + ARC_WIDTH_MAX) / 2);
    const equal = makeArcWidthScale([75_000, 75_000, 75_000]);
    expect(equal(75_000)).toBe((ARC_WIDTH_MIN + ARC_WIDTH_MAX) / 2);
  });

  it("null/negative amounts count as zero-dollar (domain floor)", () => {
    const scale = makeArcWidthScale([null, 1_000_000]);
    expect(scale(null)).toBe(ARC_WIDTH_MIN);
    expect(scale(undefined)).toBe(ARC_WIDTH_MIN);
    expect(scale(-500)).toBe(ARC_WIDTH_MIN);
    expect(scale(1_000_000)).toBe(ARC_WIDTH_MAX);
  });
});

// ── Density palette ───────────────────────────────────────────────────────────

describe("density sequential palette", () => {
  it("is a 5-step single-hue ramp shared with the deck colorRange", () => {
    expect(DENSITY_RAMP_HEXES).toHaveLength(5);
    expect(DENSITY_COLOR_RANGE).toHaveLength(5);
    expect(DENSITY_COLOR_RANGE[0]).toEqual(hexToRgbArray(DENSITY_RAMP_HEXES[0]));
  });

  it("parses hex to an RGB tuple", () => {
    expect(hexToRgbArray("#2563EB")).toEqual([37, 99, 235]);
    expect(hexToRgbArray("2563eb")).toEqual([37, 99, 235]);
  });
});

describe("densityColorWeight (heat map weight)", () => {
  it("weights a density bin by AWARDED dollars, null → 0", () => {
    expect(densityColorWeight(feature({ amountAwarded: 250_000 }))).toBe(250_000);
    expect(densityColorWeight(feature({ amountAwarded: null }))).toBe(0);
  });

  it("NEVER reads announcedInvestment — a development contributes 0 to a bin", () => {
    // A development carries a multi-billion announced figure but NO awarded dollars;
    // density is a picture of awarded grants, so its weight must be 0.
    const dev = feature({
      funderType: "private_development",
      amountAwarded: null,
      announcedInvestment: 9_000_000_000,
    });
    expect(densityColorWeight(dev)).toBe(0);
  });
});

describe("density metric (dollars | records)", () => {
  it("exposes both metrics with dollars first (the default)", () => {
    expect(INVESTMENT_DENSITY_METRICS).toEqual(["dollars", "records"]);
  });

  it("records weight is 1 for EVERY point (a plain count), never a dollar field", () => {
    expect(densityRecordWeight(feature({ amountAwarded: 250_000 }))).toBe(1);
    expect(densityRecordWeight(feature({ amountAwarded: null }))).toBe(1);
    // Even a billion-dollar development counts as exactly one record.
    expect(
      densityRecordWeight(
        feature({ funderType: "private_development", amountAwarded: null, announcedInvestment: 9_000_000_000 }),
      ),
    ).toBe(1);
  });

  it("densityWeightForMetric selects the awarded-dollars weight for 'dollars' (unchanged)", () => {
    const w = densityWeightForMetric("dollars");
    expect(w(feature({ amountAwarded: 250_000 }))).toBe(250_000);
    expect(w).toBe(densityColorWeight);
  });

  it("densityWeightForMetric selects the count weight for 'records'", () => {
    const w = densityWeightForMetric("records");
    expect(w(feature({ amountAwarded: 250_000 }))).toBe(1);
    expect(w).toBe(densityRecordWeight);
  });
});
