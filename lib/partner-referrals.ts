export const PARTNER_REFERRAL_UTM = {
  source: "chicagoincentiveexplorer",
  medium: "referral",
  campaign: "report_handoff",
} as const;

export function addPartnerReferralAttribution(
  rawUrl: string,
  partnerId?: string,
): string {
  const value = rawUrl.trim();
  if (!value) return rawUrl;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return rawUrl;

    url.searchParams.set("utm_source", PARTNER_REFERRAL_UTM.source);
    url.searchParams.set("utm_medium", PARTNER_REFERRAL_UTM.medium);
    url.searchParams.set("utm_campaign", PARTNER_REFERRAL_UTM.campaign);
    if (partnerId?.trim()) {
      url.searchParams.set("utm_content", partnerId.trim());
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}
