"use client";

// ─── Corridor Investment Chart (spec v2 item 4, supporter) ────────────────
// Bar-per-year small-business loan-origination dollars for this address's
// community area, from the FFIEC CRA series the engine already resolved at
// generation time (lib/report-engine.ts, report.corridorInvestment) — real
// committed data, never fetched client-side, never estimated. Renders
// nothing when the community area has no committed series. Gate finding 5
// requires the source line to carry the file's own FFIEC citation verbatim
// — never a paraphrase — so a reader can trace the number back.

import { buildCorridorInvestmentChartData } from "@/lib/report-charts";
import type { GeneratedReport } from "@/lib/report-engine";

const CHART_WIDTH = 560;
const CHART_HEIGHT = 160;
const BAR_GAP = 14;
const AXIS_LEFT = 46;
const AXIS_BOTTOM = 24;

function formatDollars(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

export function CorridorInvestmentChart({ report }: { report: GeneratedReport }) {
  const data = buildCorridorInvestmentChartData(report);
  if (!data || data.rows.length === 0) return null;

  const plotWidth = CHART_WIDTH - AXIS_LEFT - 12;
  const plotHeight = CHART_HEIGHT - AXIS_BOTTOM - 12;
  const maxDollars = Math.max(...data.rows.map((r) => r.dollars), 1);
  const barWidth = (plotWidth - BAR_GAP * (data.rows.length - 1)) / data.rows.length;

  return (
    <div data-testid="corridor-investment-chart" className="mt-3">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full max-w-[560px]"
        role="img"
        aria-label={`Small-business loan originations by year, ${data.communityArea}`}
      >
        <line
          x1={AXIS_LEFT}
          y1={12}
          x2={AXIS_LEFT}
          y2={CHART_HEIGHT - AXIS_BOTTOM}
          stroke="#0C1B33"
          strokeOpacity={0.15}
        />
        <line
          x1={AXIS_LEFT}
          y1={CHART_HEIGHT - AXIS_BOTTOM}
          x2={CHART_WIDTH - 12}
          y2={CHART_HEIGHT - AXIS_BOTTOM}
          stroke="#0C1B33"
          strokeOpacity={0.15}
        />
        <text x={4} y={16} fontSize="9" fill="#0C1B33" fillOpacity={0.4}>
          {formatDollars(maxDollars)}
        </text>
        {data.rows.map((row, index) => {
          const x = AXIS_LEFT + index * (barWidth + BAR_GAP);
          const barHeight = (row.dollars / maxDollars) * plotHeight;
          const y = CHART_HEIGHT - AXIS_BOTTOM - barHeight;
          return (
            <g key={row.year}>
              <title>{`${row.year}: ${formatDollars(row.dollars)} in small-business loan originations`}</title>
              <rect x={x} y={y} width={barWidth} height={barHeight} fill="#2563EB" />
              <text x={x + barWidth / 2} y={y - 4} fontSize="9" fill="#0C1B33" textAnchor="middle">
                {formatDollars(row.dollars)}
              </text>
              <text
                x={x + barWidth / 2}
                y={CHART_HEIGHT - AXIS_BOTTOM + 14}
                fontSize="10"
                fill="#0C1B33"
                textAnchor="middle"
              >
                {row.year}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[9px] text-[#0C1B33]/40">
        {data.communityArea} — small-business loan originations. Source: {data.source}
      </p>
    </div>
  );
}
