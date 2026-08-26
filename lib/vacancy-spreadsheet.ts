import {
  cclbaSourceCoverageSummary,
  type CclbaSourceCoverage,
} from "@/lib/drawn-area-vacancy";

// ─── Vacancy Spreadsheet Helpers ─────────────────────────────────────
// Shared by BOTH ReportDisplay forks (the local copy in app/report/page.tsx
// and components/report/ReportDisplay.tsx). The forks themselves have
// diverged and are intentionally NOT consolidated here (audit RF2 is a
// separate refactor); sharing these helpers keeps the CSV exports and
// vacancy links from diverging further.

export type VacancySpreadsheetFeature = {
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown> | null;
};

export interface VacancySpreadsheetProvenanceContext {
  scopeFingerprint?: string | null;
  selectionMethod?: string | null;
  scopeGeneratedAt?: string | null;
  generationFreshnessFilter?: string | null;
  generationLicenseFilter?: string | null;
  generationManifestSelectedCount?: number | null;
  generationCoverageStatus?: string | null;
  generationLicenseScreeningStatus?: string | null;
  generationSourcePath?: string | null;
  generationFallbackReason?: string | null;
  generationCclbaSourceCoverage?: CclbaSourceCoverage | null;
  currentCoverageStatus?: string | null;
  currentLicenseScreeningStatus?: string | null;
  currentSourcePath?: string | null;
  currentFallbackReason?: string | null;
  currentCclbaSourceCoverage?: CclbaSourceCoverage | null;
}

export function toCsvCell(value: unknown): string {
  const raw = String(value ?? "");
  // Quoting does not stop spreadsheet programs from executing a formula.
  // Neutralize formula/control-leading strings while preserving the published
  // source text for a human reader.
  const safe =
    typeof value === "string" && /^(?:[\s\u0000-\u001f]*[=+\-@]|[\t\r])/.test(raw)
      ? `'${raw}`
      : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function slugifyFilePart(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "locale";
}

export function zoneMatchesToText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((zone) => {
      if (typeof zone === "string") return zone;
      if (zone && typeof zone === "object" && "zoneKey" in zone) {
        return String((zone as { zoneKey?: unknown }).zoneKey ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join("; ");
}

/** Preserve either upstream source details or program/window flags verbatim. */
export function programContextToText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const sourceContextKeys = [
        "sourceRowId",
        "currentStatus",
        "inventoryType",
        "propertyClass",
        "structureType",
        "occupied",
        "askingPrice",
        "minimumBid",
        "neighborhood",
        "comments",
      ] as const;
      if (sourceContextKeys.some((key) => Object.prototype.hasOwnProperty.call(record, key))) {
        const labels: Record<(typeof sourceContextKeys)[number], string> = {
          sourceRowId: "Source row ID",
          currentStatus: "Current status",
          inventoryType: "Inventory type",
          propertyClass: "Property class",
          structureType: "Structure type",
          occupied: "Occupied",
          askingPrice: "Asking price",
          minimumBid: "Minimum bid",
          neighborhood: "Neighborhood",
          comments: "Comments",
        };
        const details = sourceContextKeys.flatMap((key) => {
          const field = record[key];
          return field === null || field === undefined || field === ""
            ? []
            : [`${labels[key]}=${String(field)}`];
        });
        return details.length > 0 ? [details.join("; ")] : [];
      }
      const program = record.program && typeof record.program === "object"
        ? record.program as Record<string, unknown>
        : {};
      const label = [program.name, program.alias, record.id]
        .find((candidate) => typeof candidate === "string" && candidate.trim());
      const flags = [
        "isIneligible",
        "isBeforeApplicationStart",
        "isAfterApplicationEnd",
      ].flatMap((key) =>
        typeof record[key] === "boolean" ? [`${key}=${record[key]}`] : [],
      );
      const prefix = typeof label === "string" ? label.trim() : "Published program context";
      return [`${prefix}${flags.length > 0 ? ` [${flags.join("; ")}]` : ""}`];
    })
    .join(" | ");
}

export function buildVacancySpreadsheetCsv(
  features: VacancySpreadsheetFeature[],
  provenance: VacancySpreadsheetProvenanceContext = {},
): string {
  const header = [
    "Record ID",
    "PIN",
    "Source Key",
    "Source Dataset ID",
    "Source Dataset Label",
    "Source Row ID",
    "Source URL",
    "Source Snapshot ID",
    "Source As Of",
    "Source Retrieved At",
    "Source Status",
    "Address",
    "Property Type",
    "Ward",
    "Community Area",
    "Zoning Class",
    "Sq Ft",
    "Owner Name",
    "Owner Type",
    "Incentive Count",
    "Zone Matches",
    "Owner Jurisdiction",
    "Managing Organization",
    "Published Source / Program Context",
    "Published Source / Program Context Details",
    "Program Key",
    "Offer Round",
    "Application Use",
    "Application Opens",
    "Application Deadline",
    "Application URL",
    "Property Status",
    "Sales Status",
    "Sale Offering Status",
    "Sale Offering Reason",
    "Scope Fingerprint",
    "Selection Method",
    "Scope Generated At",
    "Generation Freshness Filter",
    "Generation License Filter",
    "Generation Manifest Selected Count",
    "Generation Coverage Status",
    "Generation License Screening Status",
    "Generation Source Path",
    "Generation Fallback Reason",
    "Generation CCLBA Source Coverage",
    "Current Coverage Status",
    "Current License Screening Status",
    "Current Source Path",
    "Current Fallback Reason",
    "Current CCLBA Source Coverage",
  ];
  const rows = features.map((feature) => {
    const p = feature.properties ?? {};
    return [
      p.recordId ?? p.id,
      p.pin,
      p.source,
      p.sourceDatasetId,
      p.sourceDatasetLabel,
      p.sourceRowId,
      p.sourceUrl,
      p.sourceSnapshotId,
      p.sourceAsOf,
      p.sourceRetrievedAt,
      p.status,
      p.address,
      p.propertyType,
      p.ward,
      p.communityArea,
      p.zoningClass,
      p.squareFeet,
      p.ownerName,
      p.ownerType,
      p.incentiveCount,
      zoneMatchesToText(p.zoneMatches),
      p.ownerJurisdiction,
      p.managingOrganization,
      p.programName,
      programContextToText(p.programContext),
      p.programKey,
      p.offerRound,
      p.applicationUse,
      p.applicationOpens,
      p.applicationDeadline,
      p.applicationUrl,
      p.propertyStatus,
      p.salesStatus,
      p.saleOfferingStatus,
      p.saleOfferingReason,
      provenance.scopeFingerprint,
      provenance.selectionMethod,
      provenance.scopeGeneratedAt,
      provenance.generationFreshnessFilter,
      provenance.generationLicenseFilter,
      provenance.generationManifestSelectedCount,
      provenance.generationCoverageStatus,
      provenance.generationLicenseScreeningStatus,
      provenance.generationSourcePath,
      provenance.generationFallbackReason,
      cclbaSourceCoverageSummary(provenance.generationCclbaSourceCoverage),
      provenance.currentCoverageStatus,
      provenance.currentLicenseScreeningStatus,
      provenance.currentSourcePath,
      provenance.currentFallbackReason,
      cclbaSourceCoverageSummary(provenance.currentCclbaSourceCoverage),
    ].map(toCsvCell).join(",");
  });

  const hasProvenance = Object.values(provenance).some(
    (value) => value !== undefined && value !== null && value !== "",
  );
  const zeroRowMetadata = rows.length === 0 && hasProvenance
    ? [
        "",
        ["Export Metadata", "Value"].map(toCsvCell).join(","),
        ["Scope Fingerprint", provenance.scopeFingerprint].map(toCsvCell).join(","),
        ["Selection Method", provenance.selectionMethod].map(toCsvCell).join(","),
        ["Scope Generated At", provenance.scopeGeneratedAt].map(toCsvCell).join(","),
        ["Generation Freshness Filter", provenance.generationFreshnessFilter].map(toCsvCell).join(","),
        ["Generation License Filter", provenance.generationLicenseFilter].map(toCsvCell).join(","),
        ["Generation Manifest Selected Count", provenance.generationManifestSelectedCount].map(toCsvCell).join(","),
        ["Generation Coverage Status", provenance.generationCoverageStatus].map(toCsvCell).join(","),
        ["Generation License Screening Status", provenance.generationLicenseScreeningStatus].map(toCsvCell).join(","),
        ["Generation Source Path", provenance.generationSourcePath].map(toCsvCell).join(","),
        ["Generation Fallback Reason", provenance.generationFallbackReason].map(toCsvCell).join(","),
        ["Generation CCLBA Source Coverage", cclbaSourceCoverageSummary(provenance.generationCclbaSourceCoverage)].map(toCsvCell).join(","),
        ["Current Coverage Status", provenance.currentCoverageStatus].map(toCsvCell).join(","),
        ["Current License Screening Status", provenance.currentLicenseScreeningStatus].map(toCsvCell).join(","),
        ["Current Source Path", provenance.currentSourcePath].map(toCsvCell).join(","),
        ["Current Fallback Reason", provenance.currentFallbackReason].map(toCsvCell).join(","),
        ["Current CCLBA Source Coverage", cclbaSourceCoverageSummary(provenance.currentCclbaSourceCoverage)].map(toCsvCell).join(","),
      ]
    : [];

  return [header.join(","), ...rows, ...zeroRowMetadata].join("\n");
}

export function buildTableCsv(columns: string[], rows: string[][]): string {
  return [
    columns.map(toCsvCell).join(","),
    ...rows.map((row) => row.map(toCsvCell).join(",")),
  ].join("\n");
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function buildIncentiveAnalysisUrl(feature: VacancySpreadsheetFeature): string {
  const properties = feature.properties ?? {};
  const coords = Array.isArray(feature.geometry?.coordinates)
    ? feature.geometry.coordinates
    : [];
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  const address = String(properties.address ?? "");

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `/report?instant=true&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&addr=${encodeURIComponent(address)}`;
  }

  return `/report?addr=${encodeURIComponent(address)}`;
}
