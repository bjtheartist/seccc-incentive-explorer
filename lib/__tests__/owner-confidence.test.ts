import { describe, expect, it } from "vitest";
import { algorithmicTier, resolveConfidenceTier } from "../owner-confidence";

describe("algorithmicTier", () => {
  it("maps High -> B, Medium -> C, everything else -> D", () => {
    expect(algorithmicTier("High")).toBe("B");
    expect(algorithmicTier("Medium")).toBe("C");
    expect(algorithmicTier("Low")).toBe("D");
    expect(algorithmicTier("")).toBe("D");
    expect(algorithmicTier("garbage")).toBe("D");
  });
});

describe("resolveConfidenceTier", () => {
  const highCluster = { confidence: "High" };
  const lowCluster = { confidence: "Low" };

  it("never grants A without a verified status, regardless of lookup data", () => {
    expect(
      resolveConfidenceTier(highCluster, { status: "draft", ilSosLookupUrl: "https://apps.ilsos.gov/x" })
    ).toBe("B");
    expect(resolveConfidenceTier(highCluster, null)).toBe("B");
    expect(resolveConfidenceTier(highCluster, undefined)).toBe("B");
  });

  it("grants A when verified with a non-empty il_sos_lookup_url", () => {
    expect(
      resolveConfidenceTier(lowCluster, {
        status: "verified",
        ilSosLookupUrl: "https://apps.ilsos.gov/businessentitysearch/",
      })
    ).toBe("A");
  });

  it("treats a whitespace-only il_sos_lookup_url as empty", () => {
    expect(
      resolveConfidenceTier(highCluster, { status: "verified", ilSosLookupUrl: "   " })
    ).toBe("B");
  });

  it("grants A when verified with an entity_lookup note even without a lookup URL", () => {
    expect(
      resolveConfidenceTier(
        lowCluster,
        { status: "verified", ilSosLookupUrl: null },
        [{ noteType: "general" }, { noteType: "entity_lookup" }]
      )
    ).toBe("A");
  });

  it("falls back to the algorithmic tier when verified but no entity evidence exists", () => {
    expect(
      resolveConfidenceTier(lowCluster, { status: "verified", ilSosLookupUrl: null }, [
        { noteType: "general" },
      ])
    ).toBe("D");
    expect(resolveConfidenceTier(highCluster, { status: "verified" })).toBe("B");
  });

  it("falls back to the algorithmic tier for stale/superseded verifications", () => {
    expect(
      resolveConfidenceTier(highCluster, {
        status: "stale",
        ilSosLookupUrl: "https://apps.ilsos.gov/businessentitysearch/",
      })
    ).toBe("B");
    expect(
      resolveConfidenceTier(lowCluster, {
        status: "superseded",
        ilSosLookupUrl: "https://apps.ilsos.gov/businessentitysearch/",
      })
    ).toBe("D");
  });
});
