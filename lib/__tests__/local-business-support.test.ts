import { describe, expect, it } from "vitest";
import citywideSupportData from "@/data/curated/citywide_business_support_resources.json";
import supportData from "@/data/exports/chicago-neighborhood-economics/local_business_support_by_community_area.json";
import {
  mergeCitywideBusinessSupport,
  inferSupportLanes,
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

  it("uses Calumet Area Industrial Commission as the current SSA 5 provider", () => {
    const southChicago = supportData.byCommunityArea["46"];
    const caic = southChicago.organizations.find(
      (org) => org.name === "Calumet Area Industrial Commission",
    );

    expect(southChicago.coverage.ssa).toBe(
      "SSA #5 Commercial Ave. (Calumet Area Industrial Commission)",
    );
    expect(caic?.relationships).toContain("ssa_provider");
    expect(caic?.sourceUrls).toContain("https://calumetareaindustrial.com/ssa5");
    expect(
      southChicago.organizations.some(
        (org) => org.name === "South Chicago Parents and Friends, Inc.",
      ),
    ).toBe(false);
  });

  it("keeps citywide LANE data separate from the community-area workbook export", () => {
    const lane = citywideSupportData.organizations.find((org) =>
      org.name.includes("Legal Aid for New Entrepreneurs")
    );

    expect(supportData.providerCount).toBe(140);
    expect(citywideSupportData.providerCount).toBe(9);
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

  it("uses the verified public intake for Greater Englewood in every mapped area", () => {
    for (const communityAreaNumber of ["67", "68"] as const) {
      const organization = supportData.byCommunityArea[communityAreaNumber].organizations.find(
        (org) => org.id === "P019",
      );

      expect(organization).toMatchObject({
        name: "Greater Englewood Chamber Foundation",
        address: "825 W. 69th St., 2nd Floor, Chicago, IL 60621",
        phone: "312-768-8573",
        email: "connect@geccf.org",
        website: "https://www.gechamber.com/contactus",
        validationLevel: "Verified: official organization contact page",
        currentStatus: "Active public intake",
        sourceYear: "2026",
        lastVerifiedAt: "2026-08-07",
      });
      expect(organization?.sourceUrls).toContain("https://www.gechamber.com/contactus");
    }
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

    expect(
      supportPool.filter((org) => org.name === "Legal Aid for New Entrepreneurs (LANE)")
    ).toHaveLength(1);
  });

  it("deduplicates aliases and enriches place-based organizations", () => {
    const pullman = supportData.byCommunityArea["50"];
    const request = {
      communityAreaNumber: "50",
      communityArea: "Pullman",
      region: "Far South Side",
      reportType: "site-incentives",
      projectType: "equipment",
    };
    const supportPool = mergeCitywideBusinessSupport(
      pullman.organizations as unknown as LocalBusinessSupportOrganization[],
      citywideSupportData.organizations as unknown as LocalBusinessSupportOrganization[],
      request,
    );
    const ranked = rankLocalBusinessSupport(supportPool, 10, request);
    const farSouth = ranked.filter((org) => org.name.includes("Far South Community"));

    expect(farSouth).toHaveLength(1);
    expect(farSouth[0].website).toBe("https://farsouthcdc.org/nbdc");
    expect(inferSupportLanes(farSouth[0])).toContain("capital_readiness");
  });

  it("routes specialists by geography and project instead of listing everyone", () => {
    const woodlawnRequest = {
      communityAreaNumber: "42",
      communityArea: "Woodlawn",
      region: "South Side",
      reportType: "dev-feasibility",
      projectType: "vacant-acquisition",
      proposedUse: "community-cultural",
    };
    const woodlawnPool = mergeCitywideBusinessSupport(
      [],
      citywideSupportData.organizations as unknown as LocalBusinessSupportOrganization[],
      woodlawnRequest,
    );
    const names = rankLocalBusinessSupport(woodlawnPool, 20, woodlawnRequest).map(
      (org) => org.name,
    );

    expect(names).toContain("Emerald South Economic Development Collaborative");
    expect(names).toContain("LISC Chicago");
    expect(names).not.toContain("Neighborhood Housing Services of Chicago");
    expect(names).not.toContain("The Resurrection Project");
  });

  it("puts the SSA provider first for storefront remodels inside an SSA/CCSA corridor", () => {
    const southChicago = supportData.byCommunityArea["46"];
    const base = {
      communityAreaNumber: "46",
      communityArea: "South Chicago",
      region: "Southeast Side",
      reportType: "site-incentives",
    };
    const rank = (request: Parameters<typeof rankLocalBusinessSupport>[2]) =>
      rankLocalBusinessSupport(
        mergeCitywideBusinessSupport(
          southChicago.organizations as unknown as LocalBusinessSupportOrganization[],
          citywideSupportData.organizations as unknown as LocalBusinessSupportOrganization[],
          request,
        ),
        6,
        request,
      ).map((org) => org.name);

    // Storefront remodel inside an SSA/CCSA corridor: the SSA provider (the
    // CCSA/corridor-program front door) leads, above the primary access point.
    const corridorRemodel = rank({ ...base, projectType: "rehab", storefrontCorridor: true });
    expect(corridorRemodel[0]).toBe("Calumet Area Industrial Commission");

    // Same remodel outside a corridor: default ordering holds.
    const plainRemodel = rank({ ...base, projectType: "rehab", storefrontCorridor: false });
    expect(plainRemodel[0]).toBe("Southeast Chicago Chamber of Commerce");

    // A different project inside the corridor does not trigger the reorder.
    const corridorEquipment = rank({ ...base, projectType: "equipment", storefrontCorridor: true });
    expect(corridorEquipment[0]).toBe("Southeast Chicago Chamber of Commerce");
  });
});
