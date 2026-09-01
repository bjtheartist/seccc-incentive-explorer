// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReportDisplay } from "@/components/report/ReportDisplay";
import {
  CAPITAL_PARTNER_SECTION_ID,
  CAPITAL_PARTNER_SECTION_TITLE,
} from "@/lib/capital-partner-report";
import {
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  SECTION_IDS,
  type GeneratedReport,
} from "@/lib/report-engine";
import { SUPPORT_ORGANIZATIONS_SECTION_TITLE } from "@/lib/support-organization-copy";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

/**
 * Regression pin for the Contact Sheet's section ordinal.
 *
 * `personaContactSectionNumber()` used to return a per-persona CONSTANT
 * ("06" for starting/growing, "05" for supporter/developer; "07"/"09" before
 * the 2026-08-31 four-section cap). Section presence on a persona board is
 * data-dependent, though — 8701 S Bennett Ave has no capital-partner
 * financing section, so the live developer and supporter boards numbered
 * 01 → 02 → 03 → **05**, a visible hole. These tests render the real board
 * both ways and assert the Contact Sheet's number is contiguous with the
 * section above it in each case.
 */

const financingSection = {
  id: CAPITAL_PARTNER_SECTION_ID,
  title: CAPITAL_PARTNER_SECTION_TITLE,
  description: "",
  items: [
    {
      label: "Greenwood Archer Capital",
      value: "CDFI lender",
      detail: "Community lender active on the South Side.",
    },
  ],
};

function boardReport({ withFinancing }: { withFinancing: boolean }): GeneratedReport {
  return {
    title: "Location report",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: "2026-08-31T00:00:00.000Z",
    summary: "",
    sections: [
      {
        id: SECTION_IDS.siteFacts,
        title: "Site Facts",
        description: "",
        items: [{ label: "Ward", value: "8" }],
      },
      {
        title: GOAL_MATCH_PROGRAMS_SECTION_TITLE,
        description: "",
        items: [
          {
            label: "SBIF Facade Grant",
            value: "Review published terms",
            programId: "sbif",
            detail: "Funds permanent building improvements.",
          },
        ],
      },
      ...(withFinancing ? [financingSection] : []),
      {
        title: SUPPORT_ORGANIZATIONS_SECTION_TITLE,
        description: "",
        items: [
          { label: "Local support", value: "1 organization" },
          {
            label: "Community Development Corporation",
            value: "Community development advising",
            url: "https://example.com/community",
          },
        ],
      },
    ],
    recommendedActions: [],
    metadata: { address: "8701 S Bennett Ave" },
  } as unknown as GeneratedReport;
}

/** The ordinal rendered beside a numbered persona heading — every board
 *  heading (loop sections and the shared PersonaSectionHeading alike) puts
 *  the number in the span immediately before its <h2>. */
function ordinalOf(heading: Element): string {
  return heading.previousElementSibling?.textContent?.trim() ?? "";
}

/** Every ordinal the persona board actually rendered, in DOM order. */
function renderedOrdinals(): string[] {
  return Array.from(document.querySelectorAll("h2"))
    .map(ordinalOf)
    .filter((text) => /^\d{2}$/.test(text));
}

function contactSheetOrdinal(): string {
  const sheet = screen.getByTestId("contact-sheet");
  const heading = sheet.querySelector("h2");
  expect(heading, "contact sheet renders a numbered heading").toBeTruthy();
  return ordinalOf(heading as Element);
}

function renderBoard(report: GeneratedReport, persona: string) {
  window.history.replaceState({}, "", `/report?persona=${persona}`);
  render(<ReportDisplay report={report} showPersonaLens onStartOver={() => {}} />);
}

describe.each(["developer", "supporter", "starting"])(
  "persona board contact-sheet ordinal (%s)",
  (persona) => {
    it("stays contiguous with the section above it when the financing section is ABSENT (the 8701 S Bennett regression: 01 → 02 → 03 → 05)", () => {
      renderBoard(boardReport({ withFinancing: false }), persona);

      const ordinals = renderedOrdinals();
      expect(ordinals.length).toBeGreaterThan(1);
      // No hole anywhere on the board: 01, 02, 03, … with the Contact Sheet
      // last. A hardcoded per-persona constant fails here.
      expect(ordinals).toEqual(
        ordinals.map((_, index) => String(index + 1).padStart(2, "0")),
      );
      expect(contactSheetOrdinal()).toBe(ordinals[ordinals.length - 1]);
    });

    it("takes the incremented number when the financing section IS present", () => {
      const withoutFinancing = (() => {
        renderBoard(boardReport({ withFinancing: false }), persona);
        const value = contactSheetOrdinal();
        cleanup();
        return value;
      })();

      renderBoard(boardReport({ withFinancing: true }), persona);

      const ordinals = renderedOrdinals();
      expect(ordinals).toEqual(
        ordinals.map((_, index) => String(index + 1).padStart(2, "0")),
      );
      const withFinancing = contactSheetOrdinal();
      expect(withFinancing).toBe(contactSheetOrdinal());
      expect(Number(withFinancing)).toBe(Number(withoutFinancing) + 1);
    });
  },
);
