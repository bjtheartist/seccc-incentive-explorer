import { describe, expect, it } from "vitest";
import {
  PRACTITIONER_VALIDATION_CASES,
  normalizePractitionerValidationCampaign,
  practitionerValidationCampaignFromSearch,
  practitionerValidationCaseForCampaign,
  practitionerValidationStartPath,
  resolvePractitionerValidationCampaign,
} from "../practitioner-validation";

describe("practitioner validation campaigns", () => {
  const equipment = PRACTITIONER_VALIDATION_CASES[0];
  const remodel = PRACTITIONER_VALIDATION_CASES[1];

  it("accepts only the five named internal campaigns", () => {
    expect(normalizePractitionerValidationCampaign(` ${equipment.campaign.toUpperCase()} `)).toBe(
      equipment.campaign,
    );
    expect(normalizePractitionerValidationCampaign("practitioner-validation-made-up")).toBeNull();
    expect(normalizePractitionerValidationCampaign("summer-marketing-campaign")).toBeNull();
  });

  it("reads supported query aliases and ignores unrelated campaigns", () => {
    expect(
      practitionerValidationCampaignFromSearch(`?utm_campaign=${remodel.campaign}`),
    ).toBe(remodel.campaign);
    expect(practitionerValidationCampaignFromSearch(`?campaign=${equipment.campaign}`)).toBe(
      equipment.campaign,
    );
    expect(practitionerValidationCampaignFromSearch("?utm_campaign=ordinary-outreach")).toBeNull();
  });

  it("prefers explicit attribution before URL and stored session attribution", () => {
    expect(
      resolvePractitionerValidationCampaign({
        explicit: equipment.campaign,
        search: `?campaign=${remodel.campaign}`,
        stored: remodel.campaign,
      }),
    ).toBe(equipment.campaign);
    expect(
      resolvePractitionerValidationCampaign({
        search: "",
        stored: remodel.campaign,
      }),
    ).toBe(remodel.campaign);
  });

  it("builds a facilitated start link and resolves its case", () => {
    const path = practitionerValidationStartPath(equipment);
    const url = new URL(path, "https://chicagoincentiveexplorer.com");

    expect(url.pathname).toBe("/start");
    expect(url.searchParams.get("utm_source")).toBe("validation-equipment");
    expect(url.searchParams.get("utm_medium")).toBe("facilitated-session");
    expect(url.searchParams.get("utm_campaign")).toBe(equipment.campaign);
    expect(practitionerValidationCaseForCampaign(equipment.campaign)).toEqual(equipment);
  });
});
