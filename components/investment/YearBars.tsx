import { BarRounded } from "@visx/shape";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import type { YearBreakdown } from "@/lib/investment-analysis";
import { formatCompactDollars, formatCount, formatFullDollars, GRID, INK_40, INK_55, MAGNITUDE_HUE } from "./format";

/**
 * "When it arrived" — a single-series column chart of awarded dollars per year,
 * 2020 → latest. Built on @visx primitives: a @visx/scale scaleBand places the
 * year columns, a scaleLinear maps dollars to pixels, and @visx/shape's
 * BarRounded draws each column (square baseline, 4px-rounded top) inside a
 * @visx/group Group translated to its band.
 *
 * Complies: no legend (one series), thin bars (≤24px) with a 4px-rounded top and
 * square baseline, 2px gaps, ONE direct label on the peak year only, hairline
 * recessive gridlines, one y-axis, and a native hover tooltip on every bar.
 * Un-yeared records are noted in the caption, never plotted at a guessed year.
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
  const xScale = scaleBand<string>({
    domain: byYear.map((y) => String(y.year)),
    range: [M_LEFT, M_LEFT + PLOT_W],
    padding: 0,
  });
  const yScale = scaleLinear<number>({ domain: [0, axisMax], range: [BASELINE, M_TOP] });
  const bandW = xScale.bandwidth();
  const barW = Math.min(24, bandW - 10);
  const peakYear = byYear.reduce((a, b) => (b.awardedDollars > a.awardedDollars ? b : a));

  const ticks = [0, 0.5, 1].map((t) => t * axisMax);

  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5 sm:p-6">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Awarded dollars by year">
        {/* Gridlines + y ticks */}
        {ticks.map((t) => {
          const y = yScale(t);
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
        {byYear.map((y) => {
          const barY = yScale(y.awardedDollars);
          const h = BASELINE - barY;
          const barX = (bandW - barW) / 2;
          const isPeak = y.year === peakYear.year && peakYear.awardedDollars > 0;
          const tip = `${y.year}: ${formatFullDollars(y.awardedDollars)} · ${formatCount(y.count)} grant${y.count === 1 ? "" : "s"}`;
          return (
            <Group key={y.year} left={xScale(String(y.year)) ?? 0}>
              {h > 0 &&
                (h >= 2 ? (
                  <BarRounded x={barX} y={barY} width={barW} height={h} radius={4} top>
                    {({ path }) => (
                      <path d={path} fill={MAGNITUDE_HUE}>
                        <title>{tip}</title>
                      </path>
                    )}
                  </BarRounded>
                ) : (
                  // Sub-2px slivers can't carry a 4px round without distorting;
                  // render a square nub (visually a hairline, as the old path was).
                  <rect x={barX} y={barY} width={barW} height={h} fill={MAGNITUDE_HUE}>
                    <title>{tip}</title>
                  </rect>
                ))}
              {isPeak && (
                <text
                  x={bandW / 2}
                  y={barY - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="#0C1B33"
                >
                  {formatCompactDollars(y.awardedDollars)}
                </text>
              )}
              <text x={bandW / 2} y={BASELINE + 16} textAnchor="middle" fontSize={10} fill={INK_55}>
                {y.year}
              </text>
            </Group>
          );
        })}
      </svg>

      {unYeared > 0 && (
        <p className="mt-3 text-[11px] leading-relaxed text-[#0C1B33]/40">
          {unYeared === 1
            ? "1 record carries no year"
            : `${formatCount(unYeared)} records carry no year`}{" "}
          (development projects and undated grants) and {unYeared === 1 ? "is" : "are"} not shown in the trend.
        </p>
      )}
    </div>
  );
}
