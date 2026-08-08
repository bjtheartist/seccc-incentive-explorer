import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReportDisplay } from "@/components/report/ReportDisplay";
import type { GeneratedReport } from "@/lib/report-engine";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

describe("ReportDisplay public safety", () => {
  it("renders a legacy saved report through the neutral public presentation", () => {
    const legacy = {
      title: "Eligible Incentive Programs",
      subtitle: "Appears eligible based on location",
      reportType: "site-incentives",
      generatedAt: "2026-08-01T00:00:00.000Z",
      summary: "You may qualify for a High Match program worth $25,000-$50,000.",
      verdict: {
        signal: "strong",
        headline: "High Match with a potential incentive of $50,000",
        subheadline: "You qualify for an estimated $25,000 benefit",
        topReasons: ["Appears eligible for a benefit range of $25,000-$50,000"],
      },
      sections: [
        {
          title: "Eligible Incentive Programs",
          description: "Appears eligible for a potential incentive of $50,000.",
          items: [
            {
              label: "Legacy Program",
              value: "$25,000-$50,000",
              detail: "Published program summary.",
              programId: "legacy",
              confidenceLabel: "High Match",
              matchedRules: ["You reported plans to remodel."],
              notVerified: ["Confirm current published requirements."],
              eligibilityRules: [
                { description: "Eligible applicants must be in good standing.", required: true },
              ],
              sourceUrl: "https://example.com/legacy",
            },
          ],
        },
      ],
      recommendedActions: [
        {
          label: "Claim a possible $25,000 incentive",
          description: "You qualify for a projected award of $25,000.",
          priority: "high",
        },
      ],
      actionRoadmap: [
        {
          tier: "do-this-week",
          label: "Pursue an estimated $50,000 benefit",
          description: "Appears eligible for a potential incentive of $50,000.",
          callScript: "Tell them you qualify for up to $50,000.",
        },
      ],
      metadata: { address: "100 E Test St" },
    } as unknown as GeneratedReport;

    const html = renderToStaticMarkup(
      <ReportDisplay report={legacy} onStartOver={() => {}} />,
    );

    expect(html).toContain("Programs Mapped at This Address");
    expect(html).toContain("Legacy Program");
    expect(html).toContain("Review published terms");
    expect(html).toContain("Program review details");
    expect(html).not.toMatch(
      /appears eligible|may qualify|you qualify|eligible incentive programs|high match|medium match/i,
    );
    expect(html).not.toContain("$25,000");
    expect(html).not.toContain("$50,000");
  });
});
