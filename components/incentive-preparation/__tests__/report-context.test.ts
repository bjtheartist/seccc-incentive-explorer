import { describe, expect, it } from "vitest";
import type { GeneratedReport } from "@/lib/report-engine";
import {
  extractPreparationContext,
  parsePreparationContext,
  PREPARATION_CONTEXT_STORAGE_KEY,
} from "@/components/incentive-preparation/StartPreparationPacketButton";

function reportFixture(): GeneratedReport {
  return {
    title: "Location snapshot",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: "2026-07-10T00:00:00.000Z",
    summary: "",
    metadata: {
      address: "9101 S Commercial Ave",
      industry: "Restaurant",
      projectType: "Improve storefront",
    },
    sections: [
      {
        title: "Likely matches",
        description: "",
        items: [
          { label: "Small Business Improvement Fund", value: "", programId: "sbif" },
          { label: "Small Business Improvement Fund again", value: "", programId: "sbif" },
          { label: "Neighborhood Opportunity Fund", value: "", programId: "nof" },
        ],
      },
    ],
    recommendedActions: [],
    actionRoadmap: [
      {
        tier: "do-this-week",
        label: "Review SBIF",
        description: "",
        programId: "sbif",
        programName: "SBIF",
      },
      {
        tier: "start-gathering",
        label: "Review TIF",
        description: "",
        programId: "tif",
        programName: "TIF",
      },
    ],
  };
}

describe("preparation report context", () => {
  it("exports a stable session storage key and extracts distinct program candidates", () => {
    const context = extractPreparationContext(reportFixture());

    expect(PREPARATION_CONTEXT_STORAGE_KEY).toBe("seccc.incentive-preparation.context.v1");
    expect(context).toEqual({
      projectId: "",
      address: "9101 S Commercial Ave",
      projectGoal: "Improve storefront",
      industry: "Restaurant",
      programs: [
        { programId: "sbif", label: "Small Business Improvement Fund" },
        { programId: "nof", label: "Neighborhood Opportunity Fund" },
        { programId: "tif", label: "TIF" },
      ],
    });
  });

  it("parses only valid stored context and removes duplicate candidates", () => {
    expect(
      parsePreparationContext(
        JSON.stringify({
          projectId: "project-1",
          address: " 9101 S Commercial Ave ",
          projectGoal: " improve-storefront ",
          industry: " Restaurant ",
          programs: [
            { programId: "sbif", label: "SBIF" },
            { programId: "sbif", label: "Duplicate" },
            { programId: "", label: "Ignored" },
          ],
        }),
      ),
    ).toEqual({
      projectId: "project-1",
      address: "9101 S Commercial Ave",
      projectGoal: "improve-storefront",
      industry: "Restaurant",
      programs: [{ programId: "sbif", label: "SBIF" }],
    });
    expect(parsePreparationContext("not json")).toBeNull();
  });
});
