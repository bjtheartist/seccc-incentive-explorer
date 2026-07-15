import { describe, expect, it } from "vitest";
import {
  capitalPartnerHandoffForReport,
  reportNeedsCapitalPartner,
} from "@/lib/capital-partner-report";

function state(
  projectType: string,
  supportNeeded: string[] = [],
  reportType = "site-incentives",
) {
  return {
    reportType,
    projectType,
    proposedUse: "",
    supportNeeded,
    neighborhood: "South Chicago",
    industry: "retail",
  };
}

const context = {
  zip: "60617",
  lat: 41.739,
  lon: -87.556,
  asOf: "2026-07-14T12:00:00.000Z",
};

describe("capitalPartnerHandoffForReport", () => {
  it.each([
    ["expansion", "greenwood-archer-capital"],
    ["equipment", "greenwood-archer-capital"],
    ["rehab", "chicago-community-loan-fund"],
    ["affordable-housing", "community-investment-corporation"],
  ])("routes %s projects to an appropriate first conversation", (projectType, partnerId) => {
    const handoff = capitalPartnerHandoffForReport(state(projectType), context);
    expect(handoff?.primary?.partnerId).toBe(partnerId);
    expect(handoff?.alternates.length).toBeLessThanOrEqual(2);
  });

  it("only routes hiring projects when the user asks for capital support", () => {
    expect(reportNeedsCapitalPartner(state("hiring"))).toBe(false);
    expect(capitalPartnerHandoffForReport(state("hiring"), context)).toBeNull();

    const financedHiring = capitalPartnerHandoffForReport(
      state("hiring", ["financing"]),
      context,
    );
    expect(financedHiring?.primary?.partnerId).toBe("allies-for-community-business");
  });

  it("uses industry fit before office proximity for specialist partners", () => {
    const retailMixedUse = capitalPartnerHandoffForReport(state("mixed-use"), context);
    expect(retailMixedUse?.primary?.partnerId).toBe("chicago-trend");

    const manufacturingState = {
      ...state("mixed-use"),
      industry: "manufacturing",
    };
    const manufacturingMixedUse = capitalPartnerHandoffForReport(manufacturingState, context);
    expect(manufacturingMixedUse?.primary?.partnerId).toBe("community-investment-corporation");
  });

  it("excludes CIC from general business equipment reports", () => {
    const handoff = capitalPartnerHandoffForReport(
      {
        ...state("equipment"),
        industry: "",
      },
      context,
    );
    const partnerIds = [
      handoff?.primary?.partnerId,
      ...(handoff?.alternates.map((partner) => partner.partnerId) ?? []),
    ];

    expect(partnerIds).not.toContain("community-investment-corporation");
    expect(partnerIds).not.toContain("chicago-neighborhood-initiatives");
    expect(handoff?.primary?.partnerId).toBe("greenwood-archer-capital");
    expect(handoff?.primary?.fitNote).toContain("purchase equipment");
  });

  it("reserves CNI for complex development and structured-finance reports", () => {
    const siteReport = capitalPartnerHandoffForReport(
      {
        ...state("new-construction"),
        proposedUse: "community-cultural",
      },
      context,
    );
    const siteIds = [
      siteReport?.primary?.partnerId,
      ...(siteReport?.alternates.map((partner) => partner.partnerId) ?? []),
    ];
    expect(siteIds).not.toContain("chicago-neighborhood-initiatives");

    const developmentReport = capitalPartnerHandoffForReport(
      {
        ...state("new-construction", [], "dev-feasibility"),
        proposedUse: "community-cultural",
      },
      { ...context, zip: "60628", lat: 41.6944, lon: -87.5992 },
    );
    expect(developmentReport?.primary?.partnerId).toBe(
      "chicago-neighborhood-initiatives",
    );
    expect(developmentReport?.primary?.fitNote).toContain("NMTC structuring");
  });

  it("surfaces CIC only with a multifamily project type or property-use signal", () => {
    const affordableHousing = capitalPartnerHandoffForReport(
      state("affordable-housing"),
      context,
    );
    expect(affordableHousing?.primary?.partnerId).toBe("community-investment-corporation");
    expect(affordableHousing?.primary?.fitNote).toContain(
      "affordable multifamily rental housing",
    );
    expect(affordableHousing?.primary?.fitNote).toContain("five or more units");

    const housingRehab = capitalPartnerHandoffForReport(
      {
        ...state("rehab", [], "dev-feasibility"),
        proposedUse: "housing",
      },
      context,
    );
    const housingPartnerIds = [
      housingRehab?.primary?.partnerId,
      ...(housingRehab?.alternates.map((partner) => partner.partnerId) ?? []),
    ];
    expect(housingPartnerIds).toContain("community-investment-corporation");
  });

  it("does not attach a business referral to corridor intelligence reports", () => {
    expect(
      capitalPartnerHandoffForReport(
        state("rehab", ["financing"], "corridor-intelligence"),
        context,
      ),
    ).toBeNull();
  });

  it("serializes contact paths and provenance without internal scores or dollar bounds", () => {
    const handoff = capitalPartnerHandoffForReport(state("equipment"), context);
    const serialized = JSON.stringify(handoff);
    expect(handoff?.primary?.intakeUrl).toMatch(/^https:\/\//);
    expect(handoff?.primary?.provenance.sourceUrl).toMatch(/^https:\/\//);
    expect(serialized).not.toMatch(/score|rank|minUsd|maxUsd|amount|dollar/i);
    expect(serialized).not.toContain("$");
  });

  it("carries the Treasury certification factually and never invents one", () => {
    const expansion = capitalPartnerHandoffForReport(state("expansion"), context);
    expect(expansion?.primary?.partnerId).toBe("greenwood-archer-capital");
    expect(expansion?.primary?.certifications?.join(" ")).toContain(
      "U.S. Treasury CDFI Fund certified",
    );

    const retailMixedUse = capitalPartnerHandoffForReport(state("mixed-use"), context);
    expect(retailMixedUse?.primary?.partnerId).toBe("chicago-trend");
    expect(retailMixedUse?.primary?.certifications).toBeUndefined();
  });

  it("keeps CDFI banks behind mission lenders at equal product fit", () => {
    const expansion = capitalPartnerHandoffForReport(state("expansion"), context);
    const matches = [expansion?.primary, ...(expansion?.alternates ?? [])].filter(
      (match): match is NonNullable<typeof match> => Boolean(match),
    );
    for (const match of matches.filter((m) => m.partnerType === "community_bank")) {
      expect(match.partnerId).not.toBe(expansion?.primary?.partnerId);
    }
  });

  it("reserves investor and community-development lenders for development reports", () => {
    const equipment = capitalPartnerHandoffForReport(state("equipment"), context);
    const equipmentIds = [
      equipment?.primary?.partnerId,
      ...(equipment?.alternates.map((partner) => partner.partnerId) ?? []),
    ];
    expect(equipmentIds).not.toContain("c3-impact-fund");
    expect(equipmentIds).not.toContain("cinnaire-lending");

    const housingDevelopment = capitalPartnerHandoffForReport(
      {
        ...state("rehab", [], "dev-feasibility"),
        proposedUse: "housing",
      },
      context,
    );
    const developmentIds = [
      housingDevelopment?.primary?.partnerId,
      ...(housingDevelopment?.alternates.map((partner) => partner.partnerId) ?? []),
    ];
    expect(developmentIds).toContain("c3-impact-fund");
  });
});
