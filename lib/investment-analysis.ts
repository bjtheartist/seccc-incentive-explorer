/**
 * Investment & Impact Analysis — the per-community-area aggregation over the
 * committed Community Investment dataset (lib/community-investment.ts). Powers
 * the admin-gated /investment landing + /investment/[area] pages.
 *
 * SHAPE OF THE ANALYSIS (all scoped to "since 2020"):
 *   • The community's records are the point records whose point-in-polygon
 *     communityArea (stamped in scripts/export-community-investment.ts) equals
 *     the requested area. Citywide-geometry records carry NO communityArea, so
 *     they are structurally excluded from every community total — the honest
 *     rule "citywide / intermediary commitments are excluded from community
 *     totals".
 *   • DOLLAR MATH uses only records with a real year >= SINCE_YEAR (2020). A
 *     record with a null year (a development project, an undated grant) is
 *     EXCLUDED from every dollar sum but COUNTED separately as `unYeared` and in
 *     the count-based breakdowns — "development projects counted, not dollared".
 *   • Records dated BEFORE 2020 fall out of this since-2020 view entirely.
 *
 * IRON RULE (inherited): every dollar is a real AWARDED amount. No key here ever
 * names a received / available / remaining / unspent figure — the shape is
 * unit-tested against assertNoBannedFigureKeys from lib/community-investment.ts.
 *
 * CLIENT-SAFE SEPARATION (repo gotcha): the loaders at the bottom call
 * loadCommunityInvestment(), which touches `node:fs`, so this module is
 * server-only. The pure aggregation functions take records as input and never
 * touch fs; a client component may import the TYPES from here with `import type`
 * (erased at build time), never a value — mirroring how the fs-touching
 * lib/community-investment.ts is consumed type-only by lib/community-investment-layer.ts.
 */

import {
  FUNDER_TYPES,
  INVESTMENT_SOURCES,
  loadCommunityInvestment,
  type CommunityInvestmentRecord,
  type FunderType,
  type InvestmentSource,
  type InvestmentStatus,
} from "./community-investment";

/** The since-anchor year. Dollar math and breakdowns cover year >= this. */
export const SINCE_YEAR = 2020;

// ── Output shapes ─────────────────────────────────────────────────────────────

/** Per-funderType roll-up. `share` is awardedDollars / totalAwarded (0 when the
 * community has no awarded dollars). A funderType with zero awarded dollars
 * (private development, whose amounts are null by design) still carries its
 * project `count`. */
export interface FunderTypeBreakdown {
  funderType: FunderType;
  awardedDollars: number;
  count: number;
  share: number;
}

/** Per-year roll-up, zero-filled across 2020..latest. */
export interface YearBreakdown {
  year: number;
  awardedDollars: number;
  count: number;
}

/** Per-source roll-up. Development dollars are always 0 (amounts null by design);
 * the source is surfaced by `count` only. */
export interface SourceBreakdown {
  source: InvestmentSource;
  awardedDollars: number;
  count: number;
}

/** One of the top-dollar recipients (in-window, real awarded amount). */
export interface TopRecipient {
  recipient: string;
  funderName: string;
  source: InvestmentSource;
  year: number | null;
  amountAwarded: number;
  logLine: string | null;
}

/** One of the top-dollar funders — the funder-profile seed. */
export interface TopFunder {
  funderName: string;
  awardedDollars: number;
  grants: number;
}

/** Equity context: where this community sits among all funded communities. */
export interface InvestmentEquity {
  /** 1-based rank of this community by since-2020 awarded dollars (1 = most). */
  rank: number;
  /** Number of communities with >= 1 record in the since-2020 view. */
  totalCAs: number;
  /** Median community's since-2020 awarded-dollar total. */
  citywideMedianCA: number;
  /** thisTotal / citywideMedianCA (0 when the median is 0). */
  thisVsMedian: number;
  /** Sum of every community's since-2020 awarded total (community-sited only —
   * excludes citywide / intermediary dollars). The denominator for `share`. */
  citywideTotal: number;
  /** thisTotal / citywideTotal (0 when the citywide total is 0). */
  share: number;
}

/** The full analysis for one community area. */
export interface CommunityInvestmentAnalysis {
  communityArea: string;
  generatedAt: string;
  /** Sum of every in-window (year >= 2020), non-null awarded amount. */
  totalAwarded: number;
  /** In-window yeared records + unYeared records — the hero's "grants & projects". */
  recordCount: number;
  /** Records with a null year — counted, never dollared. */
  unYeared: number;
  /** [min, max] in-window year present, or null when no in-window yeared record. */
  span: { min: number; max: number } | null;
  /** The latest in-window year present (== span.max), or SINCE_YEAR when none. */
  latestYear: number;
  byFunderType: FunderTypeBreakdown[];
  byYear: YearBreakdown[];
  bySource: SourceBreakdown[];
  topRecipients: TopRecipient[];
  topFunders: TopFunder[];
  equity: InvestmentEquity;
}

/** One row of the all-communities ranking (the landing page). */
export interface CommunityInvestmentRankRow {
  communityArea: string;
  totalAwarded: number;
  recordCount: number;
  unYeared: number;
}

/** The all-communities index used by the landing page and by equity ranking. */
export interface CommunityInvestmentIndex {
  generatedAt: string;
  /** Sum of every community's since-2020 awarded total (community-sited only). */
  citywideTotal: number;
  /** Number of communities with >= 1 record. */
  communityCount: number;
  /** All communities, ranked descending by totalAwarded. */
  rows: CommunityInvestmentRankRow[];
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** A record whose real year is in the since-2020 window (drives dollar math). */
function isInWindow(r: CommunityInvestmentRecord): boolean {
  return r.year != null && r.year >= SINCE_YEAR;
}

/** A record kept in the since-2020 view: in-window OR unYeared (null year). A
 * pre-2020 dated record is excluded. */
function isInSinceView(r: CommunityInvestmentRecord): boolean {
  return r.year == null || r.year >= SINCE_YEAR;
}

/** Sum of in-window, non-null awarded amounts across the given records. */
function sumInWindowAwarded(records: readonly CommunityInvestmentRecord[]): number {
  let total = 0;
  for (const r of records) {
    if (isInWindow(r) && r.amountAwarded != null) total += r.amountAwarded;
  }
  return total;
}

/** The median of a numeric list (0 for empty). Even length averages the two
 * middle values. Does not mutate the input. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ── All-communities index ─────────────────────────────────────────────────────

/**
 * Build the all-communities ranking from the full record set. Groups point
 * records by their stamped communityArea (citywide records carry none and are
 * skipped), sums each community's since-2020 awarded dollars, and ranks
 * descending. Pure / deterministic — ties break by community name so the order
 * is stable across runs.
 */
export function buildInvestmentIndex(
  records: readonly CommunityInvestmentRecord[],
  generatedAt: string,
): CommunityInvestmentIndex {
  const byCA = new Map<string, CommunityInvestmentRecord[]>();
  for (const r of records) {
    const ca = r.communityArea;
    if (!ca) continue;
    const list = byCA.get(ca);
    if (list) list.push(r);
    else byCA.set(ca, [r]);
  }

  const rows: CommunityInvestmentRankRow[] = [];
  for (const [ca, list] of byCA) {
    const inView = list.filter(isInSinceView);
    if (inView.length === 0) continue;
    rows.push({
      communityArea: ca,
      totalAwarded: sumInWindowAwarded(list),
      recordCount: inView.length,
      unYeared: inView.filter((r) => r.year == null).length,
    });
  }

  rows.sort((a, b) => b.totalAwarded - a.totalAwarded || a.communityArea.localeCompare(b.communityArea));

  const citywideTotal = rows.reduce((sum, row) => sum + row.totalAwarded, 0);
  return { generatedAt, citywideTotal, communityCount: rows.length, rows };
}

// ── Single-community analysis ─────────────────────────────────────────────────

/** Per-funderType breakdown over one community's records, in FUNDER_TYPES order.
 * `share` is a fraction of `totalAwarded`. */
function funderTypeBreakdown(
  records: readonly CommunityInvestmentRecord[],
  totalAwarded: number,
): FunderTypeBreakdown[] {
  return FUNDER_TYPES.map((funderType) => {
    const ofType = records.filter((r) => r.funderType === funderType);
    const awardedDollars = sumInWindowAwarded(ofType);
    return {
      funderType,
      awardedDollars,
      count: ofType.length, // in-window yeared + unYeared
      share: totalAwarded > 0 ? awardedDollars / totalAwarded : 0,
    };
  });
}

/** Per-year breakdown, zero-filled 2020..latest (inclusive). Empty when the
 * community has no in-window yeared record. */
function yearBreakdown(
  inWindow: readonly CommunityInvestmentRecord[],
  latestYear: number,
): YearBreakdown[] {
  if (inWindow.length === 0) return [];
  const dollars = new Map<number, number>();
  const counts = new Map<number, number>();
  for (const r of inWindow) {
    const y = r.year as number;
    counts.set(y, (counts.get(y) ?? 0) + 1);
    if (r.amountAwarded != null) dollars.set(y, (dollars.get(y) ?? 0) + r.amountAwarded);
  }
  const out: YearBreakdown[] = [];
  for (let y = SINCE_YEAR; y <= latestYear; y++) {
    out.push({ year: y, awardedDollars: dollars.get(y) ?? 0, count: counts.get(y) ?? 0 });
  }
  return out;
}

/** Per-source breakdown, in INVESTMENT_SOURCES order, only for sources present
 * in the since-2020 view. Development dollars are always 0 (amounts null). */
function sourceBreakdown(records: readonly CommunityInvestmentRecord[]): SourceBreakdown[] {
  const out: SourceBreakdown[] = [];
  for (const source of INVESTMENT_SOURCES) {
    const ofSource = records.filter((r) => r.source === source);
    if (ofSource.length === 0) continue;
    out.push({ source, awardedDollars: sumInWindowAwarded(ofSource), count: ofSource.length });
  }
  return out;
}

/** Top-N recipients by in-window awarded dollars. Ties break by recipient name
 * for a stable order. */
function topRecipients(
  inWindow: readonly CommunityInvestmentRecord[],
  limit: number,
): TopRecipient[] {
  return inWindow
    .filter((r) => r.amountAwarded != null && r.amountAwarded > 0)
    .map((r) => ({
      recipient: r.recipient,
      funderName: r.funderName,
      source: r.source,
      year: r.year,
      amountAwarded: r.amountAwarded as number,
      logLine: r.logLine,
    }))
    .sort((a, b) => b.amountAwarded - a.amountAwarded || a.recipient.localeCompare(b.recipient))
    .slice(0, limit);
}

/** Top-N funders by in-window awarded dollars, with grant counts. `grants`
 * counts every in-window record from that funder (including any with a null
 * amount); `awardedDollars` sums only the real amounts. */
function topFunders(inWindow: readonly CommunityInvestmentRecord[], limit: number): TopFunder[] {
  const dollars = new Map<string, number>();
  const grants = new Map<string, number>();
  for (const r of inWindow) {
    grants.set(r.funderName, (grants.get(r.funderName) ?? 0) + 1);
    if (r.amountAwarded != null) dollars.set(r.funderName, (dollars.get(r.funderName) ?? 0) + r.amountAwarded);
  }
  return [...grants.keys()]
    .map((funderName) => ({
      funderName,
      awardedDollars: dollars.get(funderName) ?? 0,
      grants: grants.get(funderName) ?? 0,
    }))
    .sort((a, b) => b.awardedDollars - a.awardedDollars || a.funderName.localeCompare(b.funderName))
    .slice(0, limit);
}

/**
 * Analyze one community area against the full record set. Returns null when the
 * community has no record in the since-2020 view (so a route can 404/redirect).
 * `index` is the prebuilt all-communities ranking — passed in so a page that
 * already built it (the landing page linking into an area) does not rebuild it;
 * omit it and the function builds one internally. Pure / deterministic.
 */
export function analyzeCommunityArea(
  records: readonly CommunityInvestmentRecord[],
  communityArea: string,
  generatedAt: string,
  index?: CommunityInvestmentIndex,
): CommunityInvestmentAnalysis | null {
  const mine = records.filter((r) => r.communityArea === communityArea);
  const inView = mine.filter(isInSinceView);
  if (inView.length === 0) return null;

  const inWindow = inView.filter(isInWindow);
  const totalAwarded = sumInWindowAwarded(inWindow);
  const unYeared = inView.filter((r) => r.year == null).length;

  const years = inWindow.map((r) => r.year as number);
  const span = years.length > 0 ? { min: Math.min(...years), max: Math.max(...years) } : null;
  const latestYear = span ? span.max : SINCE_YEAR;

  const idx = index ?? buildInvestmentIndex(records, generatedAt);
  const rankIndex = idx.rows.findIndex((row) => row.communityArea === communityArea);
  const medianCA = median(idx.rows.map((row) => row.totalAwarded));
  const equity: InvestmentEquity = {
    rank: rankIndex >= 0 ? rankIndex + 1 : idx.rows.length,
    totalCAs: idx.rows.length,
    citywideMedianCA: medianCA,
    thisVsMedian: medianCA > 0 ? totalAwarded / medianCA : 0,
    citywideTotal: idx.citywideTotal,
    share: idx.citywideTotal > 0 ? totalAwarded / idx.citywideTotal : 0,
  };

  return {
    communityArea,
    generatedAt,
    totalAwarded,
    recordCount: inView.length,
    unYeared,
    span,
    latestYear,
    byFunderType: funderTypeBreakdown(inView, totalAwarded),
    byYear: yearBreakdown(inWindow, latestYear),
    bySource: sourceBreakdown(inView),
    topRecipients: topRecipients(inWindow, 10),
    topFunders: topFunders(inWindow, 8),
    equity,
  };
}

// ── Major private developments (announced capital — a SEPARATE measure) ───────

/** One major private development for the "Major private developments" section. */
export interface MajorDevelopment {
  recipient: string;
  funderName: string;
  /** Announced private DEVELOPMENT capital (non-null; the section only lists
   * developments that carry a real announced figure). NEVER an awarded grant. */
  announcedInvestment: number;
  year: number | null;
  status: InvestmentStatus;
  logLine: string | null;
  /** First http(s) source link, or "" when the record carries none. */
  sourceLink: string;
  communityArea?: string;
}

/** The developments roll-up for a scope (citywide or one community area). */
export interface MajorDevelopmentsSummary {
  /** Number of major developments in scope (with a non-null announced figure). */
  count: number;
  /**
   * Sum of announcedInvestment across the in-scope developments — ANNOUNCED
   * private capital, a different measure from awarded grants; the two are never
   * added together (the UI states this inline). Named to pass the banned-figure
   * rail.
   */
  totalAnnounced: number;
  /** The developments, ranked by announced capital desc (name tiebreak), then sliced. */
  developments: MajorDevelopment[];
}

/**
 * Summarize the major private developments for a scope. A "major development" is
 * a `development`-source record carrying a non-null announcedInvestment (the
 * enriched megaprojects — the ~68 legacy KML rows and the subset/blank megadevs
 * have null announced capital and are excluded). When `communityArea` is given,
 * only that area's point-stamped developments count; otherwise it is citywide
 * (both point- and citywide-geometry developments, e.g. Advocate's multi-site
 * investment). `count`/`totalAnnounced` cover ALL in-scope developments; the
 * returned `developments` array is ranked desc by announcedInvestment (recipient
 * name tiebreak) and sliced to `limit` when provided. Pure / deterministic —
 * announcedInvestment is NEVER combined with amountAwarded.
 */
export function summarizeMajorDevelopments(
  records: readonly CommunityInvestmentRecord[],
  opts?: { communityArea?: string; limit?: number },
): MajorDevelopmentsSummary {
  const scoped = records.filter(
    (r) =>
      r.source === "development" &&
      r.announcedInvestment != null &&
      (opts?.communityArea == null || r.communityArea === opts.communityArea),
  );
  const totalAnnounced = scoped.reduce((sum, r) => sum + (r.announcedInvestment as number), 0);
  const ranked = scoped
    .map((r): MajorDevelopment => ({
      recipient: r.recipient,
      funderName: r.funderName,
      announcedInvestment: r.announcedInvestment as number,
      year: r.year,
      status: r.status,
      logLine: r.logLine,
      sourceLink: r.links.find((l) => /^https?:\/\//i.test(l)) ?? "",
      ...(r.communityArea ? { communityArea: r.communityArea } : {}),
    }))
    .sort((a, b) => b.announcedInvestment - a.announcedInvestment || a.recipient.localeCompare(b.recipient));
  return {
    count: scoped.length,
    totalAnnounced,
    developments: opts?.limit != null ? ranked.slice(0, opts.limit) : ranked,
  };
}

// ── Server-only loaders (fs) ──────────────────────────────────────────────────

/**
 * Load the all-communities ranking from the committed export. Returns null when
 * the export has not been generated yet (loadCommunityInvestment returns null),
 * so a route degrades to a clean empty state instead of throwing. Server-only.
 */
export function loadInvestmentIndex(): CommunityInvestmentIndex | null {
  const data = loadCommunityInvestment();
  if (!data) return null;
  return buildInvestmentIndex(data.records, data.generatedAt);
}

/**
 * Load one community's full analysis from the committed export. Returns null
 * when the export is absent or the community has no since-2020 record.
 * Server-only.
 */
export function loadInvestmentAnalysis(communityArea: string): CommunityInvestmentAnalysis | null {
  const data = loadCommunityInvestment();
  if (!data) return null;
  const index = buildInvestmentIndex(data.records, data.generatedAt);
  return analyzeCommunityArea(data.records, communityArea, data.generatedAt, index);
}

/**
 * Load the major private developments for a scope from the committed export.
 * Omit `communityArea` for the citywide roll-up (the landing page passes
 * `{ limit: 10 }` for the top-10 by announced capital); pass a community name for
 * that area's developments. Returns an empty summary when the export is absent.
 * Server-only.
 */
export function loadMajorDevelopments(opts?: {
  communityArea?: string;
  limit?: number;
}): MajorDevelopmentsSummary {
  const data = loadCommunityInvestment();
  if (!data) return { count: 0, totalAnnounced: 0, developments: [] };
  return summarizeMajorDevelopments(data.records, opts);
}
