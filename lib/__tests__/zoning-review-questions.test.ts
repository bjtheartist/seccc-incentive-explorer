import { describe, expect, it } from "vitest";
import {
  buildZoningReviewNotes,
  getDistrictUseTableLink,
  getZoningReviewActivity,
  ZONING_REVIEW_ACTIVITIES,
} from "@/lib/zoning-review-questions";

const DETERMINATION_LANGUAGE =
  /Permitted by Right|ZBA Approval Required|Not Allowed in District|outcomeCode|outcomeOverride/i;

describe("zoning review questions", () => {
  it("collects restaurant details without producing a zoning outcome", () => {
    const activity = getZoningReviewActivity("restaurant");
    const notes = buildZoningReviewNotes("restaurant", {
      drive_through: "yes",
      alcohol_plan: "with_food",
    });

    expect(activity.questions.map((question) => question.id)).toEqual([
      "drive_through",
      "alcohol_plan",
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({
      answer: "Yes",
      reviewNote: expect.stringContaining("applicable use-table rows"),
    });
    expect(JSON.stringify({ activity, notes })).not.toMatch(DETERMINATION_LANGUAGE);
  });

  it("keeps unanswered and invalid answers out of the review notes", () => {
    expect(buildZoningReviewNotes("day_care", {})).toEqual([]);
    expect(buildZoningReviewNotes("day_care", { care_count: "not-an-option" })).toEqual([]);
  });

  it("preserves open-text activities without guessing a predefined category", () => {
    const notes = buildZoningReviewNotes("other", {
      primary_activity: "Repair bicycles and sell replacement parts.",
      site_activity: "Customers enter the shop; deliveries arrive twice each week.",
    });

    expect(notes).toHaveLength(2);
    expect(notes[0].answer).toBe("Repair bicycles and sell replacement parts.");
    expect(notes[0].reviewNote).toContain("exact ordinance use category");
  });

  it("flags major-project scope without assigning an entitlement outcome", () => {
    const notes = buildZoningReviewNotes("capital_project", {
      capital_project_scope: "ground_up_or_addition",
      capital_project_scale: "yes",
    });

    expect(notes).toHaveLength(2);
    expect(notes[0].reviewNote).toContain("floor area, height, site area");
    expect(notes[1].reviewNote).toContain("confirm whether");
    expect(JSON.stringify(notes)).not.toMatch(DETERMINATION_LANGUAGE);
  });

  it("points each recognized district family to the relevant published chapter", () => {
    expect(getDistrictUseTableLink("RS-3").label).toContain("17-2-0207");
    expect(getDistrictUseTableLink("B3-2").label).toContain("17-3-0207");
    expect(getDistrictUseTableLink("DX-5").label).toContain("17-4-0207");
    expect(getDistrictUseTableLink("M1-2").label).toContain("17-5-0207");
    expect(getDistrictUseTableLink("PMD 8").label).toContain("Chapter 17-6");
    expect(getDistrictUseTableLink("PD 677").context).toContain("site-specific");
  });

  it("contains no hard-coded P/S outcome engine", () => {
    expect(JSON.stringify(ZONING_REVIEW_ACTIVITIES)).not.toMatch(DETERMINATION_LANGUAGE);
  });
});
