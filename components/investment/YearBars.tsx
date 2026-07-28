import type { YearBreakdown } from "@/lib/investment-analysis";
import { formatCompactDollars, formatCount, formatFullDollars, GRID, INK_40, INK_55, MAGNITUDE_HUE } from "./format";

/**
 * "When it arrived" — a single-series column chart of awarded dollars per year,
 * 2020 → latest. Complies: no legend (one series), thin bars (≤24px) with a
 * 4px-rounded top and square baseline, 2px gaps, ONE direct label on the peak
 * year only, hairline recessive gridlines, one y-axis, and a native hover
 * tooltip on every bar. Un-yeared records are noted in the caption, never
 * plotted at a guessed year.
 */

const W = 520;
const H = 244;
const M_LEFT = 52;
const M_RIGHT = 14;
const M_TOP = 26;
const M_BOTTOM = 30;
const PLOT_W = W - M_LEFT - M_RIGHT;
const PLOT_H = H - M_TOP - M_BOTTOM;
const BASELINE = M_TOP + PLOT_H;

/** Round up to a clean 1 / 2 / 2.5 / 5 / 10 × 10^k ceiling for the axis top. */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * p;
}

/** Column path: square at the baseline, rounded (r) at the top. */
function columnPath(x: number, y: number, w: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, BASELINE - y));
  return [
    `M ${x.toFixed(2)} ${BASELINE}`,
    `L ${x.toFixed(2)} ${(y + rr).toFixed(2)}`,
    `Q ${x.toFixed(2)} ${y.toFixed(2)} ${(x + rr).toFixed(2)} ${y.toFixed(2)}`,
    `L ${(x + w - rr).toFixed(2)} ${y.toFixed(2)}`,
    `Q ${(x + w).toFixed(2)} ${y.toFixed(2)} ${(x + w).toFixed(2)} ${(y + rr).toFixed(2)}`,
    `L ${(x + w).toFixed(2)} ${BASELINE}`,
    "Z",
  ].join(" ");
}

export function YearBars({ byYear, unYeared }: { byYear: YearBreakdown[]; unYeared: number }) {
  if (byYear.length === 0) {
    return (
      <div className="border border-[#0C1B33]/10 bg-white p-6 text-[13px] text-[#0C1B33]/55">
        No dated awards since 2020 in this community.
        {unYeared > 0 ? ` ${formatCount(unYeared)} record${unYeared === 1 ? "" : "s"} carry no year.` : ""}
      </div>
    );
  }

  const maxVal = Math.max(...byYear.map((y) => y.awardedDollars));
  const axisMax = niceCeil(maxVal);
  const bands = byYear.length;
  const bandW = PLOT_W / bands;
  const barW = Math.min(24, bandW - 10);
  const peakYear = byYear.reduce((a, b) => (b.awardedDollars > a.awardedDollars ? b : a));

  const ticks = [0, 0.5, 1].map((t) => t * axisMax);

  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5 sm:p-6">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Awarded dollars by year">
        {/* Gridlines + y ticks */}
        {ticks.map((t) => {
          const y = BASELINE - (t / axisMax) * PLOT_H;
          return (
            <g key={t}>
              <line x1={M_LEFT} y1={y} x2={W - M_RIGHT} y2={y} stroke={GRID} strokeWidth={1} />
              <text
                x={M_LEFT - 8}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill={INK_40}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatCompactDollars(t)}
              </text>
            </g>
          );
        })}

        {/* Columns */}
        {byYear.map((y, i) => {
          const h = (y.awardedDollars / axisMax) * PLOT_H;
          const x = M_LEFT + i * bandW + (bandW - barW) / 2;
          const barY = BASELINE - h;
          const isPeak = y.year === peakYear.year && peakYear.awardedDollars > 0;
          return (
            <g key={y.year}>
              <path d={columnPath(x, barY, barW, 4)} fill={MAGNITUDE_HUE}>
                <title>{`${y.year}: ${formatFullDollars(y.awardedDollars)} · ${formatCount(y.count)} grant${y.count === 1 ? "" : "s"}`}</title>
              </path>
              {isPeak && (
                <text
                  x={x + barW / 2}
                  y={barY - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="#0C1B33"
                >
                  {formatCompactDollars(y.awardedDollars)}
                </text>
              )}
              <text x={x + barW / 2} y={BASELINE + 16} textAnchor="middle" fontSize={10} fill={INK_55}>
                {y.year}
              </text>
            </g>
          );
        })}
      </svg>

      {unYeared > 0 && (
        <p className="mt-3 text-[11px] leading-relaxed text-[#0C1B33]/40">
          {formatCount(unYeared)} record{unYeared === 1 ? "" : "s"} carry no year (development projects and
          undated grants) and are not shown in the trend.
        </p>
      )}
    </div>
  );
}
