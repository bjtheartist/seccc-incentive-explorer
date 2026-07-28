import type { YearBreakdown } from "@/lib/investment-analysis";
import { MAGNITUDE_HUE } from "./format";

/**
 * A tiny year-trend sparkline for the Compare view — awarded dollars per year as a
 * filled area + line, no axes or labels (the compare card carries the numbers).
 * Pure server component (inline SVG, no chart engine). A flat/empty series renders
 * a baseline so the card never shows an empty box.
 */
export function Sparkline({
  byYear,
  width = 132,
  height = 34,
}: {
  byYear: YearBreakdown[];
  width?: number;
  height?: number;
}) {
  const values = byYear.map((y) => y.awardedDollars);
  const max = Math.max(1, ...values);
  const n = values.length;
  const pad = 1.5;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const x = (i: number) => (n <= 1 ? pad + innerW / 2 : pad + (i / (n - 1)) * innerW);
  const y = (v: number) => pad + innerH - (v / max) * innerH;

  if (n === 0) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="block w-full" role="img" aria-label="No year trend">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke={MAGNITUDE_HUE} strokeOpacity={0.25} />
      </svg>
    );
  }

  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${pad},${height - pad} ${line} ${(width - pad).toFixed(1)},${height - pad}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block w-full" role="img" aria-label="Awarded dollars by year (sparkline)">
      <polygon points={area} fill={MAGNITUDE_HUE} fillOpacity={0.12} />
      <polyline points={line} fill="none" stroke={MAGNITUDE_HUE} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
