import { FUNDER_TYPE_COLORS, FUNDER_TYPE_LABELS } from "@/lib/community-investment-layer";
import type { FunderTypeBreakdown } from "@/lib/investment-analysis";
import { formatCompactDollars, formatFullDollars, formatPercent, INK_55, INK_70 } from "./format";

/**
 * "Where the money came from" — a donut of the funder-type split (government /
 * philanthropic / private development), the one pie the analysis carries.
 *
 * Complies with the donut spec:
 *   • Slice colors are EXACTLY the funder-type palette (blue/green/purple).
 *   • Direct slice labels are mandatory (name + $ + %) — external callouts with
 *     a leader line drawn in the slice color (the identity channel); the label
 *     TEXT stays ink, never the series color.
 *   • 2px surface gaps between slices; the center shows the total.
 *   • A legend is present, and every slice has a native hover tooltip (<title>).
 *   • Zero-dollar funder types fold OUT of the donut but remain in the table
 *     below — the accessibility fallback where every value is reachable.
 */

const CX = 240;
const CY = 128;
const R_OUTER = 86;
const R_INNER = 54;
const GAP_DEG = 2; // ~2px surface gap between slices at this radius

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** A gapped donut segment path from startDeg to endDeg (clockwise from top). */
function segmentPath(startDeg: number, endDeg: number): string {
  const p1 = polar(CX, CY, R_OUTER, startDeg);
  const p2 = polar(CX, CY, R_OUTER, endDeg);
  const p3 = polar(CX, CY, R_INNER, endDeg);
  const p4 = polar(CX, CY, R_INNER, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${R_INNER} ${R_INNER} 0 ${largeArc} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

/** A full annulus (used when a single funder type is 100% — an arc can't close). */
function annulusPath(): string {
  const o = R_OUTER;
  const i = R_INNER;
  return [
    `M ${CX - o} ${CY}`,
    `a ${o} ${o} 0 1 0 ${2 * o} 0`,
    `a ${o} ${o} 0 1 0 ${-2 * o} 0`,
    `Z`,
    `M ${CX - i} ${CY}`,
    `a ${i} ${i} 0 1 1 ${2 * i} 0`,
    `a ${i} ${i} 0 1 1 ${-2 * i} 0`,
    `Z`,
  ].join(" ");
}

interface Slice {
  funderType: FunderTypeBreakdown["funderType"];
  awardedDollars: number;
  share: number;
  color: string;
  label: string;
  start: number;
  end: number;
  mid: number;
}

export function FunderDonut({
  byFunderType,
  total,
}: {
  byFunderType: FunderTypeBreakdown[];
  total: number;
}) {
  const nonZero = byFunderType.filter((f) => f.awardedDollars > 0);
  const single = nonZero.length === 1;

  // Build gapped slices around the circle.
  const slices: Slice[] = [];
  let cursor = 0;
  for (const f of nonZero) {
    const sweep = f.share * 360;
    const rawStart = cursor;
    const rawEnd = cursor + sweep;
    const gap = single ? 0 : GAP_DEG / 2;
    slices.push({
      funderType: f.funderType,
      awardedDollars: f.awardedDollars,
      share: f.share,
      color: FUNDER_TYPE_COLORS[f.funderType],
      label: FUNDER_TYPE_LABELS[f.funderType],
      start: rawStart + gap,
      end: rawEnd - gap,
      mid: (rawStart + rawEnd) / 2,
    });
    cursor = rawEnd;
  }

  // External label callouts, decluttered per side so two same-side labels don't
  // overlap vertically.
  type Callout = Slice & { side: 1 | -1; edgeX: number; edgeY: number; elbowX: number; textX: number; textY: number };
  const callouts: Callout[] = slices.map((s) => {
    const side: 1 | -1 = s.mid % 360 < 180 ? 1 : -1;
    const edge = polar(CX, CY, R_OUTER, s.mid);
    const elbow = polar(CX, CY, R_OUTER + 16, s.mid);
    return {
      ...s,
      side,
      edgeX: edge.x,
      edgeY: edge.y,
      elbowX: elbow.x,
      textX: elbow.x + side * 6,
      textY: elbow.y,
    };
  });
  for (const side of [1, -1] as const) {
    const group = callouts.filter((c) => c.side === side).sort((a, b) => a.textY - b.textY);
    const MIN_GAP = 34;
    for (let i = 1; i < group.length; i++) {
      if (group[i].textY - group[i - 1].textY < MIN_GAP) {
        group[i].textY = group[i - 1].textY + MIN_GAP;
      }
    }
  }

  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5 sm:p-6">
      <svg
        viewBox="0 0 480 268"
        className="mx-auto block w-full max-w-[480px]"
        role="img"
        aria-label="Funder-type share of awarded dollars"
      >
        {callouts.map((c) => (
          <g key={`leader-${c.funderType}`}>
            <polyline
              points={`${c.edgeX.toFixed(1)},${c.edgeY.toFixed(1)} ${c.elbowX.toFixed(1)},${c.textY.toFixed(1)} ${(c.textX - c.side * 4).toFixed(1)},${c.textY.toFixed(1)}`}
              fill="none"
              stroke={c.color}
              strokeWidth={1}
            />
          </g>
        ))}
        {slices.map((s) => (
          <path
            key={s.funderType}
            d={single ? annulusPath() : segmentPath(s.start, s.end)}
            fill={s.color}
            fillRule={single ? "evenodd" : undefined}
          >
            <title>{`${s.label}: ${formatFullDollars(s.awardedDollars)} (${formatPercent(s.share)})`}</title>
          </path>
        ))}
        {callouts.map((c) => (
          <text
            key={`label-${c.funderType}`}
            x={c.textX}
            y={c.textY}
            textAnchor={c.side === 1 ? "start" : "end"}
            fontSize={12}
          >
            <tspan x={c.textX} dy="-0.1em" fill={INK_70} fontWeight={500}>
              {c.label}
            </tspan>
            <tspan x={c.textX} dy="1.25em" fill={INK_55} fontSize={11}>
              {formatCompactDollars(c.awardedDollars)} · {formatPercent(c.share)}
            </tspan>
          </text>
        ))}
        {/* Center total */}
        <text x={CX} y={CY - 4} textAnchor="middle" fontSize={20} fontWeight={600} fill="#0C1B33">
          {formatCompactDollars(total)}
        </text>
        <text
          x={CX}
          y={CY + 14}
          textAnchor="middle"
          fontSize={9}
          fill={INK_55}
          style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          awarded since 2020
        </text>
      </svg>

      {/* Legend — the dependable identity channel */}
      <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2">
        {byFunderType.map((f) => (
          <span key={f.funderType} className="flex items-center gap-1.5 text-[11px] text-[#0C1B33]/60">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: FUNDER_TYPE_COLORS[f.funderType] }}
            />
            {FUNDER_TYPE_LABELS[f.funderType]}
          </span>
        ))}
      </div>

      {/* Accessibility fallback table — every value, including zero-dollar types */}
      <table className="mt-5 w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-[#0C1B33]/10 text-left text-[#0C1B33]/45">
            <th className="py-1.5 pr-3 font-medium">Funder type</th>
            <th className="py-1.5 pr-3 text-right font-medium">Awarded</th>
            <th className="py-1.5 text-right font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {byFunderType.map((f) => (
            <tr key={f.funderType} className="border-b border-[#0C1B33]/5">
              <td className="py-1.5 pr-3 text-[#0C1B33]/75">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: FUNDER_TYPE_COLORS[f.funderType] }}
                  />
                  {FUNDER_TYPE_LABELS[f.funderType]}
                </span>
              </td>
              <td className="py-1.5 pr-3 text-right text-[#0C1B33]/75 [font-variant-numeric:tabular-nums]">
                {f.awardedDollars > 0 ? formatFullDollars(f.awardedDollars) : "—"}
              </td>
              <td className="py-1.5 text-right text-[#0C1B33]/55 [font-variant-numeric:tabular-nums]">
                {formatPercent(f.share)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
