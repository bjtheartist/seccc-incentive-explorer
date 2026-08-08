import { describe, expect, it } from "vitest";
import { censusNarrative } from "../census-narrative";

const PROHIBITED_DETERMINATION_COPY =
  /may qualify|likely qualifies|you qualify|this neighborhood qualifies/i;

describe("censusNarrative public copy", () => {
  it("labels QCT-related income as modeled screening context", () => {
    const result = censusNarrative({
      tractId: "17031010100",
      medianIncome: 18_500,
      medianHomeValue: 112_100,
      population: 905,
      walkScore: 13,
    });

    expect(result.incomeNarrative).toContain("modeled Qualified Census Tract");
    expect(result.qualificationNarrative).toContain(
      "only the current HUD list can confirm",
    );
    expect(
      `${result.incomeNarrative} ${result.qualificationNarrative}`,
    ).not.toMatch(PROHIBITED_DETERMINATION_COPY);
  });

  it("keeps LMI context neutral and tied to published requirements", () => {
    const result = censusNarrative({
      tractId: "17031010200",
      medianIncome: 45_000,
      medianHomeValue: 180_000,
      population: 3_200,
      walkScore: 11,
    });

    expect(result.incomeNarrative).toContain(
      "modeled low-to-moderate income signal",
    );
    expect(result.incomeNarrative).toContain("published requirements");
    expect(
      `${result.incomeNarrative} ${result.qualificationNarrative}`,
    ).not.toMatch(PROHIBITED_DETERMINATION_COPY);
  });
});
