import { describe, expect, it } from "vitest";
import { algorithmicTier, isIlSosUrl, resolveConfidenceTier } from "../owner-confidence";

describe("isIlSosUrl", () => {
  it("accepts https/http URLs on ilsos.gov and its subdomains", () => {
    expect(isIlSosUrl("https://apps.ilsos.gov/businessentitysearch/")).toBe(true);
    expect(isIlSosUrl("http://ilsos.gov/")).toBe(true);
    expect(isIlSosUrl("https://ilsos.gov")).toBe(true);
  });

  it("rejects non-SOS hosts", () => {
    expect(isIlSosUrl("https://example.com")).toBe(false);
    expect(isIlSosUrl("https://notilsos.gov")).toBe(false);
    expect(isIlSosUrl("https://ilsos.gov.evil.com")).toBe(false);
  });

  it("rejects non-http(s) schemes, including javascript: URLs", () => {
    expect(isIlSosUrl("javascript:alert(1)")).toBe(false);
    expect(isIlSosUrl("ftp://apps.ilsos.gov/")).toBe(false);
  });

  it("rejects empty, whitespace-only, null, and undefined values", () => {
    expect(isIlSosUrl("")).toBe(false);
    expect(isIlSosUrl("   ")).toBe(false);
    expect(isIlSosUrl(null)).toBe(false);
    expect(isIlSosUrl(undefined)).toBe(false);
  });

  it("rejects a bare non-URL string (a one-character string must never self-certify Tier A)", () => {
    expect(isIlSosUrl("x")).toBe(false);
    expect(isIlSosUrl("ilsos.gov")).toBe(false); // no scheme -> not a valid URL
  });
});

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

  it("grants A when verified with an entity_lookup note carrying an ilsos.gov sourceUrl, even without a lookup URL", () => {
    expect(
      resolveConfidenceTier(
        lowCluster,
        { status: "verified", ilSosLookupUrl: null },
        [
          { noteType: "general" },
          { noteType: "entity_lookup", sourceUrl: "https://apps.ilsos.gov/businessentitysearch/" },
        ]
      )
    ).toBe("A");
  });

  it("does NOT grant A for an entity_lookup note whose sourceUrl is not an ilsos.gov URL", () => {
    expect(
      resolveConfidenceTier(lowCluster, { status: "verified", ilSosLookupUrl: null }, [
        { noteType: "entity_lookup", sourceUrl: "https://example.com/not-sos" },
      ])
    ).toBe("D");
  });

  it("does NOT grant A for an entity_lookup note with no sourceUrl at all", () => {
    expect(
      resolveConfidenceTier(lowCluster, { status: "verified", ilSosLookupUrl: null }, [
        { noteType: "entity_lookup" },
      ])
    ).toBe("D");
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
