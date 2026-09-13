import { describe, expect, it } from "vitest";
import { buildShortlistHref, createEmptySiteMatchCriteria, decodeSiteMatchCriteria, encodeSiteMatchCriteria, siteMatchCriteriaVersionSupported } from "../site-matchmaker";

describe("evidence criteria migration", () => {
  it("round-trips explicit types, conversions and measurement basis through the real handoff", () => {
    const brief = { ...createEmptySiteMatchCriteria(), evidenceVersion: "2" as const, zip: "60617", projectUse: "retail-service" as const, propertyType: "existing-building" as const, buildingTypes: ["commercial", "mixed-use"] as const, includeConversions: true, measurementBasis: "assessor-building" as const, communityArea: "SOUTH CHICAGO" };
    const href = buildShortlistHref(brief)!;
    const params = new URL(href, "https://example.test").searchParams;
    params.set("zip", "60617");
    expect(siteMatchCriteriaVersionSupported(params)).toBe(true);
    expect(decodeSiteMatchCriteria(params)).toEqual(brief);
  });
  it("does not silently reinterpret a legacy commercial-project link as a commercial-building filter", () => {
    const brief = decodeSiteMatchCriteria(new URLSearchParams("sm_v=1&zip=60617&sm_use=retail-service&sm_property=existing-building"));
    expect(brief.evidenceVersion).toBeUndefined();
    expect(brief.buildingTypes).toBeUndefined();
    expect(encodeSiteMatchCriteria(brief).get("sm_v")).toBe("1");
  });
  it.each([
    "sm_v=2&sm_building_types=castle",
    "sm_v=2&sm_area_basis=lot-or-interior",
    "sm_v=2&sm_conversions=yes",
    "sm_v=1&sm_building_types=house",
    "sm_v=99",
    "sm_v=2&sm_building_types=",
    "sm_v=2&sm_building_types=house&sm_building_types=commercial",
    "sm_v=2&sm_area_basis=lot&sm_area_basis=available-interior",
  ])("rejects unsupported criteria instead of quietly dropping a hard requirement: %s", (query) => {
    expect(siteMatchCriteriaVersionSupported(new URLSearchParams(query))).toBe(false);
  });
});
