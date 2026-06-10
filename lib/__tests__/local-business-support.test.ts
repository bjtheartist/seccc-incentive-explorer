import { describe, expect, it } from "vitest";
import supportData from "@/data/exports/chicago-neighborhood-economics/local_business_support_by_community_area.json";
import { rankLocalBusinessSupport } from "@/lib/local-business-support";

describe("local business support data", () => {
  it("covers all 77 Chicago community areas", () => {
    expect(supportData.communityAreaCount).toBe(77);
    expect(Object.keys(supportData.byCommunityArea)).toHaveLength(77);
  });

  it("prioritizes neighborhood-facing support for South Chicago", () => {
    const southChicago = supportData.byCommunityArea["46"];
    expect(southChicago.communityArea).toBe("South Chicago");
    expect(southChicago.organizations[0].name).toBe("Southeast Chicago Chamber of Commerce");
    expect(southChicago.organizations[0].relationships).toContain("primary_access_point");
  });
});

describe("rankLocalBusinessSupport", () => {
  it("prioritizes primary local access points above secondary and regional supports", () => {
    const ranked = rankLocalBusinessSupport([
      { name: "Regional Hub", relationships: ["cbc_hub"], sourceUrls: [] },
      { name: "Local Chamber", relationships: ["primary_access_point"], sourceUrls: [] },
      { name: "Secondary Partner", relationships: ["secondary_access_point"], sourceUrls: [] },
    ]);

    expect(ranked.map((org) => org.name)).toEqual([
      "Local Chamber",
      "Secondary Partner",
      "Regional Hub",
    ]);
  });
});
