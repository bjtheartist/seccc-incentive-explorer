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
  InvestmentSource,
  InvestmentStatus,
} from "@/lib/community-investment";
import type { FunderHq } from "@/lib/investment-deck-modes";
import { publicInvestmentOverlayIdForSource } from "@/lib/public-investment-overlays";
import {
  GOVERNMENT_FUNDING_PURPOSES,
  type GovernmentFundingPurpose,
} from "@/lib/government-funding-purpose";

/** The gated dataset endpoint the layer fetches when toggled on. */
export const COMMUNITY_INVESTMENT_ENDPOINT = "/api/owner-file/investment";

export type HistoricalRecoveryRecipientSource =
  | "cook-source-2023"
  | "illinois-big"
  | "illinois-b2b";

export interface HistoricalRecoveryRecipient {
  id: string;
  businessName: string;
  /** Source-published amount from a completed historical program. */
  historicalAwardAmount: number | null;
}
export type CountyReliefRecipient = HistoricalRecoveryRecipient;

export type HistoricalRecoveryRecipientsStatus =
  | "ready"
  | "unauthorized"
  | "unavailable";
export type CountyReliefRecipientsStatus = HistoricalRecoveryRecipientsStatus;

export interface HistoricalRecoveryRecipientsResult {
  status: HistoricalRecoveryRecipientsStatus;
  sourceId: HistoricalRecoveryRecipientSource;
  zipCode: string;
  programName: string;
  programStatus: "complete";
  year: number;
  recipientCount: number;
  sourceLink: string | null;
  recipients: HistoricalRecoveryRecipient[];
}
export type CountyReliefRecipientsResult = HistoricalRecoveryRecipientsResult;

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

/** Mappable purpose filters. Arts awards are city-level only and live in the
 * admin analysis table, so they are intentionally absent from the map order. */
export const MAPPABLE_GOVERNMENT_FUNDING_PURPOSE_ORDER: GovernmentFundingPurpose[] = [
  "capital_project",
  "programmatic",
  "unclassified",
];

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
  disbursed: "Disbursed",
  appropriated: "Appropriation record",
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
  "state_appropriation",
];

/** Short capital-class labels for the legend sub-key + the record drawer chip. */
export const CAPITAL_CLASS_LABELS: Record<CapitalClass, string> = {
  grant: "Grant",
  tif_subsidy: "TIF subsidy",
  federal_program: "Federal program",
  tax_credit: "Tax credit",
  state_appropriation: "State appropriation",
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
  state_appropriation: "Published appropriation balance",
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
  state_appropriation: "#0F766E",
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
  /** Canonical source id; optional only for legacy/test payload tolerance. */
  source?: InvestmentSource;
  recipient: string;
  funderName: string;
  funderType: FunderType;
  /** What the government-funded record supports; null for non-government rows. */
  governmentFundingPurpose?: GovernmentFundingPurpose | null;
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
   * DCEO source-published appropriation balance. Not an active opportunity,
   * award, payment, project budget, or estimate of dollars a user could receive.
   */
  publishedBalance?: number | null;
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
  /** Closed-program source-reported amount, kept separate from amountAwarded. */
  historicalRecoveryAmount?: number | null;
  /** Recovery source id when this point belongs to a historical program. */
  recoverySourceId?: string;
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
        source: r.source,
        recipient: r.recipient,
        funderName: r.funderName,
        funderType: r.funderType,
        governmentFundingPurpose: r.governmentFundingPurpose,
        capitalClass: r.capitalClass,
        amountAwarded: r.amountAwarded,
        authorizedAmount: r.authorizedAmount ?? null,
        creditAmount: r.creditAmount ?? null,
        publishedBalance: r.publishedBalance ?? null,
        announcedInvestment: r.announcedInvestment ?? null,
        logLine: r.logLine,
        year: r.year,
        status: r.status,
        communityArea: r.communityArea ?? "",
        sourceLink: r.links.find((l) => /^https?:\/\//i.test(l)) ?? "",
        historicalRecoveryAmount: r.recovery?.historicalAmount?.value ?? null,
        recoverySourceId: r.recovery?.sourceId,
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
  for (const cls of ["tif_subsidy", "federal_program", "tax_credit", "state_appropriation"] as const) {
    const ofClass = features.filter((f) => f.properties.capitalClass === cls);
    if (ofClass.length === 0) continue;
    const moneyOf = (p: InvestmentPointProps): number | null =>
      p.capitalClass === "tax_credit"
        ? p.creditAmount
        : p.capitalClass === "state_appropriation"
          ? p.publishedBalance ?? null
          : p.authorizedAmount;
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
  disbursed: "planned",
  appropriated: "planned",
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

/**
 * Remove the private-development records rendered by the independent
 * Megaprojects overlay from a base dots/arcs/density feed. This keeps the
 * overlay switch honest: off removes those projects instead of leaving a
 * second, less descriptive purple dot at the same coordinates.
 */
export function excludeMegaprojectFeatures(
  features: readonly InvestmentPointFeature[],
): InvestmentPointFeature[] {
  return features.filter((f) => f.properties.funderType !== "private_development");
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

function toActivePurposeSet(
  activePurposes:
    | ReadonlySet<GovernmentFundingPurpose>
    | readonly GovernmentFundingPurpose[],
): ReadonlySet<GovernmentFundingPurpose> {
  return activePurposes instanceof Set
    ? activePurposes
    : new Set(activePurposes as readonly GovernmentFundingPurpose[]);
}

/**
 * Deliverable 2 (audit finding 3 / consult F2) — the ONE predicate every
 * investment overlay, legend total, citywide count, popup total, and
 * recipient drilldown must pass through. Before this, state capital / RRF /
 * Cook / BIG / B2B each reloaded their own complete cached dataset,
 * independent of the year/funderType/purpose controls — reproducible by
 * selecting a year and watching an out-of-range BIG/RRF/B2B/Cook record stay
 * visible. `matchesInvestmentFilter` is the single source of truth those five
 * overlays, the base Dots/Arcs/Density source, and the legend's citywide
 * summary all now call. Pure / deterministic.
 */
export interface InvestmentFilterState {
  yearRangeId: string;
  activeFunderTypes: ReadonlySet<FunderType> | readonly FunderType[];
  activeGovernmentFundingPurposes?:
    | ReadonlySet<GovernmentFundingPurpose>
    | readonly GovernmentFundingPurpose[];
}

/** The three filterable dimensions of one record/entry — everything
 * `matchesInvestmentFilter` needs, independent of geometry/shape. */
export interface InvestmentFilterDimensions {
  year: number | null;
  funderType: FunderType | string;
  /** null for a non-government record; "unclassified" is a real, filterable
   * value for a government record whose purpose the exporter couldn't assign. */
  governmentFundingPurpose: GovernmentFundingPurpose | null;
}

function governmentFundingPurposeActive(
  dims: InvestmentFilterDimensions,
  activeSet: ReadonlySet<GovernmentFundingPurpose> | null,
): boolean {
  if (!activeSet || dims.funderType !== "government") return true;
  const purpose = dims.governmentFundingPurpose ?? "unclassified";
  return activeSet.has(purpose);
}

/**
 * Whether one record/entry (year, funderType, governmentFundingPurpose)
 * passes the active year-range / funderType / purpose filter. THE single
 * predicate — every overlay, legend total, citywide count, popup total, and
 * recipient drilldown must call this (or its convenience wrappers below)
 * rather than re-deriving its own filter logic. Pure / deterministic.
 */
export function matchesInvestmentFilter(
  dims: InvestmentFilterDimensions,
  filter: InvestmentFilterState,
): boolean {
  const range = INVESTMENT_YEAR_RANGES.find((r) => r.id === filter.yearRangeId) ?? null;
  const activeSet = toActiveSet(filter.activeFunderTypes);
  const activePurposeSet = filter.activeGovernmentFundingPurposes
    ? toActivePurposeSet(filter.activeGovernmentFundingPurposes)
    : null;
  if (!funderTypeActive(dims.funderType, activeSet)) return false;
  if (!governmentFundingPurposeActive(dims, activePurposeSet)) return false;
  return yearInRange(dims.year, range);
}

/**
 * Sol gate blocker 1 — filtering must not stop at rendered sources/counts.
 * Whether an ALREADY-OPEN popup/panel showing a record with these filter
 * dimensions must close (or refuse a lazy reveal) under the CURRENT filter.
 * `dims === null` means "the open popup isn't filter-scoped" (an
 * owner-cluster popup, or the Megaprojects popup — which is deliberately
 * exempt from year/funder/purpose, matching its own disclosed caption) — such
 * a popup never closes on a filter change. Pure / deterministic, so the exact
 * reproduction (an actual 2021 RRF point surviving a switch to "2024–2026")
 * is unit-testable without mapbox.
 */
export function investmentPopupOutOfScope(
  dims: InvestmentFilterDimensions | null,
  filter: InvestmentFilterState,
): boolean {
  if (dims === null) return false;
  return !matchesInvestmentFilter(dims, filter);
}

/**
 * The subset of mapboxgl.Popup's interface InvestmentPopupTracker needs —
 * `.once("close", …)` and `.addTo(map)`. Kept minimal and structural (not
 * imported from "mapbox-gl") so this module never pulls the mapbox-gl
 * package into a non-map bundle, and so a test can supply a plain object
 * without importing the real library either. `map` is `unknown` for the same
 * reason — the tracker never inspects it, only forwards it to `addTo`.
 */
export interface InvestmentPopupLike {
  once(event: "close", handler: () => void): void;
  addTo(map: unknown): unknown;
}

/**
 * Sol gate round 2, finding 1 (and round 3's durability follow-up) — the
 * Mapbox popup-REUSE lifecycle hole. Reusing a shared mapboxgl.Popup calls
 * `.addTo(map)` on an ALREADY-open instance, which mapbox-gl 3.18.1
 * implements as (verified directly against
 * node_modules/mapbox-gl/dist/mapbox-gl-unminified.js):
 *
 *   addTo(map) { if (this._map) this.remove(); this._map = map; ...; fire('open'); }
 *   remove() { ...; this.fire(new Event('close')); return this; }  // ALWAYS fires close
 *
 * So `.addTo()` on an already-open popup fires "close" for the OLD content
 * SYNCHRONOUSLY, as the very first thing it does, before doing anything else.
 * THE INVARIANT THIS CLASS ENFORCES: a NEW popup's own close listener must
 * never be registered before that `.addTo()` call, or it would be exposed to
 * — and immediately self-consumed by — the SAME close event that opens it.
 *
 * Round 2 tried to uphold this invariant by convention (call `.addTo()` at
 * each of the 8 call sites, THEN call a separate tracking method) — Sol round
 * 3 correctly flagged that a scan/convention doesn't stop a future call site
 * from getting the order backwards, and the class's own doc comment still
 * described the WRONG (pre-addTo) order. This version closes it
 * structurally: `open()` is the ONLY exported way to attach a popup through
 * this tracker, and it calls `popup.addTo(map)` ITSELF, before registering
 * the close listener — there is no register-only method to misuse, so the
 * ordering bug is impossible by construction, not just convention.
 *
 * Every open is tagged with a monotonically increasing token; each open's
 * `.once("close", …)` clears state ONLY when the tracker's current token
 * still matches its own captured token — i.e. only for a GENUINE close of
 * the popup that is CURRENTLY active, never a stale side-effect of a LATER
 * reuse (whose own `open()` call already bumped the token by the time its
 * OWN close listener could fire).
 */
export class InvestmentPopupTracker {
  private token = 0;
  private active: { token: number; dims: InvestmentFilterDimensions | null } | null = null;
  private reveal: { token: number; controller: AbortController } | null = null;

  /**
   * THE single entry point for opening a tracked popup. Performs
   * `popup.addTo(map)` itself — BEFORE registering this open's close
   * listener — so the caller can never invert the order. The caller is
   * responsible for `popup.setLngLat(...).setHTML(...)` BEFORE calling this
   * (addTo only positions/attaches the popup; it doesn't accept content).
   * `dims` is null for non-filter-scoped content (owner-cluster,
   * Megaprojects — exempt by design). Returns the token this open was
   * tagged with, for a reveal handler to key its in-flight fetch to.
   */
  open(popup: InvestmentPopupLike, map: unknown, dims: InvestmentFilterDimensions | null): number {
    popup.addTo(map); // fires "close" for whatever was previously open, BEFORE any tracking below
    const token = ++this.token;
    // A NEW popup opening always invalidates whatever reveal was in flight
    // for the PREVIOUS popup. Abort it HERE, unconditionally, rather than
    // relying on the close event fired by addTo() above — belt and
    // suspenders alongside that event's own token-gated handler.
    if (this.reveal) {
      this.reveal.controller.abort();
      this.reveal = null;
    }
    this.active = { token, dims };
    popup.once("close", () => {
      if (this.token !== token) return; // stale reuse close — a newer open already owns the state
      this.active = null;
      if (this.reveal?.token === token) {
        this.reveal.controller.abort();
        this.reveal = null;
      }
    });
    return token;
  }

  /** The filter dimensions of whatever is CURRENTLY the active popup, or null. */
  getActiveDims(): InvestmentFilterDimensions | null {
    return this.active?.dims ?? null;
  }

  /** Whether `token` still identifies the currently active popup (not replaced/closed). */
  isActiveToken(token: number): boolean {
    return this.active?.token === token;
  }

  /** Begin tracking an in-flight reveal fetch, tagged to `token`. */
  startReveal(token: number, controller: AbortController): void {
    if (this.reveal) this.reveal.controller.abort();
    this.reveal = { token, controller };
  }

  /** Stop tracking a reveal once it settles — a no-op if it was superseded. */
  finishReveal(token: number, controller: AbortController): void {
    if (this.reveal?.token === token && this.reveal.controller === controller) {
      this.reveal = null;
    }
  }

  hasInFlightReveal(): boolean {
    return this.reveal !== null;
  }

  /**
   * Close the active popup (via the caller-supplied `remove`) and abort its
   * in-flight reveal, ONLY when its dims are out of the given filter's
   * scope. Returns whether it closed. Called from the out-of-scope closing
   * effect on every filter change.
   */
  closeIfOutOfScope(filter: InvestmentFilterState, remove: () => void): boolean {
    if (!investmentPopupOutOfScope(this.getActiveDims(), filter)) return false;
    if (this.reveal) {
      this.reveal.controller.abort();
      this.reveal = null;
    }
    remove();
    this.active = null;
    return true;
  }
}

/**
 * Client-side filter over already-built point features, mirroring the vacancy
 * distress-filter pattern (components/vacancy/VacancyReportMap.tsx) that
 * rebuilds the source data with setData rather than a layer filter. A feature
 * passes when its funderType is active (see funderTypeActive — unknown types
 * follow the "all on" state) AND (the year range is unbounded, or the feature's
 * year falls inside the inclusive window). Pure / deterministic. Thin wrapper
 * over matchesInvestmentFilter — kept as its own export because every overlay
 * effect in MapView.tsx already filters an InvestmentPointFeature array.
 */
export function filterInvestmentPointFeatures(
  features: readonly InvestmentPointFeature[],
  opts: InvestmentFilterState,
): InvestmentPointFeature[] {
  return features.filter((f) =>
    matchesInvestmentFilter(
      {
        year: f.properties.year,
        funderType: f.properties.funderType,
        governmentFundingPurpose: f.properties.governmentFundingPurpose ?? null,
      },
      opts,
    ),
  );
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

export function presentGovernmentFundingPurposesInOrder(
  purposes: Array<string | null | undefined>,
): GovernmentFundingPurpose[] {
  const present = new Set(
    purposes.filter(
      (purpose): purpose is GovernmentFundingPurpose =>
        typeof purpose === "string" &&
        (GOVERNMENT_FUNDING_PURPOSES as readonly string[]).includes(purpose),
    ),
  );
  return MAPPABLE_GOVERNMENT_FUNDING_PURPOSE_ORDER.filter((purpose) =>
    present.has(purpose),
  );
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
  source: InvestmentSource;
  funderType: FunderType;
  governmentFundingPurpose: GovernmentFundingPurpose | null;
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
      out.push({
        source: r.source,
        funderType: r.funderType,
        governmentFundingPurpose: r.governmentFundingPurpose,
        year: r.year,
        amountAwarded: r.amountAwarded,
      });
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
  opts: InvestmentFilterState | null,
): CitywideInvestmentSummary {
  let count = 0;
  let totalDollars = 0;
  for (const e of entries) {
    if (
      opts &&
      !matchesInvestmentFilter(
        { year: e.year, funderType: e.funderType, governmentFundingPurpose: e.governmentFundingPurpose },
        opts,
      )
    ) {
      continue;
    }
    count += 1;
    if (e.amountAwarded != null) totalDollars += e.amountAwarded;
  }
  return { count, totalDollars };
}

// ── ZIP-aggregate / citywide-only overlay scope (deliverable 2) ────────────────

/**
 * The fixed (year, funderType, governmentFundingPurpose) of the ZIP-aggregate
 * and citywide-only historical recovery sources — every record within one of
 * these sources shares the SAME year/funderType/purpose (verified against the
 * exporter: scripts/export-community-investment.ts hard-codes one `year` per
 * program and SOURCE_GOVERNMENT_FUNDING_PURPOSE assigns one purpose per
 * source). Because the dimensions are homogeneous, a single scope check is
 * EQUIVALENT to filtering every record individually — this is not a source
 * that "lacks" a dimension, it is one whose dimension never varies.
 */
export const ZIP_AGGREGATE_OVERLAY_SOURCE_SCOPE: Readonly<
  Record<HistoricalRecoveryRecipientSource | "illinois-hospitality-emergency", InvestmentFilterDimensions>
> = {
  "cook-source-2023": { year: 2023, funderType: "government", governmentFundingPurpose: "programmatic" },
  "illinois-big": { year: 2020, funderType: "government", governmentFundingPurpose: "programmatic" },
  "illinois-hospitality-emergency": {
    year: 2020,
    funderType: "government",
    governmentFundingPurpose: "programmatic",
  },
  "illinois-b2b": { year: 2022, funderType: "government", governmentFundingPurpose: "programmatic" },
};

/**
 * Whether a ZIP-aggregate/citywide-only historical source is IN SCOPE under
 * the active year/funderType/purpose filter — the gate MapView applies before
 * rendering that source's ZIP polygons or held-citywide count. Out of scope
 * means the overlay renders NOTHING (not a stale unfiltered total), fixing
 * the reproduction the audit gave: selecting 2024 must hide 2020 BIG, 2021
 * RRF, 2022 B2B, and 2023 Cook entirely. Pure / deterministic.
 */
export function zipAggregateOverlaySourceInScope(
  sourceId: keyof typeof ZIP_AGGREGATE_OVERLAY_SOURCE_SCOPE,
  filter: InvestmentFilterState,
): boolean {
  return matchesInvestmentFilter(ZIP_AGGREGATE_OVERLAY_SOURCE_SCOPE[sourceId], filter);
}

export type CommunityInvestmentLayerStatus = "ready" | "unauthorized" | "unavailable" | "error";

export interface CommunityInvestmentLayerResult {
  status: CommunityInvestmentLayerStatus;
  pointFeatures: InvestmentPointFeature[];
  presentFunderTypes: FunderType[];
  presentGovernmentFundingPurposes: GovernmentFundingPurpose[];
  /** Distinct capital classes present among the plotted dots, in CAPITAL_CLASS_ORDER
   * — drives the legend's capital-class sub-legend. */
  presentCapitalClasses: CapitalClass[];
  /** Unfiltered citywide summary (initial legend state, all years / all types). */
  citywide: CitywideInvestmentSummary;
  /** Filterable citywide entries so the legend note re-scopes with the filters. */
  citywideEntries: CitywideInvestmentEntry[];
  /** ZIP-level aggregates for the completed Cook County 2023 Source Grant. */
  countyReliefByZip: CountyReliefZipSummary[];
  /** ZIP-level aggregates for Illinois 2020 Business Interruption Grants. */
  state2020ReliefByZip: HistoricalRecoveryZipSummary[];
  /** ZIP-level aggregates for Illinois Back to Business historical grants. */
  stateRecoveryByZip: HistoricalRecoveryZipSummary[];
  /** DCEO Chicago records kept citywide because the source cannot support a safe point. */
  stateCapitalCitywideCount: number;
  /** SBA RRF Chicago rows held unplotted because no safe point was available. */
  federalRestaurantReliefCitywideCount: number;
  /** Illinois Hospitality Emergency Grant rows held unplotted at city precision. */
  state2020HospitalityCitywideCount: number;
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
  presentGovernmentFundingPurposes: [],
  presentCapitalClasses: [],
  citywide: { count: 0, totalDollars: 0 },
  citywideEntries: [],
  countyReliefByZip: [],
  state2020ReliefByZip: [],
  stateRecoveryByZip: [],
  stateCapitalCitywideCount: 0,
  federalRestaurantReliefCitywideCount: 0,
  state2020HospitalityCitywideCount: 0,
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
 *
 * The view=map records are a field-level PROJECTION of CommunityInvestmentRecord
 * (see projectRecordForMapView in app/api/owner-file/investment/route.ts): only
 * the fields this module and the popup actually read survive — address,
 * postalCode, recordDate, recordProvenance and non-first links never ship, and a
 * citywide record is reduced to its legend-summary fields. Every field read
 * below is in that whitelist; adding a NEW field read here requires adding it to
 * the route's projection too.
 */
export async function fetchCommunityInvestmentLayer(opts?: {
  source?: string | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<CommunityInvestmentLayerResult> {
  const doFetch = opts?.fetchImpl ?? fetch;
  const params = new URLSearchParams({ view: "map" });
  if (opts?.source) params.set("source", opts.source);
  const url = `${COMMUNITY_INVESTMENT_ENDPOINT}?${params.toString()}`;

  const res = await doFetch(url, opts?.signal ? { signal: opts.signal } : undefined);
  if (res.status === 401) return EMPTY_LAYER_RESULT("unauthorized");
  if (!res.ok) return EMPTY_LAYER_RESULT("unavailable");

  const data = (await res.json()) as CommunityInvestmentExport & {
    funderHqs?: FunderHq[];
    countyReliefByZip?: CountyReliefZipSummary[];
    state2020ReliefByZip?: HistoricalRecoveryZipSummary[];
    stateRecoveryByZip?: HistoricalRecoveryZipSummary[];
    stateCapitalCitywideCount?: number;
    federalRestaurantReliefCitywideCount?: number;
    state2020HospitalityCitywideCount?: number;
  };
  const records = Array.isArray(data?.records) ? data.records : [];
  const pointFeatures = investmentRecordsToPointFeatures(records);
  const basePointFeatures = pointFeatures.filter(
    (feature) => publicInvestmentOverlayIdForSource(feature.properties.source) === null,
  );
  const allCitywideEntries = citywideInvestmentEntries(records);
  const citywideEntries = allCitywideEntries.filter(
    (entry) => publicInvestmentOverlayIdForSource(entry.source) === null,
  );
  const countyReliefByZip = Array.isArray(data.countyReliefByZip)
    ? data.countyReliefByZip
    : summarizeCountyReliefByZip(records);
  const stateRecoveryByZip = Array.isArray(data.stateRecoveryByZip)
    ? data.stateRecoveryByZip
    : summarizeHistoricalRecoveryByZip(records, "illinois-b2b");
  const state2020ReliefByZip = Array.isArray(data.state2020ReliefByZip)
    ? data.state2020ReliefByZip
    : summarizeHistoricalRecoveryByZip(records, "illinois-big");
  return {
    status: "ready",
    pointFeatures,
    presentFunderTypes: presentFunderTypesInOrder(basePointFeatures.map((f) => f.properties.funderType)),
    presentGovernmentFundingPurposes: presentGovernmentFundingPurposesInOrder(
      basePointFeatures.map((feature) => feature.properties.governmentFundingPurpose),
    ),
    presentCapitalClasses: presentCapitalClassesInOrder(
      basePointFeatures.map((f) => f.properties.capitalClass),
    ),
    citywide: summarizeCitywideEntries(citywideEntries, null),
    citywideEntries,
    countyReliefByZip,
    state2020ReliefByZip,
    stateRecoveryByZip,
    stateCapitalCitywideCount:
      typeof data.stateCapitalCitywideCount === "number"
        ? data.stateCapitalCitywideCount
        : records.filter(
            (record) => record.source === "dceo-capital" && record.geometry.kind === "citywide",
          ).length,
    federalRestaurantReliefCitywideCount:
      typeof data.federalRestaurantReliefCitywideCount === "number"
        ? data.federalRestaurantReliefCitywideCount
        : records.filter(
            (record) => record.source === "sba-rrf" && record.geometry.kind === "citywide",
          ).length,
    state2020HospitalityCitywideCount:
      typeof data.state2020HospitalityCitywideCount === "number"
        ? data.state2020HospitalityCitywideCount
        : records.filter(
            (record) =>
              record.source === "illinois-hospitality-emergency" &&
              record.geometry.kind === "citywide",
          ).length,
    citywideDevelopmentNames: citywideDevelopmentProjectNames(records),
    funderHqs: Array.isArray(data?.funderHqs) ? data.funderHqs : [],
  };
}

const HISTORICAL_RECOVERY_RECIPIENT_CONFIG: Readonly<
  Record<
    HistoricalRecoveryRecipientSource,
    { programName: string; year: number }
  >
> = {
  "cook-source-2023": {
    programName: "Cook County 2023 Source Grant",
    year: 2023,
  },
  "illinois-big": {
    programName: "Business Interruption Grants Program",
    year: 2020,
  },
  "illinois-b2b": {
    programName: "Illinois Back to Business Grant Program",
    year: 2022,
  },
};

/**
 * Fetch one ZIP's historical recipients only after an authenticated admin asks
 * for the drilldown. The normal map request receives aggregates only, so the
 * full ZIP-level recipient lists are never shipped during map load.
 */
export async function fetchHistoricalRecoveryRecipients(
  sourceId: HistoricalRecoveryRecipientSource,
  zipCode: string,
  opts?: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): Promise<HistoricalRecoveryRecipientsResult> {
  if (!/^\d{5}$/.test(zipCode)) {
    throw new Error("A five-digit ZIP code is required");
  }

  const config = HISTORICAL_RECOVERY_RECIPIENT_CONFIG[sourceId];
  const emptyResult = (
    status: Exclude<HistoricalRecoveryRecipientsStatus, "ready">,
  ): HistoricalRecoveryRecipientsResult => ({
    status,
    sourceId,
    zipCode,
    programName: config.programName,
    programStatus: "complete",
    year: config.year,
    recipientCount: 0,
    sourceLink: null,
    recipients: [],
  });

  const doFetch = opts?.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    view: "historical-recovery-recipients",
    source: sourceId,
    zip: zipCode,
  });
  const res = await doFetch(
    `${COMMUNITY_INVESTMENT_ENDPOINT}?${params.toString()}`,
    opts?.signal ? { signal: opts.signal } : undefined,
  );
  if (res.status === 401) return emptyResult("unauthorized");
  if (!res.ok) return emptyResult("unavailable");

  const data = (await res.json()) as Partial<HistoricalRecoveryRecipientsResult>;
  const recipients = Array.isArray(data.recipients)
    ? data.recipients.filter(
        (recipient): recipient is HistoricalRecoveryRecipient =>
          typeof recipient?.id === "string" &&
          typeof recipient.businessName === "string" &&
          (recipient.historicalAwardAmount === null ||
            typeof recipient.historicalAwardAmount === "number"),
      )
    : [];

  return {
    status: "ready",
    sourceId,
    zipCode,
    programName:
      typeof data.programName === "string"
        ? data.programName
        : config.programName,
    programStatus: "complete",
    year: typeof data.year === "number" ? data.year : config.year,
    recipientCount: recipients.length,
    sourceLink:
      typeof data.sourceLink === "string" && /^https?:\/\//i.test(data.sourceLink)
        ? data.sourceLink
        : null,
    recipients,
  };
}

export type InvestmentRecipientRecordStatus = "ready" | "unauthorized" | "not_found" | "unavailable";

export interface InvestmentRecipientRecordResult {
  status: InvestmentRecipientRecordStatus;
  id: string | null;
  recipient: string | null;
  logLine: string | null;
}

/**
 * Deliverable 1 (audit finding 9 / consult F6 + Q2) — fetch exactly ONE RRF
 * point's withheld identity (recipient name + logLine), authenticated, after
 * an admin clicks that specific point. No bulk prefetch: this is called once
 * per popup open, never eagerly, and the response never grows beyond a single
 * record no matter how the id is chosen (see the route's `view=recipient-record`
 * handler, which 404s an id that isn't enrolled in lazy retrieval).
 */
export async function fetchInvestmentRecipientRecord(
  id: string,
  opts?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<InvestmentRecipientRecordResult> {
  const emptyResult = (status: Exclude<InvestmentRecipientRecordStatus, "ready">): InvestmentRecipientRecordResult => ({
    status,
    id: null,
    recipient: null,
    logLine: null,
  });
  if (!id) return emptyResult("not_found");

  const doFetch = opts?.fetchImpl ?? fetch;
  const params = new URLSearchParams({ view: "recipient-record", id });
  const res = await doFetch(
    `${COMMUNITY_INVESTMENT_ENDPOINT}?${params.toString()}`,
    opts?.signal ? { signal: opts.signal } : undefined,
  );
  if (res.status === 401) return emptyResult("unauthorized");
  if (res.status === 404) return emptyResult("not_found");
  if (!res.ok) return emptyResult("unavailable");

  const data = (await res.json()) as Partial<InvestmentRecipientRecordResult>;
  if (typeof data.id !== "string" || typeof data.recipient !== "string") {
    return emptyResult("unavailable");
  }
  return {
    status: "ready",
    id: data.id,
    recipient: data.recipient,
    logLine: typeof data.logLine === "string" ? data.logLine : null,
  };
}

/** The "Reveal recipient name" button's post-outcome state. */
export interface InvestmentRevealButtonState {
  label: string;
  disabled: boolean;
  /** true only for "unauthorized" — MapView closes the popup outright rather
   * than leaving a dead-end control an unauthenticated visitor could keep
   * clicking. */
  closePopup: boolean;
}

/**
 * Sol gate blocker 4 — the reveal button's state for every possible fetch
 * OUTCOME (a resolved, non-"ready" InvestmentRecipientRecordStatus).
 * Exhaustive by construction (the switch has no default), so a future status
 * added to InvestmentRecipientRecordStatus is a compile error here rather
 * than a silently-stuck button. "unavailable" also covers a malformed
 * response body (fetchInvestmentRecipientRecord normalizes both to this
 * status) and is the SAME state used for a genuinely rejected fetch (offline,
 * DNS failure, etc. — MapView's .catch() calls this with "unavailable" too).
 * Only "not_found" is non-retryable in place — the id itself will not
 * resolve differently on a second attempt.
 */
export function investmentRevealButtonStateForResult(
  status: Exclude<InvestmentRecipientRecordStatus, "ready">,
): InvestmentRevealButtonState {
  switch (status) {
    case "unauthorized":
      return { label: "Session expired", disabled: true, closePopup: true };
    case "not_found":
      return { label: "Recipient unavailable", disabled: true, closePopup: false };
    case "unavailable":
      return { label: "Couldn't load — tap to retry", disabled: false, closePopup: false };
  }
}

/** The reveal button's state while its fetch is in flight. */
export function investmentRevealButtonLoadingState(): InvestmentRevealButtonState {
  return { label: "Loading…", disabled: true, closePopup: false };
}

/** The reveal button's state when the record has fallen out of the active
 * filter scope by click time (Sol gate blocker 1's "refuses to reveal"). */
export function investmentRevealButtonOutOfScopeState(): InvestmentRevealButtonState {
  return { label: "No longer in the selected filters", disabled: true, closePopup: false };
}

/** Backward-compatible wrapper retained for the existing Cook County callers. */
export function fetchCountyReliefRecipients(
  zipCode: string,
  opts?: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): Promise<CountyReliefRecipientsResult> {
  return fetchHistoricalRecoveryRecipients("cook-source-2023", zipCode, opts);
}

export interface HistoricalRecoveryZipSummary {
  sourceId: HistoricalRecoveryRecipientSource;
  programName: string;
  zipCode: string;
  awardCount: number;
  /** Historical source-reported dollars, never projected funding. */
  totalDisbursed: number;
  year: number;
  sourceLink: string;
}
export type CountyReliefZipSummary = HistoricalRecoveryZipSummary;

/**
 * Aggregate the recipient-level Cook County list before it reaches the ZIP map.
 * The official file publishes ZIP but no street address, so plotting recipient
 * points would require guessing. ZIP aggregation preserves the source's location
 * precision and keeps names out of the polygon properties.
 */
export function summarizeCountyReliefByZip(
  records: readonly CommunityInvestmentRecord[],
): CountyReliefZipSummary[] {
  return summarizeHistoricalRecoveryByZip(records, "cook-source-2023");
}

export function summarizeHistoricalRecoveryByZip(
  records: readonly CommunityInvestmentRecord[],
  sourceId: HistoricalRecoveryRecipientSource,
): HistoricalRecoveryZipSummary[] {
  const config = HISTORICAL_RECOVERY_RECIPIENT_CONFIG[sourceId];
  const byZip = new Map<string, HistoricalRecoveryZipSummary>();
  for (const record of records) {
    if (record.source !== sourceId || record.geometry.kind !== "zip_area") continue;
    const zipCode = record.geometry.zip;
    const current = byZip.get(zipCode) ?? {
      sourceId,
      programName: config.programName,
      zipCode,
      awardCount: 0,
      totalDisbursed: 0,
      year: config.year,
      sourceLink: record.links.find((link) => /^https?:\/\//i.test(link)) ?? "",
    };
    current.awardCount += 1;
    const historicalAmount =
      record.recovery?.historicalAmount?.value ?? record.amountAwarded;
    if (historicalAmount != null) current.totalDisbursed += historicalAmount;
    if (!current.sourceLink) {
      current.sourceLink = record.links.find((link) => /^https?:\/\//i.test(link)) ?? "";
    }
    byZip.set(zipCode, current);
  }
  return [...byZip.values()].sort((a, b) => a.zipCode.localeCompare(b.zipCode));
}
