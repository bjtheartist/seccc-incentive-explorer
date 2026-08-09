export const PRACTITIONER_VALIDATION_CASES = [
  {
    id: "equipment",
    label: "Buy equipment",
    campaign: "practitioner-validation-2026-08-equipment",
  },
  {
    id: "remodel",
    label: "Remodel a space",
    campaign: "practitioner-validation-2026-08-remodel",
  },
  {
    id: "expansion",
    label: "Expand or hire",
    campaign: "practitioner-validation-2026-08-expansion",
  },
  {
    id: "acquisition",
    label: "Acquire a property",
    campaign: "practitioner-validation-2026-08-acquisition",
  },
  {
    id: "multifamily",
    label: "Multifamily development",
    campaign: "practitioner-validation-2026-08-multifamily",
  },
] as const;

export type PractitionerValidationCase = (typeof PRACTITIONER_VALIDATION_CASES)[number];
export type PractitionerValidationCampaign = PractitionerValidationCase["campaign"];

const CASE_BY_CAMPAIGN = new Map<PractitionerValidationCampaign, PractitionerValidationCase>(
  PRACTITIONER_VALIDATION_CASES.map((item) => [item.campaign, item]),
);

export function normalizePractitionerValidationCampaign(
  value: unknown,
): PractitionerValidationCampaign | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return CASE_BY_CAMPAIGN.has(normalized as PractitionerValidationCampaign)
    ? (normalized as PractitionerValidationCampaign)
    : null;
}

export function practitionerValidationCaseForCampaign(
  campaign: unknown,
): PractitionerValidationCase | null {
  const normalized = normalizePractitionerValidationCampaign(campaign);
  return normalized ? CASE_BY_CAMPAIGN.get(normalized) ?? null : null;
}

export function practitionerValidationCampaignFromSearch(
  search: string,
): PractitionerValidationCampaign | null {
  const params = new URLSearchParams(search);
  return normalizePractitionerValidationCampaign(
    params.get("campaign") || params.get("utm_campaign") || params.get("c"),
  );
}

export function resolvePractitionerValidationCampaign({
  explicit,
  search,
  stored,
}: {
  explicit?: unknown;
  search?: string;
  stored?: unknown;
}): PractitionerValidationCampaign | null {
  return (
    normalizePractitionerValidationCampaign(explicit) ||
    practitionerValidationCampaignFromSearch(search ?? "") ||
    normalizePractitionerValidationCampaign(stored)
  );
}

export function practitionerValidationStartPath(item: PractitionerValidationCase): string {
  const params = new URLSearchParams({
    utm_source: `validation-${item.id}`,
    utm_medium: "facilitated-session",
    utm_campaign: item.campaign,
  });
  return `/start?${params.toString()}`;
}
