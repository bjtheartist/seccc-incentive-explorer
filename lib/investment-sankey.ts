/**
 * Funder → program → recipient FLOW SHAPING for the "How the money flowed"
 * sankey (components/investment/FunderFlowSankey.tsx). This is the ONE new
 * chart in the viz-upgrade wave; everything else on the brief reuses the
 * existing server-SVG components.
 *
 * The shape is a three-column sankey over ONE community's records:
 *   funder (top 6 by awarded dollars, rest → "Other funders")
 *     → source program (all present, no folding)
 *       → recipient (top 8 by awarded dollars, rest → "Other recipients")
 * Every link's width is AWARDED dollars — a real reported/awarded amount, never
 * a derived received/available/remaining/unspent figure (the inherited iron
 * rule from lib/community-investment.ts; unit-tested here against
 * findBannedFigureKeys).
 *
 * FLOW BASIS (mirrors lib/investment-analysis.ts exactly so the sankey agrees
 * with the donut/year/program charts on the same page):
 *   • Only in-window records count — year != null && year >= SINCE_YEAR (2020).
 *   • Only records with a real, positive awarded amount participate — a null- or
 *     zero-amount record (a development project, an undated grant) carries no
 *     link width and is excluded, exactly as topRecipients/topFunders exclude it.
 *   • Each qualifying record contributes its amount to BOTH halves of its chain
 *     (funder→source AND source→recipient), so flow is conserved through every
 *     middle node: dollars in == dollars out.
 *
 * CLIENT-SAFE SEPARATION (repo gotcha, mirrors investment-analysis.ts): the pure
 * shaping functions (buildFunderFlow + the folding/ordering helpers) never touch
 * `fs` and are unit-tested directly. Only the server-only loader at the bottom
 * calls loadCommunityInvestment() (which reads `node:fs`), so a client component
 * may import the TYPES from here with `import type` (erased at build) but never a
 * value.
 */

import {
  INVESTMENT_SOURCES,
  FUNDER_TYPES,
  loadCommunityInvestment,
  type CommunityInvestmentRecord,
  type FunderType,
  type InvestmentSource,
} from "./community-investment";

/** The since-anchor year — dollar flow covers year >= this. Kept in lockstep
 * with lib/investment-analysis.ts SINCE_YEAR (redeclared locally rather than
 * imported so this module carries no analysis-loader coupling). */
export const SINCE_YEAR = 2020;

/** Default fold thresholds — top-N kept by awarded dollars, the rest bucketed.
 * Raised 6 -> 10 when the funder universe grew to 97: at six, the "Other
 * funders" bucket became the largest node on most areas, which reads as one
 * giant funder. The fold count is still disclosed in the caption. */
export const DEFAULT_TOP_FUNDERS = 10;
export const DEFAULT_TOP_RECIPIENTS = 8;

/** The label of the funder-side fold bucket. */
export const OTHER_FUNDERS_LABEL = "Other funders";
/** The label of the recipient-side fold bucket. */
export const OTHER_RECIPIENTS_LABEL = "Other recipients";

// ── Output shapes ─────────────────────────────────────────────────────────────

/** One sankey node — a funder, a source program, or a recipient. */
export interface FunderFlowNode {
  /**
   * Unique node id, depth-prefixed (`f:` / `s:` / `r:`) so a funder and a
   * recipient that happen to share a name never collide into one node. Links
   * reference nodes by this id.
   */
  name: string;
  kind: "funder" | "source" | "recipient";
  /** Column index: 0 funder, 1 source, 2 recipient. */
  depth: 0 | 1 | 2;
  /**
   * The raw grouping key: a funderName, an InvestmentSource, or a recipient —
   * or the "Other …" bucket label for a folded aggregate. The component maps
   * this to a display label (SOURCE short labels for sources; the key verbatim
   * otherwise).
   */
  key: string;
  /** True when this node is a folded aggregate ("Other funders"/"Other recipients"). */
  isOther: boolean;
  /**
   * Funder nodes carry the funderType that supplied the most dollars, for
   * funder-side coloring. A folded "Other funders" bucket mixes types and leaves
   * this undefined (the component paints it neutral). Source/recipient nodes
   * never carry it.
   */
  funderType?: FunderType;
  /** Total AWARDED dollars flowing through this node. */
  value: number;
  /** value / total (0 when the community has no awarded dollars). */
  share: number;
}

/** One sankey link — a funder→source or source→recipient flow. */
export interface FunderFlowLink {
  /** Source node id (FunderFlowNode.name). */
  source: string;
  /** Target node id (FunderFlowNode.name). */
  target: string;
  /** AWARDED dollars carried by this link (== the link's width). */
  value: number;
}

/** The full flow for one community area. */
export interface FunderFlow {
  communityArea: string;
  /** Nodes in draw order: funders, then sources, then recipients. */
  nodes: FunderFlowNode[];
  links: FunderFlowLink[];
  /** Total awarded flowing on one side (funder side == recipient side == total). */
  total: number;
  /** How many distinct funders were folded into "Other funders" (0 = none). */
  foldedFunders: number;
  /** How many distinct recipients were folded into "Other recipients" (0 = none). */
  foldedRecipients: number;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** A record that participates in the flow: in-window and carrying a real,
 * positive awarded amount. Everything else (null/pre-2020 year, null/≤0 amount)
 * is excluded, matching the dollar basis of the rest of the analysis. */
function participates(r: CommunityInvestmentRecord): boolean {
  return (
    r.year != null &&
    r.year >= SINCE_YEAR &&
    r.amountAwarded != null &&
    r.amountAwarded > 0
  );
}

/** The dominant funderType for a funder — the type that supplied the most
 * dollars, ties broken by canonical FUNDER_TYPES order for determinism. */
function dominantFunderType(byType: Map<FunderType, number>): FunderType {
  let best: FunderType = FUNDER_TYPES[0];
  let bestDollars = -1;
  for (const t of FUNDER_TYPES) {
    const d = byType.get(t) ?? 0;
    if (d > bestDollars) {
      bestDollars = d;
      best = t;
    }
  }
  return best;
}

/**
 * The set of funder names to KEEP as their own node — the top `limit` by awarded
 * dollars, ties broken by name ascending so the choice is stable across runs.
 * Every other funder folds into "Other funders". Returns the kept names as a Set
 * plus the count folded.
 */
function selectTop(
  totals: Map<string, number>,
  limit: number,
): { keep: Set<string>; folded: number } {
  const ranked = [...totals.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const keep = new Set(ranked.slice(0, limit).map(([name]) => name));
  return { keep, folded: Math.max(0, ranked.length - keep.size) };
}

/**
 * Shape one community's records into the three-column funder→source→recipient
 * flow. Pure and deterministic: every grouping and ordering has a name/enum
 * tiebreak, and the two fold buckets ("Other funders"/"Other recipients") always
 * sort last within their column regardless of magnitude. Returns an empty flow
 * (no nodes/links, total 0) when nothing qualifies.
 */
export function buildFunderFlow(
  records: readonly CommunityInvestmentRecord[],
  communityArea: string,
  opts?: { topFunders?: number; topRecipients?: number },
): FunderFlow {
  const topFunders = opts?.topFunders ?? DEFAULT_TOP_FUNDERS;
  const topRecipients = opts?.topRecipients ?? DEFAULT_TOP_RECIPIENTS;

  const rows = records.filter(participates);
  if (rows.length === 0) {
    return {
      communityArea,
      nodes: [],
      links: [],
      total: 0,
      foldedFunders: 0,
      foldedRecipients: 0,
    };
  }

  // Per-funder / per-recipient dollar totals over the whole (unfolded) set, so
  // the top-N selection ranks against real magnitude before any bucketing.
  const funderTotals = new Map<string, number>();
  const funderTypeDollars = new Map<string, Map<FunderType, number>>();
  const recipientTotals = new Map<string, number>();
  for (const r of rows) {
    const amt = r.amountAwarded as number;
    funderTotals.set(r.funderName, (funderTotals.get(r.funderName) ?? 0) + amt);
    recipientTotals.set(r.recipient, (recipientTotals.get(r.recipient) ?? 0) + amt);
    let typeMap = funderTypeDollars.get(r.funderName);
    if (!typeMap) {
      typeMap = new Map<FunderType, number>();
      funderTypeDollars.set(r.funderName, typeMap);
    }
    typeMap.set(r.funderType, (typeMap.get(r.funderType) ?? 0) + amt);
  }

  const { keep: keepFunders, folded: foldedFunders } = selectTop(funderTotals, topFunders);
  const { keep: keepRecipients, folded: foldedRecipients } = selectTop(recipientTotals, topRecipients);

  const funderKeyOf = (name: string) => (keepFunders.has(name) ? name : OTHER_FUNDERS_LABEL);
  const recipientKeyOf = (name: string) => (keepRecipients.has(name) ? name : OTHER_RECIPIENTS_LABEL);

  // Aggregate the two link halves. A funder→source key and a source→recipient
  // key are kept separate so the middle "source" node conserves flow.
  const funderSource = new Map<string, number>(); // `${funderKey} ${source}`
  const sourceRecipient = new Map<string, number>(); // `${source} ${recipientKey}`
  for (const r of rows) {
    const amt = r.amountAwarded as number;
    const fKey = funderKeyOf(r.funderName);
    const rKey = recipientKeyOf(r.recipient);
    const fsKey = `${fKey} ${r.source}`;
    const srKey = `${r.source} ${rKey}`;
    funderSource.set(fsKey, (funderSource.get(fsKey) ?? 0) + amt);
    sourceRecipient.set(srKey, (sourceRecipient.get(srKey) ?? 0) + amt);
  }

  // Node value tallies from the aggregated links.
  const funderValue = new Map<string, number>();
  const sourceValue = new Map<InvestmentSource, number>();
  const recipientValue = new Map<string, number>();
  for (const [k, v] of funderSource) {
    const [fKey, source] = k.split(" ") as [string, InvestmentSource];
    funderValue.set(fKey, (funderValue.get(fKey) ?? 0) + v);
    sourceValue.set(source, (sourceValue.get(source) ?? 0) + v);
  }
  for (const [k, v] of sourceRecipient) {
    const [, rKey] = k.split(" ") as [InvestmentSource, string];
    recipientValue.set(rKey, (recipientValue.get(rKey) ?? 0) + v);
  }

  const total = [...funderValue.values()].reduce((s, v) => s + v, 0);
  const share = (v: number) => (total > 0 ? v / total : 0);

  // ── Funder nodes: real funders by dollars desc (name tiebreak), "Other" last.
  const funderNodes: FunderFlowNode[] = [...funderValue.entries()]
    .filter(([key]) => key !== OTHER_FUNDERS_LABEL)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, value]) => ({
      name: `f:${key}`,
      kind: "funder" as const,
      depth: 0 as const,
      key,
      isOther: false,
      funderType: dominantFunderType(funderTypeDollars.get(key) ?? new Map()),
      value,
      share: share(value),
    }));
  if (funderValue.has(OTHER_FUNDERS_LABEL)) {
    const value = funderValue.get(OTHER_FUNDERS_LABEL) as number;
    funderNodes.push({
      name: `f:${OTHER_FUNDERS_LABEL}`,
      kind: "funder",
      depth: 0,
      key: OTHER_FUNDERS_LABEL,
      isOther: true,
      value,
      share: share(value),
    });
  }

  // ── Source nodes: by dollars desc, ties broken by canonical source order.
  const sourceOrder = (s: InvestmentSource) => INVESTMENT_SOURCES.indexOf(s);
  const sourceNodes: FunderFlowNode[] = [...sourceValue.entries()]
    .sort((a, b) => b[1] - a[1] || sourceOrder(a[0]) - sourceOrder(b[0]))
    .map(([key, value]) => ({
      name: `s:${key}`,
      kind: "source" as const,
      depth: 1 as const,
      key,
      isOther: false,
      value,
      share: share(value),
    }));

  // ── Recipient nodes: real recipients by dollars desc (name tiebreak), "Other" last.
  const recipientNodes: FunderFlowNode[] = [...recipientValue.entries()]
    .filter(([key]) => key !== OTHER_RECIPIENTS_LABEL)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, value]) => ({
      name: `r:${key}`,
      kind: "recipient" as const,
      depth: 2 as const,
      key,
      isOther: false,
      value,
      share: share(value),
    }));
  if (recipientValue.has(OTHER_RECIPIENTS_LABEL)) {
    const value = recipientValue.get(OTHER_RECIPIENTS_LABEL) as number;
    recipientNodes.push({
      name: `r:${OTHER_RECIPIENTS_LABEL}`,
      kind: "recipient",
      depth: 2,
      key: OTHER_RECIPIENTS_LABEL,
      isOther: true,
      value,
      share: share(value),
    });
  }

  // ── Links in a stable order: funder→source (by the funder/source draw order),
  // then source→recipient, each sub-sorted by value desc then target name.
  const funderIndex = new Map(funderNodes.map((n, i) => [n.key, i]));
  const sourceIndex = new Map(sourceNodes.map((n, i) => [n.key, i]));
  const recipientIndex = new Map(recipientNodes.map((n, i) => [n.key, i]));

  const fsLinks: FunderFlowLink[] = [...funderSource.entries()]
    .map(([k, value]) => {
      const [fKey, source] = k.split(" ") as [string, InvestmentSource];
      return { source: `f:${fKey}`, target: `s:${source}`, value, _f: fKey, _s: source };
    })
    .sort(
      (a, b) =>
        (funderIndex.get(a._f) ?? 0) - (funderIndex.get(b._f) ?? 0) ||
        (sourceIndex.get(a._s) ?? 0) - (sourceIndex.get(b._s) ?? 0),
    )
    .map(({ source, target, value }) => ({ source, target, value }));

  const srLinks: FunderFlowLink[] = [...sourceRecipient.entries()]
    .map(([k, value]) => {
      const [source, rKey] = k.split(" ") as [InvestmentSource, string];
      return { source: `s:${source}`, target: `r:${rKey}`, value, _s: source, _r: rKey };
    })
    .sort(
      (a, b) =>
        (sourceIndex.get(a._s) ?? 0) - (sourceIndex.get(b._s) ?? 0) ||
        (recipientIndex.get(a._r) ?? 0) - (recipientIndex.get(b._r) ?? 0),
    )
    .map(({ source, target, value }) => ({ source, target, value }));

  return {
    communityArea,
    nodes: [...funderNodes, ...sourceNodes, ...recipientNodes],
    links: [...fsLinks, ...srLinks],
    total,
    foldedFunders,
    foldedRecipients,
  };
}

// ── Server-only loader (fs) ───────────────────────────────────────────────────

/**
 * Load one community's funder→program→recipient flow from the committed export.
 * Returns null when the export is absent (loadCommunityInvestment() → null) so a
 * route degrades to a clean empty state instead of throwing. Server-only —
 * touches `node:fs` via loadCommunityInvestment. Mirrors loadInvestmentAnalysis.
 */
export function loadFunderFlow(
  communityArea: string,
  opts?: { topFunders?: number; topRecipients?: number },
): FunderFlow | null {
  const data = loadCommunityInvestment();
  if (!data) return null;
  const mine = data.records.filter((r) => r.communityArea === communityArea);
  return buildFunderFlow(mine, communityArea, opts);
}
