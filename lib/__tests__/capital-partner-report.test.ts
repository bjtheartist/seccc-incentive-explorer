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
    supportNeeded,
    neighborhood: "South Chicago",
    industry: "retail",
  };
}

const context = {
  zip: "60617",
  lat: 41.739,
  lon: -87.556,
  asOf: "2026-07-13T12:00:00.000Z",
};

describe("capitalPartnerHandoffForReport", () => {
  it.each([
    ["expansion", "allies-for-community-business"],
    ["equipment", "somercor"],
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
});
