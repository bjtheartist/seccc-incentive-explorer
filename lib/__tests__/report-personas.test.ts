import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/** Every .ts/.tsx file under `dir`, recursively. */
function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : listSourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}
import {
  ALSO_AT_ADDRESS_TITLE,
  applyPersonaLens,
  applyVisibleProgramBudget,
  PERSONA_VISIBLE_PROGRAM_BUDGET,
  BUCKET_PART,
  guidepostPartForSection,
  PERSONA_SECTION_ORDER,
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

/** A report carrying one section for every canonical bucket the persona
 *  lens knows about. Hoisted to module scope (it was declared inside the
 *  "Gate finding 19" describe) so the owner-ruling 2026-08-31 cap guard can
 *  reuse the SAME fixture the title-override suite already exercises. */
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

  /**
   * Fork-unification round: the saved-report renderer used to wrap a section
   * in `<details>` when `!showPersonaView && section.collapsedByPersona`.
   * That branch was unreachable on every real input and was removed with the
   * merge (docs/report-renderer-unification.md section 6, finding 1). Its
   * unreachability rests on an INPUT-SHAPE invariant, not on the renderer:
   * `collapsedByPersona` has exactly one writer, and that writer never runs
   * for the 'all' lens — so a section can only carry the flag when the lens
   * is a real persona, which is exactly when `showPersonaView` is true.
   *
   * Pinned here so the removal cannot regress silently: if a second writer
   * appears, or the 'all' lens starts producing a new report, the deleted
   * branch becomes reachable and this test says so before a reader finds an
   * un-collapsible section.
   */
  it("'all' produces no collapsedByPersona section, and lib/report-personas.ts is its only writer", () => {
    const report = reportFixture();
    const all = applyPersonaLens(report, "all").report;

    // Same reference in, same reference out — so 'all' cannot add the flag.
    expect(all).toBe(report);
    expect(all.sections?.some((section) => section.collapsedByPersona)).toBe(false);

    // ...and a real persona DOES set it, so the assertion above is not
    // vacuous on a fixture that simply never collapses anything.
    expect(
      applyPersonaLens(report, "developer").report.sections?.some(
        (section) => section.collapsedByPersona,
      ),
    ).toBe(true);

    // One writer, in this module. A second one anywhere in app/ or
    // components/ could set the flag outside the lens, on a report the
    // renderer draws with showPersonaView false.
    const writers = listSourceFiles(join(process.cwd(), "lib"))
      .concat(listSourceFiles(join(process.cwd(), "app")))
      .concat(listSourceFiles(join(process.cwd(), "components")))
      .filter((filePath) => !filePath.includes("__tests__"))
      .filter((filePath) => readFileSync(filePath, "utf8").includes("collapsedByPersona:"))
      .map((filePath) => filePath.slice(process.cwd().length + 1));

    expect(writers).toEqual(["lib/report-personas.ts"]);
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
    // Owner ruling 2026-08-31 (four-section cap): the zoning bucket is off
    // every persona's lens inventory, so the whole section — ZBA diagnostic
    // included — no longer reaches a lensed board at all. This test's claim
    // (the ZBA source diagnostic is not persona-board material) therefore
    // holds a fortiori; the per-item zoning filter in asPersonaBoardFacts
    // stays in place for the "all"/direct-caller path.
    expect(
      lensed.sections.find((section) => section.id === SECTION_IDS.zoningUseStartingPoint),
    ).toBeUndefined();
    // ...and nothing was deleted: "All" still carries the full zoning
    // section, ZBA line and all.
    expect(
      applyPersonaLens(report, "all").report.sections.find(
        (section) => section.id === SECTION_IDS.zoningUseStartingPoint,
      )?.items,
    ).toEqual([
      { label: "City Zoning Classification", value: "B3-2" },
      { label: "City ZBA Case Source", value: "No intersecting record" },
    ]);
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
    // Board law: all canonical program tiers merge into the board's single
    // program section. Owner ruling 2026-08-31 (four-section cap):
    // "neighborhoodContext" is off the developer inventory now (it survives
    // only on supporter), so the Neighborhood Economic Context section that
    // used to lead this list is no longer on the developer lens — it is
    // still in the canonical report, asserted below.
    expect(titles).toEqual(["Capital-relevant programs", ALSO_AT_ADDRESS_TITLE]);
    expect(
      applyPersonaLens(refined, "all").report.sections.map((s) => s.id),
    ).toContain(SECTION_IDS.neighborhoodEconomicContext);

    // Goal-matched tier: persona-tag filtered as before (federalOZ matches
    // developer, sbif does not).
    expect(lensed.sections[0].items.map((i) => i.programId)).toEqual([
      "federalOZ",
      "highUnemployment",
    ]);
    // Fully-demoted TIF is not goal-matched, so it is NOT rescued by
    // matching "developer" and joins SBIF behind the one Also-line.
    const also = lensed.sections[1];
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

  it("fills from a collapsed-only lensed report even when a legacy disclosure title cannot be bucket-classified", () => {
    const collapsedOnly: GeneratedReport = {
      ...reportFixture(),
      sections: [
        {
          id: "legacy-persona-disclosure",
          title: "More mapped programs",
          items: [
            { label: "Program A", value: "", programId: "a" },
            { label: "Program B", value: "", programId: "b" },
            { label: "Program C", value: "", programId: "c" },
          ],
          collapsedByPersona: true,
        },
      ],
    };
    expect(visiblePersonaProgramNames(collapsedOnly)).toEqual([]);
    expect(personaSummaryProgramNames(collapsedOnly)).toEqual([
      { programId: "a", label: "Program A" },
      { programId: "b", label: "Program B" },
      { programId: "c", label: "Program C" },
    ]);
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

    // Owner ruling 2026-08-31 (four-section cap) trimmed the lens
    // inventories, so a board section that is no longer in this persona's
    // PERSONA_SECTION_ORDER never reaches the title override at all — it is
    // gone from the LENS (still whole in "All"). The `toBeUndefined()`
    // lines below record exactly which R5 board sections the cap removed;
    // the surviving strings are still the exact R5 board strings.

    // R5OwnerFinal (starting AND growing both render this board — the
    // "Business owner" chip group).
    for (const lensed of [owner, growing]) {
      expect(titleById(lensed, SECTION_IDS.siteFacts)).toBe("Site facts");
      expect(titleById(lensed, SECTION_IDS.logisticsAccess)).toBeUndefined(); // capped out
      expect(titleById(lensed, SECTION_IDS.civicRepresentation)).toBeUndefined(); // capped out
      expect(titleById(lensed, SECTION_IDS.zoningUseStartingPoint)).toBeUndefined(); // capped out
      expect(titleById(lensed, CONFIRMED_PROGRAMS_SECTION_ID)).toBe("Programs for your goal");
      expect(titleById(lensed, SECTION_IDS.documentReadinessChecklist)).toBeUndefined();
      expect(titleById(lensed, CAPITAL_PARTNER_SECTION_ID)).toBe("Financing resources");
    }

    // R5DeveloperFinal
    expect(titleById(developer, SECTION_IDS.siteFacts)).toBe("Site facts & county records");
    expect(titleById(developer, SECTION_IDS.logisticsAccess)).toBeUndefined(); // capped out
    expect(titleById(developer, SECTION_IDS.civicRepresentation)).toBeUndefined(); // capped out
    expect(titleById(developer, SECTION_IDS.zoningUseStartingPoint)).toBeUndefined(); // capped out
    expect(titleById(developer, SECTION_IDS.neighborhoodEconomicContext)).toBeUndefined(); // capped out (supporter keeps it)
    expect(titleById(developer, CONFIRMED_PROGRAMS_SECTION_ID)).toBe("Capital-relevant programs");
    expect(titleById(developer, CAPITAL_PARTNER_SECTION_ID)).toBe("Financing resources");

    // R5SupporterFinal
    expect(titleById(supporter, SECTION_IDS.neighborhoodEconomicContext)).toBe("Neighborhood context");
    expect(titleById(supporter, SECTION_IDS.civicRepresentation)).toBeUndefined(); // capped out
    expect(titleById(supporter, SECTION_IDS.zoningUseStartingPoint)).toBeUndefined(); // capped out
    expect(titleById(supporter, CONFIRMED_PROGRAMS_SECTION_ID)).toBe("Programs for the goal");
    expect(titleById(supporter, SECTION_IDS.documentReadinessChecklist)).toBeUndefined();
    expect(titleById(supporter, CAPITAL_PARTNER_SECTION_ID)).toBe("Financing resources");

    // Nothing was deleted from the record: every section the cap removed
    // above is still present, under its canonical title, on "All".
    const all = applyPersonaLens(multiSectionReport(), "all").report;
    for (const id of [
      SECTION_IDS.logisticsAccess,
      SECTION_IDS.civicRepresentation,
      SECTION_IDS.zoningUseStartingPoint,
      SECTION_IDS.neighborhoodEconomicContext,
    ]) {
      expect(titleById(all, id), `All view still carries ${id}`).toBeDefined();
    }

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
      expect(siteFacts.id, `${persona} site facts id`).toBeUndefined(); // genuinely legacy — no id
      // The title really did get renamed (proves the override actually ran
      // against this id-less fixture, not a no-op).
      expect(siteFacts.title, `${persona} site facts title`).not.toBe("Site Facts");
      // ...but PART 01 placement survives regardless (the actual claim
      // this finding is about).
      expect(guidepostPartForSection(siteFacts, persona), `${persona} site facts PART`).toBe(1);
      // Owner ruling 2026-08-31 (four-section cap): "logisticsAccess" is on
      // no persona's lens inventory any more, so the legacy Logistics
      // Access section leaves the LENS entirely — which is why this test
      // no longer asserts a renamed-and-still-PART-01 logistics section.
      expect(
        lensed.sections.some((s) => s.description === "logistics-marker"),
        `${persona} logistics off the capped lens`,
      ).toBe(false);
    }

    const supporter = applyPersonaLens(legacyReport, "supporter").report;
    expect(supporter.sections).toHaveLength(0);

    // The cap narrows the LENS, never the record: "all" still carries both
    // legacy sections byte-for-byte (the transparency-floor escape hatch).
    expect(applyPersonaLens(legacyReport, "all").report.sections).toEqual(legacySections);
  });
});

// Owner ruling (Billy, 2026-08-31), binding: no persona-lensed report may
// render more than FOUR canonical sections, and those four must still
// populate all three guidepost parts — the PART 01 / PART 02 / PART 03
// anatomy is unchanged, it just stops being padded. "All" is explicitly
// EXEMPT: it is the full record and the transparency-floor escape hatch.
// Every owner ruling gets an enforcing test; this is that test.
describe("Owner ruling 2026-08-31: persona lenses cap at four canonical sections", () => {
  const REAL_PERSONAS = PERSONA_CHIPS.map((chip) => chip.id).filter(
    (id): id is Exclude<PersonaId, "all"> => id !== "all",
  );

  /** multiSectionReport() carries one section for every canonical bucket
   *  except the PART 03 support-organizations section; reportFixture()
   *  already carries the real one, so borrow it rather than hand-rolling a
   *  new fixture shape for this suite. */
  function boardInventoryReport(): GeneratedReport {
    const supportOrganizations = reportFixture().sections.find(
      (section) => section.title === SUPPORT_ORGANIZATIONS_SECTION_TITLE,
    )!;
    return {
      ...multiSectionReport(),
      sections: [...multiSectionReport().sections, supportOrganizations],
    };
  }

  it("every persona's lens inventory lists at most four canonical buckets", () => {
    expect(REAL_PERSONAS.length).toBeGreaterThan(0);
    for (const persona of REAL_PERSONAS) {
      expect(PERSONA_SECTION_ORDER[persona], `${persona} has a lens inventory`).toBeDefined();
      expect(
        PERSONA_SECTION_ORDER[persona].length,
        `${persona} lens inventory: ${PERSONA_SECTION_ORDER[persona].join(", ")}`,
      ).toBeLessThanOrEqual(4);
    }
  });

  it("every capped inventory still populates all three guidepost parts ('looking' excepted — its board is the bespoke LookingOverview mount)", () => {
    for (const persona of REAL_PERSONAS) {
      if (persona === "looking") continue;
      const parts = new Set(
        PERSONA_SECTION_ORDER[persona].map((bucket) => BUCKET_PART[bucket]),
      );
      expect(
        [...parts].sort(),
        `${persona} guidepost parts from: ${PERSONA_SECTION_ORDER[persona].join(", ")}`,
      ).toEqual([1, 2, 3]);
    }
  });

  it("render level: a real lensed report never carries more than four canonical sections (the collapsed 'Also at this address' disclosure excluded)", () => {
    for (const persona of REAL_PERSONAS) {
      const { report: lensed } = applyPersonaLens(boardInventoryReport(), persona);
      const canonical = lensed.sections.filter(
        (section) => !section.collapsedByPersona && section.title !== ALSO_AT_ADDRESS_TITLE,
      );
      expect(
        canonical.length,
        `${persona} rendered sections: ${canonical.map((s) => s.title).join(" | ")}`,
      ).toBeLessThanOrEqual(4);
      // Non-vacuous: the fixture genuinely offers more buckets than the cap
      // allows, so an uncapped lens would exceed four here.
      expect(boardInventoryReport().sections.length).toBeGreaterThan(4);
    }
  });

  it("the 'All' view is exempt — it keeps the full, uncapped record (the escape hatch the cap depends on)", () => {
    const report = boardInventoryReport();
    const { report: all } = applyPersonaLens(report, "all");
    expect(all).toBe(report);
    expect(all.sections.length).toBeGreaterThan(4);
  });
});

// ─── Owner ruling 2026-08-31: visible program-card budget (N = 6) ────────
// Billy's second 2026-08-31 ruling, alongside the four-section cap above:
// the DEVELOPER and SUPPORTER lenses render at most six program cards.
// Starting/growing are deliberately left unbudgeted this round, and the
// last test in this block pins that so scope creep goes red.

describe("Owner ruling 2026-08-31: visible program-card budget", () => {
  /** Builds a confirmed tier of `ids` program items, all real catalog ids. */
  function programsReport(
    ids: string[],
    options: { sectionId?: string; windows?: Record<string, string> } = {},
  ): GeneratedReport {
    return {
      ...reportFixture(),
      sections: [
        {
          id: options.sectionId ?? CONFIRMED_PROGRAMS_SECTION_ID,
          title:
            options.sectionId === GOAL_MATCH_PROGRAMS_SECTION_ID
              ? GOAL_MATCH_PROGRAMS_SECTION_TITLE
              : CONFIRMED_PROGRAMS_SECTION_TITLE,
          description: "",
          items: ids.map((programId) => ({
            label: programId,
            value: "",
            programId,
            ...(options.windows?.[programId]
              ? { nextWindow: { expected: options.windows[programId], note: null } }
              : {}),
          })),
        },
      ],
    };
  }

  const DEVELOPER_EIGHT = [
    "tif",
    "federalOZ",
    "illinoisOZ",
    "enterprise",
    "edge",
    "rev",
    "micro",
    "dataCenter",
  ];
  const SUPPORTER_EIGHT = [
    "ssa",
    "catalystGrant",
    "smallBizSource",
    "nof",
    "landmarkDistricts",
    "microMarketRecovery",
    "ccsa",
    "innovationVoucher",
  ];

  function visibleAndAlso(report: GeneratedReport, persona: PersonaId) {
    const { report: lensed } = applyPersonaLens(report, persona);
    const programs = lensed.sections.find(
      (section) => !section.collapsedByPersona && section.guidepostBucket === "programs",
    );
    const also = lensed.sections.find((section) => section.title === ALSO_AT_ADDRESS_TITLE);
    return {
      lensed,
      visible: (programs?.items ?? []).map((item) => item.programId),
      also: (also?.items ?? []).map((item) => item.programId),
      alsoDescription: also?.description ?? null,
    };
  }

  it("declares the budget as a named per-persona constant — N=6, developer + supporter ONLY", () => {
    expect(PERSONA_VISIBLE_PROGRAM_BUDGET).toEqual({ developer: 6, supporter: 6 });
  });

  it.each(["developer", "supporter"] as const)(
    "%s: never renders more than six program cards, and the Also disclosure picks up the overflow EXACTLY",
    (persona) => {
      const ids = persona === "developer" ? DEVELOPER_EIGHT : SUPPORTER_EIGHT;
      const report = programsReport(ids);
      // Non-vacuous: every one of these eight really does survive the hard
      // relevance filter for this persona, so an unbudgeted lens shows eight.
      for (const id of ids) expect(programMatchesPersona(id, persona)).toBe(true);

      const { visible, also, alsoDescription } = visibleAndAlso(report, persona);
      expect(visible).toHaveLength(6);
      expect(also).toHaveLength(2);
      // Collapse, never delete: the split is a partition of the full set.
      expect(new Set([...visible, ...also])).toEqual(new Set(ids));
      // The disclosure's own count line is the overflow-aware copy, and it
      // still carries the "nothing is removed" promise.
      expect(alsoDescription).toContain("2 more programs tied to this address");
      expect(alsoDescription).toContain("2 further");
      expect(alsoDescription).toContain("Nothing is removed");
    },
  );

  it.each(["developer", "supporter"] as const)(
    "%s: a report already at or under the budget is byte-for-byte unaffected — no reorder, no disclosure",
    (persona) => {
      const ids = (persona === "developer" ? DEVELOPER_EIGHT : SUPPORTER_EIGHT).slice(0, 6);
      const report = programsReport(ids);
      const { visible, also } = visibleAndAlso(report, persona);
      expect(visible).toEqual(ids); // same set AND same engine order
      expect(also).toEqual([]);
    },
  );

  it.each(["starting", "growing"] as const)(
    "%s stays UNBUDGETED this round — every hard-filter survivor keeps a visible card (scope-creep guard)",
    (persona) => {
      const ids = [
        "sbif",
        "catalystGrant",
        "smallBizSource",
        "nof",
        "ccsa",
        "hubzone",
        "sba7a504",
        "sbaMicroloan",
      ].filter((id) => programMatchesPersona(id, persona));
      expect(ids.length).toBeGreaterThan(6);
      const { visible, also } = visibleAndAlso(programsReport(ids), persona);
      expect(visible).toEqual(ids);
      expect(also).toEqual([]);
      expect(PERSONA_VISIBLE_PROGRAM_BUDGET[persona]).toBeUndefined();
    },
  );

  it("pinned protection/informational overlays are never budgeted out — context, not programs", () => {
    const report = programsReport([...DEVELOPER_EIGHT, "highUnemployment"]);
    const { visible } = visibleAndAlso(report, "developer");
    expect(visible).toHaveLength(6);
    expect(visible).toContain("highUnemployment");
  });

  it("ranks goal-matched programs above persona-tag-only matches when the budget cuts", () => {
    // Four goal-matched (the engine's own goal-match partition) + five that
    // are persona-tagged but arrived in the plain confirmed tier.
    const goalMatched = ["tif", "federalOZ", "illinoisOZ", "enterprise"];
    const tagOnly = ["edge", "rev", "micro", "dataCenter", "cpace"];
    const report: GeneratedReport = {
      ...reportFixture(),
      sections: [
        programsReport(goalMatched, { sectionId: GOAL_MATCH_PROGRAMS_SECTION_ID }).sections[0],
        programsReport(tagOnly).sections[0],
      ],
    };
    const { visible, also } = visibleAndAlso(report, "developer");
    expect(visible).toHaveLength(6);
    // Every goal-matched program survives; the cut falls entirely on the
    // persona-tag-only pool.
    for (const id of goalMatched) expect(visible).toContain(id);
    expect(also).toHaveLength(3);
    for (const id of also) expect(tagOnly).toContain(id);
  });

  it("breaks ties on funding-window proximity, and treats a MISSING window as neutral (never as urgency)", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    const day = 86_400_000;
    const iso = (offsetDays: number) =>
      new Date(now + offsetDays * day).toISOString().slice(0, 10);
    // Slots 0-3 publish no window; slots 4-6 do. The three dated entries
    // re-sequence among THEIR OWN slots by proximity; the four undated ones
    // never move — being undated neither promotes nor demotes them.
    const entries = [
      { item: { label: "b", value: "", programId: "b" }, goalMatched: true },
      { item: { label: "d", value: "", programId: "d" }, goalMatched: true },
      { item: { label: "f", value: "", programId: "f" }, goalMatched: true },
      { item: { label: "g", value: "", programId: "g" }, goalMatched: true },
      { item: { label: "a", value: "", programId: "a", nextWindow: { expected: iso(90), note: null } }, goalMatched: true },
      { item: { label: "c", value: "", programId: "c", nextWindow: { expected: iso(10), note: null } }, goalMatched: true },
      { item: { label: "e", value: "", programId: "e", nextWindow: { expected: iso(45), note: null } }, goalMatched: true },
    ];
    const { visible, overflow } = applyVisibleProgramBudget(entries, 6, now);
    // Of the three programs that publish a window, the two soonest keep their
    // cards and the one 90 days out is the single card cut.
    expect(overflow.map((item) => item.programId)).toEqual(["a"]);
    // Survivors render in their original engine order — the cap removes
    // cards, it does not reshuffle the ones it keeps.
    expect(visible.map((item) => item.programId)).toEqual(["b", "d", "f", "g", "c", "e"]);
  });

  it("a window that has already closed is neutral, not the earliest date on the record", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    const entries = [
      { item: { label: "far", value: "", programId: "far", nextWindow: { expected: "2026-11-30", note: null } }, goalMatched: false },
      { item: { label: "near", value: "", programId: "near", nextWindow: { expected: "2026-09-10", note: null } }, goalMatched: false },
      { item: { label: "past", value: "", programId: "past", nextWindow: { expected: "2020-01-01", note: null } }, goalMatched: false },
    ];
    // A naive "sort by nextWindow.expected" would rank the 2020 date first
    // and hand it the last card. It is treated as no actionable window at
    // all instead: it holds its engine slot and is the one cut.
    const { visible, overflow } = applyVisibleProgramBudget(entries, 2, now);
    expect(overflow.map((item) => item.programId)).toEqual(["past"]);
    expect(visible.map((item) => item.programId)).toEqual(["far", "near"]);
  });

  it("the budget never touches the 'All' view — the full-record escape hatch the ruling depends on", () => {
    const report = programsReport(DEVELOPER_EIGHT);
    const { report: all } = applyPersonaLens(report, "all");
    expect(all).toBe(report);
    expect(all.sections[0].items).toHaveLength(8);
  });
});
