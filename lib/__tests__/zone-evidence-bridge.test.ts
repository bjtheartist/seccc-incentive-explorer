/**
 * review5 S2 — the shared v2-tri-state -> boolean-map bridge used by
 * components/map/MapView.tsx and lib/owner-file-letter-context.ts. This is
 * the exact mechanism the S2 TEST requirement targets: "inject one failed
 * relevant layer... no negative for that layer, known positives
 * preserved."
 */
import { describe, expect, it } from "vitest";
import { bridgeZoneEvidenceV2ToBooleanMap, zoneCoverageCaveat } from "../zone-evidence-bridge";
import type { NormalizedZoneEvidenceV2 } from "../zone-response";

function evidence(
  layers: NormalizedZoneEvidenceV2["layers"],
): NormalizedZoneEvidenceV2 {
  const matchedKeys = Object.entries(layers).filter(([, v]) => v.state === "matched").map(([k]) => k);
  const unknownKeys = Object.entries(layers).filter(([, v]) => v.state === "unknown").map(([k]) => k);
  return {
    schemaVersion: 2,
    dataRevision: "rev",
    checkedAt: "2026-08-13T00:00:00.000Z",
    requestedLayers: Object.keys(layers),
    layers,
    matchedKeys,
    unknownKeys,
    hasUnknown: unknownKeys.length > 0,
  };
}

describe("bridgeZoneEvidenceV2ToBooleanMap", () => {
  it("bridges matched -> true, not_matched -> false, unknown -> false", () => {
    const result = bridgeZoneEvidenceV2ToBooleanMap(
      evidence({
        tif: { state: "matched", name: "Some TIF" },
        ssa: { state: "not_matched" },
        nof: { state: "unknown", reason: "source_unavailable" },
      }),
    );
    expect(result.zones).toEqual({ tif: true, ssa: false, nof: false });
    expect(result.zoneNames).toEqual({ tif: "Some TIF" });
  });

  it("a known positive (matched) is preserved in the boolean map even when a DIFFERENT layer in the same response is unknown", () => {
    const result = bridgeZoneEvidenceV2ToBooleanMap(
      evidence({
        tif: { state: "matched", name: "Some TIF" },
        nof: { state: "unknown", reason: "source_unavailable" },
      }),
    );
    expect(result.zones.tif).toBe(true);
    expect(result.unknownKeys).toEqual(["nof"]);
  });

  it("reports unknownKeys and hasUnknown accurately, in request order", () => {
    const result = bridgeZoneEvidenceV2ToBooleanMap(
      evidence({
        tif: { state: "not_matched" },
        nof: { state: "unknown", reason: "layer_missing" },
        ssa: { state: "unknown", reason: "source_unavailable" },
      }),
    );
    expect(result.unknownKeys).toEqual(["nof", "ssa"]);
    expect(result.hasUnknown).toBe(true);
  });

  it("hasUnknown is false and unknownKeys is empty when every layer resolved", () => {
    const result = bridgeZoneEvidenceV2ToBooleanMap(
      evidence({ tif: { state: "matched" }, ssa: { state: "not_matched" } }),
    );
    expect(result.unknownKeys).toEqual([]);
    expect(result.hasUnknown).toBe(false);
  });
});

describe("zoneCoverageCaveat", () => {
  it("returns null when there are no unknown keys — no phantom caveat", () => {
    expect(zoneCoverageCaveat([])).toBeNull();
  });

  it("singular phrasing for exactly one unknown layer", () => {
    const note = zoneCoverageCaveat(["nof"]);
    expect(note).toMatch(/^1 incentive-geography layer /);
    expect(note).not.toMatch(/layers/);
  });

  it("plural phrasing for more than one unknown layer", () => {
    const note = zoneCoverageCaveat(["nof", "ssa"]);
    expect(note).toMatch(/^2 incentive-geography layers /);
  });

  it("never asserts absence — the caveat text does not claim a zone did NOT match", () => {
    const note = zoneCoverageCaveat(["nof"]);
    expect(note).not.toMatch(/not (in|matched|present)/i);
    expect(note).toMatch(/could not be verified/i);
  });
});
