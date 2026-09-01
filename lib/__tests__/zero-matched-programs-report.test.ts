import { describe, expect, it } from "vitest";
import {
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
  generateReportData,
  normalizePublicReportForDisplay,
} from "../report-engine";
import type { Program } from "../types";

/**
 * The zero-matched-programs report — an address that sits outside every mapped
 * incentive zone. This is the worst report the product can produce and the one
 * most likely to read as a bug rather than an answer, yet nothing pinned it:
 * every other generateReportData case in this suite hands the engine at least
 * one matching program.
 *
 * The honest shape (what main produces today, and what this file locks in) is
 * NOT an empty program section — the engine gates the section behind
 * `confirmedPrograms.length > 0`, so a hollow numbered heading over blank space
 * is never emitted. The absence is instead stated in prose: the summary counts
 * "0 programs" out loud. Both halves matter, so both are asserted here — a
 * change that started emitting an empty section, OR one that dropped the count
 * from the summary, would leave a reader unable to tell "nothing matched" from
 * "the report failed to load".
 *
 * Deliberately pinned at the ENGINE level rather than through a render harness:
 * this is a claim about the report DATA, so it holds for the live page, the
 * saved-report fork, and the PDF alike, and it cannot be satisfied by markup
 * that happens to look right in one of them.
 */

const PROGRAM_SECTION_TITLES = [
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
];

type ReportState = Parameters<typeof generateReportData>[0];

function makeState(overrides: Partial<ReportState> = {}): ReportState {
  return {
    reportType: "site-incentives",
    address: "100 E Test St",
    lat: 41.8,
    lon: -87.6,
    neighborhood: "",
    industry: "",
    budgetRange: "",
    projectGoals: [],
    projectType: "",
    customGoal: "",
    proposedUse: "",
    fundingCommitted: "",
    remainingGap: "",
    timeline: "",
    siteControl: "",
    documentsAvailable: [],
    jobsImpact: "",
    supportNeeded: [],
    creditsToAnalyze: [],
    ...overrides,
  };
}

// No zones true, and no program catalog — nothing can match this address.
const NO_ZONES = { tif: false, sbif: false, federalOZ: false };
const NO_PROGRAMS: Program[] = [];

function zeroMatchReport() {
  return generateReportData(makeState(), NO_PROGRAMS, {
    zones: NO_ZONES,
    zoneNames: {},
  });
}

describe("a report where zero programs match", () => {
  it("still produces a real report rather than an empty shell", () => {
    const report = zeroMatchReport();

    expect(report.title).toBeTruthy();
    expect(report.reportType).toBe("site-incentives");
    expect(report.summary).toBeTruthy();
    // The reader gets orienting content, not a blank document.
    expect(report.sections.length).toBeGreaterThan(0);
  });

  it("says out loud that zero programs are linked to the address", () => {
    const report = zeroMatchReport();

    // The honest empty state is prose, not an absence. "0 programs" (plural)
    // is the engine's own phrasing for the zero case.
    expect(report.summary).toContain("0 programs");
    expect(report.summary).toContain("links 0 programs to this address");
  });

  it("emits no hollow program section — the absence is stated, never mimed", () => {
    const report = zeroMatchReport();

    for (const title of PROGRAM_SECTION_TITLES) {
      const section = report.sections.find((candidate) => candidate.title === title);
      // Either the section is absent entirely (today's behavior) or it carries
      // items. What must never ship is a numbered heading with nothing beneath
      // it, which reads to a user as a broken page.
      if (section) {
        expect(section.items.length).toBeGreaterThan(0);
      }
    }
  });

  it("never leaves ANY section as a numbered heading over nothing", () => {
    const report = zeroMatchReport();

    // Generalized form of the guard above: a section with no items and no
    // description renders as a chip, a title, a rule, and blank space.
    const hollow = report.sections.filter(
      (section) => (section.items?.length ?? 0) === 0 && !section.description,
    );
    expect(hollow.map((section) => section.title)).toEqual([]);
  });

  it("does not claim an incentive zone it did not find", () => {
    const report = zeroMatchReport();

    expect(report.executiveSummary?.zoneCount ?? 0).toBe(0);
    expect(report.summary).toContain("0 incentive zones");
  });

  it("survives the public-display normalizer with its honest summary intact", () => {
    // The saved/shared fork runs reports through this normalizer; the zero
    // count must not be laundered out of the headline on the way.
    const publicReport = normalizePublicReportForDisplay(zeroMatchReport());

    expect(publicReport.summary).toContain("0 programs");
    expect(publicReport.sections.length).toBeGreaterThan(0);
  });
});
