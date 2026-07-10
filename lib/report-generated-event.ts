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

export function generatedReportEventType(
  report: GeneratedReport,
  isInstantMode: boolean,
  hasRefinedInstantReport: boolean,
) {
  if (report.reportType === "dev-feasibility" || report.reportType === "best-location") {
    return "vacancy_report_generated" as const;
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
