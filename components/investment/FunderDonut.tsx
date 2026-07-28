import { Pie } from "@visx/shape";
import { Group } from "@visx/group";
import { scaleOrdinal } from "@visx/scale";
import { FUNDER_TYPE_COLORS, FUNDER_TYPE_LABELS, FUNDER_TYPE_ORDER } from "@/lib/community-investment-layer";
import type { FunderType } from "@/lib/community-investment";
import type { FunderTypeBreakdown } from "@/lib/investment-analysis";
import { formatCompactDollars, formatFullDollars, formatPercent, INK_55, INK_70 } from "./format";

/**
 * "Where the money came from" — a donut of the funder-type split (government /
 * philanthropic / private development), the one pie the analysis carries. Built
 * on @visx primitives: the arcs come from @visx/shape's <Pie> (d3 pie layout +
 * arc generator), positioned with @visx/group, and the slice fills come from a
 * @visx/scale scaleOrdinal keyed on funderType.
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
/** Half the surface gap, in radians, trimmed off each end of every slice. */
const GAP_HALF_RAD = (GAP_DEG * Math.PI) / 360;

/**
 * Slice fills as a @visx/scale ordinal scale — funderType → validated hue. The
 * three colors stay reserved for funder type (identity), matching the map layer.
 */
const funderColor = scaleOrdinal<FunderType, string>({
  domain: [...FUNDER_TYPE_ORDER],
  range: FUNDER_TYPE_ORDER.map((t) => FUNDER_TYPE_COLORS[t]),
});

export function FunderDonut({
  byFunderType,
  total,
}: {
  byFunderType: FunderTypeBreakdown[];
  total: number;
}) {
  const nonZero = byFunderType.filter((f) => f.awardedDollars > 0);
  const single = nonZero.length === 1;
  // A single 100% slice can't carry a gap (an arc can't close on itself).
  const gapRad = single ? 0 : GAP_HALF_RAD;

  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5 sm:p-6">
      <svg
        viewBox="0 0 480 268"
        className="mx-auto block w-full max-w-[480px]"
        role="img"
        aria-label="Funder-type share of awarded dollars"
      >
        <Pie
          data={nonZero}
          pieValue={(f) => f.awardedDollars}
          outerRadius={R_OUTER}
          innerRadius={R_INNER}
          pieSort={null}
          pieSortValues={null}
        >
          {({ arcs, path }) => {
            // External label callouts, decluttered per side so two same-side
            // labels don't overlap vertically. Angles come from the (ungapped)
            // arc midpoint; geometry is expressed relative to the donut center.
            const callouts = arcs.map((arc) => {
              const mid = (arc.startAngle + arc.endAngle) / 2;
              const side: 1 | -1 = mid < Math.PI ? 1 : -1;
              const edgeX = R_OUTER * Math.sin(mid);
              const edgeY = -R_OUTER * Math.cos(mid);
              const elbowX = (R_OUTER + 16) * Math.sin(mid);
              const elbowY = -(R_OUTER + 16) * Math.cos(mid);
              return {
                funderType: arc.data.funderType,
                awardedDollars: arc.data.awardedDollars,
                share: arc.data.share,
                label: FUNDER_TYPE_LABELS[arc.data.funderType],
                color: funderColor(arc.data.funderType),
                side,
                edgeX,
                edgeY,
                elbowX,
                textX: elbowX + side * 6,
                textY: elbowY,
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
              <Group left={CX} top={CY}>
                {callouts.map((c) => (
                  <polyline
                    key={`leader-${c.funderType}`}
                    points={`${c.edgeX.toFixed(1)},${c.edgeY.toFixed(1)} ${c.elbowX.toFixed(1)},${c.textY.toFixed(1)} ${(c.textX - c.side * 4).toFixed(1)},${c.textY.toFixed(1)}`}
                    fill="none"
                    stroke={c.color}
                    strokeWidth={1}
                  />
                ))}
                {arcs.map((arc) => (
                  <path
                    key={arc.data.funderType}
                    d={path({ ...arc, startAngle: arc.startAngle + gapRad, endAngle: arc.endAngle - gapRad }) || ""}
                    fill={funderColor(arc.data.funderType)}
                  >
                    <title>{`${FUNDER_TYPE_LABELS[arc.data.funderType]}: ${formatFullDollars(arc.data.awardedDollars)} (${formatPercent(arc.data.share)})`}</title>
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
                <text x={0} y={-4} textAnchor="middle" fontSize={20} fontWeight={600} fill="#0C1B33">
                  {formatCompactDollars(total)}
                </text>
                <text
                  x={0}
                  y={14}
                  textAnchor="middle"
                  fontSize={9}
                  fill={INK_55}
                  style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
                >
                  awarded since 2020
                </text>
              </Group>
            );
          }}
        </Pie>
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
