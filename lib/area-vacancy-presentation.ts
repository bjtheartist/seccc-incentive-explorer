import {
  canonicalVacancyType,
  includeVacancyForFreshnessFilter,
  type VacancyCanonicalType,
  type VacancyFreshnessFilter,
} from "@/lib/vacancy-evidence";
import type { VacancyLicenseScreeningMetadata } from "@/lib/vacancy-license-screening";
import {
  CCLBA_PUBLIC_DATASET_ID,
  CCLBA_PUBLIC_PORTAL_URL,
} from "@/lib/vacancy-inventory-sources";

export type VacancyLicenseFilter = "all" | "conflicts";

export interface AreaVacancyTypeCounts {
  land: number;
  building: number;
  storefront: number;
  other: number;
  total: number;
}

export interface AreaVacancyReportItem {
  label: string;
  value: string;
  detail?: string;
}

/** Keep every screening fact below the PDF renderer's compact-detail limit. */
export function licenseScreeningReportItems(
  screening: VacancyLicenseScreeningMetadata,
): AreaVacancyReportItem[] {
  const reasons = screening.partialReasons.join(", ") || "none";
  const items = [
    {
      label: "License Screening Coverage",
      value: screening.status,
      detail: `Checked ${screening.checkedCount} of ${screening.candidateCount} candidate exact addresses; ${screening.matchedPropertyCount} returned properties matched.`,
    },
    {
      label: "License Screening Limits",
      value: `Capped: ${screening.capped ? "yes" : "no"}`,
      detail: `Address cap ${screening.addressCap}; root groups: ${screening.successfulBatches} complete, ${screening.failedBatches} incomplete; source calls: ${screening.sourceCallCount}; malformed rows: ${screening.malformedRowCount}.`,
    },
    {
      label: "License Screening Check",
      value: screening.checkedAt ?? "Time unavailable",
      detail: `Policy ${screening.policyVersion}. Partial reasons: ${reasons}.`,
    },
  ];
  if (items.some((item) => item.detail.length > 175)) {
    throw new Error("License screening report detail exceeds the PDF-safe limit");
  }
  return items;
}

export function filterAreaVacancyFeatures(
  features: readonly GeoJSON.Feature[],
  freshnessFilter: VacancyFreshnessFilter,
  licenseFilter: VacancyLicenseFilter,
): GeoJSON.Feature[] {
  return features.filter(
    (feature) =>
      includeVacancyForFreshnessFilter(feature, freshnessFilter) &&
      (licenseFilter === "all" ||
        feature.properties?.licenseCheckState === "match"),
  );
}

export function summarizeAreaVacancyTypes(
  features: readonly GeoJSON.Feature[],
): AreaVacancyTypeCounts {
  const counts: AreaVacancyTypeCounts = {
    land: 0,
    building: 0,
    storefront: 0,
    other: 0,
    total: features.length,
  };
  for (const feature of features) {
    const published = feature.properties?.canonicalType;
    const type: VacancyCanonicalType =
      published === "land" ||
      published === "building" ||
      published === "storefront" ||
      published === "other"
        ? published
        : canonicalVacancyType(feature.properties?.propertyType);
    counts[type] += 1;
  }
  return counts;
}

export function vacancySourceLabel(source: unknown): string {
  if (source === "cols") return "City-Owned Land Inventory";
  if (source === "cclba") {
    return "Cook County Land Bank Authority public record";
  }
  if (source === "dpd_vacant") {
    return "311 Vacant/Abandoned Building Complaint";
  }
  if (source === "311_clean_lot") return "311 Clean Vacant Lot Request";
  if (source === "violations") return "Vacant-building violation record";
  return "Other tracked public record";
}

/**
 * A source enum alone cannot establish that the current official CCLBA feed
 * supplied a row. Require the exact row-level dataset and HTTPS source pair so
 * legacy or pre-migration records never inherit an official inventory claim.
 */
export function isOfficialCclbaPublishedInventorySource(
  properties: unknown,
): boolean {
  if (!properties || typeof properties !== "object") return false;
  const record = properties as Record<string, unknown>;
  return (
    record.source === "cclba" &&
    record.sourceDatasetId === CCLBA_PUBLIC_DATASET_ID &&
    record.sourceUrl === CCLBA_PUBLIC_PORTAL_URL
  );
}

export function vacancyFreshnessLabel(value: unknown): string {
  if (value === "recent") return "Report within the past 3 years";
  if (value === "stale") return "Report older than 3 years";
  return "Source record date unavailable";
}

export function vacancyCanonicalTypeLabel(value: unknown): string {
  const type =
    value === "land" ||
    value === "building" ||
    value === "storefront" ||
    value === "other"
      ? value
      : "other";
  if (type === "land") return "Tracked land signal";
  if (type === "building") return "Tracked building signal";
  if (type === "storefront") return "Tracked storefront signal";
  return "Other tracked vacancy signal";
}

export function currentLicenseConflictSummary(value: unknown): string {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return "";
    }
  }
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((match) => {
      if (!match || typeof match !== "object") return [];
      const record = match as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "License on record";
      const status = typeof record.status === "string" ? record.status : "";
      const expiration =
        typeof record.expirationDate === "string" ? record.expirationDate : "";
      return [`${name}${status ? ` (${status})` : ""}${expiration ? ` through ${expiration}` : ""}`];
    })
    .join("; ");
}

export function vacancyLicenseCheckStateNote(value: unknown): string {
  if (value === "no_match") {
    return "Exact address checked; no issued, unexpired license match was returned. This is not proof that the site is unoccupied.";
  }
  if (value === "unavailable") {
    return "The license source was unavailable for this address. No occupancy inference can be made.";
  }
  if (value === "not_checked_cap") {
    return "This address was not checked because the area exceeded the 500-address screening cap.";
  }
  if (value === "not_checked_address") {
    return "This record had no usable exact address for license screening.";
  }
  return "An issued, unexpired license matched this exact published address. This may indicate current use; confirm.";
}
