/**
 * Community Investment MAP-LAYER support — the client-safe half of the
 * admin-gated "Community investment" layer (components/map/MapView.tsx +
 * MapLegendPanel.tsx).
 *
 * lib/community-investment.ts is the DATA-CONTRACT + static loader and imports
 * `node:fs` / `node:path`, so it can only run server-side (the gated
 * /api/owner-file/investment route). This module carries everything the client
 * needs — endpoint, palette, year ranges, pure record→GeoJSON transforms, the
 * client-side year/funderType filter, the citywide summary, and the injectable
 * probe-then-fetch orchestration — importing ONLY types from the data contract
 * (type-only imports are erased at build time and never pull `node:fs` into the
 * browser bundle). Mirrors the split used for the ownership-cluster layer:
 * lib/owner-cluster-geo.ts (server) vs lib/owner-classify.ts (client-safe).
 *
 * The fetch orchestration mirrors lib/owner-file-report-context.ts
 * (fetchAdminOwnershipContext): a `fetchImpl` seam so the toggle's network
 * behavior is unit-testable in the node vitest env without rendering the map.
 */

import type {
  CapitalClass,
  CommunityInvestmentExport,
  CommunityInvestmentRecord,
  FunderType,
  InvestmentStatus,
} from "@/lib/community-investment";
import type { FunderHq } from "@/lib/investment-deck-modes";

/** The gated dataset endpoint the layer fetches when toggled on. */
export const COMMUNITY_INVESTMENT_ENDPOINT = "/api/owner-file/investment";

/**
 * Canonical funder-type order wherever the three are listed together (legend
 * checkboxes, color key). Government first (the largest, most-mapped source),
 * private development last. Mirrors OWNER_TYPE_ORDER in lib/owner-classify.ts.
 */
export const FUNDER_TYPE_ORDER: FunderType[] = ["government", "philanthropic", "private_development"];

export const FUNDER_TYPE_LABELS: Record<FunderType, string> = {
  government: "Government",
  philanthropic: "Philanthropic",
  private_development: "Private development",
};

/**
 * Display labels for every InvestmentStatus — the ONE place status text is
 * humanized, shared by the map popup, the analysis "Major private developments"
 * section, and the print brief so the raw snake_case enum ("under_construction")
 * never reaches a reader. Exhaustive over INVESTMENT_STATUSES (a unit test guards
 * completeness).
 */
export const INVESTMENT_STATUS_LABELS: Record<InvestmentStatus, string> = {
  completed: "Completed",
  awarded: "Awarded",
  announced: "Announced",
  proposed: "Proposed",
  under_construction: "Under construction",
  partially_open: "Partially open",
  opened: "Opened",
  stalled: "Stalled",
  cancelled: "Cancelled",
};

/** Humanize a status for display; falls back to the raw value for an off-enum string. */
export function investmentStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return INVESTMENT_STATUS_LABELS[status as InvestmentStatus] ?? status;
}

/**
 * Funder-type dot colors, drawn from the app's existing palette so the layer
 * reads as part of the same system:
 *   • government          #2563EB — the app's canonical government / City blue
 *     (LEVEL_COLORS, OWNER_TYPE_COLORS.city_public).
 *   • philanthropic       #059669 — the grantmaking / community green
 *     (enterprise zones, Community Assets, OWNER_TYPE_COLORS.local_private).
 *   • private_development  #7C3AED — the private-capital purple already used
 *     for investor ownership (OWNER_TYPE_COLORS.out_of_state, State level).
 */
export const FUNDER_TYPE_COLORS: Record<FunderType, string> = {
  government: "#2563EB",
  philanthropic: "#059669",
  private_development: "#7C3AED",
};

/** Fallback dot color for any unrecognized funderType (matches the paint fallback). */
export const INVESTMENT_FALLBACK_COLOR = "#9CA3AF";

/**
 * Capital-class axis (lib/community-investment.ts CAPITAL_CLASSES), surfaced on
 * the map so the four new capital-spine sources (TIF / HUD / LIHTC-NMTC) read as
 * a DIFFERENT KIND of money than a grant. Order = grant first, then the three
 * non-grant classes, for the legend sub-key.
 */
export const CAPITAL_CLASS_ORDER: CapitalClass[] = [
  "grant",
  "tif_subsidy",
  "federal_program",
  "tax_credit",
];

/** Short capital-class labels for the legend sub-key + the record drawer chip. */
export const CAPITAL_CLASS_LABELS: Record<CapitalClass, string> = {
  grant: "Grant",
  tif_subsidy: "TIF subsidy",
  federal_program: "Federal program",
  tax_credit: "Tax credit",
};

/**
 * The CORRECT money noun for each capital class — the word the popup/drawer puts
 * in front of the dollar figure so it is NEVER mislabeled. A grant is "Awarded",
 * a TIF assistance ceiling is "Authorized", a HUD CDBG/HOME allocation is
 * "Federal program funding", a LIHTC/NMTC placement is a "Tax-credit allocation".
 * (A `development` record is capitalClass "grant" but is labeled "Announced" by
 * the popup's own private-development branch, ahead of this map.)
 */
export const CAPITAL_CLASS_MONEY_NOUN: Record<CapitalClass, string> = {
  grant: "Awarded",
  tif_subsidy: "Authorized",
  federal_program: "Federal program funding",
  tax_credit: "Tax-credit allocation",
};

/**
 * Distinct DOT-OUTLINE color per capital class (a mapbox circle can't dash, so a
 * stroke color from the app palette carries the distinction instead). All four
 * capital-spine sources are funderType `government` → the same blue FILL, so the
 * OUTLINE is what tells a grant apart from a TIF/federal/tax-credit dot:
 *   • grant           → white (the unchanged default ring).
 *   • tif_subsidy     → amber #D97706 (the app's "authorized ceiling" accent).
 *   • federal_program → navy ink #0C1B33 (a dark program ring).
 *   • tax_credit      → magenta #DB2777 (a distinct credit ring, off the three
 *     funder-type hues so it never reads as a funder type).
 */
export const CAPITAL_CLASS_OUTLINE: Record<CapitalClass, string> = {
  grant: "#ffffff",
  tif_subsidy: "#D97706",
  federal_program: "#0C1B33",
  tax_credit: "#DB2777",
};

const CAPITAL_CLASS_ORDER_STRINGS: readonly string[] = CAPITAL_CLASS_ORDER;

/**
 * Distinct capital classes actually present among the plotted points, in
 * CAPITAL_CLASS_ORDER — drives the legend's capital-class sub-legend so a class
 * with no dots never shows a swatch. Mirrors presentFunderTypesInOrder. An empty
 * input yields an empty array; unknown classes are dropped.
 */
export function presentCapitalClassesInOrder(
  classes: Array<string | null | undefined>,
): CapitalClass[] {
  const present = new Set<string>();
  for (const c of classes) if (c && CAPITAL_CLASS_ORDER_STRINGS.includes(c)) present.add(c);
  return CAPITAL_CLASS_ORDER.filter((k) => present.has(k));
}

export interface InvestmentYearRange {
  id: string;
  label: string;
  /** Inclusive lower bound, or null for the "All" chip (no year constraint). */
  min: number | null;
  /** Inclusive upper bound, or null for the "All" chip. */
  max: number | null;
}

/**
 * Year-range chips for the legend. "All" first (min/max null → no constraint),
 * then the four windows the task specifies. A record whose `year` is null (e.g.
 * a development project with no reliable single year) only ever shows under
 * "All" — it can never satisfy a bounded window.
 */
export const INVESTMENT_YEAR_RANGES: InvestmentYearRange[] = [
  { id: "all", label: "All", min: null, max: null },
  { id: "2017-2019", label: "2017–2019", min: 2017, max: 2019 },
  { id: "2020-2021", label: "2020–2021", min: 2020, max: 2021 },
  { id: "2022-2023", label: "2022–2023", min: 2022, max: 2023 },
  { id: "2024-2026", label: "2024–2026", min: 2024, max: 2026 },
];

export const DEFAULT_INVESTMENT_YEAR_RANGE = "all";

/**
 * Feature properties for one plotted community-investment point, carrying exactly
 * the fields the click popup renders (buildInvestmentPopupHtml in map-helpers.ts).
 * `sourceLink` is the first http(s) link flattened to a single string because
 * Mapbox serializes non-primitive feature properties to strings — keeping it a
 * scalar avoids a JSON.parse round-trip in the click handler.
 */
export interface InvestmentPointProps {
  id: string;
  recipient: string;
  funderName: string;
  funderType: FunderType;
  /**
   * What KIND of capital this dot's money is (grant / tif_subsidy /
   * federal_program / tax_credit). Drives the popup's money noun + field and the
   * dot's outline color, so a TIF ceiling / federal allocation / tax-credit
   * placement is NEVER mislabeled "Awarded". Defaults to "grant" for the six
   * original grant/development sources.
   */
  capitalClass: CapitalClass;
  /** Real awarded GRANT dollars, or null — NEVER a derived figure, and null on
   * every tif/cdbg-home/lihtc/nmtc dot (whose money lives below). */
  amountAwarded: number | null;
  /** Council-AUTHORIZED TIF ceiling (tif_subsidy) or committed HUD CDBG/HOME
   * allocation (federal_program), or null. A DIFFERENT truth from amountAwarded. */
  authorizedAmount: number | null;
  /** LIHTC/NMTC tax-credit capital (tax_credit), or null. A DIFFERENT instrument. */
  creditAmount: number | null;
  /**
   * Announced private DEVELOPMENT capital, or null — a SEPARATE measure from
   * amountAwarded, carried so the popup can label a development's figure
   * "Announced" (never "Awarded") and the Dots-mode radius can size a
   * development dot by it. Never combined with amountAwarded.
   */
  announcedInvestment: number | null;
  logLine: string | null;
  year: number | null;
  status: InvestmentStatus;
  /** The stamped Chicago community area (point-in-polygon), or "" — powers the
   * popup's "Analyze this community →" cross-link to /investment/[area]. */
  communityArea: string;
  /** First http(s) source link, or "" when the record carries none. */
  sourceLink: string;
  /**
   * Precomputed Dots-mode circle radius (px) for a DEVELOPMENT record, sized by
   * announcedInvestment over the development records only (sqrt-domain, 4–18px).
   * Absent on non-development points (they size by amountAwarded in the mapbox
   * paint). Stamped here rather than in the paint because a domain-normalized
   * scale needs the whole development set, which a per-feature mapbox expression
   * cannot see.
   */
  radiusPx?: number;
}

export type InvestmentPointFeature = GeoJSON.Feature<GeoJSON.Point, InvestmentPointProps>;

/** Dots-mode radius bounds for a DEVELOPMENT dot (px), sized by announcedInvestment. */
export const DEV_DOT_RADIUS_MIN = 4;
export const DEV_DOT_RADIUS_MAX = 18;

/**
 * Build a Dots-mode radius scale across the ACTUAL announced-capital domain of
 * the development records being plotted: sqrt(announcedInvestment) normalized
 * between the set's min and max, mapped to [4, 18] px. Mirrors
 * makeArcWidthScale (lib/investment-deck-modes.ts) but for circle radius, so a
 * $7B megasite dot reads visibly larger than a $30M hotel while a null-capital
 * development (subset/blank) sits at the 4px floor. A degenerate domain (one
 * development / all-equal amounts) renders at the midpoint radius. Null/negative
 * amounts count as 0. Pure / deterministic.
 */
export function makeDevelopmentDotRadiusScale(
  amounts: readonly (number | null | undefined)[],
): (amount: number | null | undefined) => number {
  const roots = amounts.map((a) => Math.sqrt(Math.max(0, a ?? 0)));
  const lo = roots.length ? Math.min(...roots) : 0;
  const hi = roots.length ? Math.max(...roots) : 0;
  const span = hi - lo;
  if (span <= 0) return () => (DEV_DOT_RADIUS_MIN + DEV_DOT_RADIUS_MAX) / 2;
  return (amount) => {
    const v = Math.sqrt(Math.max(0, amount ?? 0));
    const t = Math.min(1, Math.max(0, (v - lo) / span));
    return DEV_DOT_RADIUS_MIN + t * (DEV_DOT_RADIUS_MAX - DEV_DOT_RADIUS_MIN);
  };
}

/**
 * Convert canonical records to plottable GeoJSON point features. Citywide
 * records (geometry.kind === "citywide") are EXCLUDED — they carry no lat/lng
 * and must never be plotted at a misleading location (see the geometry doc in
 * lib/community-investment.ts); they surface only in the legend's "Citywide
 * commitments" note via summarizeCitywideInvestment. Pure / deterministic.
 */
export function investmentRecordsToPointFeatures(
  records: readonly CommunityInvestmentRecord[]
): InvestmentPointFeature[] {
  const features: InvestmentPointFeature[] = [];
  for (const r of records) {
    if (r.geometry.kind !== "point") continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.geometry.lng, r.geometry.lat] },
      properties: {
        id: r.id,
        recipient: r.recipient,
        funderName: r.funderName,
        funderType: r.funderType,
        capitalClass: r.capitalClass,
        amountAwarded: r.amountAwarded,
        authorizedAmount: r.authorizedAmount ?? null,
        creditAmount: r.creditAmount ?? null,
        announcedInvestment: r.announcedInvestment ?? null,
        logLine: r.logLine,
        year: r.year,
        status: r.status,
        communityArea: r.communityArea ?? "",
        sourceLink: r.links.find((l) => /^https?:\/\//i.test(l)) ?? "",
      },
    });
  }
  // Size DEVELOPMENT dots by announcedInvestment over the development records
  // ONLY (sqrt-domain, 4–18px). Stamped here so the mapbox paint can read a
  // ready radius without a domain-normalization it cannot express. A development
  // with null announcedInvestment (subset/blank) resolves to the 4px floor.
  const devAmounts = features
    .filter((f) => f.properties.funderType === "private_development")
    .map((f) => f.properties.announcedInvestment);
  const radiusOf = makeDevelopmentDotRadiusScale(devAmounts);
  for (const f of features) {
    if (f.properties.funderType === "private_development") {
      f.properties.radiusPx = radiusOf(f.properties.announcedInvestment);
    }
  }
  // Size NON-GRANT capital dots (tif_subsidy / federal_program / tax_credit — all
  // funderType government, amountAwarded=null) by their OWN money field, each on
  // its own per-class sqrt-domain scale (4–18px). Without this every non-grant dot
  // collapses to the 4px floor under the amountAwarded paint (to-number(null)=0),
  // so a $959M TIF ceiling would read identical to a $0 one. tif_subsidy /
  // federal_program size by authorizedAmount; tax_credit sizes by creditAmount.
  // A per-CLASS domain keeps each instrument's magnitudes comparable within itself
  // (the outline color already tells the classes apart).
  for (const cls of ["tif_subsidy", "federal_program", "tax_credit"] as const) {
    const ofClass = features.filter((f) => f.properties.capitalClass === cls);
    if (ofClass.length === 0) continue;
    const moneyOf = (p: InvestmentPointProps): number | null =>
      p.capitalClass === "tax_credit" ? p.creditAmount : p.authorizedAmount;
    const scale = makeDevelopmentDotRadiusScale(ofClass.map((f) => moneyOf(f.properties)));
    for (const f of ofClass) f.properties.radiusPx = scale(moneyOf(f.properties));
  }
  return features;
}

// ── Megaprojects view mode ────────────────────────────────────────────────────

/**
 * The four STATUS GROUPS the Megaprojects view colors development dots by,
 * collapsing the nine granular InvestmentStatus lifecycle states into the four
 * buckets a reader tracks at a glance. In legend/control order (the lifecycle
 * arc — open, building, planned — with stalled last):
 *   • open     — opened | partially_open | completed  (ground open / occupied)
 *   • building — under_construction                    (actively being built)
 *   • planned  — announced | proposed | awarded        (committed, not started)
 *   • stalled  — stalled | cancelled                   (paused / dead)
 */
export const MEGAPROJECT_STATUS_GROUPS = ["open", "building", "planned", "stalled"] as const;
export type MegaprojectStatusGroup = (typeof MEGAPROJECT_STATUS_GROUPS)[number];

export const MEGAPROJECT_STATUS_GROUP_LABELS: Record<MegaprojectStatusGroup, string> = {
  open: "Open",
  building: "Building",
  planned: "Planned",
  stalled: "Stalled",
};

/**
 * Status-group colors — four hues from the app palette family, VALIDATED with the
 * dataviz palette checker
 * (`validate_palette.js "#059669,#2563EB,#D97706,#DB2777" --mode light`
 * → ALL CHECKS PASS: normal-vision floor worst-adjacent ΔE 20.3, CVD ΔE 14.1
 * deutan / 6.6 tritan, all inside the L band + chroma floor + 3:1 surface
 * contrast). The legend swatches + labels supply the secondary encoding:
 *   • open     #059669 — the app's community / completion green.
 *   • building #2563EB — the canonical City / active blue.
 *   • planned  #D97706 — the "authorized / on the horizon" amber.
 *   • stalled  #DB2777 — a hot magenta alert, off the three funder-type hues so it
 *     never reads as a funder type (amber↔red was too close for normal vision).
 */
export const MEGAPROJECT_STATUS_GROUP_COLORS: Record<MegaprojectStatusGroup, string> = {
  open: "#059669",
  building: "#2563EB",
  planned: "#D97706",
  stalled: "#DB2777",
};

/**
 * Exhaustive InvestmentStatus → status-group mapping — every one of the nine
 * lifecycle states folds into exactly one group (guarded by the
 * `Record<InvestmentStatus, …>` type and a unit test that iterates
 * INVESTMENT_STATUSES). Kept as data (not a switch) so the completeness check is
 * a plain key comparison.
 */
export const MEGAPROJECT_STATUS_GROUP_BY_STATUS: Record<InvestmentStatus, MegaprojectStatusGroup> = {
  opened: "open",
  partially_open: "open",
  completed: "open",
  under_construction: "building",
  announced: "planned",
  proposed: "planned",
  awarded: "planned",
  stalled: "stalled",
  cancelled: "stalled",
};

/** Map a status to its group; an off-enum status folds to "planned" (the neutral
 * middle bucket) rather than throwing. Pure. */
export function megaprojectStatusGroup(status: string | null | undefined): MegaprojectStatusGroup {
  return (status && MEGAPROJECT_STATUS_GROUP_BY_STATUS[status as InvestmentStatus]) || "planned";
}

/** Megaprojects circle-radius bounds (px), sized by announcedInvestment. Wider
 * than the Dots-mode development scale (4–18px) so a $7B megasite reads boldly. */
export const MEGAPROJECT_RADIUS_MIN = 6;
export const MEGAPROJECT_RADIUS_MAX = 24;

/**
 * sqrt-domain radius scale over the ACTUAL announced-capital domain of the
 * megaproject set: sqrt(announcedInvestment) normalized between the set's min and
 * max, mapped to [6, 24] px — the same approach as makeArcWidthScale /
 * makeDevelopmentDotRadiusScale. A null/negative announcedInvestment counts as 0
 * → the 6px floor (the many development rows with no published price tag; e.g. the
 * Fire-stadium subset row, whose popup explains the null). A degenerate domain
 * (one project / all-equal amounts) renders at the midpoint. Pure / deterministic.
 */
export function makeMegaprojectRadiusScale(
  amounts: readonly (number | null | undefined)[],
): (amount: number | null | undefined) => number {
  const roots = amounts.map((a) => Math.sqrt(Math.max(0, a ?? 0)));
  const lo = roots.length ? Math.min(...roots) : 0;
  const hi = roots.length ? Math.max(...roots) : 0;
  const span = hi - lo;
  if (span <= 0) return () => (MEGAPROJECT_RADIUS_MIN + MEGAPROJECT_RADIUS_MAX) / 2;
  return (amount) => {
    const v = Math.sqrt(Math.max(0, amount ?? 0));
    const t = Math.min(1, Math.max(0, (v - lo) / span));
    return MEGAPROJECT_RADIUS_MIN + t * (MEGAPROJECT_RADIUS_MAX - MEGAPROJECT_RADIUS_MIN);
  };
}

/** Max characters for a megaproject's on-map symbol label before truncation. */
export const MEGAPROJECT_LABEL_MAX_CHARS = 24;

/** Truncate a project name for the on-map label (…-suffixed past the ~24-char cap). Pure. */
export function truncateMegaprojectLabel(name: string | null | undefined): string {
  const s = (name ?? "").trim();
  if (s.length <= MEGAPROJECT_LABEL_MAX_CHARS) return s;
  return `${s.slice(0, MEGAPROJECT_LABEL_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * Megaproject feature props — the plotted development point's InvestmentPointProps
 * plus the two fields the mapbox megaproject layers read directly: `statusGroup`
 * (the circle-color match key) and `label` (the truncated symbol-label text).
 * `radiusPx` (already on InvestmentPointProps) is recomputed here on the wider
 * megaproject 6–24px scale, so the reused popup contract is otherwise unchanged.
 */
export interface MegaprojectPointProps extends InvestmentPointProps {
  statusGroup: MegaprojectStatusGroup;
  label: string;
}

export type MegaprojectPointFeature = GeoJSON.Feature<GeoJSON.Point, MegaprojectPointProps>;

/**
 * Build the Megaprojects-mode features from the full plotted point set: keep ONLY
 * the development records (funderType "private_development" — the client-side
 * equivalent of source "development", the ONLY source that maps to that funder
 * type; the client features carry no `source` field), stamp each with its status
 * GROUP + a truncated label, and size each by announcedInvestment on the shared
 * 6–24px sqrt scale. Order-preserving. Pure / deterministic.
 */
export function buildMegaprojectFeatures(
  features: readonly InvestmentPointFeature[],
): MegaprojectPointFeature[] {
  const dev = features.filter((f) => f.properties.funderType === "private_development");
  const radiusOf = makeMegaprojectRadiusScale(dev.map((f) => f.properties.announcedInvestment));
  return dev.map((f) => ({
    ...f,
    properties: {
      ...f.properties,
      statusGroup: megaprojectStatusGroup(f.properties.status),
      label: truncateMegaprojectLabel(f.properties.recipient),
      radiusPx: radiusOf(f.properties.announcedInvestment),
    },
  }));
}

/** A FeatureCollection wrapper for the megaproject GeoJSONSource.setData. Pure. */
export function megaprojectFeatureCollection(
  features: readonly MegaprojectPointFeature[],
): GeoJSON.FeatureCollection<GeoJSON.Point, MegaprojectPointProps> {
  return { type: "FeatureCollection", features: features as MegaprojectPointFeature[] };
}

/**
 * EXACT legend line for the megaproject announced-capital total. "Announced" is
 * deliberate — these are self-reported private project price tags, never grants a
 * public/philanthropic body awarded — and the "not awarded dollars" clause makes
 * the distinction explicit at the figure. Shared constant so the legend and its
 * unit test can never drift.
 */
export const MEGAPROJECT_ANNOUNCED_CAPITAL_LABEL = "Announced private capital — not awarded dollars";

export interface MegaprojectSummary {
  /** Plotted development point count (the map dots). */
  plottedCount: number;
  /** Per-status-group counts over the plotted development points. */
  groupCounts: Record<MegaprojectStatusGroup, number>;
  /**
   * Sum of announcedInvestment over the plotted development points (null → 0). A
   * total of ANNOUNCED private capital — never awarded, never a derived figure.
   */
  totalAnnounced: number;
}

/**
 * Summarize the plotted megaproject features for the legend: plotted count,
 * per-status-group counts, and the total ANNOUNCED private capital (a plain sum of
 * announcedInvestment, null → 0 — never an awarded/derived figure). Pure.
 */
export function summarizeMegaprojects(
  features: readonly MegaprojectPointFeature[],
): MegaprojectSummary {
  const groupCounts: Record<MegaprojectStatusGroup, number> = {
    open: 0,
    building: 0,
    planned: 0,
    stalled: 0,
  };
  let totalAnnounced = 0;
  for (const f of features) {
    groupCounts[f.properties.statusGroup] += 1;
    if (f.properties.announcedInvestment != null) totalAnnounced += f.properties.announcedInvestment;
  }
  return { plottedCount: features.length, groupCounts, totalAnnounced };
}

/**
 * Recipient names of the CITYWIDE development records (funderType
 * "private_development", geometry "citywide") — the megaprojects that carry no
 * plottable point (an entity-wide / multi-site commitment, e.g. Advocate's South
 * Side investment). The Megaprojects legend lists them under a "not plotted" note.
 * Order-preserving. Pure.
 */
export function citywideDevelopmentProjectNames(
  records: readonly CommunityInvestmentRecord[],
): string[] {
  const out: string[] = [];
  for (const r of records) {
    if (r.geometry.kind === "citywide" && r.funderType === "private_development") {
      out.push(r.recipient);
    }
  }
  return out;
}

const FUNDER_TYPE_ORDER_STRINGS: readonly string[] = FUNDER_TYPE_ORDER;

/**
 * Whether a record's funderType is active under the current checkbox set. A
 * CANONICAL type is active iff its checkbox is on. An UNKNOWN (off-enum)
 * funderType — the same case the paint `match` and popup render grey via
 * INVESTMENT_FALLBACK_COLOR — has no checkbox of its own, so it follows the
 * "all on" state: visible exactly when every canonical checkbox is checked, and
 * hidden the moment any is unchecked. This keeps the grey fallback dot reachable
 * instead of silently filtered off the map with no control to bring it back.
 */
function funderTypeActive(funderType: string, activeSet: ReadonlySet<FunderType>): boolean {
  if (FUNDER_TYPE_ORDER_STRINGS.includes(funderType)) {
    return activeSet.has(funderType as FunderType);
  }
  return FUNDER_TYPE_ORDER.every((t) => activeSet.has(t));
}

/** Whether a record's year satisfies the (possibly unbounded) year range. */
function yearInRange(year: number | null, range: InvestmentYearRange | null): boolean {
  if (range && range.min != null && range.max != null) {
    if (year == null) return false;
    if (year < range.min || year > range.max) return false;
  }
  return true;
}

function toActiveSet(
  activeFunderTypes: ReadonlySet<FunderType> | readonly FunderType[]
): ReadonlySet<FunderType> {
  return activeFunderTypes instanceof Set
    ? activeFunderTypes
    : new Set(activeFunderTypes as readonly FunderType[]);
}

/**
 * Client-side filter over already-built point features, mirroring the vacancy
 * distress-filter pattern (components/vacancy/VacancyReportMap.tsx) that
 * rebuilds the source data with setData rather than a layer filter. A feature
 * passes when its funderType is active (see funderTypeActive — unknown types
 * follow the "all on" state) AND (the year range is unbounded, or the feature's
 * year falls inside the inclusive window). Pure / deterministic.
 */
export function filterInvestmentPointFeatures(
  features: readonly InvestmentPointFeature[],
  opts: { yearRangeId: string; activeFunderTypes: ReadonlySet<FunderType> | readonly FunderType[] }
): InvestmentPointFeature[] {
  const range = INVESTMENT_YEAR_RANGES.find((r) => r.id === opts.yearRangeId) ?? null;
  const activeSet = toActiveSet(opts.activeFunderTypes);
  return features.filter((f) => {
    const p = f.properties;
    if (!funderTypeActive(p.funderType, activeSet)) return false;
    return yearInRange(p.year, range);
  });
}

/** A FeatureCollection wrapper for GeoJSONSource.setData. Pure. */
export function investmentFeatureCollection(
  features: readonly InvestmentPointFeature[]
): GeoJSON.FeatureCollection<GeoJSON.Point, InvestmentPointProps> {
  return { type: "FeatureCollection", features: features as InvestmentPointFeature[] };
}

/**
 * Distinct funder types actually present among the plotted points, in
 * FUNDER_TYPE_ORDER — drives the legend's data-driven funderType checkboxes so
 * a type with no dots never shows a control. Mirrors presentOwnerTypesInOrder
 * in lib/owner-classify.ts. An empty input yields an empty array.
 */
export function presentFunderTypesInOrder(types: Array<string | null | undefined>): FunderType[] {
  const present = new Set<string>();
  for (const t of types) if (t) present.add(t);
  return FUNDER_TYPE_ORDER.filter((k) => present.has(k));
}

export interface CitywideInvestmentSummary {
  count: number;
  totalDollars: number;
}

/**
 * The just-enough fields of a citywide record to re-filter it client-side by the
 * active year window / funderType checkboxes (citywide records never plot, so
 * their full geometry/props are not needed). Keeps the legend's "Citywide
 * commitments" figure in lockstep with the plotted dots under the same filters.
 */
export interface CitywideInvestmentEntry {
  funderType: FunderType;
  year: number | null;
  /** Real awarded dollars, or null — NEVER a derived figure. */
  amountAwarded: number | null;
}

/** Extract the filterable fields of every citywide (non-plotting) record. Pure. */
export function citywideInvestmentEntries(
  records: readonly CommunityInvestmentRecord[]
): CitywideInvestmentEntry[] {
  const out: CitywideInvestmentEntry[] = [];
  for (const r of records) {
    if (r.geometry.kind === "citywide") {
      out.push({ funderType: r.funderType, year: r.year, amountAwarded: r.amountAwarded });
    }
  }
  return out;
}

/**
 * Count + total awarded dollars of the citywide-geometry records (the ones that
 * never plot). `totalDollars` sums only non-null amountAwarded — a plain total
 * of AWARDED dollars, never a derived received/available/remaining figure. Pure.
 */
export function summarizeCitywideInvestment(
  records: readonly CommunityInvestmentRecord[]
): CitywideInvestmentSummary {
  return summarizeCitywideEntries(citywideInvestmentEntries(records), null);
}

/**
 * Summarize citywide entries under the SAME year/funderType filter applied to
 * the plotted dots, so the legend's "Citywide commitments (N) · $X awarded" note
 * re-scopes with the active filters instead of freezing at the unfiltered total
 * (which reads as "$X in the selected year" when it is not). `opts === null`
 * summarizes everything (the unfiltered total). Pure / deterministic.
 */
export function summarizeCitywideEntries(
  entries: readonly CitywideInvestmentEntry[],
  opts: { yearRangeId: string; activeFunderTypes: ReadonlySet<FunderType> | readonly FunderType[] } | null
): CitywideInvestmentSummary {
  const range = opts ? INVESTMENT_YEAR_RANGES.find((r) => r.id === opts.yearRangeId) ?? null : null;
  const activeSet = opts ? toActiveSet(opts.activeFunderTypes) : null;
  let count = 0;
  let totalDollars = 0;
  for (const e of entries) {
    if (activeSet && !funderTypeActive(e.funderType, activeSet)) continue;
    if (!yearInRange(e.year, range)) continue;
    count += 1;
    if (e.amountAwarded != null) totalDollars += e.amountAwarded;
  }
  return { count, totalDollars };
}

export type CommunityInvestmentLayerStatus = "ready" | "unauthorized" | "unavailable" | "error";

export interface CommunityInvestmentLayerResult {
  status: CommunityInvestmentLayerStatus;
  pointFeatures: InvestmentPointFeature[];
  presentFunderTypes: FunderType[];
  /** Distinct capital classes present among the plotted dots, in CAPITAL_CLASS_ORDER
   * — drives the legend's capital-class sub-legend. */
  presentCapitalClasses: CapitalClass[];
  /** Unfiltered citywide summary (initial legend state, all years / all types). */
  citywide: CitywideInvestmentSummary;
  /** Filterable citywide entries so the legend note re-scopes with the filters. */
  citywideEntries: CitywideInvestmentEntry[];
  /**
   * Recipient names of the citywide (non-plotting) DEVELOPMENT records — the
   * megaprojects held citywide rather than plotted (e.g. Advocate's South Side
   * investment). Powers the Megaprojects legend's "N projects not plotted" note.
   */
  citywideDevelopmentNames: string[];
  /**
   * Foundation-HQ coordinates the gated route attaches (read server-side from
   * data/curated/foundation-hqs.csv). Seeds the Arcs view mode (funder HQ →
   * recipient); empty when the layer is unauthorized/unavailable or the CSV is
   * absent. The client never fetches the raw CSV — it only ever sees this array.
   */
  funderHqs: FunderHq[];
}

const EMPTY_LAYER_RESULT = (status: CommunityInvestmentLayerStatus): CommunityInvestmentLayerResult => ({
  status,
  pointFeatures: [],
  presentFunderTypes: [],
  presentCapitalClasses: [],
  citywide: { count: 0, totalDollars: 0 },
  citywideEntries: [],
  citywideDevelopmentNames: [],
  funderHqs: [],
});

/**
 * Fetch the gated Community Investment export and transform it into everything
 * the map layer + legend need: plotted point features (citywide excluded),
 * the present funder types, and the citywide summary. The `fetchImpl` seam
 * mirrors lib/owner-file-report-context.ts so the toggle's network behavior is
 * unit-testable without a live map.
 *
 * Status mapping: 401 → "unauthorized" (never requests parsing), any other
 * non-ok (e.g. 503 before the export is generated) → "unavailable", a thrown
 * error (network/abort) propagates to the caller's catch. On success →
 * "ready" with the transformed payload.
 */
export async function fetchCommunityInvestmentLayer(opts?: {
  source?: string | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<CommunityInvestmentLayerResult> {
  const doFetch = opts?.fetchImpl ?? fetch;
  const url = opts?.source
    ? `${COMMUNITY_INVESTMENT_ENDPOINT}?source=${encodeURIComponent(opts.source)}`
    : COMMUNITY_INVESTMENT_ENDPOINT;

  const res = await doFetch(url, opts?.signal ? { signal: opts.signal } : undefined);
  if (res.status === 401) return EMPTY_LAYER_RESULT("unauthorized");
  if (!res.ok) return EMPTY_LAYER_RESULT("unavailable");

  const data = (await res.json()) as CommunityInvestmentExport & { funderHqs?: FunderHq[] };
  const records = Array.isArray(data?.records) ? data.records : [];
  const pointFeatures = investmentRecordsToPointFeatures(records);
  const citywideEntries = citywideInvestmentEntries(records);
  return {
    status: "ready",
    pointFeatures,
    presentFunderTypes: presentFunderTypesInOrder(pointFeatures.map((f) => f.properties.funderType)),
    presentCapitalClasses: presentCapitalClassesInOrder(
      pointFeatures.map((f) => f.properties.capitalClass),
    ),
    citywide: summarizeCitywideEntries(citywideEntries, null),
    citywideEntries,
    citywideDevelopmentNames: citywideDevelopmentProjectNames(records),
    funderHqs: Array.isArray(data?.funderHqs) ? data.funderHqs : [],
  };
}
