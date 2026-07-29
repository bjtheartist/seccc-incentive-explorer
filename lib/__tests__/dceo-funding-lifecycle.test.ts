import { describe, expect, it } from "vitest";
import {
  DCEO_FUNDING_LIFECYCLE_POLICY,
  DCEO_FUNDING_LIFECYCLE_STAGE_IDS,
  DCEO_FUNDING_LIFECYCLE_STAGES,
  dceoFundingLifecycleStage,
} from "@/lib/dceo-funding-lifecycle";

describe("DCEO funding lifecycle", () => {
  it("keeps appropriation, executed award, and disbursement distinct", () => {
    expect(DCEO_FUNDING_LIFECYCLE_STAGE_IDS).toEqual([
      "proposed_budget",
      "enacted_authority",
      "appropriation_register",
      "funding_opportunity",
      "executed_award",
      "disbursement",
    ]);
    expect(DCEO_FUNDING_LIFECYCLE_STAGES.map((stage) => stage.sourceField)).toEqual([
      "Recommended project amount",
      "Enacted appropriation",
      "Published balance",
      "Notice of Funding Opportunity",
      "Award Amount",
      "Amount Disbursed",
    ]);
    expect(DCEO_FUNDING_LIFECYCLE_POLICY.amountCombinationPolicy).toBe(
      "never_sum_across_lifecycle_stages",
    );
  });

  it("marks only the current appropriation source as ingested", () => {
    expect(dceoFundingLifecycleStage("appropriation_register").platformCoverage).toBe(
      "ingested",
    );
    expect(dceoFundingLifecycleStage("proposed_budget").platformCoverage).toBe(
      "source_identified",
    );
    expect(dceoFundingLifecycleStage("executed_award").platformCoverage).toBe(
      "source_identified",
    );
    expect(dceoFundingLifecycleStage("disbursement").platformCoverage).toBe(
      "source_identified",
    );
  });

  it("requires source identifiers rather than a hidden match score", () => {
    expect(DCEO_FUNDING_LIFECYCLE_POLICY.crosswalkPolicy).toMatch(
      /official shared identifier/i,
    );
    expect(JSON.stringify(DCEO_FUNDING_LIFECYCLE_POLICY)).not.toMatch(
      /score|rank|probability/i,
    );
    expect(DCEO_FUNDING_LIFECYCLE_POLICY.readerNote).toContain(
      "do not estimate funding",
    );
  });
});
