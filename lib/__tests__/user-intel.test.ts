import { describe, expect, it } from "vitest";
import { normalizeSearchQuery } from "../user-intel";

describe("normalizeSearchQuery", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeSearchQuery("  hello  ")).toBe("hello");
  });

  it("lowercases", () => {
    expect(normalizeSearchQuery("Chicago AVE")).toBe("chicago ave");
  });

  it("collapses internal whitespace runs", () => {
    expect(normalizeSearchQuery("123   N    State   St")).toBe("123 n state st");
  });

  it("collapses tabs and newlines to single spaces", () => {
    expect(normalizeSearchQuery("a\t\tb\nc")).toBe("a b c");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeSearchQuery("   \n\t ")).toBe("");
  });

  it("is idempotent", () => {
    const once = normalizeSearchQuery("  Some  MIXED   Query ");
    expect(normalizeSearchQuery(once)).toBe(once);
  });
});
