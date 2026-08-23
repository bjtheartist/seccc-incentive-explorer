import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FundingWindowChart } from "@/components/report/FundingWindowChart";
import { SECTION_IDS, type GeneratedReport } from "@/lib/report-engine";

const reportWithWindow: GeneratedReport = {
  title: "Site Incentive Analysis",
  subtitle: "",
  reportType: "site-incentives",
  generatedAt: "2026-08-20T12:00:00.000Z",
  summary: "",
  sections: [
    {
      id: SECTION_IDS.upcomingDeadlines,
      title: "Upcoming Deadlines Near This Address",
      items: [
        {
          programId: "sbif",
          label: "SBIF application window",
          deadlineKind: "sbif_window",
          deadlineDate: "2026-09-15",
          deadlineWindowEnd: "2026-10-15",
        } as unknown as GeneratedReport["sections"][number]["items"][number],
      ],
    },
  ],
  recommendedActions: [],
  metadata: { address: "4200 S California Ave, Chicago, IL" },
};

const reportWithoutWindow: GeneratedReport = {
  ...reportWithWindow,
  sections: [],
};

// ─── Funding window inline email offer (email-gate redesign, spec §C) ───
// This is also this surface's "dedicated rendered-output test" for its
// reviewed-copy claim-surface registration (lib/public-claim-surfaces.ts):
// the honest, non-fabricated copy is asserted here directly against the
// real render.

describe("FundingWindowChart inline email offer", () => {
  it("renders nothing when there is no funding window (chart itself returns null)", () => {
    const html = renderToStaticMarkup(<FundingWindowChart report={reportWithoutWindow} />);
    expect(html).toBe("");
  });

  it("renders the inline, dismissible, non-modal offer beside a real funding window", () => {
    const html = renderToStaticMarkup(<FundingWindowChart report={reportWithWindow} />);
    expect(html).toContain('data-testid="funding-window-email-offer"');
    expect(html).toContain('aria-label="Dismiss"');
    // Never a modal: no fixed-inset overlay classes anywhere in the offer.
    expect(html).not.toContain("fixed inset-0");
  });

  it("never promises a future-triggered reminder — only an immediate, real send (no reminder-send backend exists)", () => {
    const html = renderToStaticMarkup(<FundingWindowChart report={reportWithWindow} />);
    const lower = html.toLowerCase();
    expect(lower).not.toContain("when this window opens");
    expect(lower).not.toContain("notify me when");
    expect(lower).not.toContain("we'll remind you");
    expect(lower).not.toContain("we will remind you");
    expect(html).toContain("right now");
    expect(html).toContain("Email me this report");
  });

  it("submit control is disabled without a valid-looking email", () => {
    const html = renderToStaticMarkup(<FundingWindowChart report={reportWithWindow} />);
    const buttonMatch = html.match(/<button[^>]*>(?:(?!<\/button>).)*Email me this report[\s\S]*?<\/button>/);
    expect(buttonMatch?.[0]).toContain("disabled=\"\"");
  });
});
