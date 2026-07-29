/**
 * Community Investment dataset — export-side data contract, pure helpers, and
 * the static-only loader.
 *
 * This layer merges twelve independent public-money and private-capital sources
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
 *   scripts/export-community-investment.ts (reads the committed input files,
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

/**
 * The merged sources. The first six are the original grant/development layer;
 * the next four carry NON-grant public capital that awarded totals must never
 * absorb, and the final two are opt-in historical/context overlays:
 *   • tif        — City of Chicago TIF-funded RDA/IGA projects (council-authorized
 *     TIF assistance ceilings) — capitalClass "tif_subsidy", money in
 *     authorizedAmount, amountAwarded null.
 *   • cdbg-home  — HUD CDBG/HOME activities administered by the City of Chicago
 *     (committed federal allocations) — capitalClass "federal_program", money in
 *     authorizedAmount, amountAwarded null.
 *   • lihtc      — Low-Income Housing Tax Credit allocations (tax-credit capital)
 *     — capitalClass "tax_credit", money in creditAmount.
 *   • nmtc       — New Markets Tax Credit QLICIs (tax-credit capital) — capitalClass
 *     "tax_credit", money in creditAmount, citywide geometry (no street address in
 *     the public file) but community-area-stamped from the project's 2020 census
 *     tract centroid so it still appears in per-community analysis lists.
 *   • cook-source-2023 — Cook County's completed 2023 Source Grant awards. The
 *     official recipient list carries ZIP, not street address, so these records
 *     use zip-area geometry and are rendered only as ZIP aggregates.
 *   • dceo-capital — Illinois DCEO capital-appropriation listings. The source PDF
 *     publishes appropriation balances, not active opportunities or confirmed
 *     award payments, so money lives only in publishedBalance.
 */
export const INVESTMENT_SOURCES = [
  "nof-small",
  "nof-large",
  "sbif",
  "cdg",
  "foundation",
  "development",
  "tif",
  "cdbg-home",
  "lihtc",
  "nmtc",
  "cook-source-2023",
  "dceo-capital",
] as const;
export type InvestmentSource = (typeof INVESTMENT_SOURCES)[number];

/** Who is putting the money in. */
export const FUNDER_TYPES = ["government", "philanthropic", "private_development"] as const;
export type FunderType = (typeof FUNDER_TYPES)[number];

/**
 * A SECOND, ORTHOGONAL axis to funderType: what KIND of capital a record's money
 * is, so the awarded-grant totals never silently absorb a subsidy, a federal
 * program allocation, or tax-credit capital. Every record carries exactly one:
 *   • grant          — a real awarded/reported grant dollar (amountAwarded). The
 *     default for all six original sources (NOF/SBIF/CDG/foundation) and the
 *     zero-dollar development records.
 *   • tif_subsidy    — a council-AUTHORIZED TIF assistance ceiling (authorizedAmount).
 *     NOT money awarded to a business, NOT money spent — a public-financing ceiling.
 *   • federal_program— a committed HUD CDBG/HOME federal allocation (authorizedAmount).
 *     Program funding, not a discretionary grant award to a named business.
 *   • tax_credit     — LIHTC/NMTC tax-credit capital (creditAmount). A different
 *     financing instrument again; never a grant, never summed with anything.
 *   • state_appropriation — a published DCEO appropriation balance
 *     (publishedBalance). Context only: not an active opportunity or a promise
 *     of funds to the map user.
 * The five money-meaning fields (amountAwarded / announcedInvestment /
 * authorizedAmount / creditAmount / publishedBalance) are mutually exclusive
 * per record and are NEVER added together (enforced structurally in
 * buildCommunityInvestmentExport).
 */
export const CAPITAL_CLASSES = [
  "grant",
  "tif_subsidy",
  "federal_program",
  "tax_credit",
  "state_appropriation",
] as const;
export type CapitalClass = (typeof CAPITAL_CLASSES)[number];

/**
 * Lifecycle stage of the dollar, chosen to be HONEST about what each source
 * actually records:
 *   • completed          — a finished build-out (NOF/SBIF completion records).
 *   • awarded            — money committed/granted (CDG rounds, foundation
 *     grants, Chicago Prize awards, Jim's NOF corridor awards w/o a completion).
 *   • disbursed          — a completed historical award program (Cook Source).
 *   • appropriated       — a published state appropriation listing (DCEO).
 *   • announced          — a development publicly announced, no ground broken.
 *   • proposed           — a development still at the proposal stage.
 *   • under_construction — a development actively being built.
 *   • partially_open     — a phased development with some phases open/occupied.
 *   • opened             — a development fully open / complete.
 *   • stalled            — an announced development paused / on hold.
 *   • cancelled          — an announced development formally cancelled.
 * The last five are the granular megadevelopment lifecycle states
 * (developments_major.csv status_2026); the first four are unchanged.
 */
export const INVESTMENT_STATUSES = [
  "completed",
  "awarded",
  "disbursed",
  "appropriated",
  "announced",
  "proposed",
  "under_construction",
  "partially_open",
  "opened",
  "stalled",
  "cancelled",
] as const;
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
  // The original four capital-spine sources are all PUBLIC-policy capital (City TIF,
  // HUD CDBG/HOME, and the federal LIHTC/NMTC tax-credit programs administered
  // through public/quasi-public entities) → funderType "government". The
  // grant-vs-subsidy-vs-federal-vs-credit distinction lives on the SEPARATE
  // capitalClass axis, not here.
  tif: "government",
  "cdbg-home": "government",
  lihtc: "government",
  nmtc: "government",
  "cook-source-2023": "government",
  "dceo-capital": "government",
};

/**
 * Canonical source -> capitalClass mapping (the default a record's capitalClass
 * takes from its source). Exhaustive over INVESTMENT_SOURCES (guarded by the
 * `Record<InvestmentSource, …>` type and a unit test). A development record is a
 * "grant" class carrying zero grant dollars — its money lives in the separate
 * announcedInvestment field, never a grant/subsidy/credit total.
 */
export const SOURCE_CAPITAL_CLASS: Record<InvestmentSource, CapitalClass> = {
  "nof-small": "grant",
  "nof-large": "grant",
  sbif: "grant",
  cdg: "grant",
  foundation: "grant",
  development: "grant",
  tif: "tif_subsidy",
  "cdbg-home": "federal_program",
  lihtc: "tax_credit",
  nmtc: "tax_credit",
  "cook-source-2023": "grant",
  "dceo-capital": "state_appropriation",
};

// ── Data contract ────────────────────────────────────────────────────────────

/**
 * A record's geometry is a real plottable point, a ZIP-area aggregate, or an
 * explicit "citywide" marker (foundation intermediary / unmappable rows).
 * Citywide carries NO lat/lng — it must never be silently plotted at 0,0 or a
 * downtown HQ that would mislead a map reader.
 */
export type InvestmentGeometry =
  | { kind: "point"; lat: number; lng: number }
  | { kind: "zip_area"; zip: string }
  | { kind: "citywide" };

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
  /**
   * Which of the five money-meaning fields carries this record's dollars (see
   * CAPITAL_CLASSES). "grant" → amountAwarded; "tif_subsidy"/"federal_program" →
   * authorizedAmount; "tax_credit" → creditAmount; "state_appropriation" →
   * publishedBalance. The awarded/announced/authorized/credit totals are each
   * computed from ONE field, never combined.
   */
  capitalClass: CapitalClass;
  /** Real awarded/reported GRANT dollars, or null — NEVER a derived figure, and
   * NEVER populated on a tif/cdbg-home/lihtc/nmtc record (whose money lives in
   * authorizedAmount / creditAmount). */
  amountAwarded: number | null;
  /**
   * A council-AUTHORIZED TIF assistance ceiling (capitalClass "tif_subsidy") or a
   * committed HUD CDBG/HOME federal program allocation (capitalClass
   * "federal_program"), or null. A DIFFERENT TRUTH from amountAwarded: NOT a grant
   * awarded to a business, NOT money spent, NOT an announced private price tag. It
   * must NEVER be summed into totalDollarsAwarded, announcedCapitalTotal, or any
   * awarded/announced aggregate — it rolls up ONLY into totalAuthorizedTif (the
   * tif_subsidy subset) and totalFederalProgram (the federal_program subset).
   * Only ever populated on `tif` / `cdbg-home` records; null everywhere else.
   * Enforced structurally: buildCommunityInvestmentExport() recomputes the awarded
   * total from amountAwarded alone and hard-fails on any divergence.
   */
  authorizedAmount?: number | null;
  /**
   * Tax-credit capital — a LIHTC annual allocated amount or an NMTC project QLICI
   * amount (capitalClass "tax_credit"), or null. A DIFFERENT financing instrument
   * again: never a grant, never a subsidy ceiling, never an announced price tag.
   * It must NEVER be summed with any other money field — it rolls up ONLY into
   * totalCreditCapital. Only ever populated on `lihtc` / `nmtc` records; null
   * everywhere else.
   */
  creditAmount?: number | null;
  /**
   * DCEO's source-published capital-appropriation balance, or null. This is not
   * an active opportunity, award, payment, project budget, or estimate of funds
   * a user could receive. It is populated only on `state_appropriation` records
   * and is never rolled into an awarded/authorized/credit headline total.
   */
  publishedBalance?: number | null;
  /**
   * Announced private DEVELOPMENT capital (developments_major.csv
   * announced_investment_usd) — the publicly reported total project cost of a
   * major private development, or null. This is a DIFFERENT TRUTH from
   * amountAwarded: it is a self-reported project price tag, NOT a grant a public
   * or philanthropic body awarded. It must NEVER be summed into
   * totalDollarsAwarded, any awarded aggregate, or the density-mode weight —
   * awarded grants and announced development capital are separate measures that
   * are never combined. Only ever populated on `development` records; null
   * everywhere else. Enforced structurally: buildCommunityInvestmentExport()
   * recomputes totalDollarsAwarded from amountAwarded alone and hard-fails if it
   * ever diverges, and a grep-level test forbids any code that adds the two
   * fields together.
   */
  announcedInvestment?: number | null;
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
  /** Source-published five-digit ZIP when available; never inferred. */
  postalCode?: string;
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
  /**
   * Where the row's facts come from: "official" (a city dataset / published
   * record) or "partner-list" (a hand-kept partner sheet re-stating an award,
   * e.g. Jim's corridor NOF list). Absent means "official". The dedupe treats a
   * cross-provenance address+amount collision as the SAME award re-stated (the
   * official row wins), while two official rows with different record dates are
   * two REAL grant events and both survive.
   */
  recordProvenance?: "official" | "partner-list";
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
  /** Number of ZIP-area records (aggregated before map rendering). */
  zipAreaCount: number;
  /** Cook County rows retained for Chicago ZIP aggregation. */
  cookSourceChicagoRecords: number;
  /** Cook County rows kept in the curated source but excluded from this Chicago map. */
  cookSourceOutsideChicagoRecords: number;
  /** High-confidence Chicago DCEO records retained from the statewide ledger. */
  dceoChicagoRecords: number;
  /** DCEO Chicago records plotted at one explicit, successfully geocoded address. */
  dceoPointRecords: number;
  /** DCEO Chicago records held citywide because the source location was not point-safe. */
  dceoCitywideRecords: number;
  /** Single explicit DCEO addresses that failed geocoding and were held citywide. */
  dceoAddressGeocodeMisses: number;
  /** DCEO geocodes outside Chicago that were rejected and held citywide. */
  dceoAddressOutOfBounds: number;
  /** Multi-address/various-location DCEO rows deliberately held citywide. */
  dceoMultiSiteHeldCitywide: number;
  /**
   * Sum of every non-null amountAwarded. This is a plain total of AWARDED
   * dollars, not a derived received/available/remaining/unspent figure — the
   * key name is deliberately chosen to pass the banned-figure rail.
   */
  totalDollarsAwarded: number;
  /**
   * Sum of every non-null announcedInvestment — the announced PRIVATE development
   * capital across the major-development records. A SEPARATE MEASURE from
   * totalDollarsAwarded: announced project price tags, never awarded grants. The
   * two are reported side by side but are never added together (a UI note makes
   * the distinction explicit). Excludes the subset-capital record(s) counted in
   * `subsetExcluded`. Passes the banned-figure rail (no
   * received/available/remaining/unspent token).
   */
  announcedCapitalTotal: number;
  /**
   * Sum of every authorizedAmount on a `tif_subsidy`-class record — the total
   * council-AUTHORIZED TIF assistance across the mapped RDA/IGA projects. A
   * SEPARATE MEASURE: not awarded grants, not announced private capital, not tax
   * credits. Computed from authorizedAmount on tif_subsidy records ALONE and never
   * added into any other total. Passes the banned-figure rail.
   */
  totalAuthorizedTif: number;
  /**
   * Sum of every authorizedAmount on a `federal_program`-class record — the total
   * committed HUD CDBG/HOME federal allocation across the mapped activities. A
   * SEPARATE MEASURE, computed from federal_program authorizedAmount ALONE.
   */
  totalFederalProgram: number;
  /**
   * Sum of every creditAmount on a `tax_credit`-class record — the total LIHTC +
   * NMTC tax-credit capital. A SEPARATE MEASURE, computed from creditAmount ALONE
   * and never combined with awarded/announced/authorized dollars.
   */
  totalCreditCapital: number;
  /**
   * Megadevelopment records whose announcedInvestment was deliberately left null
   * because the figure is a SUBSET of another development's already-counted total
   * (e.g. the Chicago Fire stadium's $650M sits inside The 78's $7B). Kept on the
   * map for context, excluded from announcedCapitalTotal so nothing double-counts.
   */
  subsetExcluded: number;
  /**
   * Major-development rows dropped because they are NOT private-led (public
   * infrastructure) — this layer models private development only. 0 when every
   * retained megadevelopment is genuinely a private (or private-anchored) project.
   */
  privateLedExcluded: number;
  /** HUD CDBG/HOME activities dropped because their geocode fell OUTSIDE the
   * Chicago bounding box (a bad/suburban geocode is not plotted at a misleading
   * point) — counted here so the drop is visible rather than silent. */
  droppedHudOutOfBbox: number;
  /** TIF RDA/IGA rows dropped because the source published no usable coordinates
   * (this layer only creates a point record for a row with real coords). */
  droppedTifNoCoords: number;
  /** LIHTC rows dropped because they carry no usable coordinates. */
  droppedLihtcNoCoords: number;
  /** NMTC records (always citywide geometry — the public file has no street
   * address) whose community area WAS stamped from the project's 2020 census-tract
   * centroid, so they surface in per-community credit-capital lists without ever
   * plotting. */
  nmtcCitywideStamped: number;
  /** NMTC records whose 2020 census tract had no gazetteer centroid, so no
   * community area could be assigned (kept citywide, no CA — never guessed). */
  nmtcUnstamped: number;
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
  /**
   * Point-geometry records whose coordinates fell OUTSIDE every one of Chicago's
   * 77 community areas during the export's point-in-polygon stamping (a point on
   * the lake, an inter-CA gap, or a slightly-off geocode near the city edge).
   * They keep NO communityArea and are excluded from any per-community total —
   * counted here so the drop is visible rather than silent. Citywide-geometry
   * records are never point-stamped and are NOT included in this figure.
   */
  outsideCommunityAreas: number;
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

/**
 * completed beats awarded beats announced beats proposed. The dedupe only ever
 * consults this rank for GOVERNMENT point records (see dedupeInvestmentRecords'
 * `eligible` guard: funderType === "government"), whose status is always
 * "completed" or "awarded". The five megadevelopment lifecycle states
 * (under_construction … cancelled) belong exclusively to private_development
 * records, which are structurally excluded from dedupe — so their ranks here are
 * inert and only satisfy the exhaustive `Record<InvestmentStatus, …>` type.
 * They are given ranks strictly BELOW the government statuses (higher numbers)
 * so that, even in a hypothetical future where a development row became
 * dedupe-eligible, a real completed/awarded government record would always win.
 */
const DEDUPE_STATUS_RANK: Record<InvestmentStatus, number> = {
  completed: 0,
  awarded: 1,
  disbursed: 2,
  appropriated: 3,
  announced: 4,
  proposed: 5,
  under_construction: 6,
  partially_open: 7,
  opened: 8,
  stalled: 9,
  cancelled: 10,
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
    const rProvenance = r.recordProvenance ?? "official";
    // Does r duplicate an existing group member?
    let matchIdx = -1;
    for (const idx of group) {
      const k = kept[idx];
      const kName = normalizeRecipientForDedupe(k.recipient);
      const sameName = rName !== "" && rName === kName;
      // Cross-provenance only: "Huddle House" vs "Huddle House Diner" is the
      // same award re-stated with a truncated/expanded name.
      const nameLoose =
        sameName || (rName !== "" && kName !== "" && (rName.startsWith(kName) || kName.startsWith(rName)));
      const statusDiffers = r.status !== k.status; // government status ∈ {completed, awarded}
      const provenanceDiffers = rProvenance !== (k.recordProvenance ?? "official");
      const isMatch = provenanceDiffers
        ? // A partner list re-states an official award: same project when the
          // names loosely match, or when the shared amount is a distinctive
          // (non-round-cap) figure — covers DBA-vs-legal-name pairs.
          nameLoose || !isRoundCapAmount(r.amountAwarded)
        : statusDiffers
          ? // award ↔ completion supersede within official data: same project when
            // the names match, or the shared amount is a distinctive figure.
            sameName || !isRoundCapAmount(r.amountAwarded)
          : // same provenance + status: a genuine duplicate ROW needs the same name
            // AND the same record date — different dates mean two real grant cycles.
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
    // Collapse into the matched slot: the official record beats a partner-list
    // re-statement; within the same provenance, the better-ranked status wins.
    const matched = kept[matchIdx];
    const matchedOfficial = (matched.recordProvenance ?? "official") === "official";
    const rOfficial = rProvenance === "official";
    const rWins =
      rOfficial !== matchedOfficial
        ? rOfficial
        : DEDUPE_STATUS_RANK[r.status] < DEDUPE_STATUS_RANK[matched.status];
    if (rWins) {
      kept[matchIdx] = r;
    }
    removedCount += 1;
  }

  // Second pass: a partner-list re-statement can carry a slightly-off street
  // number (Jim's "9401 S Stony Island" vs the official award's "9421"), which
  // defeats the address-keyed grouping above. Collapse a partner-list row into
  // an official row when the names loosely match, the amount is identical, and
  // the two points sit within PARTNER_RESTATEMENT_RADIUS_M of each other —
  // unrelated businesses sharing a prefix name, an exact dollar figure, AND a
  // block is not a real collision mode.
  const finalRecords: CommunityInvestmentRecord[] = [];
  const officialByAmount = new Map<number, CommunityInvestmentRecord[]>();
  for (const r of kept) {
    if (
      (r.recordProvenance ?? "official") === "official" &&
      r.funderType === "government" &&
      r.geometry.kind === "point" &&
      r.amountAwarded != null
    ) {
      const list = officialByAmount.get(r.amountAwarded);
      if (list) list.push(r);
      else officialByAmount.set(r.amountAwarded, [r]);
    }
  }
  for (const r of kept) {
    const isPartnerPoint =
      r.recordProvenance === "partner-list" &&
      r.funderType === "government" &&
      r.geometry.kind === "point" &&
      r.amountAwarded != null;
    if (isPartnerPoint) {
      const rName = normalizeRecipientForDedupe(r.recipient);
      const candidates = officialByAmount.get(r.amountAwarded as number) ?? [];
      const shadowed = candidates.some((o) => {
        const oName = normalizeRecipientForDedupe(o.recipient);
        const nameLoose =
          rName !== "" && oName !== "" && (rName === oName || rName.startsWith(oName) || oName.startsWith(rName));
        return (
          nameLoose &&
          r.geometry.kind === "point" &&
          o.geometry.kind === "point" &&
          haversineMeters(r.geometry.lat, r.geometry.lng, o.geometry.lat, o.geometry.lng) <= PARTNER_RESTATEMENT_RADIUS_M
        );
      });
      if (shadowed) {
        removedCount += 1;
        continue;
      }
    }
    finalRecords.push(r);
  }

  return { records: finalRecords, removedCount };
}

/** Radius within which a partner-list row is treated as re-stating a nearby official award. */
const PARTNER_RESTATEMENT_RADIUS_M = 150;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Export assembly (pure) ───────────────────────────────────────────────────

/** Sum every non-null amountAwarded (a plain total of awarded dollars). */
export function sumAwardedDollars(records: readonly CommunityInvestmentRecord[]): number {
  let total = 0;
  for (const r of records) if (r.amountAwarded != null) total += r.amountAwarded;
  return total;
}

/**
 * Sum every non-null announcedInvestment (announced private DEVELOPMENT capital).
 * A SEPARATE total from sumAwardedDollars — the two are never added together.
 * Reads a field the awarded sum deliberately ignores, so no dollar is ever
 * counted in both. Pure.
 */
export function sumAnnouncedInvestment(records: readonly CommunityInvestmentRecord[]): number {
  let total = 0;
  for (const r of records) if (r.announcedInvestment != null) total += r.announcedInvestment;
  return total;
}

/**
 * Sum authorizedAmount across records of ONE capitalClass ("tif_subsidy" or
 * "federal_program"). Reads a field the awarded/announced sums deliberately
 * ignore, so no dollar is ever double-counted across measures. Restricting by
 * capitalClass keeps the TIF ceiling total and the HUD federal-allocation total
 * cleanly separate even though both live in authorizedAmount. Pure.
 */
export function sumAuthorizedByClass(
  records: readonly CommunityInvestmentRecord[],
  capitalClass: "tif_subsidy" | "federal_program",
): number {
  let total = 0;
  for (const r of records) {
    if (r.capitalClass === capitalClass && r.authorizedAmount != null) total += r.authorizedAmount;
  }
  return total;
}

/**
 * Sum every non-null creditAmount (LIHTC + NMTC tax-credit capital). A SEPARATE
 * total again — never combined with awarded, announced, or authorized dollars.
 * Pure.
 */
export function sumCreditCapital(records: readonly CommunityInvestmentRecord[]): number {
  let total = 0;
  for (const r of records) if (r.creditAmount != null) total += r.creditAmount;
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
    outsideCommunityAreas?: number;
    subsetExcluded?: number;
    privateLedExcluded?: number;
    droppedHudOutOfBbox?: number;
    droppedTifNoCoords?: number;
    droppedLihtcNoCoords?: number;
    nmtcCitywideStamped?: number;
    nmtcUnstamped?: number;
    cookSourceChicagoRecords?: number;
    cookSourceOutsideChicagoRecords?: number;
    dceoChicagoRecords?: number;
    dceoPointRecords?: number;
    dceoCitywideRecords?: number;
    dceoAddressGeocodeMisses?: number;
    dceoAddressOutOfBounds?: number;
    dceoMultiSiteHeldCitywide?: number;
  },
): CommunityInvestmentExport {
  const pointCount = records.filter((r) => r.geometry.kind === "point").length;
  const zipAreaCount = records.filter((r) => r.geometry.kind === "zip_area").length;
  const totalDollarsAwarded = sumAwardedDollars(records);

  // STRUCTURAL GUARD (money-field firewall): the awarded total must be computable
  // from amountAwarded ALONE. Recompute it the long way, summing only amountAwarded
  // and NEVER announcedInvestment / authorizedAmount / creditAmount, and hard-fail
  // on any divergence — so a future edit that folds announced development capital,
  // a TIF/federal authorization ceiling, or tax-credit capital into the awarded
  // total cannot be committed. (sumAwardedDollars already ignores those fields;
  // this asserts the invariant explicitly at build time.)
  let awardedOnly = 0;
  for (const r of records) if (r.amountAwarded != null) awardedOnly += r.amountAwarded;
  if (awardedOnly !== totalDollarsAwarded) {
    throw new Error(
      `Community Investment export: totalDollarsAwarded (${totalDollarsAwarded}) diverges from the ` +
        `amountAwarded-only recompute (${awardedOnly}) — announced development capital, TIF/federal ` +
        `authorization ceilings, and tax-credit capital must NEVER be summed into the awarded total.`,
    );
  }

  // FIREWALL ASSERT (per-class field discipline): each capitalClass may populate
  // ONLY its own money field. A grant/development record never carries an
  // authorized or credit amount; a tif/federal record carries ONLY authorizedAmount
  // (amountAwarded null); a tax_credit record carries ONLY creditAmount. This makes
  // the money fields provably non-overlapping — a dollar can live in exactly one.
  for (const r of records) {
    const hasAwarded = r.amountAwarded != null;
    const hasAuthorized = r.authorizedAmount != null;
    const hasCredit = r.creditAmount != null;
    const hasPublishedBalance = r.publishedBalance != null;
    const hasAnnounced = r.announcedInvestment != null;
    if (r.capitalClass === "grant") {
      if (hasAuthorized || hasCredit || hasPublishedBalance) {
        throw new Error(
          `Record ${r.id} (capitalClass grant) must not carry authorizedAmount/creditAmount/publishedBalance.`,
        );
      }
    } else if (r.capitalClass === "tif_subsidy" || r.capitalClass === "federal_program") {
      if (hasAwarded || hasCredit || hasPublishedBalance || hasAnnounced) {
        throw new Error(
          `Record ${r.id} (capitalClass ${r.capitalClass}) may carry ONLY authorizedAmount — not ` +
            `amountAwarded/creditAmount/publishedBalance/announcedInvestment.`,
        );
      }
    } else if (r.capitalClass === "tax_credit") {
      if (hasAwarded || hasAuthorized || hasPublishedBalance || hasAnnounced) {
        throw new Error(
          `Record ${r.id} (capitalClass tax_credit) may carry ONLY creditAmount — not ` +
            `amountAwarded/authorizedAmount/publishedBalance/announcedInvestment.`,
        );
      }
    } else if (r.capitalClass === "state_appropriation") {
      if (hasAwarded || hasAuthorized || hasCredit || hasAnnounced) {
        throw new Error(
          `Record ${r.id} (capitalClass state_appropriation) may carry ONLY publishedBalance — not ` +
            `amountAwarded/authorizedAmount/creditAmount/announcedInvestment.`,
        );
      }
    }
  }

  const out: CommunityInvestmentExport = {
    generatedAt,
    meta: {
      counts: countBySource(records),
      totalRecords: records.length,
      pointCount,
      citywideCount: records.filter((r) => r.geometry.kind === "citywide").length,
      zipAreaCount,
      cookSourceChicagoRecords: stats.cookSourceChicagoRecords ?? 0,
      cookSourceOutsideChicagoRecords: stats.cookSourceOutsideChicagoRecords ?? 0,
      dceoChicagoRecords: stats.dceoChicagoRecords ?? 0,
      dceoPointRecords: stats.dceoPointRecords ?? 0,
      dceoCitywideRecords: stats.dceoCitywideRecords ?? 0,
      dceoAddressGeocodeMisses: stats.dceoAddressGeocodeMisses ?? 0,
      dceoAddressOutOfBounds: stats.dceoAddressOutOfBounds ?? 0,
      dceoMultiSiteHeldCitywide: stats.dceoMultiSiteHeldCitywide ?? 0,
      totalDollarsAwarded,
      announcedCapitalTotal: sumAnnouncedInvestment(records),
      totalAuthorizedTif: sumAuthorizedByClass(records, "tif_subsidy"),
      totalFederalProgram: sumAuthorizedByClass(records, "federal_program"),
      totalCreditCapital: sumCreditCapital(records),
      subsetExcluded: stats.subsetExcluded ?? 0,
      privateLedExcluded: stats.privateLedExcluded ?? 0,
      droppedHudOutOfBbox: stats.droppedHudOutOfBbox ?? 0,
      droppedTifNoCoords: stats.droppedTifNoCoords ?? 0,
      droppedLihtcNoCoords: stats.droppedLihtcNoCoords ?? 0,
      nmtcCitywideStamped: stats.nmtcCitywideStamped ?? 0,
      nmtcUnstamped: stats.nmtcUnstamped ?? 0,
      droppedNoGeocode: stats.droppedNoGeocode,
      dedupedRows: stats.dedupedRows,
      droppedPlaceholder: stats.droppedPlaceholder ?? 0,
      droppedPreWindow: stats.droppedPreWindow ?? 0,
      droppedNoCoords: stats.droppedNoCoords ?? 0,
      outOfBoundsGeocodes: stats.outOfBoundsGeocodes ?? 0,
      negativeAmountsNulled: stats.negativeAmountsNulled ?? 0,
      outsideCommunityAreas: stats.outsideCommunityAreas ?? 0,
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
