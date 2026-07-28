/**
 * Community Investment dataset — export-side data contract, pure helpers, and
 * the static-only loader.
 *
 * This layer merges six independent public-money and private-capital sources
 * into one canonical, admin-gated map layer that answers "who has been putting
 * dollars into this neighborhood, and where":
 *
 *   • nof-small / nof-large — City of Chicago Neighborhood Opportunity Fund
 *     grant COMPLETIONS (Socrata) — physical build-outs that finished.
 *   • sbif                  — City of Chicago Small Business Improvement Fund
 *     COMPLETIONS (Socrata).
 *   • cdg                   — City of Chicago Community Development Grant AWARDS
 *     (scraped press-release rounds 2022–2025).
 *   • foundation            — private-foundation grants parsed from 990-PF/990
 *     filings, geocoded to the recipient's address (or held citywide when the
 *     recipient is an intermediary / the address is unmappable).
 *   • development           — major current development projects from Ellen's
 *     "Developments" map (megasites, Invest South/West, transit, etc.).
 *
 * The pipeline mirrors lib/tif-briefs.ts / lib/owner-cluster-geo.ts:
 *
 *   scripts/export-community-investment.ts (reads the six committed input files,
 *     geocodes the city-grant addresses that lack coordinates, dedupes
 *     cross-source rows that describe the same grant)
 *     -> data/private/community-investment.json (committed-private — NEVER
 *        served publicly; see data/private/README.md)
 *     -> loadCommunityInvestment() here (static-only, no DB)
 *     -> the admin-gated /api/owner-file/investment route.
 *
 * IRON RULE (repo precedent from the TIF funding work — lib/tif-briefs.ts): the
 * export never derives or computes a "received / available / remaining /
 * unspent" figure. Every dollar in a record is a real awarded/reported amount
 * or null — never a subtraction of two sources, never an implied balance. The
 * rule is enforced STRUCTURALLY: buildCommunityInvestmentExport() hard-fails if
 * ANY object key anywhere in the output matches BANNED_FIGURE_KEY_RE, so a
 * future edit that introduces such a field cannot be committed.
 *
 * No personal data of any kind travels beyond what the sources already publish
 * (grantee/business names + street addresses are the sensitive fields — exactly
 * why this file is admin-gated and never moved into public/).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// ── Enums (const arrays so completeness is testable) ─────────────────────────

/** The six merged sources. */
export const INVESTMENT_SOURCES = [
  "nof-small",
  "nof-large",
  "sbif",
  "cdg",
  "foundation",
  "development",
] as const;
export type InvestmentSource = (typeof INVESTMENT_SOURCES)[number];

/** Who is putting the money in. */
export const FUNDER_TYPES = ["government", "philanthropic", "private_development"] as const;
export type FunderType = (typeof FUNDER_TYPES)[number];

/**
 * Lifecycle stage of the dollar, chosen to be HONEST about what each source
 * actually records:
 *   • completed — a finished build-out (NOF/SBIF completion records).
 *   • awarded   — money committed/granted (CDG rounds, foundation grants, and
 *     Jim's NOF corridor list of awards without a completion record).
 *   • announced — a development publicly announced / underway.
 *   • proposed  — a development still at the proposal stage.
 */
export const INVESTMENT_STATUSES = ["completed", "awarded", "announced", "proposed"] as const;
export type InvestmentStatus = (typeof INVESTMENT_STATUSES)[number];

/** Canonical source -> funderType mapping. Exhaustive over INVESTMENT_SOURCES
 * (guarded by the `Record<InvestmentSource, …>` type and a unit test). */
export const SOURCE_FUNDER_TYPE: Record<InvestmentSource, FunderType> = {
  "nof-small": "government",
  "nof-large": "government",
  sbif: "government",
  cdg: "government",
  foundation: "philanthropic",
  development: "private_development",
};

// ── Data contract ────────────────────────────────────────────────────────────

/**
 * A record's geometry is either a real plottable point or an explicit
 * "citywide" marker (foundation intermediary / unmappable rows). Citywide
 * carries NO lat/lng — it must never be silently plotted at 0,0 or a downtown
 * HQ that would mislead a map reader (per the geocoding agent's intermediary
 * caveat).
 */
export type InvestmentGeometry = { kind: "point"; lat: number; lng: number } | { kind: "citywide" };

/** One canonical community-investment record. */
export interface CommunityInvestmentRecord {
  /** Stable, deterministic id (source-prefixed). */
  id: string;
  source: InvestmentSource;
  funderType: FunderType;
  /** The funding entity/program (e.g. a foundation name, or the City program). */
  funderName: string;
  /** The grantee / project / development. */
  recipient: string;
  /** Real awarded/reported dollars, or null — NEVER a derived figure. */
  amountAwarded: number | null;
  /** A one-line project description, or null when the source has none. */
  logLine: string | null;
  /**
   * The calendar year the money attaches to (completion year, award round year,
   * or 990 tax year), or null when the source carries no year (development
   * projects have no reliable single year and are left null rather than guessed).
   */
  year: number | null;
  geometry: InvestmentGeometry;
  /** Street address as published, or null (developments carry only a point). */
  address: string | null;
  /** Chicago community area when the source supplies it (Socrata NOF/SBIF). */
  communityArea?: string;
  status: InvestmentStatus;
  /**
   * Raw completion/approval date the record attaches to (Socrata completion_date,
   * or the approval_date fallback), or null when the source carries none. Named
   * neutrally — it is provenance, NOT a derived received/available/remaining
   * figure. Threaded through so the dedupe can tell a genuine duplicate ROW from
   * two REAL completions of the same grantee on DIFFERENT dates (which must both
   * survive). Sources without a per-record date (CDG rounds, foundations,
   * developments) leave it null.
   */
  recordDate?: string | null;
  /** Source/project links (deduped, http(s) only). */
  links: string[];
}

/** Provenance + run stats for the committed export. */
export interface CommunityInvestmentMeta {
  /** Per-source kept-record counts. */
  counts: Record<InvestmentSource, number>;
  /** records.length (a convenience mirror of the array length). */
  totalRecords: number;
  /** Number of point-geometry records. */
  pointCount: number;
  /** Number of citywide-geometry records. */
  citywideCount: number;
  /**
   * Sum of every non-null amountAwarded. This is a plain total of AWARDED
   * dollars, not a derived received/available/remaining/unspent figure — the
   * key name is deliberately chosen to pass the banned-figure rail.
   */
  totalDollarsAwarded: number;
  /** City-grant rows dropped because geocoding failed and they carry no coords. */
  droppedNoGeocode: number;
  /** Cross-source rows removed by the address+amount dedupe. */
  dedupedRows: number;
  /**
   * Foundation rows rejected as placeholders (recipient/address literally
   * "SEE ATTACHED", or a 99999-style filler zip/address) — a 990-PF grant-schedule
   * aggregate the parser captured, NOT a real single grant. Counted, never silently
   * kept, so nothing inflates totalDollarsAwarded.
   */
  droppedPlaceholder: number;
  /** Socrata completion/approval rows dropped because their year predates the
   * source's inclusion window (nof 2017 / sbif 2020). */
  droppedPreWindow: number;
  /** Socrata/development rows dropped because they carry no usable coordinates. */
  droppedNoCoords: number;
  /** Sited foundation points whose geocode fell OUTSIDE Chicago bounds and were
   * held citywide instead of plotted at a misleading out-of-city location (a bad
   * geocode is not a bad grant — the dollars still count). */
  outOfBoundsGeocodes: number;
  /** Records whose source amount was negative (a 990 correction / return-of-grant)
   * and was set to null rather than quietly reducing the awarded total. */
  negativeAmountsNulled: number;
  /** Human-readable source/provenance labels for the section footer. */
  sources: string[];
}

export interface CommunityInvestmentExport {
  generatedAt: string;
  meta: CommunityInvestmentMeta;
  records: CommunityInvestmentRecord[];
}

// ── IRON RULE: banned derived-figure key rail ────────────────────────────────

/**
 * No object key anywhere in the committed export may name a derived
 * "received / available / remaining / unspent" figure. Mirrors
 * lib/tif-briefs.ts's TIF_FORBIDDEN_FIGURE_KEY_RE, widened to this task's
 * banned vocabulary.
 */
export const BANNED_FIGURE_KEY_RE = /received|available|remaining|unspent/i;

/**
 * Recursively collect every object key in `value` that matches the banned
 * figure-name rail. Returns [] when clean. Pure — used by the structural assert
 * and unit-tested directly.
 */
export function findBannedFigureKeys(value: unknown): string[] {
  const hits: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) {
        if (BANNED_FIGURE_KEY_RE.test(k)) hits.push(k);
        walk(child);
      }
    }
  };
  walk(value);
  return hits;
}

/**
 * Hard-fail if the value carries any banned derived-figure key. Throws with the
 * offending keys so a bad export aborts before it is written. Pure/deterministic.
 */
export function assertNoBannedFigureKeys(value: unknown): void {
  const hits = findBannedFigureKeys(value);
  if (hits.length > 0) {
    throw new Error(
      `Community Investment export violates the banned-figure rail — remove these keys: ${hits.join(", ")}`,
    );
  }
}

// ── Dedupe (pure) ────────────────────────────────────────────────────────────

/**
 * Canonical spellings for the trailing street-type token, so a completion row
 * written "…Stony Island Av" and a corridor-award row written "…Stony Island
 * Ave." fold to the same dedupe key. Only the LAST token is canonicalized (the
 * street-type position in this data), so a street NAMED "Court"/"Park" is never
 * rewritten.
 */
const STREET_TYPE_CANON: Record<string, string> = {
  AV: "AVE", AVE: "AVE", AVEN: "AVE", AVENUE: "AVE",
  ST: "ST", STR: "ST", STREET: "ST",
  BLV: "BLVD", BLVD: "BLVD", BOULEVARD: "BLVD",
  RD: "RD", ROAD: "RD",
  DR: "DR", DRIVE: "DR",
  LN: "LN", LANE: "LN",
  CT: "CT", COURT: "CT",
  PL: "PL", PLACE: "PL",
  PKY: "PKWY", PKWY: "PKWY", PARKWAY: "PKWY",
  TER: "TER", TERR: "TER", TERRACE: "TER",
  SQ: "SQ", SQUARE: "SQ",
  HWY: "HWY", HIGHWAY: "HWY",
};

/**
 * Normalize a street address for dedupe comparison: upper-case, strip
 * punctuation, collapse whitespace, and canonicalize the trailing street-type
 * abbreviation. "212 E. 79th St." and "212 E 79th St" fold to the same key, as
 * do "8126 S Stony Island Av" and "8126 S. Stony Island Ave." — so Jim's
 * corridor award and the Socrata NOF completion of the same project match.
 * Returns "" for a null/blank input (an unusable key).
 */
export function normalizeAddressForDedupe(address: string | null | undefined): string {
  if (!address) return "";
  const base = address
    .toUpperCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (base === "") return "";
  const tokens = base.split(" ");
  const canon = STREET_TYPE_CANON[tokens[tokens.length - 1]];
  if (canon) tokens[tokens.length - 1] = canon;
  return tokens.join(" ");
}

/** Common legal/entity suffixes stripped when comparing recipient names. */
const RECIPIENT_SUFFIX_RE = /\b(L\s?L\s?C|L\s?L\s?P|INC(ORPORATED)?|CORP(ORATION)?|CO|P\s?C|LTD)\b/g;

/**
 * Normalize a recipient/business name for dedupe comparison: upper-case, drop
 * non-alphanumeric, strip legal suffixes (LLC/INC/PC/…), collapse whitespace.
 * "Marina Cartage, Inc." and "Marina Cartage Inc" fold together; "The Park
 * Manor 75, LLC" and "The Park Manor 75 LLC" fold together. Returns "" for
 * null/blank. Used to tell a true duplicate ROW apart from two DIFFERENT
 * tenants of the same multi-tenant building that happen to share the same
 * standardized grant amount.
 */
export function normalizeRecipientForDedupe(recipient: string | null | undefined): string {
  if (!recipient) return "";
  return recipient
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(RECIPIENT_SUFFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** completed beats awarded beats announced beats proposed. */
const DEDUPE_STATUS_RANK: Record<InvestmentStatus, number> = {
  completed: 0,
  awarded: 1,
  announced: 2,
  proposed: 3,
};

/**
 * A "round cap" grant amount — a positive whole multiple of $25,000. These are
 * program ceilings (the $250,000 NOF-small cap, common CDG award sizes) that two
 * UNRELATED businesses can independently land on, so an amount match alone is NOT
 * evidence two award/completion rows describe the same project. A distinctive
 * non-round figure (e.g. $139,058.77) effectively never collides by chance.
 */
export function isRoundCapAmount(amount: number | null | undefined): boolean {
  return amount != null && amount > 0 && amount % 25000 === 0;
}

/** The date portion (YYYY-MM-DD) of a raw record date, "" when absent. */
function normalizeRecordDate(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).slice(0, 10);
}

/** True when two records carry the same completion/approval date (both absent
 * counts as equal — an undated pair can still be a true duplicate row). */
function recordDatesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeRecordDate(a) === normalizeRecordDate(b);
}

/**
 * Collapse rows that describe the SAME grant, keeping ONE and preferring the
 * completion record. Two government point-records at the same normalized
 * address and amount are treated as the same grant only when:
 *   • SAME lifecycle status (both completed, or both awarded) — a true duplicate
 *     ROW requires the normalized recipient names to match AND the record dates
 *     to be identical. Two same-name completions on DIFFERENT completion dates
 *     are two REAL grant cycles and BOTH survive (e.g. House 2 Home LLC's two
 *     $75,000 SBIF completions at 655 W 59th St, 2023-02-24 vs 2023-11-14).
 *   • DIFFERENT status (one awarded, one completed) — the completion supersedes
 *     the award when the names match OR the shared amount is a distinctive
 *     non-round figure. A name match handles "Legacy, etc" (NOF completion) vs
 *     "Mikkey's Retro Grill" (Jim's corridor award) at 8126 S Stony Island Ave —
 *     a DBA rebrand of one project at $139,058.77. The non-round-amount test
 *     catches the same case even when the names diverge; but when the names
 *     DIFFER and the amount is a round program cap ($250,000), the two rows are
 *     assumed to be two DIFFERENT businesses and BOTH are kept.
 * When neither holds — DIFFERENT businesses that merely share a multi-tenant
 * address and the same standardized grant amount (e.g. four separate SBIF
 * grantees at one building each capped at $62,500) — BOTH rows are kept.
 *
 * Scope is intentionally narrow to avoid false merges: only records that are
 *   • funderType === "government" (NOF/SBIF/CDG),
 *   • geometry.kind === "point" (a real sited grant, not a citywide marker), and
 *   • amountAwarded != null with a non-empty normalized address
 * are eligible. Philanthropic (foundation) and private (development) rows are
 * NEVER deduped — foundations legitimately share intermediary addresses and
 * would be wrongly merged. Ineligible rows always pass through untouched.
 *
 * Deterministic and order-preserving: the first row of a matched group holds
 * its slot; a later row of the same group with a strictly better (lower-rank)
 * status replaces it in place; every other collision is dropped and counted.
 * Pure — unit-tested without a network call.
 */
export function dedupeInvestmentRecords(records: readonly CommunityInvestmentRecord[]): {
  records: CommunityInvestmentRecord[];
  removedCount: number;
} {
  const kept: CommunityInvestmentRecord[] = [];
  // addr|amount key -> indices (into `kept`) of the group's surviving members.
  const groupsByKey = new Map<string, number[]>();
  let removedCount = 0;

  for (const r of records) {
    const normAddr = normalizeAddressForDedupe(r.address);
    const eligible =
      r.funderType === "government" && r.geometry.kind === "point" && r.amountAwarded != null && normAddr !== "";
    if (!eligible) {
      kept.push(r);
      continue;
    }
    const key = `${normAddr}|${r.amountAwarded}`;
    const group = groupsByKey.get(key);
    if (!group) {
      groupsByKey.set(key, [kept.length]);
      kept.push(r);
      continue;
    }
    const rName = normalizeRecipientForDedupe(r.recipient);
    // Does r duplicate an existing group member?
    let matchIdx = -1;
    for (const idx of group) {
      const k = kept[idx];
      const sameName = rName !== "" && rName === normalizeRecipientForDedupe(k.recipient);
      const statusDiffers = r.status !== k.status; // government status ∈ {completed, awarded}
      const isMatch = statusDiffers
        ? // award ↔ completion supersede: same project when the names match, or
          // when the shared amount is a distinctive (non-round-cap) figure that a
          // coincidental two-business collision is vanishingly unlikely to hit.
          sameName || !isRoundCapAmount(r.amountAwarded)
        : // same status: a genuine duplicate ROW needs the same name AND the same
          // completion/record date — different dates mean two real grant cycles.
          sameName && recordDatesEqual(r.recordDate, k.recordDate);
      if (isMatch) {
        matchIdx = idx;
        break;
      }
    }
    if (matchIdx === -1) {
      // Same address+amount but a distinct grantee → keep as its own row.
      group.push(kept.length);
      kept.push(r);
      continue;
    }
    // Collapse into the matched slot, keeping the better-ranked status.
    if (DEDUPE_STATUS_RANK[r.status] < DEDUPE_STATUS_RANK[kept[matchIdx].status]) {
      kept[matchIdx] = r;
    }
    removedCount += 1;
  }

  return { records: kept, removedCount };
}

// ── Export assembly (pure) ───────────────────────────────────────────────────

/** Sum every non-null amountAwarded (a plain total of awarded dollars). */
export function sumAwardedDollars(records: readonly CommunityInvestmentRecord[]): number {
  let total = 0;
  for (const r of records) if (r.amountAwarded != null) total += r.amountAwarded;
  return total;
}

/** Per-source kept-record counts, exhaustive over INVESTMENT_SOURCES. */
export function countBySource(records: readonly CommunityInvestmentRecord[]): Record<InvestmentSource, number> {
  const counts = Object.fromEntries(INVESTMENT_SOURCES.map((s) => [s, 0])) as Record<InvestmentSource, number>;
  for (const r of records) counts[r.source] += 1;
  return counts;
}

/**
 * Assemble the final export object and run the structural banned-figure assert.
 * `droppedNoGeocode` / `dedupedRows` are run-stats the caller tracks; `sources`
 * are provenance labels. Throws (via assertNoBannedFigureKeys) if any banned
 * key slipped into a record — so the writer never persists an offending file.
 */
export function buildCommunityInvestmentExport(
  records: CommunityInvestmentRecord[],
  generatedAt: string,
  stats: {
    droppedNoGeocode: number;
    dedupedRows: number;
    sources: string[];
    droppedPlaceholder?: number;
    droppedPreWindow?: number;
    droppedNoCoords?: number;
    outOfBoundsGeocodes?: number;
    negativeAmountsNulled?: number;
  },
): CommunityInvestmentExport {
  const pointCount = records.filter((r) => r.geometry.kind === "point").length;
  const out: CommunityInvestmentExport = {
    generatedAt,
    meta: {
      counts: countBySource(records),
      totalRecords: records.length,
      pointCount,
      citywideCount: records.length - pointCount,
      totalDollarsAwarded: sumAwardedDollars(records),
      droppedNoGeocode: stats.droppedNoGeocode,
      dedupedRows: stats.dedupedRows,
      droppedPlaceholder: stats.droppedPlaceholder ?? 0,
      droppedPreWindow: stats.droppedPreWindow ?? 0,
      droppedNoCoords: stats.droppedNoCoords ?? 0,
      outOfBoundsGeocodes: stats.outOfBoundsGeocodes ?? 0,
      negativeAmountsNulled: stats.negativeAmountsNulled ?? 0,
      sources: stats.sources,
    },
    records,
  };
  assertNoBannedFigureKeys(out);
  return out;
}

// ── Static-only loader ───────────────────────────────────────────────────────

const COMMUNITY_INVESTMENT_PATH = path.join(process.cwd(), "data/private/community-investment.json");

// Module-level cache, read once per process.
// `undefined` = not attempted yet; `null` = attempted and the file is absent or
// unparseable (a legitimate state before the export has been generated).
let cache: CommunityInvestmentExport | null | undefined = undefined;

function isValidExport(value: unknown): value is CommunityInvestmentExport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CommunityInvestmentExport>;
  return Array.isArray(candidate.records) && typeof candidate.generatedAt === "string";
}

/**
 * Read and parse the committed export once per process. Static-only (no DB
 * fallback). Returns `null` when the file has not been generated yet (or fails
 * to parse) so the gated API route degrades to a clean 503 instead of throwing.
 * Mirrors loadOwnerClusterGeoFile / loadTifBriefs.
 */
export function loadCommunityInvestment(): CommunityInvestmentExport | null {
  if (cache !== undefined) return cache;
  try {
    if (!existsSync(COMMUNITY_INVESTMENT_PATH)) {
      cache = null;
      return cache;
    }
    const parsed = JSON.parse(readFileSync(COMMUNITY_INVESTMENT_PATH, "utf8")) as unknown;
    cache = isValidExport(parsed) ? parsed : null;
  } catch {
    cache = null;
  }
  return cache;
}

/** Test-only: reset the module cache so tests can re-read the file after mutating it. */
export function __resetCommunityInvestmentCacheForTests(): void {
  cache = undefined;
}

/**
 * Filter a loaded export down to the given sources. A null/empty `sources`
 * returns the export unfiltered. `meta` and `generatedAt` pass through unchanged
 * (the counts describe the full committed export, not the filtered view).
 */
export function filterInvestmentBySources(
  data: CommunityInvestmentExport,
  sources?: string[] | null,
): CommunityInvestmentExport {
  if (!sources || sources.length === 0) return data;
  const allowed = new Set(sources);
  return { ...data, records: data.records.filter((r) => allowed.has(r.source)) };
}
