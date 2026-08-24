import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommunityInvestmentEvidenceSummary } from "@/components/investment/CommunityInvestmentEvidenceSummary";
import { FunderTypeBars } from "@/components/investment/FunderTypeBars";
import type { CommunityInvestmentAnalysis, FunderTypeBreakdown } from "@/lib/investment-analysis";

describe("community investment evidence brief", () => {
  it("renders all six community-scoped capital instruments without combining them", () => {
    const analysis = {
      generatedAt: "2026-08-24T00:00:00.000Z",
      totalAwarded: 1_000_000,
      authorizedTif: 2_000_000,
      federalProgram: 3_000_000,
      publishedStateAppropriation: 4_000_000,
      creditCapital: 5_000_000,
      announcedCapital: 6_000_000,
    } as CommunityInvestmentAnalysis;

    const html = renderToStaticMarkup(<CommunityInvestmentEvidenceSummary analysis={analysis} />);

    expect(html).toContain("Awarded grants");
    expect(html).toContain("Authorized TIF");
    expect(html).toContain("Federal program commitments");
    expect(html).toContain("Published state appropriations");
    expect(html).toContain("Tax-credit capital");
    expect(html).toContain("Announced private capital");
    expect(html).toContain("Do not add them together");
    expect(html).toContain("Not shown on this page");
  });

  it("shows corporate giving when documented dollars exist and hides an absent zero-count category", () => {
    const rows: FunderTypeBreakdown[] = [
      { funderType: "government", awardedDollars: 800_000, count: 4, share: 0.8 },
      { funderType: "corporate", awardedDollars: 200_000, count: 2, share: 0.2 },
      { funderType: "philanthropic", awardedDollars: 0, count: 0, share: 0 },
      { funderType: "private_development", awardedDollars: 0, count: 3, share: 0 },
    ];

    const html = renderToStaticMarkup(<FunderTypeBars byFunderType={rows} />);

    expect(html).toContain("Corporate giving");
    expect(html).toContain("$200,000");
    expect(html).toContain("Private development");
    expect(html).not.toContain("Philanthropic");
    expect(html).not.toContain("0 projects");
  });
});
