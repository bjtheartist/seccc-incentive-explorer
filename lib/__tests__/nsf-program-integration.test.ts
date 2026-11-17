import { describe, expect, it } from "vitest";
import { getProgramsSync } from "../programs-data";
import { GOAL_RULES, isProjectGoalMatch, projectGoalFit } from "../project-fit";
import { programMatchesPersona } from "../report-personas";

describe("NSF catalog discovery integration", () => {
  const nsf = getProgramsSync().find((program) => program.id === "nsfSeedFund")!;

  it("is available through starting/growing discovery lenses, not the developer lens", () => {
    expect(nsf).toBeDefined();
    expect(programMatchesPersona(nsf.id, "starting")).toBe(true);
    expect(programMatchesPersona(nsf.id, "growing")).toBe(true);
    expect(programMatchesPersona(nsf.id, "developer")).toBe(false);
  });

  it("does not infer deep-tech eligibility from any generic goal or industry selection", () => {
    for (const goal of Object.keys(GOAL_RULES)) {
      for (const industry of [undefined, "tech", "manufacturing", "retail"]) {
        const fit = projectGoalFit(nsf, goal, industry);
        expect(fit?.level, `${goal}/${industry}`).toBe("industry-check");
        expect(isProjectGoalMatch(fit)).toBe(false);
        expect(fit?.reason).toContain("high-risk technology R&D");
        expect(fit?.reason).toContain("invitation or prior-award");
        expect(fit?.reason).toContain("not general startup funding");
      }
    }
  });
});
