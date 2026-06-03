import { describe, expect, it } from "vitest";
import {
  modelNeighborhoodLeakage,
  modelLocalMultiplier,
  scoreAnchor,
  rankAnchors,
  rankCommunityAnchors,
  MULTIPLIER_LOW,
  MULTIPLIER_HIGH,
} from "@/lib/neighborhood-economic-models";

describe("modelNeighborhoodLeakage", () => {
  it("returns null when inputs are missing", () => {
    expect(modelNeighborhoodLeakage({ residentSpendingPowerProxy: null, localAnnualPayroll: 1 })).toBeNull();
    expect(modelNeighborhoodLeakage({ residentSpendingPowerProxy: 1, localAnnualPayroll: null })).toBeNull();
  });

  it("estimates positive leakage when demand outstrips local capacity", () => {
    const result = modelNeighborhoodLeakage({
      residentSpendingPowerProxy: 1_000_000_000,
      localAnnualPayroll: 20_000_000, // capacity = 100M, demand = 320M
    });
    expect(result).not.toBeNull();
    expect(result!.estimatedLeakageRate).toBeGreaterThan(0);
    expect(result!.estimatedLeakageRate).toBeLessThanOrEqual(0.95);
    expect(result!.capturableDemand).toBeCloseTo(320_000_000);
    expect(result!.localCapacity).toBeCloseTo(100_000_000);
    expect(result!.assumptions.length).toBeGreaterThan(0);
  });

  it("clamps leakage to zero when local capacity exceeds demand", () => {
    const result = modelNeighborhoodLeakage({
      residentSpendingPowerProxy: 100_000_000, // demand = 32M
      localAnnualPayroll: 50_000_000, // capacity = 250M
    });
    expect(result!.estimatedLeakageRate).toBe(0);
  });
});

describe("modelLocalMultiplier", () => {
  it("returns null without payroll", () => {
    expect(modelLocalMultiplier({ localAnnualPayroll: null })).toBeNull();
    expect(modelLocalMultiplier({ localAnnualPayroll: 0 })).toBeNull();
  });

  it("applies the scenario multiplier band to payroll", () => {
    const result = modelLocalMultiplier({ localAnnualPayroll: 100_000_000 });
    expect(result!.localOutputEstimateLow).toBe(100_000_000 * MULTIPLIER_LOW);
    expect(result!.localOutputEstimateHigh).toBe(100_000_000 * MULTIPLIER_HIGH);
    expect(result!.localOutputEstimateHigh!).toBeGreaterThan(result!.localOutputEstimateLow!);
  });
});

describe("anchor scoring", () => {
  it("weights employment and revenue above the multiplier-quality traits", () => {
    const big = scoreAnchor({ name: "A", employmentBand: "500+", revenueBand: "20M+" });
    const small = scoreAnchor({ name: "B", employmentBand: "1-9", revenueBand: "<500K" });
    expect(big).toBeGreaterThan(small);
  });

  it("rewards high local linkage / destination draw / staying power", () => {
    const base = { name: "X", employmentBand: "50-99" as const, revenueBand: "1M-5M" as const };
    const plain = scoreAnchor(base);
    const anchored = scoreAnchor({ ...base, draw: "destination", linkage: "high", continuity: "established" });
    expect(anchored).toBeGreaterThan(plain);
  });

  it("ranks and limits anchors by score, dropping nameless entries", () => {
    const ranked = rankAnchors(
      [
        { name: "Small Shop", employmentBand: "1-9", revenueBand: "<500K" },
        { name: "Major Employer", employmentBand: "500+", revenueBand: "20M+", draw: "destination", linkage: "high", continuity: "established" },
        { name: "  ", employmentBand: "500+" },
      ],
      2
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0].name).toBe("Major Employer");
    expect(ranked[0].anchorScore).toBeGreaterThan(ranked[1].anchorScore);
  });
});

describe("rankCommunityAnchors", () => {
  it("ranks curated workbook anchors by total score and drops nameless rows", () => {
    const ranked = rankCommunityAnchors(
      [
        { name: "Corner Store", totalScore: 52 },
        { name: "Regional Hospital", totalScore: 88 },
        { name: "  ", totalScore: 99 },
        { name: "University", totalScore: 81 },
      ],
      2
    );
    expect(ranked).toHaveLength(2);
    expect(ranked.map((a) => a.name)).toEqual(["Regional Hospital", "University"]);
  });
});
