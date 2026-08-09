export const SUPPORT_REQUEST_TYPES = ["introduction", "materials_review"] as const;

export type SupportRequestType = (typeof SUPPORT_REQUEST_TYPES)[number];

export const MATERIALS_REVIEW_ORGANIZATION = "Chicago Incentive Explorer support";

export function isSupportRequestType(value: unknown): value is SupportRequestType {
  return typeof value === "string" && SUPPORT_REQUEST_TYPES.includes(value as SupportRequestType);
}

export function supportRequestTypeLabel(value: SupportRequestType): string {
  return value === "materials_review" ? "1:1 materials review" : "Local partner introduction";
}
