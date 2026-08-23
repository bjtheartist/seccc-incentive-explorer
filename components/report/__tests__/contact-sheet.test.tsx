// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ContactSheet } from "@/components/report/ContactSheet";
import type { GeneratedReport } from "@/lib/report-engine";
import { SUPPORT_ORGANIZATIONS_SECTION_TITLE } from "@/lib/support-organization-copy";

afterEach(cleanup);

describe("ContactSheet", () => {
  it("renders financial, program, and community contacts in separate labeled groups", () => {
    const report = {
      title: "Location report",
      subtitle: "",
      reportType: "site-incentives",
      generatedAt: "2026-08-23T00:00:00.000Z",
      summary: "",
      sections: [
        {
          title: "Programs for your goal",
          description: "",
          items: [
            {
              label: "SBIF",
              value: "",
              programId: "sbif",
              url: "https://example.com/sbif",
              sourceLabel: "sbif@somercor.com",
            },
          ],
        },
        {
          title: SUPPORT_ORGANIZATIONS_SECTION_TITLE,
          description: "",
          items: [
            { label: "Local support", value: "1 organization" },
            {
              label: "Community Development Corporation",
              value: "Community development and property advising",
              url: "https://example.com/community",
            },
          ],
        },
      ],
      recommendedActions: [],
      capitalPartnerHandoff: {
        primary: {
          partnerId: "gac",
          name: "Greenwood Archer Capital",
          partnerType: "cdfi",
          phone: "312-555-0100",
          reason: "Matches the project's capital need.",
          provenance: { verificationTier: "current", verifiedAt: "2026-08-23" },
        },
        alternates: [],
      },
    } as unknown as GeneratedReport;

    render(<ContactSheet report={report} persona="developer" sectionNumber="09" />);

    const financial = screen.getByTestId("contact-sheet-financing");
    const programs = screen.getByTestId("contact-sheet-program");
    const community = screen.getByTestId("contact-sheet-organization");

    expect(within(financial).getByRole("heading", { name: "Financial resources" })).toBeTruthy();
    expect(within(financial).getByText("Greenwood Archer Capital")).toBeTruthy();
    expect(within(programs).getByRole("heading", { name: "Program resources" })).toBeTruthy();
    expect(within(programs).getByText("SBIF")).toBeTruthy();
    expect(within(community).getByRole("heading", { name: "Community resources" })).toBeTruthy();
    expect(within(community).getByText("Community Development Corporation")).toBeTruthy();
    expect(within(community).queryByText("Greenwood Archer Capital")).toBeNull();
  });
});
