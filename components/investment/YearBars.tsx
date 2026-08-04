import { BarRounded } from "@visx/shape";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import type { YearBreakdown } from "@/lib/investment-analysis";
import { formatAsOf, formatCompactDollars, formatCount, formatFullDollars, GRID, INK_40, INK_55, MAGNITUDE_HUE } from "./format";

/**
 * "When it arrived" — a single-series column chart per year, 2020 → latest. Built
 * on @visx primitives: a @visx/scale scaleBand places the year columns, a
 * scaleLinear maps the value to pixels, and @visx/shape's BarRounded draws each
 * column (square baseline, 4px-rounded top) inside a @visx/group Group.
 *
 * `mode` picks the y measure — awarded dollars (default) or grant count — so a
 * client toggle (YearModeToggle) can swap between two server-rendered instances.
 * The export year is shaded with a diagonal hatch and marked "YTD" when the
 * committed export was generated before year end, so the annotation follows the
 * dataset metadata instead of a hard-coded calendar year. The exact as-of date is
 * printed beneath the chart.
 *
 * Complies: no legend (one series), thin bars (≤24px) with a 4px-rounded top and
 * square baseline, ONE direct label on the peak year only, hairline gridlines, one
 * y-axis, native hover tooltips. Un-yeared records are noted, never plotted at a
 * guessed year. Every dollar is an AWARDED amount.
 */

const W = 520;
const H = 244;
const M_LEFT = 52;
const M_RIGHT = 14;
const M_TOP = 26;
const M_BOTTOM = 34;
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

export function YearBars({
  byYear,
  unYeared,
  generatedAt,
  mode = "amount",
}: {
  byYear: YearBreakdown[];
  unYeared: number;
  generatedAt: string;
  mode?: "amount" | "count";
}) {
  if (byYear.length === 0) {
    return (
      <div className="border border-[#0C1B33]/10 bg-white p-6 text-[13px] text-[#0C1B33]/55">
        No dated awards since 2020 in this community.
        {unYeared > 0 ? ` ${formatCount(unYeared)} record${unYeared === 1 ? "" : "s"} carry no year.` : ""}
      </div>
    );
  }

  const valueOf = (y: YearBreakdown) => (mode === "amount" ? y.awardedDollars : y.count);
  const fmtValue = (v: number) => (mode === "amount" ? formatCompactDollars(v) : formatCount(Math.round(v)));
  const hatchId = `ytd-hatch-${mode}`;
  const exportDate = new Date(generatedAt);
  const partialYear = Number.isNaN(exportDate.getTime()) ||
    (exportDate.getUTCMonth() === 11 && exportDate.getUTCDate() === 31)
    ? null
    : exportDate.getUTCFullYear();

  const maxVal = Math.max(...byYear.map(valueOf));
  const axisMax = niceCeil(maxVal);
  const xScale = scaleBand<string>({
    domain: byYear.map((y) => String(y.year)),
    range: [M_LEFT, M_LEFT + PLOT_W],
    padding: 0,
  });
  const yScale = scaleLinear<number>({ domain: [0, axisMax], range: [BASELINE, M_TOP] });
  const bandW = xScale.bandwidth();
  const barW = Math.min(24, bandW - 10);
  const peakYear = byYear.reduce((a, b) => (valueOf(b) > valueOf(a) ? b : a));
  const hasYtd = partialYear != null && byYear.some((y) => y.year === partialYear && valueOf(y) > 0);

  const ticks = [0, 0.5, 1].map((t) => t * axisMax);

  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5 sm:p-6">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Awarded ${mode === "amount" ? "dollars" : "grant count"} by year`}>
        <defs>
          {/* Diagonal hatch marking the partial (YTD) year. */}
          <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill={MAGNITUDE_HUE} opacity={0.28} />
            <line x1="0" y1="0" x2="0" y2="5" stroke={MAGNITUDE_HUE} strokeWidth={2} />
          </pattern>
        </defs>

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
                {fmtValue(t)}
              </text>
            </g>
          );
        })}

        {/* Columns */}
        {byYear.map((y) => {
          const v = valueOf(y);
          const barY = yScale(v);
          const h = BASELINE - barY;
          const barX = (bandW - barW) / 2;
          const isPeak = y.year === peakYear.year && valueOf(peakYear) > 0;
          const isYtd = y.year === partialYear;
          const amountText = formatFullDollars(y.awardedDollars);
          const countText = `${formatCount(y.count)} grant${y.count === 1 ? "" : "s"}`;
          const tip = `${y.year}: ${mode === "amount" ? `${amountText} · ${countText}` : `${countText} · ${amountText}`}${isYtd ? " · year-to-date" : ""}`;
          return (
            <Group key={y.year} left={xScale(String(y.year)) ?? 0}>
              {h > 0 &&
                (h >= 2 ? (
                  <BarRounded x={barX} y={barY} width={barW} height={h} radius={4} top>
                    {({ path }) => (
                      <path d={path} fill={isYtd ? `url(#${hatchId})` : MAGNITUDE_HUE}>
                        <title>{tip}</title>
                      </path>
                    )}
                  </BarRounded>
                ) : (
                  // Sub-2px slivers can't carry a 4px round without distorting;
                  // render a square nub (visually a hairline, as the old path was).
                  <rect x={barX} y={barY} width={barW} height={h} fill={isYtd ? `url(#${hatchId})` : MAGNITUDE_HUE}>
                    <title>{tip}</title>
                  </rect>
                ))}
              {isPeak && (
                <text x={bandW / 2} y={barY - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="#0C1B33">
                  {fmtValue(v)}
                </text>
              )}
              <text x={bandW / 2} y={BASELINE + 16} textAnchor="middle" fontSize={10} fill={INK_55}>
                {y.year}
              </text>
              {isYtd && (
                <text x={bandW / 2} y={BASELINE + 27} textAnchor="middle" fontSize={8} fill={INK_40} style={{ letterSpacing: "0.06em" }}>
                  YTD
                </text>
              )}
            </Group>
          );
        })}
      </svg>

      <p className="mt-3 text-[11px] leading-relaxed text-[#0C1B33]/40">
        {hasYtd ? `${partialYear} is partial through ${formatAsOf(generatedAt)} (hatched). ` : ""}
        Per-year coverage is uneven: City completion records (NOF/SBIF) and grant rounds (CDG) enter on
        different cadences than foundation 990 filings, so a low year can reflect reporting lag rather than
        less money.
      </p>

      {hasYtd ? (
        <div className="mt-3 border-l-2 border-[#A45B00]/45 bg-[#FFF4DD]/55 px-3 py-2">
          <span className="font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.1em] text-[#8A4B00]">
            {partialYear} · Partial year
          </span>
          <p className="mt-1 text-[10px] leading-relaxed text-[#0C1B33]/55">
            Export as of {formatAsOf(generatedAt)}. Later source publications are not inferred.
          </p>
        </div>
      ) : null}

      <p className="mt-2 text-[10px] leading-relaxed text-[#0C1B33]/40">
        Closed CARES and ARPA recipient files remain in separate historical overlays and are excluded from
        this ordinary awarded-capital trend.
      </p>

      {unYeared > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/40">
          {unYeared === 1 ? "1 record carries no year" : `${formatCount(unYeared)} records carry no year`}{" "}
          (development projects and undated grants) and {unYeared === 1 ? "is" : "are"} not shown in the trend.
        </p>
      )}
    </div>
  );
}
