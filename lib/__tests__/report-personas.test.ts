import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ALSO_AT_ADDRESS_TITLE,
  applyPersonaLens,
  personaSelectionEvent,
  programMatchesPersona,
  PROGRAM_PERSONA_TAGS,
} from "@/lib/report-personas";
import {
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
} from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";
import { SUPPORT_ORGANIZATIONS_SECTION_TITLE } from "@/lib/support-organization-copy";
import { PERSONA_CHIPS, type PersonaId } from "@/lib/personas";

// Known tags used by the fixtures (mirror of public/data/programs.json):
//   sbif → starting, growing | tif → growing, developer | federalOZ → developer
//   highUnemployment → untagged

function reportFixture(): GeneratedReport {
  return {
    title: "Location Snapshot",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: "2026-07-12T00:00:00.000Z",
    summary: "",
    sections: [
      {
        title: CONFIRMED_PROGRAMS_SECTION_TITLE,
        description: "",
        items: [
          { label: "SBIF", value: "", programId: "sbif" },
          { label: "TIF", value: "", programId: "tif" },
          { label: "Federal OZ", value: "", programId: "federalOZ" },
          { label: "High Unemployment", value: "", programId: "highUnemployment" },
          { label: "Lead note", value: "" },
        ],
      },
      {
        title: SUPPORT_ORGANIZATIONS_SECTION_TITLE,
        description: "",
        items: [
          { label: "Local Support in South Chicago", value: "3 organizations" },
          {
            label: "Chicago SBDC",
            value: "Advising",
            detail: "SBDC technical assistance and counseling",
          },
          {
            label: "Greenwood Archer Capital",
            value: "CDFI lender",
            detail: "revenue-based loans",
          },
          { label: "Neighbors Chamber", value: "Chamber", detail: "advising" },
        ],
      },
      {
        title: "Neighborhood Economic Context",
        description: "",
        items: [{ label: "Median income", value: "$40,000" }],
      },
    ],
    recommendedActions: [],
    actionRoadmap: [
      { tier: "do-this-week", programId: "federalOZ", label: "OZ", description: "" },
      { tier: "do-this-week", programId: "sbif", label: "SBIF", description: "" },
      { tier: "start-gathering", programId: "tif", label: "TIF", description: "" },
    ],
    metadata: { address: "9101 S Commercial Ave" },
  };
}

function programIds(report: GeneratedReport): string[] {
  return report.sections
    .flatMap((s) => s.items)
    .map((i) => i.programId)
    .filter((id): id is string => Boolean(id));
}

describe("programMatchesPersona", () => {
  it("matches on the static tags and treats 'all' as universal", () => {
    expect(programMatchesPersona("sbif", "all")).toBe(true);
    expect(programMatchesPersona("sbif", "starting")).toBe(true);
    expect(programMatchesPersona("sbif", "developer")).toBe(false);
    expect(programMatchesPersona("federalOZ", "developer")).toBe(true);
    expect(programMatchesPersona("highUnemployment", "developer")).toBe(false);
    expect(programMatchesPersona(undefined, "developer")).toBe(false);
  });
});

describe("applyPersonaLens", () => {
  it("returns the same reference and full counts for the 'all' lens", () => {
    const report = reportFixture();
    const result = applyPersonaLens(report, "all");
    expect(result.report).toBe(report);
    expect(result.matchedBefore).toBe(4);
    expect(result.matchedAfter).toBe(4);
  });

  it("never mutates the canonical report (print/export stays 'All')", () => {
    const report = reportFixture();
    const snapshot = JSON.parse(JSON.stringify(report));
    applyPersonaLens(report, "developer");
    expect(report).toEqual(snapshot);
  });

  it("ranks matched programs first and collapses the rest — never hides them", () => {
    const report = reportFixture();
    const { report: lensed, matchedBefore, matchedAfter } = applyPersonaLens(
      report,
      "developer",
    );

    const confirmed = lensed.sections.find(
      (s) => s.title === CONFIRMED_PROGRAMS_SECTION_TITLE,
    )!;
    const also = lensed.sections.find((s) => s.title === ALSO_AT_ADDRESS_TITLE)!;

    // Matched (tif, federalOZ) + the non-program lead note stay primary.
    expect(confirmed.items.map((i) => i.programId)).toEqual([
      "tif",
      "federalOZ",
      undefined,
    ]);
    // Everything else collapses under a disclosure — present, not dropped.
    expect(also).toBeDefined();
    expect(also.collapsedByPersona).toBe(true);
    expect(also.items.map((i) => i.programId)).toEqual(["sbif", "highUnemployment"]);

    // Collapse-not-hide: the full program set is preserved across the split.
    expect(new Set(programIds(lensed))).toEqual(
      new Set(["tif", "federalOZ", "sbif", "highUnemployment"]),
    );
    expect(matchedBefore).toBe(4);
    expect(matchedAfter).toBe(2);
  });

  it("leaves a section untouched when the persona matches nothing in it", () => {
    const report: GeneratedReport = {
      ...reportFixture(),
      sections: [
        {
          title: CONFIRMED_PROGRAMS_SECTION_TITLE,
          description: "",
          items: [
            { label: "High Unemployment", value: "", programId: "highUnemployment" },
            { label: "Lead note", value: "" },
          ],
        },
      ],
    };
    const { report: lensed, matchedAfter } = applyPersonaLens(report, "developer");
    expect(lensed.sections.some((s) => s.title === ALSO_AT_ADDRESS_TITLE)).toBe(false);
    expect(lensed.sections[0].items).toHaveLength(2);
    expect(matchedAfter).toBe(0);
  });

  it("composes with a goal-refined report: both confirmed sections partition into ONE combined disclosure", () => {
    // The email gate funnels every real instant-flow user into the refined
    // shape: "Programs to Review for Your Goal" + "Other Programs Tied to This
    // Address". Persona (audience) and goal (outcome) are orthogonal lenses —
    // the persona lens must re-rank both sections and pool their out-of-lens
    // programs into a single "Also at this address" after the last one.
    const refined: GeneratedReport = {
      ...reportFixture(),
      sections: [
        {
          title: GOAL_MATCH_PROGRAMS_SECTION_TITLE,
          description: "",
          items: [
            { label: "SBIF", value: "", programId: "sbif" },
            { label: "Federal OZ", value: "", programId: "federalOZ" },
          ],
        },
        {
          title: OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
          description: "",
          items: [
            { label: "TIF", value: "", programId: "tif" },
            { label: "High Unemployment", value: "", programId: "highUnemployment" },
          ],
        },
        {
          title: "Neighborhood Economic Context",
          description: "",
          items: [{ label: "Median income", value: "$40,000" }],
        },
      ],
    };

    const { report: lensed, matchedBefore, matchedAfter } = applyPersonaLens(
      refined,
      "developer",
    );

    const titles = lensed.sections.map((s) => s.title);
    // Exactly one combined disclosure, placed right after the last confirmed
    // section (no duplicate "Also at this address" anchors in the DOM).
    expect(titles.filter((t) => t === ALSO_AT_ADDRESS_TITLE)).toHaveLength(1);
    expect(titles).toEqual([
      GOAL_MATCH_PROGRAMS_SECTION_TITLE,
      OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
      ALSO_AT_ADDRESS_TITLE,
      "Neighborhood Economic Context",
    ]);

    // Goal-ranked order is preserved inside each lensed section.
    expect(lensed.sections[0].items.map((i) => i.programId)).toEqual(["federalOZ"]);
    expect(lensed.sections[1].items.map((i) => i.programId)).toEqual(["tif"]);
    const also = lensed.sections[2];
    expect(also.collapsedByPersona).toBe(true);
    expect(also.items.map((i) => i.programId)).toEqual([
      "sbif",
      "highUnemployment",
    ]);

    // Collapse-not-hide across the refined shape too.
    expect(new Set(programIds(lensed))).toEqual(
      new Set(["sbif", "federalOZ", "tif", "highUnemployment"]),
    );
    expect(matchedBefore).toBe(4);
    expect(matchedAfter).toBe(2);
  });

  it("reorders the action roadmap so persona-relevant actions lead (all kept)", () => {
    const { report: lensed } = applyPersonaLens(reportFixture(), "developer");
    expect(lensed.actionRoadmap?.map((a) => a.programId)).toEqual([
      "federalOZ",
      "tif",
      "sbif",
    ]);
  });

  it("leaves startHere untouched (undefined) when the report has none (legacy report shape)", () => {
    const { report: lensed } = applyPersonaLens(reportFixture(), "developer");
    expect(lensed.startHere).toBeUndefined();
  });

  it("reorders startHere.primary/secondary the same way as actionRoadmap when a report carries one", () => {
    const withStartHere: GeneratedReport = {
      ...reportFixture(),
      startHere: {
        primary: { label: "SBIF", description: "", kind: "call-agency", programId: "sbif" },
        secondary: [
          { label: "OZ", description: "", kind: "call-agency", programId: "federalOZ" },
          { label: "TIF", description: "", kind: "confirm-with-agency", programId: "tif" },
        ],
        evidence: [],
        unresolvedQuestions: [],
        audience: "site-incentives",
      },
    };

    const { report: lensed } = applyPersonaLens(withStartHere, "developer");

    // Same persona weighting as the actionRoadmap reorder above: federalOZ and
    // tif match "developer", sbif does not — the developer-matched action
    // that was originally last (federalOZ, in secondary) becomes primary.
    expect(lensed.startHere?.primary.programId).toBe("federalOZ");
    expect(lensed.startHere?.secondary.map((a) => a.programId)).toEqual(["tif", "sbif"]);
  });

  it("never displaces an unresolved zoning/use question from startHere.primary for any persona", () => {
    const withZoningGate: GeneratedReport = {
      ...reportFixture(),
      startHere: {
        primary: {
          label: "Confirm the exact proposed use with the City",
          description: "",
          kind: "confirm-zoning-use",
        },
        secondary: [
          { label: "OZ", description: "", kind: "call-agency", programId: "federalOZ" },
        ],
        evidence: [],
        unresolvedQuestions: ["What is the exact proposed use?"],
        audience: "site-incentives",
      },
    };

    const { report: lensed } = applyPersonaLens(withZoningGate, "developer");
    expect(lensed.startHere).toEqual(withZoningGate.startHere);
  });

  it("surfaces finance orgs first for developers, advising first for starters", () => {
    const dev = applyPersonaLens(reportFixture(), "developer").report;
    const devSupport = dev.sections.find((s) => s.title === SUPPORT_ORGANIZATIONS_SECTION_TITLE)!;
    // Head summary stays pinned; capital org leads for developers.
    expect(devSupport.items[0].label).toBe("Local Support in South Chicago");
    expect(devSupport.items[1].label).toBe("Greenwood Archer Capital");

    const start = applyPersonaLens(reportFixture(), "starting").report;
    const startSupport = start.sections.find(
      (s) => s.title === SUPPORT_ORGANIZATIONS_SECTION_TITLE,
    )!;
    expect(startSupport.items[0].label).toBe("Local Support in South Chicago");
    expect(startSupport.items[1].label).toBe("Chicago SBDC");
  });
});

describe("personaSelectionEvent — exactly once per selection", () => {
  it("emits nothing when the persona does not change", () => {
    const report = reportFixture();
    expect(personaSelectionEvent("all", "all", report)).toBeNull();
    expect(personaSelectionEvent("developer", "developer", report)).toBeNull();
  });

  it("emits exactly one payload per real change and dedupes repeats", () => {
    const report = reportFixture();
    const events: { persona: PersonaId }[] = [];
    let current: PersonaId = "all";
    // Model the component's click handler exactly: fire on change only.
    const select = (next: PersonaId) => {
      const event = personaSelectionEvent(current, next, report);
      if (event) events.push(event);
      current = next;
    };

    select("developer");
    select("developer"); // repeat → suppressed
    select("all");
    select("all"); // repeat → suppressed
    select("starting");

    expect(events.map((e) => e.persona)).toEqual(["developer", "all", "starting"]);
    expect(events[0]).toMatchObject({
      persona: "developer",
      reportType: "site-incentives",
      matchedProgramsBefore: 4,
      matchedProgramsAfter: 2,
    });
  });
});

describe("persona tags stay in sync with the static dataset", () => {
  const programs = JSON.parse(
    readFileSync(join(process.cwd(), "data/programs-internal.json"), "utf8"),
  ) as { id: string; personas?: PersonaId[] }[];
  const validPersonas = new Set<string>(
    PERSONA_CHIPS.map((c) => c.id).filter((id) => id !== "all"),
  );

  it("mirrors programs.json <-> PROGRAM_PERSONA_TAGS with no drift", () => {
    const fromJson = new Map(
      programs.filter((p) => p.personas?.length).map((p) => [p.id, p.personas!]),
    );
    const fromMap = new Map(Object.entries(PROGRAM_PERSONA_TAGS));
    expect(fromJson.size).toBe(fromMap.size);
    for (const [id, tags] of fromMap) {
      expect(fromJson.get(id)).toEqual(tags);
    }
  });

  it("only ever uses real, non-'all' persona ids", () => {
    for (const [, tags] of Object.entries(PROGRAM_PERSONA_TAGS)) {
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(validPersonas.has(tag)).toBe(true);
    }
  });
});
