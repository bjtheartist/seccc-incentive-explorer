import { describe, expect, it } from "vitest";
import { cookViewerUrl, normalizePin14 } from "../cook-viewer";

describe("normalizePin14", () => {
  it("returns a digits-only 14-digit PIN unchanged", () => {
    expect(normalizePin14("20363230080000")).toBe("20363230080000");
  });

  it("preserves a significant leading zero", () => {
    expect(normalizePin14("01234567890123")).toBe("01234567890123");
  });

  it("strips dashes from a dashed PIN", () => {
    expect(normalizePin14("21-32-211-039-0000")).toBe("21322110390000");
  });

  it("strips surrounding and interior whitespace", () => {
    expect(normalizePin14("  20-36-323-008-0000 ")).toBe("20363230080000");
    expect(normalizePin14("2036 3230 0800 00")).toBe("20363230080000");
  });

  it("rejects a 13-digit PIN", () => {
    expect(normalizePin14("2036323008000")).toBeNull();
  });

  it("rejects a 15-digit PIN", () => {
    expect(normalizePin14("203632300800000")).toBeNull();
  });

  it("rejects garbage / non-numeric input", () => {
    expect(normalizePin14("not-a-pin")).toBeNull();
    expect(normalizePin14("2036323008000X")).toBeNull();
    expect(normalizePin14("")).toBeNull();
  });

  it("never converts a number — numeric input returns null", () => {
    expect(normalizePin14(20363230080000)).toBeNull();
  });

  it("returns null for null / undefined / non-string types", () => {
    expect(normalizePin14(null)).toBeNull();
    expect(normalizePin14(undefined)).toBeNull();
    expect(normalizePin14({})).toBeNull();
    expect(normalizePin14(["20363230080000"])).toBeNull();
  });
});

describe("cookViewerUrl", () => {
  it("builds the pin14 deep-link for a digits-only PIN", () => {
    expect(cookViewerUrl("20363230080000")).toBe(
      "https://maps.cookcountyil.gov/cookviewer/?pin14=20363230080000",
    );
  });

  it("builds the deep-link from a dashed PIN (normalized to digits)", () => {
    expect(cookViewerUrl("21-32-211-039-0000")).toBe(
      "https://maps.cookcountyil.gov/cookviewer/?pin14=21322110390000",
    );
  });

  it("returns null for an invalid-length PIN", () => {
    expect(cookViewerUrl("2036323008000")).toBeNull();
    expect(cookViewerUrl("203632300800000")).toBeNull();
  });

  it("returns null for garbage, number, and nullish input", () => {
    expect(cookViewerUrl("not-a-pin")).toBeNull();
    expect(cookViewerUrl(20363230080000)).toBeNull();
    expect(cookViewerUrl(null)).toBeNull();
    expect(cookViewerUrl(undefined)).toBeNull();
  });
});
