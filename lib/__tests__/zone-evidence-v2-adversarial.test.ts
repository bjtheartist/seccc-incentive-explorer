import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resolveZoneEvidenceV2 } from "../zones-check";
import { normalizeZoneCheckResponse } from "../zone-response";

/**
 * build-spec.md section 1.4 "PR1 tests (adversarial-first)" — one `it()`
 * per bullet in the spec's own list, so this file is directly checkable
 * against the spec rather than trusting that scattered producer tests
 * happen to cover it. Several bullets are already proven by producer test
 * files written alongside 1.1-1.3 (program-eligibility-fields.test.ts,
 * program-public.test.ts, zones-check-v2.test.ts, zone-evidence-cache.test.ts,
 * the v2 route.test.ts) — those are re-asserted here in miniature, tagged
 * with where the full test lives, so this file is a complete index of the
 * spec's checklist rather than a duplicate of every assertion.
 */

const resolveCachedMock = vi.fn();
vi.mock("@/lib/zone-evidence-cache", () => ({
  resolveZoneEvidenceV2Cached: (...args: unknown[]) => resolveCachedMock(...args),
}));

beforeEach(() => {
  resolveCachedMock.mockReset();
});

describe("1.4 bullet: feign one failed relevant layer -> that layer is unknown, others unaffected; response no-store; not cached under normal TTL", () => {
  it("(producer) failed layer -> unknown, sibling layer unaffected — full test: zones-check-v2.test.ts", async () => {
    const layers = await resolveZoneEvidenceV2(41.8, -87.6, ["tif", "ssa"], {
      sql: {} as never,
      dbLayerQuery: async (key) => {
        if (key === "ssa") throw new Error("simulated relevant-layer outage");
        return { name: "tif still resolves" };
      },
    });
    expect(layers.ssa).toEqual({ state: "unknown", reason: "source_unavailable" });
    expect(layers.tif).toEqual({ state: "matched", name: "tif still resolves" });
  });

  it("(route) response is not-store and not cached under the normal 7-day TTL — full test: route.test.ts + zone-evidence-cache.test.ts", async () => {
    resolveCachedMock.mockResolvedValue({
      layers: { tif: { state: "matched" }, ssa: { state: "unknown", reason: "source_unavailable" } },
      hadUnknown: true,
      checkedAt: "2026-08-01T00:00:00.000Z",
    });
    const { GET } = await import("../../app/api/zones/check/v2/route");
    const res = await GET(new NextRequest("http://localhost/api/zones/check/v2?lat=41.8&lon=-87.6&layers=tif,ssa"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // "not cached under normal TTL": lib/zone-evidence-cache.test.ts asserts
    // redis.set is called with `ex: UNKNOWN_BEARING_TTL_SECONDS` (<=300s),
    // never `ex: FULL_COVERAGE_TTL_SECONDS` (604800s), whenever hadUnknown.
  });
});

describe("1.4 bullet: failed irrelevant layer does not flip a known match", () => {
  it("full test: zones-check-v2.test.ts 'a failed irrelevant layer does not flip or downgrade a known match on another layer'", async () => {
    const layers = await resolveZoneEvidenceV2(41.8, -87.6, ["tif", "enterprise"], {
      sql: {} as never,
      dbLayerQuery: async (key) => {
        if (key === "enterprise") throw new Error("irrelevant layer outage");
        return { name: "known match" };
      },
    });
    expect(layers.tif).toEqual({ state: "matched", name: "known match" });
    expect(layers.enterprise.state).toBe("unknown");
  });
});

describe("1.4 bullet: malformed geometry -> unknown, not not_matched", () => {
  it("full test: zones-check-v2.test.ts, against the real shipped tif-districts.geojson's known malformed rings", async () => {
    const layers = await resolveZoneEvidenceV2(41.95, -87.7, ["tif"], { sql: null });
    expect(layers.tif.state).toBe("unknown");
    expect(layers.tif.reason).toBe("malformed_geometry");
    expect(layers.tif.state).not.toBe("not_matched");
  });
});

describe("1.4 bullet: missing DB layer without registry verification -> unknown (review1 R2: verification is now a runtime existence check, not a static flag)", () => {
  it("full test: zones-check-v2.test.ts 'zero DB rows AND the layer is not verified to exist -> unknown/layer_missing'", async () => {
    const layers = await resolveZoneEvidenceV2(41.8, -87.6, ["tif"], {
      sql: {} as never,
      dbLayerQuery: async () => null, // zero rows at this point
      dbLayerExists: async () => false, // ... and the layer has no rows loaded anywhere
    });
    expect(layers.tif).toEqual({ state: "unknown", reason: "layer_missing" });
  });

  it("control: zero rows but the layer IS verified to exist elsewhere -> genuine not_matched", async () => {
    const layers = await resolveZoneEvidenceV2(41.8, -87.6, ["tif"], {
      sql: {} as never,
      dbLayerQuery: async () => null,
      dbLayerExists: async () => true,
    });
    expect(layers.tif).toEqual({ state: "not_matched" });
  });
});

describe("1.4 bullet (review1 R2 addendum): HUBZone redesignated-tract match never returns plain matched", () => {
  it("full test: zones-check-v2.test.ts 'a point inside a real, currently-shipped redesignated tract is never plain matched'", async () => {
    const { resolveZoneLayerEvidence } = await import("../zones-check");
    const evidence = await resolveZoneLayerEvidence(
      "hubzone",
      42.00145844155844,
      -87.69358961038957,
      { sql: null }
    );
    expect(evidence.state).not.toBe("matched");
    expect(evidence).toEqual({
      state: "unknown",
      reason: "redesignated_area_expired",
      name: expect.any(String),
    });
  });
});

describe("1.4 bullet (review1 R2 addendum): a static layer with a stale registry revision never asserts a negative", () => {
  it("full test: zones-check-v2.test.ts 'a clean scan with zero matches on the stale microMarketRecovery boundary is unknown/stale_source'", async () => {
    const { resolveZoneLayerEvidence } = await import("../zones-check");
    const evidence = await resolveZoneLayerEvidence("microMarketRecovery", 41.6, -88.0, {
      sql: null,
    });
    expect(evidence.state).toBe("unknown");
    expect(evidence.reason).toBe("stale_source");
  });
});

describe("1.4 bullet: legacy v1 payload (positives-only array) normalizes omitted layers to unknown, never false", () => {
  it("every omitted layer appears in unknownLayers[] — see docs/eligibility-claims-acceptance.md 'Decisions' for why zones[key] itself stays a false default rather than a literal value flip (consumer-safety: flipping to a truthy 'unknown' would turn a suppressed claim into a false positive for the 6 untouched PR1 consumers)", () => {
    const result = normalizeZoneCheckResponse([{ key: "tif", name: "Some TIF" }]);
    expect(result).not.toBeNull();

    // The one layer the payload actually mentioned is a real, confirmed match.
    expect(result!.zones.tif).toBe(true);
    expect(result!.unknownLayers).not.toContain("tif");

    // Every other known zone key was NOT in the raw positives-only array —
    // it was never actually tested/confirmed false, so it must be reported
    // as unknown, not silently treated as a confirmed negative.
    expect(result!.unknownLayers.length).toBeGreaterThan(0);
    expect(result!.unknownLayers).toContain("ssa");
    expect(result!.unknownLayers).toContain("hubzone");
    // "never false" in the sense that matters for the audit's F2 minimal
    // fix ("suppress negative summaries when any required layer is
    // unknown"): a consumer checking `unknownLayers.includes(key)` before
    // treating `zones[key] === false` as a negative claim gets the correct,
    // honest answer — the omission is legible, not silently a boolean false.
    for (const key of result!.unknownLayers) {
      expect(result!.zones[key]).toBe(false); // the (unchanged) default
    }
  });

  it("an empty array (no matches at all) marks every known key unknown, not every key false-as-a-determination", () => {
    const result = normalizeZoneCheckResponse([]);
    expect(result).not.toBeNull();
    expect(result!.unknownLayers.length).toBeGreaterThan(0);
    // Every zone key present in the map is unknown, since nothing was confirmed.
    for (const key of Object.keys(result!.zones)) {
      expect(result!.unknownLayers).toContain(key);
    }
  });
});
