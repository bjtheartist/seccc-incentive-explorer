import * as echarts from "echarts/core";
import { SankeyChart } from "echarts/charts";
import { SVGRenderer } from "echarts/renderers";
import { FUNDER_TYPE_COLORS, FUNDER_TYPE_LABELS, INVESTMENT_FALLBACK_COLOR } from "@/lib/community-investment-layer";
import { FUNDER_TYPES } from "@/lib/community-investment";
import { loadFunderFlow, type FunderFlow, type FunderFlowNode } from "@/lib/investment-sankey";
import { formatCompactDollars, formatFullDollars, INK, INK_55, MAGNITUDE_HUE, SOURCE_LABELS_SHORT } from "./format";

/**
 * "How the money flowed" — the ONE new chart in the viz-upgrade wave. A server
 * component that renders an ECharts SVG SANKEY entirely on the server (zero
 * client JS): funder → source program → recipient, link width = AWARDED dollars.
 * ECharts is initialized in headless SSR mode (renderToSVGString) so the output
 * is a plain, self-contained SVG string — the same server-SVG discipline as the
 * hand-rolled FunderDonut / YearBars / SourceBars on this page.
 *
 * Colors: funder-side nodes carry the funderType palette (government blue /
 * philanthropic green / private-development purple; the folded "Other funders"
 * bucket goes neutral). Source and recipient nodes are neutral magnitude slate —
 * identity color is reserved for the funder side, exactly as the donut reserves
 * the three hues for funderType. Node labels are app ink; nodes at ≥ 5% share
 * carry a direct awarded-dollar value label.
 *
 * Every figure is an AWARDED amount, never a received/available/remaining one.
 */

// Register the minimal ECharts pieces once per process (tree-shaken: sankey +
// the SVG renderer only, no canvas). Safe at module scope — this file is
// imported by server components only (no "use client").
echarts.use([SankeyChart, SVGRenderer]);

const CHART_WIDTH = 900;
const NODE_WIDTH = 13;
const NODE_GAP = 12;
/** Nodes at or above this share of the total get a direct value label. */
const VALUE_LABEL_SHARE = 0.05;

/** Fill color for a node: funder-side uses the funderType palette (neutral for
 * the "Other" bucket); source/recipient nodes are neutral magnitude slate. */
function nodeColor(n: FunderFlowNode): string {
  if (n.kind === "funder") {
    return n.isOther || !n.funderType ? INVESTMENT_FALLBACK_COLOR : FUNDER_TYPE_COLORS[n.funderType];
  }
  return n.isOther ? INVESTMENT_FALLBACK_COLOR : MAGNITUDE_HUE;
}

/** Human display label for a node — short program label for sources, the key
 * verbatim (funder / recipient / "Other …") otherwise. */
function nodeLabel(n: FunderFlowNode): string {
  if (n.kind === "source") return SOURCE_LABELS_SHORT[n.key as keyof typeof SOURCE_LABELS_SHORT] ?? n.key;
  return n.key;
}

/** Label placement per column so text lands in a gutter, never over the links:
 * funders to the left, sources above, recipients to the right. */
function labelPosition(depth: number): { position: string; align: string; width: number } {
  if (depth === 0) return { position: "left", align: "right", width: 132 };
  if (depth === 2) return { position: "right", align: "left", width: 154 };
  return { position: "top", align: "center", width: 104 };
}

interface SankeyLabelParam {
  data?: { displayLabel?: string; valueLabel?: string; showValue?: boolean };
}

/** Render the flow to a self-contained, responsive SVG string via ECharts SSR. */
function renderSankeySvg(flow: FunderFlow): string {
  const maxColumn = Math.max(
    flow.nodes.filter((n) => n.depth === 0).length,
    flow.nodes.filter((n) => n.depth === 1).length,
    flow.nodes.filter((n) => n.depth === 2).length,
  );
  const height = Math.min(760, Math.max(340, maxColumn * 46 + 64));

  const data = flow.nodes.map((n) => {
    const pos = labelPosition(n.depth);
    const color = nodeColor(n);
    return {
      name: n.name,
      depth: n.depth,
      value: n.value,
      displayLabel: nodeLabel(n),
      valueLabel: formatCompactDollars(n.value),
      showValue: n.share >= VALUE_LABEL_SHARE,
      itemStyle: { color, borderColor: color, borderWidth: 0 },
      label: { position: pos.position, align: pos.align, width: pos.width, overflow: "truncate" },
    };
  });

  const option = {
    backgroundColor: "transparent",
    animation: false,
    series: [
      {
        type: "sankey",
        left: 142,
        right: 168,
        top: 26,
        bottom: 14,
        nodeWidth: NODE_WIDTH,
        nodeGap: NODE_GAP,
        nodeAlign: "justify",
        draggable: false,
        emphasis: { disabled: true },
        data,
        links: flow.links.map((l) => ({ source: l.source, target: l.target, value: l.value })),
        lineStyle: { color: "source", opacity: 0.38, curveness: 0.5 },
        label: {
          color: INK,
          fontSize: 11,
          fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
          formatter: (p: SankeyLabelParam) => {
            const d = p.data;
            if (!d?.displayLabel) return "";
            return d.showValue ? `${d.displayLabel}\n{v|${d.valueLabel}}` : d.displayLabel;
          },
          rich: { v: { color: INK_55, fontSize: 10, lineHeight: 14, fontWeight: 600 } },
        },
        itemStyle: { borderWidth: 0 },
      },
    ],
  };

  const chart = echarts.init(null, null, {
    renderer: "svg",
    ssr: true,
    width: CHART_WIDTH,
    height,
  });
  chart.setOption(option as echarts.EChartsCoreOption);
  const svg = chart.renderToSVGString({ useViewBox: true });
  chart.dispose();

  // Replace the fixed pixel width/height with responsive CSS so the viewBox
  // drives a scale-to-fit SVG. Without this the bare viewBox renders at its
  // intrinsic 900px — overflowing the letter print column and clipping. Keeping
  // width:100%/height:auto makes it fit both the web card and the paper column.
  return svg.replace(/^<svg width="\d+" height="\d+"/, '<svg style="width:100%;height:auto;display:block"');
}

/** A neutral chip used in the legend. */
function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-[#0C1B33]/60">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

/** A compact reachable-values table for one column (the accessibility fallback,
 * mirroring FunderDonut's fallback table — every awarded figure is listed). */
function ColumnTable({ title, nodes }: { title: string; nodes: FunderFlowNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <div>
      <div className="font-mono-bureau text-[9px] uppercase tracking-[0.15em] text-[#0C1B33]/40">{title}</div>
      <table className="mt-1.5 w-full border-collapse text-[11px]">
        <tbody>
          {nodes.map((n) => (
            <tr key={n.name} className="border-b border-[#0C1B33]/5 last:border-b-0">
              <td className="py-1 pr-3 text-[#0C1B33]/70">{nodeLabel(n)}</td>
              <td className="py-1 text-right text-[#0C1B33]/60 [font-variant-numeric:tabular-nums]">
                {formatFullDollars(n.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Server component. Loads the community's flow, renders the SSR sankey, and
 * frames it with a funder-type legend and a per-column reachable-values table.
 * `flow` may be passed directly (already loaded) to avoid a second fs read;
 * otherwise it loads by community area. Renders a clean empty note when the
 * community has no dollar-valued flow since 2020.
 */
export function FunderFlowSankey({
  communityArea,
  flow: flowProp,
}: {
  communityArea: string;
  flow?: FunderFlow | null;
}) {
  const flow = flowProp ?? loadFunderFlow(communityArea);

  if (!flow || flow.links.length === 0) {
    return (
      <div className="border border-[#0C1B33]/10 bg-white p-6 text-[13px] text-[#0C1B33]/55">
        No dollar-valued flows to chart in {communityArea} since 2020. Development projects and undated grants
        carry no awarded amount and are not shown here.
      </div>
    );
  }

  const svg = renderSankeySvg(flow);
  const funders = flow.nodes.filter((n) => n.depth === 0);
  const sources = flow.nodes.filter((n) => n.depth === 1);
  const recipients = flow.nodes.filter((n) => n.depth === 2);
  const presentTypes = FUNDER_TYPES.filter((t) => funders.some((n) => !n.isOther && n.funderType === t));

  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5 sm:p-6">
      <div
        className="w-full overflow-x-auto"
        role="img"
        aria-label={`Sankey diagram: awarded dollars flowing from funders through funding programs to recipients in ${communityArea} since 2020. Total ${formatFullDollars(
          flow.total,
        )}.`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <p className="mt-3 text-[11px] leading-relaxed text-[#0C1B33]/45">
        Link width is awarded dollars. Funders are colored by type; programs and recipients are neutral. The largest
        funders and recipients are named
        {flow.foldedFunders > 0
          ? ` — ${flow.foldedFunders} smaller funder${flow.foldedFunders === 1 ? "" : "s"} fold into “Other funders”`
          : ""}
        {flow.foldedRecipients > 0
          ? `${flow.foldedFunders > 0 ? " and" : " —"} ${flow.foldedRecipients} smaller recipient${
              flow.foldedRecipients === 1 ? "" : "s"
            } into “Other recipients”`
          : ""}
        .
      </p>

      {/* Legend — funder identity + the neutral flow channel */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        {presentTypes.map((t) => (
          <LegendChip key={t} color={FUNDER_TYPE_COLORS[t]} label={FUNDER_TYPE_LABELS[t]} />
        ))}
        <LegendChip color={MAGNITUDE_HUE} label="Programs & recipients" />
      </div>

      {/* Accessibility fallback — every awarded figure reachable as text. Tagged
          so a print context can suppress it when the same figures already appear
          in sibling sections (the print brief does this). */}
      <div className="sankey-a11y-fallback mt-5 grid grid-cols-1 gap-5 border-t border-[#0C1B33]/10 pt-4 sm:grid-cols-3">
        <ColumnTable title="Funders" nodes={funders} />
        <ColumnTable title="Programs" nodes={sources} />
        <ColumnTable title="Recipients" nodes={recipients} />
      </div>
    </div>
  );
}
