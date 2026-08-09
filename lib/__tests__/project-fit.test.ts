import { describe, expect, it } from "vitest";
import {
  orderProgramCheckResultsByProjectGoal,
  orderProgramCheckResultsByProjectGoals,
  projectGoalFit,
  projectGoalsFit,
  summarizeProjectFit,
} from "../project-fit";
import type { Program, ProgramCheckResult } from "../types";

function program(id: string, name = id): Pick<Program, "id" | "name"> {
  return { id, name };
}

function result(id: string): ProgramCheckResult {
  return {
    programId: id,
    program: program(id) as Program,
    confidence: "location_eligible",
    confidenceLabel: "Location eligible",
    whyOneLine: "Address match",
    benefitRange: "Contact for details",
    fastestStep: "Confirm fit",
    matchedRules: [],
    notVerified: [],
  };
}

describe("project goal fit", () => {
  it.each([
    ["edge", "hiring"],
    ["sbif", "rehab"],
    ["enterprise", "equipment"],
    ["sbaMicroloan", "equipment"],
  ])("recognizes %s as a strong match for %s", (programId, goal) => {
    expect(projectGoalFit(program(programId), goal)?.level).toBe("strong");
  });

  it("keeps specialized programs behind an industry confirmation", () => {
    const fit = projectGoalFit(program("dataCenter"), "equipment");
    expect(fit?.level).toBe("industry-check");
    expect(fit?.label).toBe("Industry requirements to confirm");
  });

  it("orders goal matches first while keeping the score out of the public summary", () => {
    const ordered = orderProgramCheckResultsByProjectGoal(
      [result("dataCenter"), result("sbif"), result("edge")],
      "hiring",
    );
    const publicFit = summarizeProjectFit(projectGoalFit(program("edge"), "hiring"));

    expect(ordered.map((item) => item.program.id)).toEqual(["edge", "sbif", "dataCenter"]);
    expect(publicFit).toMatchObject({ level: "strong" });
    expect(publicFit).not.toHaveProperty("score");
  });

  it("uses the strongest fit across several selected goals", () => {
    const ordered = orderProgramCheckResultsByProjectGoals(
      [result("sbif"), result("edge"), result("sbaMicroloan")],
      ["hiring", "equipment"],
    );

    expect(ordered.map((item) => item.program.id)).toEqual([
      "edge",
      "sbaMicroloan",
      "sbif",
    ]);
    expect(projectGoalsFit(program("sbaMicroloan"), ["hiring", "equipment"])?.level).toBe("strong");
  });
});
