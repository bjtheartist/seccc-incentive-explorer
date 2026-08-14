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

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  FUNDER_TYPES,
  INVESTMENT_SOURCES,
  loadCommunityInvestment,
  sumAnnouncedInvestment,
  sumAuthorizedByClass,
  sumCreditCapital,
  sumPublishedStateAppropriation,
  type CapitalClass,
  type CommunityInvestmentRecord,
  type FunderType,
  type InvestmentGeometry,
  type InvestmentSource,
  type InvestmentStatus,
} from "./community-investment";
import { formatCount, formatFullDollars, formatMultiple, formatPercent } from "@/components/investment/format";
import type { IllinoisArtsCouncilAward } from "./illinois-arts-council";
import type { GovernmentFundingPurpose } from "./government-funding-purpose";

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

export type MappableGovernmentFundingPurpose = Exclude<
  GovernmentFundingPurpose,
  "arts"
>;

/** Record-count view of what government support is for. Counts deliberately
 * avoid combining dollars whose capital classes have different meanings. Arts
 * awards remain city-level and are therefore absent from community analysis. */
export interface GovernmentFundingPurposeBreakdown {
  purpose: MappableGovernmentFundingPurpose;
  count: number;
}

/** One of the top-dollar recipients (in-window, real awarded amount). */
export interface TopRecipient {
  /** Stable source record id — lets a client shortlist flag/dedupe this row. */
  id: string;
  recipient: string;
  funderName: string;
  source: InvestmentSource;
  year: number | null;
  amountAwarded: number;
  logLine: string | null;
  /** Lifecycle stage of the award (drawer status badge). Top recipients are all
   * grant-class awards, so this is a grant status ("awarded" / "completed" / …). */
  status: InvestmentStatus;
  /** Capital class — always "grant" here (top recipients are amountAwarded>0
   * grant records), surfaced so the drawer can name the class honestly. */
  capitalClass: CapitalClass;
  /** Government funding purpose, or null for philanthropic/private records. */
  governmentFundingPurpose: GovernmentFundingPurpose | null;
  /** Street address as published, or null (the drawer's location line). */
  address: string | null;
  /**
   * The drawer's location-confidence. EXACTLY ONE TIER PER GEOMETRY KIND —
   * there is no separate confidence model, and no tier that the data cannot
   * produce:
   *   • "sited"    — geometry.kind "point": plotted at a real address.
   *   • "zip_area" — geometry.kind "zip_area": the source publishes a ZIP but no
   *     street address, so the record is a ZIP-level aggregate.
   *   • "citywide" — geometry.kind "citywide": genuinely unplotted (a foundation
   *     intermediary, a multi-site appropriation, an out-of-bounds geocode).
   *
   * "zip_area" is called out rather than folded into "citywide" because a ZIP
   * aggregate is a real, meaningfully narrower location claim than "somewhere in
   * Chicago" — reporting it as citywide understates what the source actually
   * published.
   */
  locationConfidence: "sited" | "zip_area" | "citywide";
  /** Source/project links (http(s)), for the drawer. */
  links: string[];
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
  /**
   * Foundation-source (funderType philanthropic) dollars within this
   * community's totalAwarded — computed LIVE from the same in-window records
   * as totalAwarded, never a hand-typed literal (audit finding 5 / consult
   * Q4). Powers the rank disclosure: a community rank can be dominated by
   * where a foundation's grantee HEADQUARTERS sits rather than where the
   * money was spent, so the figure quantifies exactly how much of THIS
   * community's total comes from foundation rows.
   */
  foundationDollars: number;
  /** foundationDollars / totalAwarded (0 when totalAwarded is 0). */
  foundationShare: number;
}

/** The full analysis for one community area. */
export interface CommunityInvestmentAnalysis {
  communityArea: string;
  generatedAt: string;
  /** Sum of every in-window (year >= 2020), non-null awarded amount. */
  totalAwarded: number;
  /** Median in-window awarded grant amount (records with a real, positive award);
   * 0 when the community has no such record. A SEPARATE statistic from
   * totalAwarded — a typical-award gauge for the status/compare surfaces. */
  medianAward: number;
  /**
   * Announced private DEVELOPMENT capital sited in this community (a self-reported
   * project price tag, never a grant). A SEPARATE measure from totalAwarded — the
   * "Announced private capital" status card reads this; it is NEVER summed with
   * awarded dollars. Equals sumAnnouncedInvestment over this community's records.
   */
  announcedCapital: number;
  /**
   * Council-AUTHORIZED TIF assistance ceilings (capitalClass "tif_subsidy") sited
   * in this community — a SEPARATE measure again, never a grant, never summed with
   * awarded/announced/credit dollars. Feeds the capital-class status row.
   */
  authorizedTif: number;
  /**
   * Committed HUD CDBG/HOME federal allocations (capitalClass "federal_program")
   * sited in this community — a SEPARATE measure, never summed with anything else.
   */
  federalProgram: number;
  /** All-time tax-credit capital (LIHTC + NMTC) stamped to this community — a
   * SEPARATE measure from totalAwarded, never summed with awarded dollars. */
  creditCapital: number;
  /**
   * Sol gate blocker 2 — the published state appropriation balance
   * (capitalClass "state_appropriation") POINT-SITED to this community only
   * (`mine`, the same community-filtered set every other capital-class field
   * here uses). The committed export's 620 appropriation rows are 563 held
   * CITYWIDE (no communityArea — they carry NO community, and belong ONLY to
   * the landing page's meta.totalPublishedStateAppropriation) and 57
   * point-sited; passing the citywide total here would show every community
   * the full state figure regardless of whether any appropriation was
   * actually sited there. A SEPARATE measure, never summed with anything else.
   */
  publishedStateAppropriation: number;
  /** GRANT-CLASS records in the since-2020 view (in-window yeared + unYeared) —
   * the hero's "grants & projects". Excludes the non-grant capital classes
   * (tif_subsidy / federal_program / tax_credit), which have their own count-free
   * capital row and are never labeled "grants". */
  recordCount: number;
  /** Grant-class records with a null year — counted, never dollared. */
  unYeared: number;
  /** [min, max] in-window year present, or null when no in-window yeared record. */
  span: { min: number; max: number } | null;
  /** The latest in-window year present (== span.max), or SINCE_YEAR when none. */
  latestYear: number;
  byFunderType: FunderTypeBreakdown[];
  byYear: YearBreakdown[];
  bySource: SourceBreakdown[];
  governmentFundingPurposes: GovernmentFundingPurposeBreakdown[];
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
  /**
   * All-time tax-credit capital (LIHTC + NMTC creditAmount) stamped to this
   * community. A SEPARATE MEASURE from totalAwarded — NOT a grant, never summed
   * with awarded dollars. Deliberately NOT year-windowed (tax-credit placements
   * are largely historical); reported beside the since-2020 awarded total, never
   * added to it. NMTC records reach this list via their tract-centroid community
   * stamp even though they are citywide geometry and never plot on the map.
   */
  creditCapital: number;
  /**
   * Foundation-source (funderType philanthropic) dollars within this row's
   * totalAwarded, computed live over the same since-2020 window (audit
   * finding 5 / consult Q4) — lets the landing ranking disclose exactly how
   * much of the TOP-ranked community's total is recipient-office
   * concentration rather than neighborhood-wide funding, without a
   * hand-typed literal.
   */
  foundationDollars: number;
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

/** Closed pandemic-recovery overlays have their own historical views. They are
 * excluded from the ordinary awarded-capital analysis so record counts, trends,
 * medians, and rankings do not silently mix current/base investment with
 * historical recovery transactions. */
function isBaseInvestmentRecord(r: CommunityInvestmentRecord): boolean {
  return r.recovery == null;
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
    if (!isBaseInvestmentRecord(r)) continue;
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
      // All-time tax-credit capital in this community — a SEPARATE measure, summed
      // over the full record list (not the since-2020 window) and never folded into
      // totalAwarded. Citywide-but-CA-stamped NMTC records contribute here.
      creditCapital: sumCreditCapital(list),
      foundationDollars: sumInWindowAwarded(list.filter((r) => r.funderType === "philanthropic")),
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

const MAPPABLE_GOVERNMENT_PURPOSES: readonly MappableGovernmentFundingPurpose[] = [
  "capital_project",
  "programmatic",
  "unclassified",
];

/** Count all sited base-investment government records by their persisted source
 * purpose. This is intentionally a record count, not a dollar aggregation. */
export function governmentFundingPurposeBreakdown(
  records: readonly CommunityInvestmentRecord[],
): GovernmentFundingPurposeBreakdown[] {
  return MAPPABLE_GOVERNMENT_PURPOSES.map((purpose) => ({
    purpose,
    count: records.filter(
      (record) =>
        record.funderType === "government" &&
        record.governmentFundingPurpose === purpose,
    ).length,
  }));
}

/**
 * Map a record's geometry to its location-confidence tier — exhaustive over
 * InvestmentGeometry, so a future geometry kind is a compile error here rather
 * than silently collapsing into "citywide".
 */
export function locationConfidenceForGeometry(
  geometry: InvestmentGeometry,
): TopRecipient["locationConfidence"] {
  switch (geometry.kind) {
    case "point":
      return "sited";
    case "zip_area":
      return "zip_area";
    case "citywide":
      return "citywide";
  }
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
      id: r.id,
      recipient: r.recipient,
      funderName: r.funderName,
      source: r.source,
      year: r.year,
      amountAwarded: r.amountAwarded as number,
      logLine: r.logLine,
      status: r.status,
      capitalClass: r.capitalClass,
      governmentFundingPurpose: r.governmentFundingPurpose,
      address: r.address,
      // One tier per geometry kind, mapped exhaustively. Previously this was
      // `point ? "sited" : "citywide"`, which reported a ZIP-level aggregate as
      // "citywide" — a weaker location claim than the source actually published.
      locationConfidence: locationConfidenceForGeometry(r.geometry),
      links: r.links,
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
  const mine = records.filter(
    (r) => r.communityArea === communityArea && isBaseInvestmentRecord(r),
  );
  const inView = mine.filter(isInSinceView);
  if (inView.length === 0) return null;

  // GRANT-CLASS FIREWALL: every AWARDED-dollar breakdown and every "grants &
  // projects" count below is computed over grant-class records ONLY. The four
  // non-grant capital classes (tif_subsidy / federal_program / tax_credit) carry
  // amountAwarded=null; they have their OWN StatusCards capital row + the print
  // brief's Capital-class context (fed from `mine` via authorizedTif /
  // federalProgram / creditCapital below), so they must NEVER surface in an
  // "Awarded dollars by program / funder type / year" chart as a $0 bar, nor be
  // counted as "grants & projects". `development` is grant-class (its money is
  // announcedInvestment, surfaced separately) so it stays in — a real "project".
  const grantInView = inView.filter((r) => r.capitalClass === "grant");

  const inWindow = grantInView.filter(isInWindow);
  const totalAwarded = sumInWindowAwarded(inWindow);
  const unYeared = grantInView.filter((r) => r.year == null).length;
  const medianAward = median(
    inWindow.filter((r) => r.amountAwarded != null && r.amountAwarded > 0).map((r) => r.amountAwarded as number),
  );

  const years = inWindow.map((r) => r.year as number);
  const span = years.length > 0 ? { min: Math.min(...years), max: Math.max(...years) } : null;
  const latestYear = span ? span.max : SINCE_YEAR;

  const idx = index ?? buildInvestmentIndex(records, generatedAt);
  const rankIndex = idx.rows.findIndex((row) => row.communityArea === communityArea);
  const medianCA = median(idx.rows.map((row) => row.totalAwarded));
  // Audit finding 5 / consult Q4: computed live from the SAME in-window
  // records as totalAwarded, over funderType "philanthropic" — the only
  // philanthropic-mapped source is "foundation" (lib/community-investment.ts
  // SOURCE_FUNDER_TYPE), so this is exactly "foundation rows" in plain terms.
  const foundationDollars = sumInWindowAwarded(inWindow.filter((r) => r.funderType === "philanthropic"));
  const equity: InvestmentEquity = {
    rank: rankIndex >= 0 ? rankIndex + 1 : idx.rows.length,
    totalCAs: idx.rows.length,
    citywideMedianCA: medianCA,
    thisVsMedian: medianCA > 0 ? totalAwarded / medianCA : 0,
    citywideTotal: idx.citywideTotal,
    share: idx.citywideTotal > 0 ? totalAwarded / idx.citywideTotal : 0,
    foundationDollars,
    foundationShare: totalAwarded > 0 ? foundationDollars / totalAwarded : 0,
  };

  return {
    communityArea,
    generatedAt,
    totalAwarded,
    medianAward,
    // Announced private development capital sited here — a SEPARATE measure from
    // totalAwarded (self-reported project price tags), never summed with grants.
    announcedCapital: sumAnnouncedInvestment(mine),
    // Council-authorized TIF ceilings + committed HUD federal allocations sited
    // here — each a SEPARATE measure, never summed with awarded/announced dollars.
    authorizedTif: sumAuthorizedByClass(mine, "tif_subsidy"),
    federalProgram: sumAuthorizedByClass(mine, "federal_program"),
    // All-time tax-credit capital in this community (LIHTC + NMTC) — a separate
    // measure, summed over every record (not the since-2020 window), never folded
    // into totalAwarded.
    creditCapital: sumCreditCapital(mine),
    // Sol gate blocker 2 — COMMUNITY-scoped, from `mine` (point-sited rows
    // only carry a communityArea) — never the citywide meta total.
    publishedStateAppropriation: sumPublishedStateAppropriation(mine),
    // "N grants & projects" — grant-class records ONLY (non-grant capital classes
    // are counted in the capital row, never here).
    recordCount: grantInView.length,
    unYeared,
    span,
    latestYear,
    byFunderType: funderTypeBreakdown(grantInView, totalAwarded),
    byYear: yearBreakdown(inWindow, latestYear),
    bySource: sourceBreakdown(grantInView),
    governmentFundingPurposes: governmentFundingPurposeBreakdown(mine),
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

// ── Auto-generated findings (pure, plain sentences) ───────────────────────────

/**
 * Three plain-language findings for the meeting-brief front page, each computed
 * straight off the analysis — no adjectives the numbers don't earn:
 *   1. Largest funder concentration (top funder's share of awarded dollars).
 *   2. Biggest year-over-year swing in awarded dollars.
 *   3. Where this community sits against the citywide community median (the
 *      equity gap), with its rank.
 * Always returns exactly three sentences; a finding whose inputs are missing
 * degrades to an honest "not enough data" line rather than a fabricated claim.
 * Every dollar named is an AWARDED amount. Pure / deterministic.
 */
export function computeInvestmentFindings(analysis: CommunityInvestmentAnalysis): string[] {
  const findings: string[] = [];

  // 1 — Funder concentration.
  const topFunder = analysis.topFunders.find((f) => f.awardedDollars > 0);
  if (topFunder && analysis.totalAwarded > 0) {
    const share = topFunder.awardedDollars / analysis.totalAwarded;
    findings.push(
      `${topFunder.funderName} is the largest single funder, accounting for ${formatPercent(share)} of awarded dollars (${formatFullDollars(topFunder.awardedDollars)} across ${formatCount(topFunder.grants)} grant${topFunder.grants === 1 ? "" : "s"}).`,
    );
  } else {
    findings.push("No single funder can be ranked — no dollar-valued awards are on record here since 2020.");
  }

  // 2 — Biggest year-over-year swing.
  const yearsWithDollars = analysis.byYear;
  let swing: { from: number; to: number; delta: number } | null = null;
  for (let i = 1; i < yearsWithDollars.length; i++) {
    const delta = yearsWithDollars[i].awardedDollars - yearsWithDollars[i - 1].awardedDollars;
    if (swing == null || Math.abs(delta) > Math.abs(swing.delta)) {
      swing = { from: yearsWithDollars[i - 1].year, to: yearsWithDollars[i].year, delta };
    }
  }
  if (swing && swing.delta !== 0) {
    const dir = swing.delta > 0 ? "a rise" : "a drop";
    findings.push(
      `The sharpest year-over-year change was ${dir} of ${formatFullDollars(Math.abs(swing.delta))} from ${swing.from} to ${swing.to}.`,
    );
  } else {
    findings.push("Awarded dollars show no year-over-year swing — too few dated years to compare.");
  }

  // 3 — Equity gap vs the citywide community median.
  const { thisVsMedian, rank, totalCAs, citywideMedianCA } = analysis.equity;
  if (citywideMedianCA > 0) {
    const relation =
      thisVsMedian >= 1
        ? `${formatMultiple(thisVsMedian)} the citywide community median — above the typical community`
        : `${formatPercent(thisVsMedian)} of the citywide community median — below the typical community`;
    findings.push(
      `Awarded dollars here are ${relation}; it ranks ${formatCount(rank)} of ${formatCount(totalCAs)} funded communities.`,
    );
  } else {
    findings.push(
      `This community ranks ${formatCount(rank)} of ${formatCount(totalCAs)} funded communities by awarded dollars since 2020.`,
    );
  }

  return findings;
}

// ── Flow rows (searchable funder → program → recipient table) ─────────────────

/** One awarded-dollar flow row for the searchable funder→program→recipient table
 * that fronts the "How the money flowed" section (the sankey moves behind a
 * disclosure). Every row is an in-window record with a real, positive AWARDED
 * amount — the same basis as buildFunderFlow / topRecipients. */
export interface FlowRow {
  id: string;
  funderName: string;
  funderType: FunderType;
  source: InvestmentSource;
  governmentFundingPurpose: GovernmentFundingPurpose | null;
  recipient: string;
  year: number;
  amountAwarded: number;
}

/**
 * Flatten one community's in-window, dollar-valued records into flow rows, sorted
 * by awarded dollars desc (recipient name tiebreak). Null-/zero-amount and
 * pre-2020 records are excluded — the exact participation rule the sankey uses,
 * so the table and the diagram never disagree. Pure / deterministic.
 */
export function buildFlowRows(records: readonly CommunityInvestmentRecord[]): FlowRow[] {
  return records
    .filter((r) => isInWindow(r) && r.amountAwarded != null && r.amountAwarded > 0)
    .map((r) => ({
      id: r.id,
      funderName: r.funderName,
      funderType: r.funderType,
      source: r.source,
      governmentFundingPurpose: r.governmentFundingPurpose,
      recipient: r.recipient,
      year: r.year as number,
      amountAwarded: r.amountAwarded as number,
    }))
    .sort((a, b) => b.amountAwarded - a.amountAwarded || a.recipient.localeCompare(b.recipient));
}

// ── Capital-class context (CRA / CDFI series beside the plotted records) ───────

/** One year of FFIEC CRA small-business lending for a community area. */
export interface CraYearRow {
  year: number;
  smallBusinessLoanCount: number;
  smallBusinessLoanDollars: number;
}

/** One year of CDFI transaction activity for a geography. */
export interface CdfiYearRow {
  year: number;
  transactionCount: number;
  dollars: number;
  instrumentMixText: string;
  transactionsMissingAmount: number;
}

/**
 * Coordinate-less capital CONTEXT for one community area, read from
 * data/private/capital-context.json: the FFIEC CRA small-business lending series
 * (keyed by community area) and the CDFI transaction series (community-area
 * geography level). These are DIFFERENT MONEY CONCEPTS from the plotted awarded
 * grants — bank small-business loan originations and CDFI loans/investments,
 * never grants — shown beside them, never summed with them. TIF district series
 * in that file are keyed by TIF district (not community area) and are NOT joined
 * here; the community's authorized-TIF total comes from its point-stamped records
 * (analysis.authorizedTif) instead.
 */
export interface CapitalContextForArea {
  communityArea: string;
  cra: CraYearRow[] | null;
  cdfi: CdfiYearRow[] | null;
  sources: string[];
  generatedAt: string | null;
}

export interface IllinoisArtsCouncilAwardsContext {
  fundingPurpose: Extract<GovernmentFundingPurpose, "arts">;
  fiscalYear: number;
  sourceVersion: string;
  sourceCheckedAt: string;
  sourcePageUrl: string;
  sourceDataUrl: string;
  recordCount: number;
  recordIdMeaning: string;
  amountMeaning: string;
  geographyMeaning: string;
  coverage: {
    capture: "complete_published";
    mapDetail: "aggregate_only";
    refresh: "awaiting_publication";
    review: "complete_published";
  };
  records: IllinoisArtsCouncilAward[];
}

interface RawCapitalContext {
  generatedAt?: string;
  meta?: { sources?: string[] };
  craByCommunityArea?: Array<{ communityArea: string; series: CraYearRow[] }>;
  cdfi?: Array<{ geography: string; geographyLevel: string; series: CdfiYearRow[] }>;
  illinoisArtsCouncilAwards?: IllinoisArtsCouncilAwardsContext;
}

const CAPITAL_CONTEXT_PATH = path.join(process.cwd(), "data/private/capital-context.json");
let capitalContextCache: RawCapitalContext | null | undefined = undefined;

/** Read + parse capital-context.json once per process (null when absent/unparseable). */
function loadCapitalContext(): RawCapitalContext | null {
  if (capitalContextCache !== undefined) return capitalContextCache;
  try {
    if (!existsSync(CAPITAL_CONTEXT_PATH)) {
      capitalContextCache = null;
      return capitalContextCache;
    }
    capitalContextCache = JSON.parse(readFileSync(CAPITAL_CONTEXT_PATH, "utf8")) as RawCapitalContext;
  } catch {
    capitalContextCache = null;
  }
  return capitalContextCache;
}

/** Test-only: reset the capital-context cache after mutating the file. */
export function __resetCapitalContextCacheForTests(): void {
  capitalContextCache = undefined;
}

/**
 * Look up the CRA + CDFI context series for one community area. Returns null
 * series when the file is absent or has no row for that area (a clean "context
 * pending" state, never a fabricated series). Server-only (fs).
 */
export function loadCapitalContextForArea(communityArea: string): CapitalContextForArea {
  const ctx = loadCapitalContext();
  const cra = ctx?.craByCommunityArea?.find((c) => c.communityArea === communityArea)?.series ?? null;
  const cdfi =
    ctx?.cdfi?.find((c) => c.geographyLevel === "community_area" && c.geography === communityArea)?.series ?? null;
  return {
    communityArea,
    cra: cra && cra.length > 0 ? cra : null,
    cdfi: cdfi && cdfi.length > 0 ? cdfi : null,
    sources: ctx?.meta?.sources ?? [],
    generatedAt: ctx?.generatedAt ?? null,
  };
}

/** Load the admin-only, city-level Illinois Arts Council historical awards. */
export function loadIllinoisArtsCouncilAwards(): IllinoisArtsCouncilAwardsContext | null {
  const awards = loadCapitalContext()?.illinoisArtsCouncilAwards;
  if (!awards || !Array.isArray(awards.records) || awards.records.length === 0) {
    return null;
  }
  return awards;
}

// ── Server-only loaders (fs) ──────────────────────────────────────────────────

/**
 * Load one community's flow rows (searchable funder→program→recipient table)
 * from the committed export. Returns [] when the export is absent. Server-only.
 */
export function loadFlowRows(communityArea: string): FlowRow[] {
  const data = loadCommunityInvestment();
  if (!data) return [];
  return buildFlowRows(data.records.filter((r) => r.communityArea === communityArea));
}

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
