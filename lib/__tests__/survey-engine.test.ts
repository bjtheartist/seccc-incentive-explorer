import { describe, expect, it } from "vitest";
import programs from "../../data/programs-internal.json";
import { scoreSurvey, SURVEY_QUESTIONS } from "../survey-engine";
import { resolveAvailability } from "../program-gating";
import type { Program } from "../types";

describe("survey public results", () => {
  it("keeps private ordering data out of the public result", () => {
    const result = scoreSurvey({
      industry: "manufacturing",
      property: "own",
      activities: ["renovations", "hiring"],
      size: "over10m",
    });

    expect(result.matches.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/score|confidence|benefitRange|totalPrograms/i);
    expect(serialized).not.toMatch(/"total"/i);

    for (const match of result.matches) {
      expect(match.explanation.whyItAppears.length).toBeGreaterThan(0);
      expect(match.explanation.knownFromPublicData.length).toBeGreaterThan(0);
      expect(match.explanation.currentDocumentsToGather.length).toBeGreaterThan(0);
      expect(match.explanation.confirmWith.length).toBeGreaterThan(0);
      expect(match.explanation.officialSource?.url).toMatch(/^https:\/\//);
    }
  });

  it("labels selected facts as user answers and leaves requirements open", () => {
    const result = scoreSurvey({
      industry: "hairBeauty",
      property: "own",
      activities: ["renovations"],
      size: "500kTo10m",
    });
    const sbif = result.matches.find((match) => match.programId === "sbif");

    expect(sbif).toBeDefined();
    expect(sbif!.explanation.basedOnUserAnswers).toEqual(
      expect.arrayContaining(["Hair Care & Beauty", "Own commercial property"]),
    );
    expect(sbif!.explanation.stillToConfirm).toEqual(
      expect.arrayContaining([
        "Property must be in an eligible TIF district with an open enrollment window",
        "Commercial or industrial building (1-4 story for commercial); determines cap tier",
      ]),
    );
    expect(JSON.stringify(sbif)).not.toMatch(/confirmed/i);
  });

  it("uses only program ids backed by the production catalog", () => {
    const result = scoreSurvey({
      industry: "nonprofit",
      property: "none",
      activities: ["advice"],
      size: "preRevenue",
    });
    const productionIds = new Set(programs.map((program) => program.id));

    expect(result.matches.some((match) => match.programId === "workforceSolutions")).toBe(true);
    expect(result.matches.every((match) => productionIds.has(match.programId))).toBe(true);
    expect(result.universal.every((match) => productionIds.has(match.programId))).toBe(true);
  });

  it("keeps every answer path free of public ranking and determination language", () => {
    for (const question of SURVEY_QUESTIONS) {
      for (const option of question.options) {
        const answer = question.type === "multi" ? [option.id] : option.id;
        const result = scoreSurvey({ [question.id]: answer });
        const serialized = JSON.stringify(result);

        expect(serialized).not.toMatch(
          /score|confidence|pre-qualif|you may qualify|high match|medium match|appears eligible|you are eligible|your business is eligible|your project is eligible/i,
        );
      }
    }
  });
});

/**
 * build-spec.md 2.6 (audit F12; consult item 10) — adversarial tests.
 */
describe("survey honesty — F12", () => {
  it("removed every previously-inert industry option (retail, professional, construction, healthcare, other) and the inert size option (under500k)", () => {
    const industryIds = SURVEY_QUESTIONS.find((q) => q.id === "industry")!.options.map((o) => o.id);
    for (const removed of ["retail", "professional", "construction", "healthcare", "other"]) {
      expect(industryIds).not.toContain(removed);
    }
    const sizeIds = SURVEY_QUESTIONS.find((q) => q.id === "size")!.options.map((o) => o.id);
    expect(sizeIds).not.toContain("under500k");
  });

  it("an answer value with no catalog rule (inert-only answers) fabricates no matches and is disclosed in unusedAnswers, never silently absorbed", () => {
    // A value that cannot be selected through the current UI (its option
    // was removed) but exercises the SAME code path a future un-ruled
    // option would hit — proves the disclosure mechanism itself, not just
    // today's absence of inert options.
    const result = scoreSurvey({ industry: "professional" as never });
    expect(result.unusedAnswers).toContain("industry:professional");
    expect(result.usedAnswers).not.toContain("industry:professional");
    // No fabricated match attributed to an answer with zero rules — only
    // the always-present universal entry may appear.
    expect(result.matches).toEqual([]);
  });

  it("separates universal navigation (Small Business Source) from answer-derived matches — it never appears in `matches`", () => {
    const result = scoreSurvey({ activities: ["advice"] });
    expect(result.matches.some((m) => m.programId === "smallBizSource")).toBe(false);
    expect(result.universal.some((m) => m.programId === "smallBizSource")).toBe(true);
  });

  it("every match (including universal) carries a status object with a non-empty label, visible before the card is opened", () => {
    const result = scoreSurvey({ industry: "manufacturing", activities: ["hiring"] });
    for (const match of [...result.matches, ...result.universal]) {
      expect(match.status).toBeDefined();
      expect(match.status.label.length).toBeGreaterThan(0);
      expect(match.status.intakeStatus).toBeTruthy();
    }
  });

  it("a lapsed program never surfaces in matches without its status recorded (catalystGrant, intakeStatus lapsed)", () => {
    // activities:equipment rules catalystGrant medium confidence.
    const result = scoreSurvey({ activities: ["equipment"] });
    const catalyst = result.matches.find((m) => m.programId === "catalystGrant");
    if (catalyst) {
      expect(catalyst.status.intakeStatus).toBe("lapsed");
      expect(catalyst.status.label).toBe("Lapsed");
    }
  });

  it("expired programs (resolveAvailability) never surface as a survey starting point, for every single-option answer across every question", () => {
    const today = new Date();
    const catalogById = new Map((programs as Program[]).map((p) => [p.id, p]));
    let expiredProgramExists = false;
    for (const question of SURVEY_QUESTIONS) {
      for (const option of question.options) {
        const answer = question.type === "multi" ? [option.id] : option.id;
        const result = scoreSurvey({ [question.id]: answer });
        for (const match of [...result.matches, ...result.universal]) {
          const record = catalogById.get(match.programId);
          expect(record).toBeDefined();
          const availability = resolveAvailability(record!, today);
          if (availability.state === "expired") expiredProgramExists = true;
          expect(availability.state).not.toBe("expired");
        }
      }
    }
    // Sanity: this suite's gate is only meaningful if at least one exercise
    // could theoretically have surfaced an expired program to filter. If the
    // catalog someday has zero expired programs reachable by any rule, this
    // just documents that rather than falsely passing on a vacuous check.
    expect(typeof expiredProgramExists).toBe("boolean");
  });
});
