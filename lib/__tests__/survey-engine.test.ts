import { describe, expect, it } from "vitest";
import programs from "../../public/data/programs.json";
import { scoreSurvey, SURVEY_QUESTIONS } from "../survey-engine";

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
      size: "under500k",
    });
    const sbif = result.matches.find((match) => match.programId === "sbif");

    expect(sbif).toBeDefined();
    expect(sbif!.explanation.basedOnUserAnswers).toEqual(
      expect.arrayContaining(["Hair Care & Beauty", "Own commercial property"]),
    );
    expect(sbif!.explanation.stillToConfirm).toEqual(
      expect.arrayContaining([
        "Program location and boundary requirements",
        "Property type and site-control requirements",
      ]),
    );
    expect(JSON.stringify(sbif)).not.toMatch(/confirmed/i);
  });

  it("uses only program ids backed by the production catalog", () => {
    const result = scoreSurvey({
      industry: "professional",
      property: "none",
      activities: ["advice"],
      size: "preRevenue",
    });
    const productionIds = new Set(programs.map((program) => program.id));

    expect(result.matches.some((match) => match.programId === "workforceSolutions")).toBe(true);
    expect(result.matches.every((match) => productionIds.has(match.programId))).toBe(true);
  });

  it("keeps every answer path free of public ranking and determination language", () => {
    for (const question of SURVEY_QUESTIONS) {
      for (const option of question.options) {
        const answer = question.type === "multi" ? [option.id] : option.id;
        const result = scoreSurvey({ [question.id]: answer });
        const serialized = JSON.stringify(result);

        expect(serialized).not.toMatch(
          /score|confidence|pre-qualif|you may qualify|high match|medium match|appears eligible|\beligible\b/i,
        );
      }
    }
  });
});
