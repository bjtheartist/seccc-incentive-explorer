import type { GeneratedReport } from "./report-engine";

/**
 * Unique program count for a report (F14, build-spec.md 2.4: "Programs
 * surfaced" must count distinct programIds, never `sections.length` — a
 * section count and a program count are different numbers, and the whole
 * point of the audit finding was that one email path silently swapped one
 * for the other). Exported so every email/count entry point
 * (ReportModals, MapPolygonPanel, FundingWindowChart) shares exactly one
 * implementation.
 */
export function programCount(report: GeneratedReport): number {
  const ids = new Set<string>();
  for (const section of report.sections || []) {
    for (const item of section.items || []) {
      if (item.programId) ids.add(item.programId);
    }
  }
  return ids.size;
}

export function reportEmailGateKey(report: GeneratedReport): string {
  const lat = report.metadata?.lat?.toFixed(5) || "";
  const lon = report.metadata?.lon?.toFixed(5) || "";
  const address = (report.metadata?.address || report.title).trim().toLowerCase();
  return [report.reportType, lat, lon, address].join("|");
}

export function reportRequiresEmailGate(report: GeneratedReport): boolean {
  return report.reportType === "site-incentives"
    || report.reportType === "location-incentives";
}
