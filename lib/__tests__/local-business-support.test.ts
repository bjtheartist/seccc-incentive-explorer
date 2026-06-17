import { describe, expect, it } from "vitest";
import citywideSupportData from "@/data/curated/citywide_business_support_resources.json";
import supportData from "@/data/exports/chicago-neighborhood-economics/local_business_support_by_community_area.json";
import {
  mergeCitywideBusinessSupport,
  rankLocalBusinessSupport,
  type LocalBusinessSupportOrganization,
} from "@/lib/local-business-support";

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

  it("keeps citywide LANE data separate from the community-area workbook export", () => {
    const lane = citywideSupportData.organizations.find((org) =>
      org.name.includes("Legal Aid for New Entrepreneurs")
    );

    expect(supportData.providerCount).toBe(140);
    expect(citywideSupportData.providerCount).toBe(1);
    expect(lane?.relationships).toContain("legal_support");
    expect(lane?.website).toBe("https://lanechicago.org/legal_help");
    expect(lane?.supportTypes).toContain("entity formation");
    expect(lane?.serviceGeography).toContain("Chicago");
  });

  it("enriches duplicate provider names with canonical contact details", () => {
    const washingtonPark = supportData.byCommunityArea["40"];
    const qcdc = washingtonPark.organizations.find((org) =>
      org.name.includes("Quad Communities Development Corporation")
    );

    expect(qcdc?.website).toBe("https://www.qcdc.org");
    expect(qcdc?.address).toContain("4210 S. Berkeley");
    expect(qcdc?.supportTypes).toContain("Commercial corridor development");
  });
});

describe("rankLocalBusinessSupport", () => {
  it("prioritizes primary local access points above secondary and regional supports", () => {
    const ranked = rankLocalBusinessSupport([
      { name: "Regional Hub", relationships: ["cbc_hub"], sourceUrls: [] },
      { name: "Local Chamber", relationships: ["primary_access_point"], sourceUrls: [] },
      { name: "Secondary Partner", relationships: ["secondary_access_point"], sourceUrls: [] },
      { name: "Legal Partner", relationships: ["legal_support"], sourceUrls: [] },
    ]);

    expect(ranked.map((org) => org.name)).toEqual([
      "Local Chamber",
      "Legal Partner",
      "Secondary Partner",
      "Regional Hub",
    ]);
  });

  it("keeps LANE visible in the ranked support list for South Chicago", () => {
    const southChicago = supportData.byCommunityArea["46"];
    const supportPool = mergeCitywideBusinessSupport(
      southChicago.organizations as unknown as LocalBusinessSupportOrganization[],
      citywideSupportData.organizations as unknown as LocalBusinessSupportOrganization[]
    );
    const ranked = rankLocalBusinessSupport(
      supportPool,
      6
    );

    expect(ranked.map((org) => org.name)).toContain("Legal Aid for New Entrepreneurs (LANE)");
  });

  it("does not duplicate citywide support resources already present locally", () => {
    const localLane = citywideSupportData.organizations[0] as unknown as LocalBusinessSupportOrganization;
    const supportPool = mergeCitywideBusinessSupport(
      [localLane],
      citywideSupportData.organizations as unknown as LocalBusinessSupportOrganization[]
    );

    expect(supportPool).toHaveLength(1);
  });
});
