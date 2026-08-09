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

describe("census narrative does not infer activity from residents", () => {
  const base = {
    tractId: "17031839900",
    medianIncome: 70_000,
    medianHomeValue: 300_000,
    population: 8_000,
    walkScore: 11,
  };

  it("never claims foot traffic or customer volume from ACS population", () => {
    // Residential population counts who SLEEPS in the tract, not who passes a
    // storefront. lib/site-activity.ts refuses to publish any combined
    // foot-traffic figure even from traffic and transit counts; inferring one
    // from ACS residents is the same violation with weaker evidence.
    for (const population of [500, 3_000, 8_000, 20_000]) {
      const r = censusNarrative({ ...base, population });
      const text = `${r.populationNarrative} ${r.homeValueNarrative} ${r.qualificationNarrative}`;
      expect(text).not.toMatch(/foot traffic|customer volume|customer base|less competition/i);
    }
  });

  it("reports the resident count and points at the measured activity feeds", () => {
    const r = censusNarrative({ ...base, population: 8_000 });
    expect(r.populationNarrative).toContain("8,000 residents");
    expect(r.populationNarrative).toMatch(/counts residents, not visitors or customers/i);
    expect(r.populationNarrative).toMatch(/site activity/i);
  });

  it("does not forecast appreciation or market strength from home value", () => {
    for (const medianHomeValue of [100_000, 200_000, 400_000]) {
      const r = censusNarrative({ ...base, medianHomeValue });
      expect(r.homeValueNarrative).not.toMatch(
        /potential for appreciation|room for growth|strong fundamentals|established market/i,
      );
      expect(r.homeValueNarrative).toMatch(/not an appraisal or a projection/i);
    }
  });

  it("does not assert an area 'has been targeted for public investment'", () => {
    // Whether public money actually landed here is answered by the Community
    // Investment dataset from records, not derived from an ACS home value.
    const r = censusNarrative({ ...base, medianIncome: 30_000, medianHomeValue: 100_000 });
    expect(r.qualificationNarrative).not.toMatch(/targeted for public investment/i);
  });
});
