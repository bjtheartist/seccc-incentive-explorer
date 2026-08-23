import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ALSO_AT_ADDRESS_TITLE,
  applyPersonaLens,
  guidepostPartForSection,
  personaSummaryProgramNames,
  personaEmptyProgramsDescription,
  personaSelectionEvent,
  programMatchesPersona,
  PROGRAM_PERSONA_TAGS,
  visiblePersonaProgramNames,
} from "@/lib/report-personas";
import {
  CONFIRMED_PROGRAMS_SECTION_ID,
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  GOAL_MATCH_PROGRAMS_SECTION_ID,
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  OTHER_CONFIRMED_PROGRAMS_SECTION_ID,
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
  SECTION_IDS,
} from "@/lib/report-engine";
import { CAPITAL_PARTNER_SECTION_ID, CAPITAL_PARTNER_SECTION_TITLE } from "@/lib/capital-partner-report";
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
        id: CONFIRMED_PROGRAMS_SECTION_ID,
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
        id: SECTION_IDS.neighborhoodEconomicContext,
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

  it("hard-filters program names nested inside a visible card's stacking references", () => {
    const report = reportFixture();
    const confirmed = report.sections.find(
      (section) => section.id === CONFIRMED_PROGRAMS_SECTION_ID,
    )!;
    confirmed.items[0] = {
      ...confirmed.items[0],
      worksWith: [
        { label: "TIF", detail: "Excluded from the starting lens." },
        { label: "High Unemployment", detail: "Pinned and still visible." },
      ],
    };

    const lensed = applyPersonaLens(report, "starting").report;
    const sbif = lensed.sections
      .flatMap((section) => section.items)
      .find((item) => item.programId === "sbif");
    expect(sbif?.worksWith).toEqual([
      { label: "High Unemployment", detail: "Pinned and still visible." },
    ]);
  });

  it("keeps persona fact grids concise by removing duplicated canonical rollups and the ZBA diagnostic", () => {
    const report: GeneratedReport = {
      ...reportFixture(),
      sections: [
        {
          id: SECTION_IDS.siteFacts,
          title: "Site Facts",
          description: "",
          items: [
            { label: "Property PIN", value: "20-01" },
            { label: "Transportation & Site Access", value: "Long rollup" },
            { label: "Civic Representation", value: "Long rollup" },
            { label: "Site Signals", value: "Long rollup" },
          ],
        },
        {
          id: SECTION_IDS.zoningUseStartingPoint,
          title: "Zoning & Use Starting Point",
          description: "",
          items: [
            { label: "City Zoning Classification", value: "B3-2" },
            { label: "City ZBA Case Source", value: "No intersecting record" },
          ],
        },
        ...reportFixture().sections,
      ],
    };

    const lensed = applyPersonaLens(report, "starting").report;
    expect(lensed.sections.find((section) => section.id === SECTION_IDS.siteFacts)?.items)
      .toEqual([{ label: "Property PIN", value: "20-01" }]);
    expect(
      lensed.sections.find((section) => section.id === SECTION_IDS.zoningUseStartingPoint)?.items,
    ).toEqual([{ label: "City Zoning Classification", value: "B3-2" }]);
  });

  it("hard filter: visible = persona-tagged ∪ pinned overlays; canonical lead notes never become persona blocks", () => {
    const report = reportFixture();
    const { report: lensed, matchedBefore, matchedAfter } = applyPersonaLens(
      report,
      "developer",
    );

    // Gate finding 19: found by id, not title — under a real persona lens
    // this section's title is now overridden (e.g. developer sees
    // "Capital-relevant programs"), so a post-lens title match would fail.
    const confirmed = lensed.sections.find(
      (s) => s.id === CONFIRMED_PROGRAMS_SECTION_ID,
    )!;
    const also = lensed.sections.find((s) => s.title === ALSO_AT_ADDRESS_TITLE)!;

    // Matched (tif, federalOZ) + the PINNED overlay (highUnemployment — context,
    // not a program, always visible) stay primary. The canonical lead note is
    // absent because no persona board contains that extra block.
    expect(confirmed.items.map((i) => i.programId)).toEqual([
      "tif",
      "federalOZ",
      "highUnemployment",
    ]);
    // Only the persona-mismatched program (sbif) collapses under a
    // disclosure — present, not dropped.
    expect(also).toBeDefined();
    expect(also.collapsedByPersona).toBe(true);
    expect(also.items.map((i) => i.programId)).toEqual(["sbif"]);

    // Collapse-not-hide: the full program set is preserved across the split.
    expect(new Set(programIds(lensed))).toEqual(
      new Set(["tif", "federalOZ", "sbif", "highUnemployment"]),
    );
    expect(matchedBefore).toBe(4);
    expect(matchedAfter).toBe(3);
  });

  it("keeps pinned overlay items visible even when nothing persona-tagged survives in the section", () => {
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
    expect(lensed.sections[0].items).toHaveLength(1);
    expect(lensed.sections[0].items[0].programId).toBe("highUnemployment");
    expect(matchedAfter).toBe(1);
  });

  it("renders explicit empty-state copy (never a blank page, never the unfiltered list) when a confirmed tier has zero visible programs", () => {
    const report: GeneratedReport = {
      ...reportFixture(),
      sections: [
        {
          id: CONFIRMED_PROGRAMS_SECTION_ID,
          title: CONFIRMED_PROGRAMS_SECTION_TITLE,
          description: "",
          items: [{ label: "SBIF", value: "", programId: "sbif" }],
        },
      ],
    };
    const { report: lensed } = applyPersonaLens(report, "developer");
    // Gate finding 19: found by id — under "developer" this section's title
    // is now overridden to "Capital-relevant programs".
    const confirmed = lensed.sections.find((s) => s.id === CONFIRMED_PROGRAMS_SECTION_ID)!;
    expect(confirmed.items).toHaveLength(0);
    expect(confirmed.description).toBe(personaEmptyProgramsDescription("developer"));
    const also = lensed.sections.find((s) => s.title === ALSO_AT_ADDRESS_TITLE)!;
    expect(also.items.map((i) => i.programId)).toEqual(["sbif"]);
  });

  it("folds a fully-demoted tier (Other Programs Mapped / Additional Programs to Explore) ENTIRELY into the disclosure — goal-matched ∩ persona-tagged never includes it, pinned overlays excepted", () => {
    // The email gate funnels every real instant-flow user into the refined
    // shape: "Programs to Review for Your Goal" + "Other Programs Mapped at
    // This Address". Persona (audience) and goal (outcome) are orthogonal —
    // "Other Programs Mapped" is NOT goal-matched by construction, so under a
    // persona lens it folds into the ONE disclosure in full (its pinned
    // overlay item excepted — context, not a program).
    const refined: GeneratedReport = {
      ...reportFixture(),
      sections: [
        {
          id: GOAL_MATCH_PROGRAMS_SECTION_ID,
          title: GOAL_MATCH_PROGRAMS_SECTION_TITLE,
          description: "",
          items: [
            { label: "SBIF", value: "", programId: "sbif" },
            { label: "Federal OZ", value: "", programId: "federalOZ" },
          ],
        },
        {
          id: OTHER_CONFIRMED_PROGRAMS_SECTION_ID,
          title: OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
          description: "",
          items: [
            { label: "TIF", value: "", programId: "tif" },
            { label: "High Unemployment", value: "", programId: "highUnemployment" },
          ],
        },
        {
          id: SECTION_IDS.neighborhoodEconomicContext,
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
    // Exactly one combined disclosure.
    expect(titles.filter((t) => t === ALSO_AT_ADDRESS_TITLE)).toHaveLength(1);
    // Round-2 board law: neighborhood precedes programs in PART 01 and all
    // canonical program tiers merge into the board's single program section.
    expect(titles).toEqual([
      "Neighborhood context",
      "Capital-relevant programs",
      ALSO_AT_ADDRESS_TITLE,
    ]);

    // Goal-matched tier: persona-tag filtered as before (federalOZ matches
    // developer, sbif does not).
    expect(lensed.sections[1].items.map((i) => i.programId)).toEqual([
      "federalOZ",
      "highUnemployment",
    ]);
    // Fully-demoted TIF is not goal-matched, so it is NOT rescued by
    // matching "developer" and joins SBIF behind the one Also-line.
    const also = lensed.sections[2];
    expect(also.collapsedByPersona).toBe(true);
    expect(also.items.map((i) => i.programId)).toEqual(["sbif", "tif"]);

    // Collapse-not-hide across the refined shape too.
    expect(new Set(programIds(lensed))).toEqual(
      new Set(["sbif", "federalOZ", "tif", "highUnemployment"]),
    );
    expect(matchedBefore).toBe(4);
    expect(matchedAfter).toBe(2);
  });

  it("visiblePersonaProgramNames remains the strict card set, in rendered order", () => {
    const { report: lensed } = applyPersonaLens(reportFixture(), "developer");
    expect(visiblePersonaProgramNames(lensed)).toEqual([
      { programId: "tif", label: "TIF" },
      { programId: "federalOZ", label: "Federal OZ" },
      { programId: "highUnemployment", label: "High Unemployment" },
    ]);
  });

  it("fills the executive summary to three from the lensed disclosure after strict matches, without promoting those programs into the card set", () => {
    const { report: lensed } = applyPersonaLens(reportFixture(), "starting");
    expect(visiblePersonaProgramNames(lensed)).toEqual([
      { programId: "sbif", label: "SBIF" },
      { programId: "highUnemployment", label: "High Unemployment" },
    ]);
    expect(personaSummaryProgramNames(lensed)).toEqual([
      { programId: "sbif", label: "SBIF" },
      { programId: "highUnemployment", label: "High Unemployment" },
      { programId: "tif", label: "TIF" },
    ]);
    expect(
      lensed.sections.find((section) => section.collapsedByPersona)?.items.map(
        (item) => item.programId,
      ),
    ).toContain("tif");
  });

  // Gate finding 1 (regression, real bug this fixes): Civic Representation
  // rows for SSA/CCSA carry `programId` (so their copy can program-link),
  // which used to make them fall through the old un-gated scan and appear
  // in "Programs matched here" — genuinely wrong for a panel about matched
  // PROGRAMS. A fixture WITH a civic section proves the gate excludes it.
  it("excludes Civic Representation's SSA/CCSA rows (they carry programId but are not the 'programs' bucket)", () => {
    const withCivic: GeneratedReport = {
      ...reportFixture(),
      sections: [
        ...reportFixture().sections,
        {
          id: "civic-representation",
          title: "Civic Representation",
          description: "",
          items: [
            { label: "SSA", value: "SSA #51", programId: "ssa" },
            { label: "City corridor", value: "Cottage Grove CCSA", programId: "ccsa" },
          ],
        },
      ],
    };
    const { report: lensed } = applyPersonaLens(withCivic, "developer");
    const names = visiblePersonaProgramNames(lensed);
    expect(names.some((n) => n.programId === "ssa")).toBe(false);
    expect(names.some((n) => n.programId === "ccsa")).toBe(false);
  });

  it("guidepostPartForSection assigns the fixed 3-part anatomy and returns null for 'all' (no guidepost)", () => {
    const { report: lensed } = applyPersonaLens(reportFixture(), "developer");
    // Gate finding 19: found by id, not the (now persona-overridden) title.
    const confirmed = lensed.sections.find((s) => s.id === CONFIRMED_PROGRAMS_SECTION_ID)!;
    const support = lensed.sections.find((s) => s.title === SUPPORT_ORGANIZATIONS_SECTION_TITLE)!;
    expect(guidepostPartForSection(confirmed, "developer")).toBe(2);
    expect(guidepostPartForSection(support, "developer")).toBe(3);
    expect(guidepostPartForSection(confirmed, "all")).toBeNull();
  });

  it("reorders sections per the persona's fixed part order (supporter leads with Neighborhood context, never touching the 3-part anatomy)", () => {
    const { report: lensed } = applyPersonaLens(reportFixture(), "supporter");
    // Gate finding 19: supporter's board title for this section is
    // "Neighborhood context" (R5SupporterFinal) — id stays the same
    // (SECTION_IDS.neighborhoodEconomicContext), only the display title
    // changes; this section still LEADS the part order either way.
    expect(lensed.sections[0].id).toBe(SECTION_IDS.neighborhoodEconomicContext);
    expect(lensed.sections[0].title).toBe("Neighborhood context");
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
      matchedProgramsAfter: 3,
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

describe("Gate finding 19: per-persona section titles", () => {
  function multiSectionReport(): GeneratedReport {
    return {
      ...reportFixture(),
      sections: [
        { id: SECTION_IDS.siteFacts, title: "Site Facts", description: "", items: [] },
        { id: SECTION_IDS.logisticsAccess, title: "Logistics Access", description: "", items: [] },
        { id: SECTION_IDS.civicRepresentation, title: "Civic Representation", description: "", items: [] },
        { id: SECTION_IDS.zoningUseStartingPoint, title: "Zoning & Use Starting Point", description: "", items: [] },
        { id: SECTION_IDS.neighborhoodEconomicContext, title: "Neighborhood Economic Context", description: "", items: [] },
        { id: SECTION_IDS.documentReadinessChecklist, title: "Document Readiness Checklist", description: "", items: [] },
        { id: CAPITAL_PARTNER_SECTION_ID, title: CAPITAL_PARTNER_SECTION_TITLE, description: "", items: [] },
        {
          id: CONFIRMED_PROGRAMS_SECTION_ID,
          title: CONFIRMED_PROGRAMS_SECTION_TITLE,
          description: "",
          items: [{ label: "TIF", value: "", programId: "tif" }],
        },
      ],
    };
  }

  it("id-keyed state (TOC anchors, expand/collapse) survives a title override — the exact ruling this whole finding is built on", () => {
    // The SAME section, the SAME id, rendered under two personas whose
    // board titles for it genuinely differ (owner: "Site facts", developer:
    // "Site facts & county records"). If anchors were still title-derived,
    // this id would change out from under any bookmark/TOC link/deep-link
    // the moment the persona (and therefore the title) changed — the exact
    // regression gate finding 19 surfaced and fixed in sectionToAnchor.
    const { report: ownerLensed } = applyPersonaLens(multiSectionReport(), "starting");
    const { report: devLensed } = applyPersonaLens(multiSectionReport(), "developer");
    const ownerSite = ownerLensed.sections.find((s) => s.id === SECTION_IDS.siteFacts)!;
    const devSite = devLensed.sections.find((s) => s.id === SECTION_IDS.siteFacts)!;

    // Titles genuinely differ per persona...
    expect(ownerSite.title).toBe("Site facts");
    expect(devSite.title).toBe("Site facts & county records");
    expect(ownerSite.title).not.toBe(devSite.title);
    // ...but the id — what TOC hrefs, the rendered DOM id, and hash
    // deep-links all actually key by (app/report/page.tsx sectionToAnchor,
    // gate finding 19) — stays byte-identical across both.
    expect(ownerSite.id).toBe(SECTION_IDS.siteFacts);
    expect(devSite.id).toBe(SECTION_IDS.siteFacts);
    expect(ownerSite.id).toBe(devSite.id);
  });

  it("merges multiple canonical program tiers into the board's one titled program section", () => {
    // OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE is always a "fully demoted"
    // tier (isFullyDemotedTier) — a persona-tagged item never rescues it on
    // its own, only a PINNED OVERLAY item does. highUnemployment is the
    // real pinned overlay id this file's other fixtures already use, so
    // this is the genuine, achievable way to get TWO real, non-collapsed
    // "programs"-bucket sections to coexist for this test.
    const twoProgramTiers: GeneratedReport = {
      ...reportFixture(),
      sections: [
        { id: CONFIRMED_PROGRAMS_SECTION_ID, title: CONFIRMED_PROGRAMS_SECTION_TITLE, description: "", items: [{ label: "TIF", value: "", programId: "tif" }] },
        { id: OTHER_CONFIRMED_PROGRAMS_SECTION_ID, title: OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE, description: "", items: [{ label: "High Unemployment", value: "", programId: "highUnemployment" }] },
      ],
    };
    const { report: lensed } = applyPersonaLens(twoProgramTiers, "developer");
    const titles = lensed.sections.map((s) => s.title);
    expect(titles).toContain("Capital-relevant programs");
    expect(titles).not.toContain(OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE);
    expect(titles.filter((t) => t === "Capital-relevant programs")).toHaveLength(1);
    expect(lensed.sections[0].items.map((item) => item.programId)).toEqual([
      "tif",
      "highUnemployment",
    ]);
  });

  it("per-persona title snapshot — exact strings from the four R5 board files (re-read in full for this finding)", () => {
    const owner = applyPersonaLens(multiSectionReport(), "starting").report;
    const growing = applyPersonaLens(multiSectionReport(), "growing").report;
    const developer = applyPersonaLens(multiSectionReport(), "developer").report;
    const supporter = applyPersonaLens(multiSectionReport(), "supporter").report;
    const looking = applyPersonaLens(multiSectionReport(), "looking").report;

    const titleById = (report: GeneratedReport, id: string) =>
      report.sections.find((s) => s.id === id)?.title;

    // R5OwnerFinal (starting AND growing both render this board — the
    // "Business owner" chip group).
    for (const lensed of [owner, growing]) {
      expect(titleById(lensed, SECTION_IDS.siteFacts)).toBe("Site facts");
      expect(titleById(lensed, SECTION_IDS.logisticsAccess)).toBe("Logistics access");
      expect(titleById(lensed, SECTION_IDS.civicRepresentation)).toBe("Civic representation");
      expect(titleById(lensed, SECTION_IDS.zoningUseStartingPoint)).toBe("Zoning");
      expect(titleById(lensed, CONFIRMED_PROGRAMS_SECTION_ID)).toBe("Programs for your goal");
      expect(titleById(lensed, SECTION_IDS.documentReadinessChecklist)).toBeUndefined();
      expect(titleById(lensed, CAPITAL_PARTNER_SECTION_ID)).toBe("Financing resources");
    }

    // R5DeveloperFinal
    expect(titleById(developer, SECTION_IDS.siteFacts)).toBe("Site facts & county records");
    expect(titleById(developer, SECTION_IDS.logisticsAccess)).toBe("Logistics access");
    expect(titleById(developer, SECTION_IDS.civicRepresentation)).toBe("Civic representation");
    expect(titleById(developer, SECTION_IDS.zoningUseStartingPoint)).toBe("Zoning & district family");
    expect(titleById(developer, SECTION_IDS.neighborhoodEconomicContext)).toBe("Neighborhood context");
    expect(titleById(developer, CONFIRMED_PROGRAMS_SECTION_ID)).toBe("Capital-relevant programs");
    expect(titleById(developer, CAPITAL_PARTNER_SECTION_ID)).toBe("Financing resources");

    // R5SupporterFinal
    expect(titleById(supporter, SECTION_IDS.neighborhoodEconomicContext)).toBe("Neighborhood context");
    expect(titleById(supporter, SECTION_IDS.civicRepresentation)).toBe("Civic representation");
    expect(titleById(supporter, SECTION_IDS.zoningUseStartingPoint)).toBe("Zoning");
    expect(titleById(supporter, CONFIRMED_PROGRAMS_SECTION_ID)).toBe("Programs for the goal");
    expect(titleById(supporter, SECTION_IDS.documentReadinessChecklist)).toBeUndefined();
    expect(titleById(supporter, CAPITAL_PARTNER_SECTION_ID)).toBe("Financing resources");

    // R5LookingFinal — only Civic Representation is a generic section on
    // this board; Location snapshot/What's notable/Explore by interest/The
    // full picture are bespoke panels (components/report/LookingOverview.tsx),
    // not titled ReportSection objects this map can reach.
    expect(titleById(looking, SECTION_IDS.civicRepresentation)).toBe("Civic representation");
    // Confirms the deliberate non-coverage: looking has no override for
    // siteFacts (the board doesn't render a generic "Site Facts" section
    // for it at all — Location snapshot replaces it).
    expect(titleById(looking, SECTION_IDS.siteFacts)).toBeUndefined();
  });

  // Gate round 2, BLOCKER 23 (regression, real bug this fixes): a LEGACY
  // section with NO `id` (a saved report persisted before that field
  // existed — see ReportSection.id's own doc comment) is classifiable by
  // title alone. Once gate finding 19's title override renamed it, a
  // FRESH re-derivation of the guidepost bucket (the old behavior) would
  // no longer match the section's own original title check and silently
  // fall through to "rest" — moving Site Facts/Logistics Access out of
  // PART 01. Fixed by resolving the bucket once, pre-override, and
  // carrying it forward (`ReportSection.guidepostBucket`). This fixture
  // deliberately omits every `id` to exercise exactly that legacy path.
  it("a legacy section with NO id still lands in the correct guidepost PART after its title is renamed, for every persona whose board overrides that title", () => {
    // Markers in `description` (never touched by the title override)
    // identify each section by CONTENT rather than by title — the exact
    // thing that's unsafe to do post-override, which is the whole point
    // of this test.
    const legacySections: GeneratedReport["sections"] = [
      { title: "Site Facts", description: "site-facts-marker", items: [] },
      { title: "Logistics Access", description: "logistics-marker", items: [] },
    ];
    const legacyReport: GeneratedReport = { ...reportFixture(), sections: legacySections };
    for (const persona of ["starting", "growing", "developer"] as const) {
      const { report: lensed } = applyPersonaLens(legacyReport, persona);
      const siteFacts = lensed.sections.find((s) => s.description === "site-facts-marker")!;
      const logistics = lensed.sections.find((s) => s.description === "logistics-marker")!;
      expect(siteFacts.id, `${persona} site facts id`).toBeUndefined(); // genuinely legacy — no id
      expect(logistics.id, `${persona} logistics id`).toBeUndefined();
      // Titles really did get renamed (proves the override actually ran
      // against this id-less fixture, not a no-op).
      expect(siteFacts.title, `${persona} site facts title`).not.toBe("Site Facts");
      expect(logistics.title, `${persona} logistics title`).not.toBe("Logistics Access");
      // ...but PART 01 placement survives regardless (the actual claim
      // this finding is about), whether or not this persona's board
      // happens to rename these two sections.
      expect(guidepostPartForSection(siteFacts, persona), `${persona} site facts PART`).toBe(1);
      expect(guidepostPartForSection(logistics, persona), `${persona} logistics PART`).toBe(1);
    }

    const supporter = applyPersonaLens(legacyReport, "supporter").report;
    expect(supporter.sections).toHaveLength(0);
  });
});
