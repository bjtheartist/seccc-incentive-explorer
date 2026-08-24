import registry from "@/data/curated/investment-inputs/corporate_foundation_registry.json";
import type { CommunityInvestmentRecord, FunderType } from "./community-investment";

export type CorporateFoundationPublicationStatus =
  | "published_itemized"
  | "excluded_aggregate_only"
  | "excluded_attachment_only"
  | "no_chicago_rows";

export interface CorporateFoundationRegistryEntry {
  ein: string;
  funderName: string;
  parentOrganization: string;
  relationshipEvidenceUrl: string;
  publicationStatus: CorporateFoundationPublicationStatus;
}

export const CORPORATE_FOUNDATION_REGISTRY =
  registry.entries as CorporateFoundationRegistryEntry[];

const publishedCorporateFoundationNames = new Set(
  CORPORATE_FOUNDATION_REGISTRY.filter(
    (entry) => entry.publicationStatus === "published_itemized",
  ).map((entry) => entry.funderName),
);

/**
 * True only for reviewed, itemized IRS 990-PF rows already present in the
 * canonical export. The exact-name registry prevents company press releases,
 * attachment-only totals, and similarly named independent foundations from
 * being swept into the category.
 */
export function isCorporateFoundationRecord(
  record: Pick<CommunityInvestmentRecord, "source" | "funderName">,
): boolean {
  return (
    record.source === "foundation" &&
    publishedCorporateFoundationNames.has(record.funderName)
  );
}

/** Analysis-facing classification. It leaves the audited source export intact. */
export function effectiveFunderType(
  record: Pick<CommunityInvestmentRecord, "source" | "funderName" | "funderType">,
): FunderType {
  return isCorporateFoundationRecord(record) ? "corporate" : record.funderType;
}
