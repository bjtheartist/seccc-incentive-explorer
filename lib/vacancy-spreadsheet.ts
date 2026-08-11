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
  properties?: Record<string, unknown>;
};

export function toCsvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
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

export function buildVacancySpreadsheetCsv(features: VacancySpreadsheetFeature[]): string {
  const header = [
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
  ];
  const rows = features.map((feature) => {
    const p = feature.properties ?? {};
    return [
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
    ].map(toCsvCell).join(",");
  });

  return [header.join(","), ...rows].join("\n");
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
