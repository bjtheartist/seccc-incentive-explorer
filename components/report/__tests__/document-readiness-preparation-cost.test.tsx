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
 * Regression pin for the preparation-cost ($ / $$ / $$$ / ?) signal in the
 * document readiness section of a PERSONA report.
 *
 * #211 ("bring persona views to board parity") introduced the board-law
 * allowlist `sectionBelongsOnPersonaBoard` and, in the same commit, dropped
 * `"rest"` and `"documentReadiness"` from every PERSONA_SECTION_ORDER array.
 * Those two buckets were what carried the canonical engine sections that
 * PRINT the tier — "Required Documents" (whose `[$$]` markers ReportDisplay
 * parses with `parseDocumentCostLine`) and the "Document Readiness Checklist"
 * (whose items carry `item.preparationCost`). The same commit renamed the
 * DocumentsToGather supplement's heading from "Documents to Gather" to
 * "Document readiness", so on a persona board the section KEPT the name and
 * LOST the dollar value: `buildProgramLinkedDocumentsToGather` has never
 * classified a cost.
 *
 * The four-section cap (#243) and the card budget (#246) are deliberate and
 * are not undone here — the tier is restored INSIDE the existing section,
 * from the same `classifyDocumentPreparationCost` the canonical sections use.
 */

const DOCUMENTS = [
  // Phase I environmental assessment -> HIGH_COST_PATTERN -> "$$$"
  { name: "Phase I environmental assessment", tier: "$$$" },
  // Certificate of good standing -> MEDIUM_COST_PATTERN -> "$$"
  { name: "Certificate of good standing", tier: "$$" },
  // W-9 -> LOW_COST_PATTERN -> "$"
  { name: "W-9", tier: "$" },
] as const;

function matchExplanation(currentDocumentsToGather: string[]) {
  return {
    whyItAppears: ["Mapped to this address"],
    knownFromPublicData: [],
    basedOnUserAnswers: [],
    stillToConfirm: [],
    currentDocumentsToGather,
    confirmWith: [],
  };
}

function boardReport(): GeneratedReport {
  return {
    title: "Location report",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: "2026-09-03T00:00:00.000Z",
    summary: "",
    sections: [
      {
        id: SECTION_IDS.siteFacts,
        title: "Site Facts",
        description: "",
        items: [{ label: "Ward", value: "8" }],
      },
      {
        id: SECTION_IDS.neighborhoodEconomicContext,
        title: "Neighborhood Economic Context",
        description: "",
        items: [{ label: "Median household income", value: "$42,000" }],
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
            matchExplanation: matchExplanation(DOCUMENTS.map((doc) => doc.name)),
          },
        ],
      },
      {
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
      },
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
      // The canonical section the "All" (full record) view still renders, with
      // the engine's own `[tier]` markers on each document line.
      {
        id: SECTION_IDS.requiredDocuments,
        title: "Required Documents",
        description: "Documents across programs mapped at this address.",
        items: [
          {
            label: "General",
            value: `${DOCUMENTS.length} documents`,
            detail: DOCUMENTS.map(
              (doc) => `${doc.name} [${doc.tier}] — SBIF Facade Grant`,
            ).join("\n"),
          },
        ],
      },
    ],
    recommendedActions: [],
    metadata: { address: "8701 S Bennett Ave" },
  } as unknown as GeneratedReport;
}

function renderBoard(persona: string) {
  window.history.replaceState({}, "", `/report?persona=${persona}`);
  render(<ReportDisplay report={boardReport()} showPersonaLens onStartOver={() => {}} />);
}

const TIER = /^(\?|\${1,3})$/;

/**
 * The preparation-cost tier rendered on the same row as `documentName`.
 * PreparationCostBadge prints the tier in an `aria-hidden` span (the spoken
 * form lives on the badge's aria-label), which is what this reads.
 */
function tierBesideDocument(documentName: string): string | null {
  const row = screen.getByText(documentName).closest("li");
  expect(row, `"${documentName}" renders on a row`).toBeTruthy();
  const tiers = Array.from(row!.querySelectorAll("span[aria-hidden='true']"))
    .map((node) => node.textContent?.trim() ?? "")
    .filter((text) => TIER.test(text));
  return tiers[0] ?? null;
}

/** Every row the document readiness section rendered, with its tier. */
function documentRowTiers(): Array<{ text: string; tiers: string[] }> {
  const section = screen.getByTestId("documents-to-gather");
  return Array.from(section.querySelectorAll("li")).map((row) => ({
    text: row.textContent?.slice(0, 60) ?? "",
    tiers: Array.from(row.querySelectorAll("span[aria-hidden='true']"))
      .map((node) => node.textContent?.trim() ?? "")
      .filter((text) => TIER.test(text)),
  }));
}

// `starting`/`growing` fall through to the Business File foundation rows on
// this fixture, `supporter` renders the program-published documents — both
// row sources must carry the tier, so the shared assertion runs over all
// three and the exact-tier assertion below pins the program-linked path.
describe.each(["starting", "growing", "supporter"])(
  "persona document readiness carries the preparation-cost tier (%s)",
  (persona) => {
    it("gives EVERY row in the section exactly one $ / $$ / $$$ / ? tier", () => {
      renderBoard(persona);

      const section = screen.getByTestId("documents-to-gather");
      expect(section.textContent).toContain("Document readiness");

      const rows = documentRowTiers();
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.tiers, `tier on row "${row.text}"`).toHaveLength(1);
      }
    });

    it("keeps the cost caveat, so a bare dollar sign is never published unexplained", () => {
      renderBoard(persona);

      const section = screen.getByTestId("documents-to-gather");
      expect(section.textContent).toContain(
        "Costs vary; this reflects document preparation, not program value.",
      );
    });
  },
);

describe("persona document readiness, program-published documents (supporter)", () => {
  it("prints the SAME tier the canonical engine sections classify for each document", () => {
    renderBoard("supporter");

    for (const doc of DOCUMENTS) {
      expect(tierBesideDocument(doc.name), `tier beside "${doc.name}"`).toBe(doc.tier);
    }
  });
});

describe('the "All" (full record) view', () => {
  it("still prints the tier beside every required document", () => {
    renderBoard("all");

    expect(screen.queryByTestId("documents-to-gather")).toBeNull();
    for (const doc of DOCUMENTS) {
      expect(tierBesideDocument(doc.name), `tier beside "${doc.name}"`).toBe(doc.tier);
    }
  });
});
