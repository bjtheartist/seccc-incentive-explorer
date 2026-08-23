// ─── Report charts — data builders (persona spec v2, item 4) ─────────────
// Pure functions only: every chart reads dates already resolved, per
// address, by lib/deadlines.ts's buildDeadlinesSection (SBIF window start/
// end, TIF expiration, program deadlines) — carried onto ReportItem as
// deadlineDate/deadlineKind/deadlineWindowEnd. No new data is fetched or
// invented here, and a chart with nothing real to plot returns null (no
// empty chart shell — the rendering component is responsible for
// rendering nothing in that case).

import { SECTION_IDS } from "@/lib/report-engine";
import type { GeneratedReport, ReportItem } from "@/lib/report-engine";

const AMBER_WITHIN_DAYS = 60;

export interface FundingWindowRow {
  label: string;
  startDate: string;
  endDate: string;
  amber: boolean;
  tooltip: string;
}

function deadlinesSectionItems(report: GeneratedReport): ReportItem[] {
  const section = report.sections?.find(
    (s) => s.id === SECTION_IDS.upcomingDeadlines || s.title === "Upcoming Deadlines Near This Address",
  );
  return section?.items ?? [];
}

function daysFromToday(iso: string): number {
  const target = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Owner persona (starting/growing) — funding-window intervals. Reads the
 * SBIF application window(s) already resolved for this address in the
 * Upcoming Deadlines section. Amber = time-sensitive: either the window
 * opens within 60 days, OR it is open RIGHT NOW (gate finding 6 —
 * `daysToStart >= 0` alone missed the already-open case: a window that
 * opened last week and closes next week is the MOST urgent state, not a
 * non-urgent one, and the old check left it un-highlighted).
 */
export function buildFundingWindowChartData(report: GeneratedReport): FundingWindowRow[] | null {
  const rows = deadlinesSectionItems(report)
    .filter((item) => item.deadlineKind === "sbif_window" && item.deadlineDate)
    .map((item) => {
      const start = item.deadlineDate!;
      const end = item.deadlineWindowEnd || item.deadlineDate!;
      const daysToStart = daysFromToday(start);
      const daysToEnd = daysFromToday(end);
      const opensSoon = daysToStart >= 0 && daysToStart <= AMBER_WITHIN_DAYS;
      const openNow = daysToStart < 0 && daysToEnd >= 0;
      return {
        label: item.label,
        startDate: start,
        endDate: end,
        amber: opensSoon || openNow,
        tooltip: item.detail || `${item.label}: ${item.value}`,
      };
    });
  return rows.length > 0 ? rows : null;
}

export interface IncentiveHorizonRow {
  label: string;
  endDate: string;
  tooltip: string;
}

/**
 * Developer persona — incentive-horizon markers. Reads every TIF
 * expiration and program deadline (e.g. federal Opportunity Zone's own
 * published 2028 sunset, an Enterprise Zone's published expiration) already
 * resolved for this address's visible programs in the Upcoming Deadlines
 * section — never a hardcoded date.
 */
export function buildIncentiveHorizonChartData(report: GeneratedReport): IncentiveHorizonRow[] | null {
  const rows = deadlinesSectionItems(report)
    .filter(
      (item) =>
        (item.deadlineKind === "tif_expiration" || item.deadlineKind === "program_deadline") &&
        item.deadlineDate,
    )
    .map((item) => ({
      label: item.label,
      endDate: item.deadlineDate!,
      tooltip: item.detail || `${item.label}: ${item.value}`,
    }));
  return rows.length > 0 ? rows : null;
}
