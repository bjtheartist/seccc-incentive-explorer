import { describe, expect, it } from "vitest";
import {
  assessorRecordUrl,
  clerkRecordsUrl,
  cookViewerUrl,
  formatPin14,
  normalizePin14,
} from "../cook-viewer";

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

describe("formatPin14", () => {
  it("formats a normalized PIN while preserving a leading zero", () => {
    expect(formatPin14("01234567890123")).toBe("01-23-456-789-0123");
    expect(formatPin14("01-23-456-789-0123")).toBe("01-23-456-789-0123");
  });

  it("fails closed for malformed and missing values", () => {
    expect(formatPin14("123")).toBeNull();
    expect(formatPin14(null)).toBeNull();
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

describe("clerkRecordsUrl", () => {
  it("builds the id1 recordings-search deep-link for a digits-only PIN", () => {
    expect(clerkRecordsUrl("21322110390000")).toBe(
      "https://crs.cookcountyclerkil.gov/Search/ResultByPin?id1=21322110390000",
    );
  });

  it("builds the deep-link from a dashed PIN (normalized to digits)", () => {
    expect(clerkRecordsUrl("21-32-211-039-0000")).toBe(
      "https://crs.cookcountyclerkil.gov/Search/ResultByPin?id1=21322110390000",
    );
  });

  it("strips whitespace like the shared normalizer", () => {
    expect(clerkRecordsUrl("  20-36-323-008-0000 ")).toBe(
      "https://crs.cookcountyclerkil.gov/Search/ResultByPin?id1=20363230080000",
    );
  });

  it("returns null for an invalid-length PIN", () => {
    expect(clerkRecordsUrl("2036323008000")).toBeNull();
    expect(clerkRecordsUrl("203632300800000")).toBeNull();
  });

  it("returns null for garbage, number, and nullish input", () => {
    expect(clerkRecordsUrl("not-a-pin")).toBeNull();
    expect(clerkRecordsUrl(20363230080000)).toBeNull();
    expect(clerkRecordsUrl(null)).toBeNull();
    expect(clerkRecordsUrl(undefined)).toBeNull();
    expect(clerkRecordsUrl({})).toBeNull();
  });
});

describe("assessorRecordUrl", () => {
  it("builds the Assessor PIN record from digits-only or dashed input", () => {
    expect(assessorRecordUrl("20363230080000")).toBe(
      "https://www.cookcountyassessoril.gov/pin/20363230080000",
    );
    expect(assessorRecordUrl("20-36-323-008-0000")).toBe(
      "https://www.cookcountyassessoril.gov/pin/20363230080000",
    );
  });

  it("fails closed for invalid and numeric PINs", () => {
    expect(assessorRecordUrl("2036323008000")).toBeNull();
    expect(assessorRecordUrl(20363230080000)).toBeNull();
    expect(assessorRecordUrl(null)).toBeNull();
  });
});
