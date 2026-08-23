"use client";

// ─── Funding Window Chart (spec v2 item 4, owner: starting/growing) ─────
// Interval bars for the SBIF application window(s) already resolved for
// this address (lib/report-charts.ts, reading lib/deadlines.ts's
// per-address resolution — never a fabricated date). Renders nothing when
// the address has no SBIF window in range.

import { buildFundingWindowChartData } from "@/lib/report-charts";
import type { GeneratedReport } from "@/lib/report-engine";

const CHART_WIDTH = 560;
const ROW_HEIGHT = 30;
const LABEL_WIDTH = 140;
const PLOT_WIDTH = CHART_WIDTH - LABEL_WIDTH - 20;
const SPAN_DAYS = 180; // today - 30d .. today + 150d, a fixed 6-month plotting window

function dayOffset(iso: string): number {
  const target = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function xFor(dayOffsetValue: number): number {
  const clamped = Math.max(-30, Math.min(SPAN_DAYS - 30, dayOffsetValue));
  return LABEL_WIDTH + ((clamped + 30) / SPAN_DAYS) * PLOT_WIDTH;
}

export function FundingWindowChart({ report }: { report: GeneratedReport }) {
  const rows = buildFundingWindowChartData(report);
  if (!rows) return null;

  const height = rows.length * ROW_HEIGHT + 24;
  const todayX = xFor(0);

  return (
    <div data-testid="funding-window-chart" className="mt-3">
      <svg viewBox={`0 0 ${CHART_WIDTH} ${height}`} className="w-full max-w-[560px]" role="img" aria-label="SBIF funding window chart">
        <line x1={todayX} y1={4} x2={todayX} y2={height - 4} stroke="#0C1B33" strokeOpacity={0.15} strokeDasharray="2,2" />
        <text x={todayX} y={12} fontSize="9" fill="#0C1B33" fillOpacity={0.4} textAnchor="middle">
          today
        </text>
        {rows.map((row, index) => {
          const y = index * ROW_HEIGHT + 24;
          const x1 = xFor(dayOffset(row.startDate));
          const x2 = xFor(dayOffset(row.endDate));
          const width = Math.max(x2 - x1, 4);
          return (
            <g key={row.label}>
              <title>{row.tooltip}</title>
              <text x={0} y={y + 5} fontSize="10" fill="#0C1B33">
                {row.label.length > 24 ? `${row.label.slice(0, 23)}…` : row.label}
              </text>
              <rect
                x={x1}
                y={y - 5}
                width={width}
                height={10}
                rx={2}
                fill={row.amber ? "#F59E0B" : "#2563EB"}
              />
              {row.amber && (
                <text x={x1 + width + 6} y={y + 4} fontSize="9" fontWeight={600} fill="#0C1B33">
                  opens within 60 days
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[9px] text-[#0C1B33]/40">
        Source: City of Chicago SBIF rollout calendar — hover a bar for details.
      </p>
    </div>
  );
}
