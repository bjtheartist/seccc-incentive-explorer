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
 * funding program, sorted high → low. Complies: this is a magnitude job, so the
 * bars carry a single NEUTRAL hue (never the categorical funder-type colors,
 * which are reserved for funder type) — one flat color for every bar, not a
 * value-ramp on nominal categories. Thin bars with a 4px-rounded data-end and a
 * square baseline, a source label, a value at the tip, and a native hover
 * tooltip per bar. Development projects carry null amounts by design and are
 * surfaced as a count-only row (no bar).
 */

const W = 520;
const ROW_H = 42;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;
const BAR_H = 14;
const TRACK_W = W - 84; // leave room for the value label at the tip

/** Horizontal bar path: square at the left baseline, 4px-rounded right end. */
function barPath(x0: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w, h / 2));
  return [
    `M ${x0} ${y}`,
    `L ${(x0 + w - rr).toFixed(2)} ${y}`,
    `Q ${(x0 + w).toFixed(2)} ${y} ${(x0 + w).toFixed(2)} ${(y + rr).toFixed(2)}`,
    `L ${(x0 + w).toFixed(2)} ${(y + h - rr).toFixed(2)}`,
    `Q ${(x0 + w).toFixed(2)} ${(y + h).toFixed(2)} ${(x0 + w - rr).toFixed(2)} ${(y + h).toFixed(2)}`,
    `L ${x0} ${(y + h).toFixed(2)}`,
    "Z",
  ].join(" ");
}

export function SourceBars({ bySource }: { bySource: SourceBreakdown[] }) {
  const dollarSources = bySource
    .filter((s) => s.source !== "development")
    .sort((a, b) => b.awardedDollars - a.awardedDollars);
  const dev = bySource.find((s) => s.source === "development") ?? null;

  const maxVal = Math.max(1, ...dollarSources.map((s) => s.awardedDollars));
  const rows = dollarSources.length + (dev ? 1 : 0);
  const height = PAD_TOP + rows * ROW_H + PAD_BOTTOM;

  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5 sm:p-6">
      <svg viewBox={`0 0 ${W} ${height}`} className="block w-full" role="img" aria-label="Awarded dollars by program">
        {dollarSources.map((s, i) => {
          const rowTop = PAD_TOP + i * ROW_H;
          const w = Math.max(2, (s.awardedDollars / maxVal) * TRACK_W);
          const barY = rowTop + 18;
          return (
            <g key={s.source}>
              <text x={0} y={rowTop + 11} fontSize={11} fill={INK_70} fontWeight={500}>
                {SOURCE_LABELS[s.source]}
              </text>
              <path d={barPath(0, barY, w, BAR_H, 4)} fill={MAGNITUDE_HUE}>
                <title>{`${SOURCE_LABELS[s.source]}: ${formatFullDollars(s.awardedDollars)} · ${formatCount(s.count)} record${s.count === 1 ? "" : "s"}`}</title>
              </path>
              <text
                x={w + 6}
                y={barY + BAR_H - 3}
                fontSize={11}
                fontWeight={600}
                fill="#0C1B33"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatCompactDollars(s.awardedDollars)}
              </text>
            </g>
          );
        })}

        {dev && (
          <g>
            {(() => {
              const rowTop = PAD_TOP + dollarSources.length * ROW_H;
              return (
                <>
                  <text x={0} y={rowTop + 11} fontSize={11} fill={INK_70} fontWeight={500}>
                    {SOURCE_LABELS.development}
                  </text>
                  <text x={0} y={rowTop + 30} fontSize={11} fill={INK_55}>
                    {formatCount(dev.count)} project{dev.count === 1 ? "" : "s"} · dollar amounts not disclosed
                  </text>
                </>
              );
            })()}
          </g>
        )}
      </svg>
    </div>
  );
}
