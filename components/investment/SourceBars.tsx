import { BarRounded } from "@visx/shape";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import type { SourceBreakdown } from "@/lib/investment-analysis";
import {
  formatCompactDollars,
  formatCount,
  formatFullDollars,
  INK_55,
  INK_70,
  MAGNITUDE_HUE,
  SOURCE_LABELS,
} from "./format";

/**
 * "Through which programs" — horizontal magnitude bars of awarded dollars by
 * funding program, sorted high → low. Built on @visx primitives: a @visx/scale
 * scaleLinear maps dollars to track width, @visx/shape's BarRounded draws each
 * bar (square baseline, 4px-rounded data-end), and each row is a @visx/group
 * Group translated to its baseline.
 *
 * Complies: this is a magnitude job, so the bars carry a single NEUTRAL hue
 * (never the categorical funder-type colors, which are reserved for funder type)
 * — one flat color for every bar, not a value-ramp on nominal categories. Thin
 * bars with a 4px-rounded data-end and a square baseline, a source label, a
 * value at the tip, and a native hover tooltip per bar. Development projects
 * carry null amounts by design and are surfaced as a count-only row (no bar).
 */

const W = 520;
const ROW_H = 42;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;
const BAR_H = 14;
const TRACK_W = W - 84; // leave room for the value label at the tip

export function SourceBars({ bySource }: { bySource: SourceBreakdown[] }) {
  const dollarSources = bySource
    .filter((s) => s.source !== "development")
    .sort((a, b) => b.awardedDollars - a.awardedDollars);
  const dev = bySource.find((s) => s.source === "development") ?? null;

  const maxVal = Math.max(1, ...dollarSources.map((s) => s.awardedDollars));
  const rows = dollarSources.length + (dev ? 1 : 0);
  const height = PAD_TOP + rows * ROW_H + PAD_BOTTOM;
  const wScale = scaleLinear<number>({ domain: [0, maxVal], range: [0, TRACK_W] });

  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5 sm:p-6">
      <svg viewBox={`0 0 ${W} ${height}`} className="block w-full" role="img" aria-label="Awarded dollars by program">
        {dollarSources.map((s, i) => {
          const w = Math.max(2, wScale(s.awardedDollars));
          return (
            <Group key={s.source} top={PAD_TOP + i * ROW_H}>
              <text x={0} y={11} fontSize={11} fill={INK_70} fontWeight={500}>
                {SOURCE_LABELS[s.source]}
              </text>
              <BarRounded x={0} y={18} width={w} height={BAR_H} radius={4} right>
                {({ path }) => (
                  <path d={path} fill={MAGNITUDE_HUE}>
                    <title>{`${SOURCE_LABELS[s.source]}: ${formatFullDollars(s.awardedDollars)} · ${formatCount(s.count)} record${s.count === 1 ? "" : "s"}`}</title>
                  </path>
                )}
              </BarRounded>
              <text
                x={w + 6}
                y={18 + BAR_H - 3}
                fontSize={11}
                fontWeight={600}
                fill="#0C1B33"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatCompactDollars(s.awardedDollars)}
              </text>
            </Group>
          );
        })}

        {dev && (
          <Group top={PAD_TOP + dollarSources.length * ROW_H}>
            <text x={0} y={11} fontSize={11} fill={INK_70} fontWeight={500}>
              {SOURCE_LABELS.development}
            </text>
            <text x={0} y={30} fontSize={11} fill={INK_55}>
              {formatCount(dev.count)} project{dev.count === 1 ? "" : "s"} · dollar amounts not disclosed
            </text>
          </Group>
        )}
      </svg>
    </div>
  );
}
