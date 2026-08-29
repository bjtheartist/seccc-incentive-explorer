import { ZONE_LABELS } from "@/lib/constants";
import {
  filterAreaVacancyFeatures,
  vacancyCanonicalTypeLabel,
  vacancySourceLabel,
  type VacancyLicenseFilter,
} from "@/lib/area-vacancy-presentation";
import {
  OWNER_TYPE_LABELS,
  OWNER_TYPE_ORDER,
  type OwnerType,
} from "@/lib/owner-classify";
import { PERMIT_MAP_TYPES, type PermitMapTypeKey } from "@/lib/permit-map";
import type { PermitAreaRecord } from "@/lib/permit-area";
import {
  canonicalVacancyType,
  type VacancyCanonicalType,
  type VacancyFreshnessFilter,
} from "@/lib/vacancy-evidence";

export const AREA_ANALYSIS_EVIDENCE_FAMILY_IDS = [
  "overview",
  "vacancy",
  "context",
  "permits",
  "investment",
  "sources",
] as const;

export type AreaAnalysisEvidenceFamilyId =
  (typeof AREA_ANALYSIS_EVIDENCE_FAMILY_IDS)[number];

export const AREA_ANALYSIS_EVIDENCE_FAMILIES: ReadonlyArray<{
  id: AreaAnalysisEvidenceFamilyId;
  label: string;
}> = [
  { id: "overview", label: "Overview" },
  { id: "vacancy", label: "Vacancy" },
  { id: "context", label: "Area context" },
  { id: "permits", label: "Permit activity" },
  { id: "investment", label: "Public investment" },
  { id: "sources", label: "Sources and methods" },
];

export const AREA_ANALYSIS_PRACTITIONER_NOTES_MAX_LENGTH = 2_000;

export type AreaVacancyFreshnessFilter =
  | "all"
  | Exclude<VacancyFreshnessFilter, "all_records">;

export interface AreaVacancyWorkstationFilters {
  query: string;
  freshness: AreaVacancyFreshnessFilter;
  licenseConflict: VacancyLicenseFilter;
  canonicalType: "all" | VacancyCanonicalType;
  ownerType: string;
  zoneKey: string;
  source: string;
}

export interface AreaPermitWorkstationFilters {
  query: string;
  /** `key:` selects a canonical map type; `raw:` preserves an unmapped source type. */
  type: string;
  status: string;
  /** Four-digit source issue year, `unknown`, or `all`. */
  issueYear: string;
}

export interface AreaAnalysisFacetOption {
  value: string;
  label: string;
  count: number;
}

export interface AreaVacancyFacetOptions {
  freshness: AreaAnalysisFacetOption[];
  licenseConflicts: AreaAnalysisFacetOption[];
  canonicalTypes: AreaAnalysisFacetOption[];
  ownerTypes: AreaAnalysisFacetOption[];
  zoneKeys: AreaAnalysisFacetOption[];
  sources: AreaAnalysisFacetOption[];
}

export interface AreaPermitFacetOptions {
  types: AreaAnalysisFacetOption[];
  statuses: AreaAnalysisFacetOption[];
  issueYears: AreaAnalysisFacetOption[];
}

export const DEFAULT_AREA_VACANCY_WORKSTATION_FILTERS: Readonly<AreaVacancyWorkstationFilters> = {
  query: "",
  freshness: "all",
  licenseConflict: "all",
  canonicalType: "all",
  ownerType: "all",
  zoneKey: "all",
  source: "all",
};

export const DEFAULT_AREA_PERMIT_WORKSTATION_FILTERS: Readonly<AreaPermitWorkstationFilters> = {
  query: "",
  type: "all",
  status: "all",
  issueYear: "all",
};

const COLLATOR = new Intl.Collator("en-US", {
  numeric: true,
  sensitivity: "base",
});

const CANONICAL_VACANCY_ORDER: VacancyCanonicalType[] = [
  "land",
  "building",
  "storefront",
  "other",
];

const VACANCY_SOURCE_ORDER = [
  "cols",
  "cclba",
  "dpd_vacant",
  "311_clean_lot",
  "violations",
];

const PERMIT_TYPE_LABEL_BY_KEY = new Map<PermitMapTypeKey, string>(
  PERMIT_MAP_TYPES.map((type) => [type.key, type.label]),
);

function normalizeSearchText(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function normalizedQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function facetValue(value: unknown, fallback = "unknown"): string {
  if (typeof value !== "string") return fallback;
  return value.trim() || fallback;
}

function facetValuesEqual(left: unknown, right: unknown): boolean {
  return normalizeSearchText(left) === normalizeSearchText(right);
}

function humanizeToken(value: string): string {
  const cleaned = value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!cleaned) return "Unknown";
  return cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function vacancyType(feature: GeoJSON.Feature): VacancyCanonicalType {
  const published = feature.properties?.canonicalType;
  return published === "land" ||
    published === "building" ||
    published === "storefront" ||
    published === "other"
    ? published
    : canonicalVacancyType(feature.properties?.propertyType);
}

function vacancyOwnerType(feature: GeoJSON.Feature): string {
  return facetValue(feature.properties?.ownerType);
}

function vacancySource(feature: GeoJSON.Feature): string {
  return facetValue(feature.properties?.source);
}

function vacancyZoneMatches(
  feature: GeoJSON.Feature,
): Array<{ zoneKey: string; zoneName: string }> {
  const matches = feature.properties?.zoneMatches;
  if (!Array.isArray(matches)) return [];
  const byKey = new Map<string, string>();
  for (const match of matches) {
    const zoneKey =
      typeof match === "string"
        ? match.trim()
        : match && typeof match === "object" &&
            typeof (match as Record<string, unknown>).zoneKey === "string"
          ? String((match as Record<string, unknown>).zoneKey).trim()
          : "";
    if (!zoneKey) continue;
    const zoneName =
      match && typeof match === "object" &&
      typeof (match as Record<string, unknown>).zoneName === "string"
        ? String((match as Record<string, unknown>).zoneName).trim()
        : "";
    const current = byKey.get(zoneKey);
    if (!current || current === zoneKey) {
      byKey.set(zoneKey, zoneName || zoneKey);
    }
  }
  return [...byKey].map(([zoneKey, zoneName]) => ({ zoneKey, zoneName }));
}

function searchObjectValues(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string" || typeof value === "number") {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap(searchObjectValues);
  if (typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(
    searchObjectValues,
  );
}

function vacancySearchText(feature: GeoJSON.Feature): string {
  const properties = feature.properties ?? {};
  const values = [
    properties.id,
    properties.recordId,
    properties.sourceRowId,
    properties.pin,
    properties.address,
    properties.communityArea,
    properties.ward,
    properties.zoningClass,
    properties.ownerName,
    properties.ownerType,
    properties.source,
    properties.status,
    properties.propertyStatus,
    properties.propertyType,
    properties.canonicalType,
    properties.managingOrganization,
    properties.programName,
    properties.programKey,
    ...searchObjectValues(properties.zoneMatches),
    ...searchObjectValues(properties.currentLicenseMatches),
  ];
  return normalizeSearchText(values.filter(Boolean).join(" "));
}

function selectedVacancyFreshness(
  value: AreaVacancyFreshnessFilter,
): VacancyFreshnessFilter {
  return value === "all" ? "all_records" : value;
}

/**
 * Filter the area vacancy evidence without changing its order. The established
 * freshness and current-license semantics remain owned by
 * `filterAreaVacancyFeatures`; workstation facets are then applied with AND.
 */
export function filterAreaVacancyWorkstationFeatures(
  features: readonly GeoJSON.Feature[],
  filters: AreaVacancyWorkstationFilters,
): GeoJSON.Feature[] {
  const query = normalizeSearchText(filters.query);
  return filterAreaVacancyFeatures(
    features,
    selectedVacancyFreshness(filters.freshness),
    filters.licenseConflict,
  ).filter((feature) => {
    if (query && !vacancySearchText(feature).includes(query)) return false;
    if (
      filters.canonicalType !== "all" &&
      vacancyType(feature) !== filters.canonicalType
    ) {
      return false;
    }
    if (
      filters.ownerType !== "all" &&
      !facetValuesEqual(vacancyOwnerType(feature), filters.ownerType)
    ) {
      return false;
    }
    if (
      filters.zoneKey !== "all" &&
      !vacancyZoneMatches(feature).some((match) =>
        facetValuesEqual(match.zoneKey, filters.zoneKey),
      )
    ) {
      return false;
    }
    if (
      filters.source !== "all" &&
      !facetValuesEqual(vacancySource(feature), filters.source)
    ) {
      return false;
    }
    return true;
  });
}

function permitIssueYear(record: PermitAreaRecord): string {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(record.issueDate ?? "");
  return match?.[1] ?? "unknown";
}

/** Stable select value for a canonical or source-only permit type. */
export function areaPermitTypeFilterValue(record: PermitAreaRecord): string {
  if (record.permitTypeKey) return `key:${record.permitTypeKey}`;
  return `raw:${facetValue(record.rawPermitType ?? record.permitTypeLabel, "Not recorded")}`;
}

function rawPermitTypeFromFilter(value: string): string {
  return value.startsWith("raw:") ? value.slice(4).trim() : "";
}

function permitTypeMatches(record: PermitAreaRecord, selected: string): boolean {
  if (selected === "all") return true;
  if (selected.startsWith("key:")) {
    return record.permitTypeKey === selected.slice(4);
  }
  const selectedRaw = rawPermitTypeFromFilter(selected);
  if (!selectedRaw) return false;
  return facetValuesEqual(
    facetValue(record.rawPermitType ?? record.permitTypeLabel, "Not recorded"),
    selectedRaw,
  );
}

function permitSearchText(record: PermitAreaRecord): string {
  return normalizeSearchText(
    [
      record.permitId,
      record.address,
      record.permitTypeKey,
      record.permitTypeLabel,
      record.rawPermitType,
      record.permitStatus,
      record.permitMilestone,
      record.workType,
      record.workDescription,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/** Filter permit rows with one value per facet and AND across active facets. */
export function filterAreaPermitWorkstationRecords(
  records: readonly PermitAreaRecord[],
  filters: AreaPermitWorkstationFilters,
): PermitAreaRecord[] {
  const query = normalizeSearchText(filters.query);
  return records.filter((record) => {
    if (query && !permitSearchText(record).includes(query)) return false;
    if (!permitTypeMatches(record, filters.type)) return false;
    if (
      filters.status !== "all" &&
      !facetValuesEqual(
        facetValue(record.permitStatus, "Not recorded"),
        filters.status,
      )
    ) {
      return false;
    }
    if (
      filters.issueYear !== "all" &&
      permitIssueYear(record) !== filters.issueYear
    ) {
      return false;
    }
    return true;
  });
}

interface FacetAccumulator {
  label: string;
  count: number;
}

function addFacetCount(
  counts: Map<string, FacetAccumulator>,
  value: string,
  label: string,
): void {
  const current = counts.get(value);
  if (!current) {
    counts.set(value, { label, count: 1 });
    return;
  }
  current.count += 1;
  if (COLLATOR.compare(label, current.label) < 0) current.label = label;
}

function sortedFacetOptions(
  counts: Map<string, FacetAccumulator>,
  order?: readonly string[],
): AreaAnalysisFacetOption[] {
  const rank = new Map(order?.map((value, index) => [value, index]) ?? []);
  return [...counts]
    .map(([value, item]) => ({ value, ...item }))
    .sort((left, right) => {
      const leftRank = rank.get(left.value);
      const rightRank = rank.get(right.value);
      if (leftRank !== undefined || rightRank !== undefined) {
        if (leftRank === undefined) return 1;
        if (rightRank === undefined) return -1;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
      return (
        COLLATOR.compare(left.label, right.label) ||
        COLLATOR.compare(left.value, right.value)
      );
    });
}

function withAllOption(
  label: string,
  count: number,
  options: AreaAnalysisFacetOption[],
): AreaAnalysisFacetOption[] {
  return [{ value: "all", label, count }, ...options];
}

function ownerTypeLabel(value: string): string {
  return OWNER_TYPE_LABELS[value as OwnerType] ?? humanizeToken(value);
}

function sourceLabel(value: string): string {
  if (VACANCY_SOURCE_ORDER.includes(value)) return vacancySourceLabel(value);
  if (value === "unknown") return "Source not recorded";
  return humanizeToken(value);
}

/** Derive complete, count-bearing vacancy facets independent of input order. */
export function deriveAreaVacancyFacetOptions(
  features: readonly GeoJSON.Feature[],
): AreaVacancyFacetOptions {
  const canonicalTypes = new Map<string, FacetAccumulator>();
  const ownerTypes = new Map<string, FacetAccumulator>();
  const zoneKeys = new Map<string, FacetAccumulator>();
  const sources = new Map<string, FacetAccumulator>();

  for (const feature of features) {
    const type = vacancyType(feature);
    addFacetCount(canonicalTypes, type, vacancyCanonicalTypeLabel(type));

    const ownerType = vacancyOwnerType(feature);
    addFacetCount(ownerTypes, ownerType, ownerTypeLabel(ownerType));

    for (const match of vacancyZoneMatches(feature)) {
      addFacetCount(
        zoneKeys,
        match.zoneKey,
        ZONE_LABELS[match.zoneKey] ?? humanizeToken(match.zoneKey),
      );
    }

    const source = vacancySource(feature);
    addFacetCount(sources, source, sourceLabel(source));
  }

  const currentCount = filterAreaVacancyFeatures(
    features,
    "current_screening",
    "all",
  ).length;
  const recentReportsCount = filterAreaVacancyFeatures(
    features,
    "recent_reports",
    "all",
  ).length;
  const conflictCount = filterAreaVacancyFeatures(
    features,
    "all_records",
    "conflicts",
  ).length;

  return {
    freshness: [
      { value: "all", label: "All retained records", count: features.length },
      {
        value: "current_screening",
        label: "Current inventory and recent reports",
        count: currentCount,
      },
      {
        value: "recent_reports",
        label: "Recent reports only",
        count: recentReportsCount,
      },
    ],
    licenseConflicts: [
      { value: "all", label: "All license screening results", count: features.length },
      {
        value: "conflicts",
        label: "Current-license conflicts only",
        count: conflictCount,
      },
    ],
    canonicalTypes: withAllOption(
      "All vacancy types",
      features.length,
      sortedFacetOptions(canonicalTypes, CANONICAL_VACANCY_ORDER),
    ),
    ownerTypes: withAllOption(
      "All owner types",
      features.length,
      sortedFacetOptions(ownerTypes, OWNER_TYPE_ORDER),
    ),
    zoneKeys: withAllOption(
      "All incentive zones",
      features.length,
      sortedFacetOptions(zoneKeys),
    ),
    sources: withAllOption(
      "All sources",
      features.length,
      sortedFacetOptions(sources, VACANCY_SOURCE_ORDER),
    ),
  };
}

function permitTypeOptionLabel(record: PermitAreaRecord): string {
  if (record.permitTypeKey) {
    return (
      PERMIT_TYPE_LABEL_BY_KEY.get(record.permitTypeKey) ??
      record.permitTypeLabel
    );
  }
  return facetValue(record.rawPermitType ?? record.permitTypeLabel, "Not recorded");
}

/** Derive complete, count-bearing permit facets independent of input order. */
export function deriveAreaPermitFacetOptions(
  records: readonly PermitAreaRecord[],
): AreaPermitFacetOptions {
  const types = new Map<string, FacetAccumulator>();
  const statuses = new Map<string, FacetAccumulator>();
  const issueYears = new Map<string, FacetAccumulator>();

  for (const record of records) {
    addFacetCount(
      types,
      areaPermitTypeFilterValue(record),
      permitTypeOptionLabel(record),
    );
    const status = facetValue(record.permitStatus, "Not recorded");
    addFacetCount(statuses, status, status);
    const issueYear = permitIssueYear(record);
    addFacetCount(
      issueYears,
      issueYear,
      issueYear === "unknown" ? "Issue year not recorded" : issueYear,
    );
  }

  const yearOptions = sortedFacetOptions(issueYears).sort((left, right) => {
    if (left.value === "unknown") return 1;
    if (right.value === "unknown") return -1;
    return Number(right.value) - Number(left.value);
  });

  return {
    types: withAllOption(
      "All permit types",
      records.length,
      sortedFacetOptions(types),
    ),
    statuses: withAllOption(
      "All recorded statuses",
      records.length,
      sortedFacetOptions(statuses),
    ),
    issueYears: withAllOption("All issue years", records.length, yearOptions),
  };
}

export function hasActiveAreaVacancyFilters(
  filters: AreaVacancyWorkstationFilters,
): boolean {
  return Boolean(
    normalizedQuery(filters.query) ||
      filters.freshness !== "all" ||
      filters.licenseConflict !== "all" ||
      filters.canonicalType !== "all" ||
      filters.ownerType !== "all" ||
      filters.zoneKey !== "all" ||
      filters.source !== "all",
  );
}

export function hasActiveAreaPermitFilters(
  filters: AreaPermitWorkstationFilters,
): boolean {
  return Boolean(
    normalizedQuery(filters.query) ||
      filters.type !== "all" ||
      filters.status !== "all" ||
      filters.issueYear !== "all",
  );
}

/** Human-readable labels in the same deterministic order as the controls. */
export function activeAreaVacancyFilterLabels(
  filters: AreaVacancyWorkstationFilters,
): string[] {
  const labels: string[] = [];
  const query = normalizedQuery(filters.query);
  if (query) labels.push(`Search: ${query}`);
  if (filters.freshness === "current_screening") {
    labels.push("Evidence: Current inventory and recent reports");
  } else if (filters.freshness === "recent_reports") {
    labels.push("Evidence: Recent reports only");
  }
  if (filters.licenseConflict === "conflicts") {
    labels.push("License screening: Current-license conflicts only");
  }
  if (filters.canonicalType !== "all") {
    labels.push(`Vacancy type: ${vacancyCanonicalTypeLabel(filters.canonicalType)}`);
  }
  if (filters.ownerType !== "all") {
    labels.push(`Owner type: ${ownerTypeLabel(filters.ownerType)}`);
  }
  if (filters.zoneKey !== "all") {
    labels.push(
      `Incentive zone: ${ZONE_LABELS[filters.zoneKey] ?? humanizeToken(filters.zoneKey)}`,
    );
  }
  if (filters.source !== "all") {
    labels.push(`Source: ${sourceLabel(filters.source)}`);
  }
  return labels;
}

function permitTypeFilterLabel(value: string): string {
  if (value.startsWith("key:")) {
    const key = value.slice(4) as PermitMapTypeKey;
    return PERMIT_TYPE_LABEL_BY_KEY.get(key) ?? humanizeToken(key);
  }
  return rawPermitTypeFromFilter(value) || "Not recorded";
}

/** Human-readable labels in the same deterministic order as the controls. */
export function activeAreaPermitFilterLabels(
  filters: AreaPermitWorkstationFilters,
): string[] {
  const labels: string[] = [];
  const query = normalizedQuery(filters.query);
  if (query) labels.push(`Search: ${query}`);
  if (filters.type !== "all") {
    labels.push(`Permit type: ${permitTypeFilterLabel(filters.type)}`);
  }
  if (filters.status !== "all") {
    labels.push(`Recorded status: ${filters.status}`);
  }
  if (filters.issueYear !== "all") {
    labels.push(
      filters.issueYear === "unknown"
        ? "Issue year: Not recorded"
        : `Issue year: ${filters.issueYear}`,
    );
  }
  return labels;
}

/**
 * Preserve intentional line breaks, normalize platform line endings, and omit
 * blank notes. Truncation is UTF-16-safe and never exceeds the exported cap.
 */
export function normalizeAreaPractitionerNotes(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return undefined;
  let truncated = normalized.slice(
    0,
    AREA_ANALYSIS_PRACTITIONER_NOTES_MAX_LENGTH,
  );
  const lastCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    truncated = truncated.slice(0, -1);
  }
  truncated = truncated.trimEnd();
  return truncated || undefined;
}
