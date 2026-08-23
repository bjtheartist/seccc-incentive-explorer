import { describe, expect, it } from "vitest";
import {
  buildLocationSnapshot,
  buildWhatsNotable,
  EXPLORE_BY_INTEREST_OPTIONS,
} from "@/lib/report-looking-overview";
import { CONFIRMED_PROGRAMS_SECTION_TITLE, SECTION_IDS } from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";

function reportFixture(overrides: Partial<GeneratedReport> = {}): GeneratedReport {
  return {
    title: "Site Incentive Analysis",
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
          { label: "TIF", value: "Review published terms", programId: "tif" },
        ],
      },
      {
        id: SECTION_IDS.civicRepresentation,
        title: "Civic Representation",
        description: "",
        items: [
          { label: "Ward", value: "6 · Ald. William Hall" },
          { label: "SSA", value: "#51", detail: "Greater Chatham Initiative" },
        ],
      },
      {
        title: "Upcoming Deadlines Near This Address",
        description: "",
        items: [
          {
            label: "SBIF application window",
            value: "Opens Oct 1, 2026",
            programId: "sbif",
            deadlineKind: "sbif_window",
            deadlineDate: "2026-10-01",
          },
        ],
      },
    ],
    recommendedActions: [],
    executiveSummary: {
      topPrograms: [],
      topActions: [],
      zoneCount: 6,
      whyTheseMatter: "",
    } as unknown as GeneratedReport["executiveSummary"],
    metadata: { address: "7939 S Cottage Grove Ave", zoneClass: "B3-2", zoneType: "Community Shopping" },
    ...overrides,
  };
}

describe("buildLocationSnapshot (gate finding 9/10)", () => {
  it("reads zoning/zone-count/program-count/data-verified straight off the report — never invents them", () => {
    const snapshot = buildLocationSnapshot(reportFixture());
    expect(snapshot.zoneClass).toBe("B3-2");
    expect(snapshot.zoneType).toBe("Community Shopping");
    expect(snapshot.mappedZoneCount).toBe(6);
    expect(snapshot.programCount).toBe(2); // sbif + tif, both visible ("looking" filters nothing)
    expect(snapshot.dataVerified).toBe("Jul 2026");
  });

  it("leaves each field null/absent honestly when the report carries no signal for it — never a fallback guess", () => {
    const bare = reportFixture({ executiveSummary: undefined, metadata: {}, generatedAt: "" });
    const snapshot = buildLocationSnapshot(bare);
    expect(snapshot.zoneClass).toBeNull();
    expect(snapshot.mappedZoneCount).toBeNull();
    expect(snapshot.dataVerified).toBeNull();
    expect(snapshot.programCount).toBe(2); // still real — programCount isn't tied to metadata
  });
});

describe("buildWhatsNotable (gate finding 9/10)", () => {
  it("pulls up to 3 REAL facts from the deadline, civic, and program-reason sources this report already carries", () => {
    const facts = buildWhatsNotable(reportFixture());
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.length).toBeLessThanOrEqual(3);
    expect(facts.some((f) => f.label === "SBIF application window")).toBe(true);
    expect(facts.some((f) => f.label === "SSA")).toBe(true);
    expect(facts.some((f) => f.detail === "Address falls inside an SBIF-eligible TIF district")).toBe(true);
  });

  it("returns an empty array (never a placeholder fact) when none of the three sources have anything real", () => {
    const empty: GeneratedReport = {
      ...reportFixture(),
      sections: [{ title: CONFIRMED_PROGRAMS_SECTION_TITLE, description: "", items: [] }],
    };
    expect(buildWhatsNotable(empty)).toEqual([]);
  });

  it("skips a Civic Representation item with no detail (e.g. Ward, which carries no detail in this fixture)", () => {
    const facts = buildWhatsNotable(reportFixture());
    expect(facts.some((f) => f.label === "Ward")).toBe(false);
  });
});

describe("EXPLORE_BY_INTEREST_OPTIONS", () => {
  it("is the board's fixed, closed set of three real persona destinations — never 'looking' or 'all'", () => {
    expect(EXPLORE_BY_INTEREST_OPTIONS.map((o) => o.persona)).toEqual(["starting", "supporter", "developer"]);
  });
});
