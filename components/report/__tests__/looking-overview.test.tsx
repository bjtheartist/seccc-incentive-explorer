// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { trackEventMock } = vi.hoisted(() => ({ trackEventMock: vi.fn() }));
vi.mock("@/lib/analytics-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics-events")>()),
  trackEvent: trackEventMock,
}));

import {
  LocationSnapshotPanel,
  WhatsNotablePanel,
  ExploreByInterestPanel,
} from "@/components/report/LookingOverview";
import { CONFIRMED_PROGRAMS_SECTION_TITLE, SECTION_IDS } from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";

afterEach(() => {
  cleanup();
  trackEventMock.mockReset();
});

function reportFixture(): GeneratedReport {
  return {
    title: "Test",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: "2026-07-10T00:00:00.000Z",
    summary: "",
    sections: [
      {
        title: CONFIRMED_PROGRAMS_SECTION_TITLE,
        description: "",
        items: [
          {
            label: "SBIF",
            value: "Review published terms",
            programId: "sbif",
            matchExplanation: {
              whyItAppears: ["Address falls inside an SBIF-eligible TIF district"],
              knownFromPublicData: [],
              basedOnUserAnswers: [],
              stillToConfirm: [],
              currentDocumentsToGather: [],
              confirmWith: [],
            },
          },
        ],
      },
      {
        id: SECTION_IDS.civicRepresentation,
        title: "Civic Representation",
        description: "",
        items: [{ label: "SSA", value: "#51", detail: "Greater Chatham Initiative" }],
      },
    ],
    recommendedActions: [],
    executiveSummary: { topPrograms: [], topActions: [], zoneCount: 6, whyTheseMatter: "" } as unknown as GeneratedReport["executiveSummary"],
    metadata: { address: "7939 S Cottage Grove Ave", zoneClass: "B3-2" },
  };
}

describe("LocationSnapshotPanel (gate finding 9/10)", () => {
  it("renders the real stat tiles (Programs Matched Here is NOT duplicated here — it already renders elsewhere for every persona lens)", () => {
    const html = renderToStaticMarkup(<LocationSnapshotPanel report={reportFixture()} />);
    expect(html).toContain('data-testid="location-snapshot"');
    expect(html).toContain("B3-2");
    expect(html).toContain("6"); // mapped zones
    expect(html).not.toContain('data-testid="programs-matched-here"');
  });
});

describe("WhatsNotablePanel (gate finding 9/10)", () => {
  it("renders the real facts pulled from civic representation and match reasons", () => {
    const html = renderToStaticMarkup(<WhatsNotablePanel report={reportFixture()} />);
    expect(html).toContain('data-testid="whats-notable"');
    expect(html).toContain("SSA");
    expect(html).toContain("Address falls inside an SBIF-eligible TIF district");
  });

  it("renders nothing when there are no real facts to show", () => {
    const empty: GeneratedReport = {
      ...reportFixture(),
      sections: [{ title: CONFIRMED_PROGRAMS_SECTION_TITLE, description: "", items: [] }],
    };
    expect(renderToStaticMarkup(<WhatsNotablePanel report={empty} />)).toBe("");
  });
});

describe("ExploreByInterestPanel (gate finding 9/10)", () => {
  it("renders the three real persona-switch controls and the full-picture line", () => {
    const html = renderToStaticMarkup(
      <ExploreByInterestPanel report={reportFixture()} onSelectPersona={() => {}} />,
    );
    expect(html).toContain("I own a business");
    expect(html).toContain("I support businesses");
    expect(html).toContain("I develop property");
    expect(html).toContain('data-testid="full-picture-line"');
    expect(html).toContain("Every program, zone, and detail at this address");
  });

  it("switches the lens in-page: every control calls onSelectPersona with its own PersonaId", () => {
    const onSelectPersona = vi.fn();
    render(<ExploreByInterestPanel report={reportFixture()} onSelectPersona={onSelectPersona} />);
    const chips = [
      ["I own a business", "starting"],
      ["I support businesses", "supporter"],
      ["I develop property", "developer"],
    ] as const;
    for (const [label, persona] of chips) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(onSelectPersona).toHaveBeenLastCalledWith(persona);
    }
    fireEvent.click(screen.getByTestId("full-picture-line"));
    expect(onSelectPersona).toHaveBeenLastCalledWith("all");
    expect(onSelectPersona).toHaveBeenCalledTimes(chips.length + 1);
  });

  it("mirrors the persona_chip_selected event PersonaChips fires from its own click handler", () => {
    render(<ExploreByInterestPanel report={reportFixture()} onSelectPersona={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "I develop property" }));
    expect(trackEventMock).toHaveBeenCalledWith(
      "persona_chip_selected",
      expect.objectContaining({
        source: "looking_explore_by_interest",
        address: "7939 S Cottage Grove Ave",
        metadata: expect.objectContaining({ persona: "developer" }),
      }),
    );
  });

  // REGRESSION (the "refined report reverts to its pre-refine snapshot" bug):
  // these controls were once raw `<a href="?persona=…">` anchors. A real
  // navigation remounts the page, which regenerates the report from stale URL
  // params and throws the refine away. Nothing on this board may become a
  // persona link again.
  it("renders NO anchor carrying a persona URL param", () => {
    const html = renderToStaticMarkup(
      <ExploreByInterestPanel report={reportFixture()} onSelectPersona={() => {}} />,
    );
    expect(html).not.toMatch(/<a\b[^>]*href="[^"]*persona=/);
    expect(html).not.toContain("persona=");
  });
});
