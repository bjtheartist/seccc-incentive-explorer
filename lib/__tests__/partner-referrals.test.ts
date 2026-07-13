import { describe, expect, it } from "vitest";
import {
  addPartnerReferralAttribution,
  PARTNER_REFERRAL_UTM,
} from "@/lib/partner-referrals";

describe("addPartnerReferralAttribution", () => {
  it("adds stable report-handoff attribution and preserves existing parameters", () => {
    const attributed = new URL(
      addPartnerReferralAttribution(
        "https://example.org/intake?language=en#start",
        "community-lender",
      ),
    );

    expect(attributed.searchParams.get("language")).toBe("en");
    expect(attributed.searchParams.get("utm_source")).toBe(
      PARTNER_REFERRAL_UTM.source,
    );
    expect(attributed.searchParams.get("utm_medium")).toBe(
      PARTNER_REFERRAL_UTM.medium,
    );
    expect(attributed.searchParams.get("utm_campaign")).toBe(
      PARTNER_REFERRAL_UTM.campaign,
    );
    expect(attributed.searchParams.get("utm_content")).toBe(
      "community-lender",
    );
    expect(attributed.hash).toBe("#start");
  });

  it("replaces stale attribution instead of duplicating it", () => {
    const attributed = new URL(
      addPartnerReferralAttribution(
        "https://example.org/intake?utm_source=old&utm_medium=email",
      ),
    );

    expect(attributed.searchParams.getAll("utm_source")).toEqual([
      PARTNER_REFERRAL_UTM.source,
    ]);
    expect(attributed.searchParams.getAll("utm_medium")).toEqual([
      PARTNER_REFERRAL_UTM.medium,
    ]);
  });

  it("does not decorate phone, email, relative, or malformed destinations", () => {
    expect(addPartnerReferralAttribution("tel:+13125550100", "partner")).toBe(
      "tel:+13125550100",
    );
    expect(addPartnerReferralAttribution("mailto:intake@example.org", "partner")).toBe(
      "mailto:intake@example.org",
    );
    expect(addPartnerReferralAttribution("/local-intake", "partner")).toBe(
      "/local-intake",
    );
    expect(addPartnerReferralAttribution("not a url", "partner")).toBe(
      "not a url",
    );
  });
});
