import type { GeneratedReport } from "@/lib/report-engine";

// The terminal funnel events (location_snapshot_generated /
// refined_report_generated / vacancy_report_generated) must fire exactly
// once per generated report. Before 2026-07 the instant-mode generation
// effect ALSO fired location_snapshot_generated inline, so every instant
// snapshot was double-counted in the flagship funnel metric. All emission
// now flows through this module's key + gate, keyed to report identity —
// app/report/page.tsx must never call trackEvent with one of these event
// types outside the single generated-report effect.

export function analyticsReportKey(report: GeneratedReport): string {
  return [
    report.reportType,
    report.generatedAt,
    report.metadata?.address || report.title,
  ].join("|");
}

/**
 * The report address's Chicago ZIP, when it has one. Exported because
 * app/report/page.tsx also gates its admin-only ownership panel on it.
 */
export function extractReportZipCode(report: GeneratedReport): string | null {
  const address = report.metadata?.address || "";
  const match = address.match(/\b(606\d{2}|60707|60827)\b/);
  return match?.[1] ?? null;
}

/**
 * The shared analytics envelope for every report-surface event.
 *
 * RF2, first landing: this helper used to exist as three hand-copied
 * local functions — app/report/page.tsx, components/report/ReportDisplay.tsx,
 * and components/report/VacancySpreadsheetSection.tsx each declared their
 * own, with headers saying the duplication was deliberate until RF2 could
 * unify the forks. The copies had already diverged: only page.tsx's carried
 * zipCode/sectionCount/actionCount, so the same event arrived with a
 * different shape depending on which renderer fired it, and nothing caught
 * it. This is that richest version, and all three sites now import it.
 * `source` (and each caller's own `analyticsSource`) is what distinguishes
 * the surface — the payload shape must not.
 */
export function reportAnalyticsPayload(
  report: GeneratedReport,
  source: string,
  metadata: Record<string, string | number | boolean | null | (string | number | boolean)[]> = {},
) {
  const zipCode = extractReportZipCode(report);
  return {
    reportType: report.reportType,
    source,
    address: report.metadata?.address ?? null,
    lat: report.metadata?.lat ?? null,
    lon: report.metadata?.lon ?? null,
    metadata: {
      reportKey: analyticsReportKey(report),
      reportTitle: report.title,
      zipCode,
      sectionCount: report.sections?.length ?? 0,
      actionCount: report.recommendedActions?.length ?? 0,
      ...metadata,
    },
  };
}

export function generatedReportEventType(
  report: GeneratedReport,
  isInstantMode: boolean,
  hasRefinedInstantReport: boolean,
) {
  if (report.reportType === "dev-feasibility" || report.reportType === "best-location") {
    return "vacancy_report_generated" as const;
  }
  // Retired Corridor Intelligence links remain readable for compatibility;
  // any legacy generation keeps its historical funnel event instead of
  // masquerading as a refined report.
  if (report.reportType === "corridor-intelligence") {
    return "corridor_report_generated" as const;
  }
  if (isInstantMode && !hasRefinedInstantReport) {
    return "location_snapshot_generated" as const;
  }
  return "refined_report_generated" as const;
}

export function generatedReportEventKey(
  report: GeneratedReport,
  eventType: string,
  source: string | null,
): string {
  return `${analyticsReportKey(report)}|${eventType}|${source}`;
}

// Remembers the last fired key so re-renders (and effect re-runs from
// unrelated dependency changes) can't re-emit the same report's event.
export function createGeneratedReportEventGate() {
  let firedKey: string | null = null;
  return {
    shouldFire(key: string): boolean {
      if (firedKey === key) return false;
      firedKey = key;
      return true;
    },
  };
}
