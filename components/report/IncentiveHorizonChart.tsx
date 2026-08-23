"use client";

// ─── Incentive Horizon Chart (spec v2 item 4, developer) ─────────────────
// Markers for every TIF expiration + program deadline (e.g. a federal OZ's
// own published sunset date) already resolved for this address's visible
// programs (lib/report-charts.ts). Renders nothing when none are present.

import { buildIncentiveHorizonChartData } from "@/lib/report-charts";
import type { GeneratedReport } from "@/lib/report-engine";

const CHART_WIDTH = 560;
const ROW_HEIGHT = 28;
const LABEL_WIDTH = 220;
const PLOT_WIDTH = CHART_WIDTH - LABEL_WIDTH - 40;
const SPAN_YEARS = 6;

function yearsFromToday(iso: string): number {
  const target = new Date(`${iso}T00:00:00`);
  const today = new Date();
  return (target.getTime() - today.getTime()) / (365.25 * 86_400_000);
}

function xFor(years: number): number {
  const clamped = Math.max(0, Math.min(SPAN_YEARS, years));
  return LABEL_WIDTH + (clamped / SPAN_YEARS) * PLOT_WIDTH;
}

export function IncentiveHorizonChart({ report }: { report: GeneratedReport }) {
  const rows = buildIncentiveHorizonChartData(report);
  if (!rows) return null;

  const height = rows.length * ROW_HEIGHT + 24;

  return (
    <div data-testid="incentive-horizon-chart" className="mt-3">
      <svg viewBox={`0 0 ${CHART_WIDTH} ${height}`} className="w-full max-w-[560px]" role="img" aria-label="Incentive horizon chart">
        <line x1={LABEL_WIDTH} y1={4} x2={LABEL_WIDTH} y2={height - 4} stroke="#0C1B33" strokeOpacity={0.15} />
        <text x={LABEL_WIDTH} y={12} fontSize="9" fill="#0C1B33" fillOpacity={0.4}>
          today
        </text>
        {rows.map((row, index) => {
          const y = index * ROW_HEIGHT + 24;
          const x = xFor(yearsFromToday(row.endDate));
          return (
            <g key={row.label}>
              <title>{row.tooltip}</title>
              <text x={0} y={y + 5} fontSize="10" fill="#0C1B33">
                {row.label.length > 36 ? `${row.label.slice(0, 35)}…` : row.label}
              </text>
              <line x1={LABEL_WIDTH} y1={y} x2={x} y2={y} stroke="#0C1B33" strokeOpacity={0.15} strokeDasharray="2,2" />
              <circle cx={x} cy={y} r={4} fill="#2563EB" />
              <text x={x + 8} y={y + 4} fontSize="9" fill="#0C1B33" fillOpacity={0.6}>
                {row.endDate}
              </text>
            </g>
          );
        })}
      </svg>
      {/* Gate finding 15: named the actual source dataset (City of Chicago
          TIF Annual Reports — the same DATA_SOURCES.tifFinance label used
          elsewhere in this report, see lib/report-engine.ts) instead of a
          vague "published program record." Program-deadline markers trace
          to each program's own published deadline instead; both are real,
          neither fabricated, so both are named rather than blurred into
          one generic phrase. No publication vintage/date is available on
          the underlying TifFinancialsSlim data to cite honestly — naming
          the source is the same bar FundingWindowChart's own citation
          holds itself to. */}
      <p className="mt-1 text-[9px] text-[#0C1B33]/40">
        Source: City of Chicago TIF Annual Reports (district expirations) and each program&apos;s own published deadline — hover a marker for details.
      </p>
    </div>
  );
}
