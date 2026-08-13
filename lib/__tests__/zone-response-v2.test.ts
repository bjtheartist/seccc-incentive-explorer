import { describe, expect, it } from "vitest";
import { normalizeZoneEvidenceV2 } from "../zone-response";

/**
 * normalizeZoneEvidenceV2 tests (build-spec.md 1.3; review1 R4). No such
 * test file existed before review1 caught the gap — the function shipped
 * in section 1.3 without dedicated coverage, which is exactly how it
 * shipped able to silently drop missing/invalid requested layers and
 * substitute "" for a missing dataRevision/checkedAt.
 */

const VALID_ENVELOPE = {
  schemaVersion: 2,
  dataRevision: "zones-v2-2026-08-13",
  checkedAt: "2026-08-13T00:00:00.000Z",
  requestedLayers: ["tif", "ssa"],
  layers: {
    tif: { state: "matched", name: "Some TIF" },
    ssa: { state: "not_matched" },
  },
};

describe("normalizeZoneEvidenceV2 — happy path", () => {
  it("normalizes a complete, valid v2 envelope", () => {
    const result = normalizeZoneEvidenceV2(VALID_ENVELOPE);
    expect(result).not.toBeNull();
    expect(result!.dataRevision).toBe("zones-v2-2026-08-13");
    expect(result!.checkedAt).toBe("2026-08-13T00:00:00.000Z");
    expect(result!.layers.tif).toEqual({ state: "matched", name: "Some TIF" });
    expect(result!.layers.ssa).toEqual({ state: "not_matched" });
    expect(result!.matchedKeys).toEqual(["tif"]);
    expect(result!.hasUnknown).toBe(false);
  });

  it("rejects a non-v2 or malformed envelope outright", () => {
    expect(normalizeZoneEvidenceV2(null)).toBeNull();
    expect(normalizeZoneEvidenceV2({ ...VALID_ENVELOPE, schemaVersion: 1 })).toBeNull();
    expect(normalizeZoneEvidenceV2({ ...VALID_ENVELOPE, layers: "not an object" })).toBeNull();
  });
});

describe("normalizeZoneEvidenceV2 — review1 R4: no silent drops", () => {
  it("a requested layer missing from the raw payload synthesizes to unknown/layer_missing, and flips hasUnknown true", () => {
    const payload = {
      schemaVersion: 2,
      dataRevision: "rev-1",
      checkedAt: "2026-08-13T00:00:00.000Z",
      requestedLayers: ["tif", "ssa"],
      layers: {
        tif: { state: "matched", name: "Some TIF" },
        // ssa is entirely absent from the raw payload
      },
    };
    const result = normalizeZoneEvidenceV2(payload);
    expect(result).not.toBeNull();
    expect(result!.hasUnknown).toBe(true);
    expect(result!.layers.ssa).toEqual({ state: "unknown", reason: "layer_missing" });
    expect(result!.unknownKeys).toContain("ssa");
    // the actually-present layer is untouched
    expect(result!.layers.tif).toEqual({ state: "matched", name: "Some TIF" });
  });

  it("a requested layer present but with an INVALID state synthesizes to unknown/layer_missing", () => {
    const payload = {
      schemaVersion: 2,
      dataRevision: "rev-1",
      checkedAt: "2026-08-13T00:00:00.000Z",
      requestedLayers: ["tif", "ssa"],
      layers: {
        tif: { state: "matched", name: "Some TIF" },
        ssa: { state: "definitely-a-match" }, // not a valid ZoneLayerState
      },
    };
    const result = normalizeZoneEvidenceV2(payload);
    expect(result).not.toBeNull();
    expect(result!.hasUnknown).toBe(true);
    expect(result!.layers.ssa).toEqual({ state: "unknown", reason: "layer_missing" });
  });

  it("a requested layer present but not an object at all synthesizes to unknown/layer_missing", () => {
    const payload = {
      schemaVersion: 2,
      dataRevision: "rev-1",
      checkedAt: "2026-08-13T00:00:00.000Z",
      requestedLayers: ["tif", "ssa"],
      layers: { tif: { state: "matched" }, ssa: "matched" }, // string, not an object
    };
    const result = normalizeZoneEvidenceV2(payload);
    expect(result!.hasUnknown).toBe(true);
    expect(result!.layers.ssa).toEqual({ state: "unknown", reason: "layer_missing" });
  });

  it("exactly reproduces the defect scenario named in review1 R4: requesting [tif,ssa] with only a valid tif entry", () => {
    const payload = {
      schemaVersion: 2,
      dataRevision: "rev-1",
      checkedAt: "2026-08-13T00:00:00.000Z",
      requestedLayers: ["tif", "ssa"],
      layers: { tif: { state: "matched", name: "Some TIF" } },
    };
    const result = normalizeZoneEvidenceV2(payload);
    expect(result).not.toBeNull();
    // Before review1 R4, this used to normalize with hasUnknown: false
    // (the omitted ssa entry simply vanished). It must now be true.
    expect(result!.hasUnknown).toBe(true);
  });
});

describe("normalizeZoneEvidenceV2 — review1 R4: absent/invalid dataRevision or checkedAt fails normalization", () => {
  it("missing dataRevision -> null, not an empty-string substitution", () => {
    const { dataRevision: _drop, ...rest } = VALID_ENVELOPE;
    expect(normalizeZoneEvidenceV2(rest)).toBeNull();
  });

  it("empty-string dataRevision -> null", () => {
    expect(normalizeZoneEvidenceV2({ ...VALID_ENVELOPE, dataRevision: "" })).toBeNull();
  });

  it("non-string dataRevision -> null", () => {
    expect(normalizeZoneEvidenceV2({ ...VALID_ENVELOPE, dataRevision: 12345 })).toBeNull();
  });

  it("missing checkedAt -> null, not an empty-string substitution", () => {
    const { checkedAt: _drop, ...rest } = VALID_ENVELOPE;
    expect(normalizeZoneEvidenceV2(rest)).toBeNull();
  });

  it("empty-string checkedAt -> null", () => {
    expect(normalizeZoneEvidenceV2({ ...VALID_ENVELOPE, checkedAt: "" })).toBeNull();
  });

  it("non-string checkedAt -> null", () => {
    expect(normalizeZoneEvidenceV2({ ...VALID_ENVELOPE, checkedAt: null })).toBeNull();
  });
});
