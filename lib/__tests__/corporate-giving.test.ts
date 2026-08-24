import { describe, expect, it } from "vitest";
import {
  CORPORATE_FOUNDATION_REGISTRY,
  effectiveFunderType,
  isCorporateFoundationRecord,
} from "../corporate-giving";
import { loadCommunityInvestment } from "../community-investment";

describe("corporate foundation classification", () => {
  it("publishes only the 14 reviewed itemized vehicles", () => {
    const published = CORPORATE_FOUNDATION_REGISTRY.filter(
      (entry) => entry.publicationStatus === "published_itemized",
    );
    expect(published).toHaveLength(14);
    expect(new Set(published.map((entry) => entry.ein)).size).toBe(14);
    expect(new Set(published.map((entry) => entry.funderName)).size).toBe(14);
  });

  it("reconciles the reviewed registry to the committed export", () => {
    const data = loadCommunityInvestment();
    expect(data).not.toBeNull();
    const corporate = data!.records.filter(isCorporateFoundationRecord);
    expect(corporate).toHaveLength(1_182);
    expect(
      corporate.reduce((sum, record) => sum + (record.amountAwarded ?? 0), 0),
    ).toBe(57_170_452);
    expect(corporate.filter((record) => record.geometry.kind === "point")).toHaveLength(848);
    expect(corporate.filter((record) => record.geometry.kind === "citywide")).toHaveLength(334);
  });

  it("classifies an exact reviewed foundation name as corporate giving", () => {
    const record = {
      source: "foundation" as const,
      funderName: "CME Group Foundation",
      funderType: "philanthropic" as const,
    };
    expect(isCorporateFoundationRecord(record)).toBe(true);
    expect(effectiveFunderType(record)).toBe("corporate");
  });

  it("does not publish attachment-only or similarly named rows", () => {
    expect(
      effectiveFunderType({
        source: "foundation",
        funderName: "Northern Trust Foundation",
        funderType: "philanthropic",
      }),
    ).toBe("philanthropic");
    expect(
      effectiveFunderType({
        source: "foundation",
        funderName: "CME Group Foundation of Somewhere Else",
        funderType: "philanthropic",
      }),
    ).toBe("philanthropic");
  });

  it("never reclassifies a non-foundation source", () => {
    expect(
      effectiveFunderType({
        source: "development",
        funderName: "CME Group Foundation",
        funderType: "private_development",
      }),
    ).toBe("private_development");
  });
});
