/**
 * DRAWN-POLYGON Community Investment analysis — pure selection + aggregation.
 *
 * The map's "Draw Area" tool (components/map/MapView.tsx draw.create →
 * components/map/MapPolygonPanel.tsx) already answers "what vacancy and which
 * incentive zones are inside this shape". This module answers the third
 * question for an ADMIN viewer: "which community-investment dollars are sited
 * inside this shape" — using the SAME gated point features the admin map layer
 * already loads (lib/community-investment-layer.ts fetchCommunityInvestmentLayer).
 *
 * Nothing here fetches, renders, or reads the DOM: given a drawn polygon and the
 * already-loaded point features it returns a plain summary object, so the whole
 * money grammar is unit-testable without a live map or an admin session.
 *
 * ── IRON RULES (inherited from lib/community-investment.ts and enforced by the
 *    shape of this module, not by reviewer discipline) ────────────────────────
 *
 *  1. NEVER A COMBINED TOTAL. Each kind of capital lands in its OWN bucket with
 *     its OWN money noun and is never added to another. There is deliberately no
 *     `grandTotal` field, and no caller can build one honestly from this object
 *     because the buckets measure different instruments.
 *  2. "AWARDED" IS GRANT-CLASS ONLY. A record reaches the `awarded` bucket only
 *     when capitalClass === "grant" AND it is not a private development AND it
 *     is not a closed historical-recovery record. A TIF ceiling is "Authorized",
 *     a HUD allocation is "Federal program funding", a LIHTC/NMTC placement is a
 *     "Tax-credit allocation", a DCEO listing is a "Published appropriation
 *     balance", and a closed relief award is a "Historical award".
 *  3. "ANNOUNCED", NEVER "AWARDED", FOR DEVELOPMENT. A `development` record
 *     carries capitalClass "grant" (see community-investment-layer.ts) but its
 *     money is a self-reported private project price tag. It is routed to
 *     `announcedDevelopment` BEFORE the capital-class switch so it can never
 *     reach the awarded total.
 *  4. NEVER "RECEIVED". No bucket, noun, or label in this module implies a
 *     recipient received, drew down, or still has money available.
 *  5. AN OFF-ENUM CAPITAL CLASS IS NEVER SILENTLY AWARDED. It lands in the
 *     `other` bucket, which counts records but sums no dollars.
 *
 * ── WHAT A POLYGON CANNOT SELECT ─────────────────────────────────────────────
 * Only `point`-geometry records are selectable. The ZIP-aggregate relief sources
 * (Cook County 2023 Source Grant, Illinois BIG, Illinois Back to Business) and
 * every citywide-geometry record carry no point location and are therefore
 * absent from any drawn area — including one drawn right on top of them. The
 * summary carries explicit EXCLUSION COUNTS so the panel states that absence
 * instead of implying those dollars are zero here.
 */

import {
  CAPITAL_CLASS_MONEY_NOUN,
  type CommunityInvestmentLayerResult,
  type InvestmentPointFeature,
  type InvestmentPointProps,
} from "@/lib/community-investment-layer";

// ── Point-in-polygon ─────────────────────────────────────────────────────────

/**
 * Any shape the drawn-area tool can hand us: a raw geometry or a Feature
 * wrapping one. MapboxDraw emits `Feature<Polygon>`; MapView forwards the bare
 * geometry. Both are accepted so neither caller has to unwrap.
 */
export type DrawnAreaInput =
  | GeoJSON.Polygon
  | GeoJSON.MultiPolygon
  | GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  | null
  | undefined;

/** Normalized ring stack: polygons → rings → positions. */
type PolygonRings = number[][][];

/**
 * Normalize any accepted drawn-area input to MultiPolygon-shaped coordinates.
 * A null/invalid input yields an empty list (which selects nothing rather than
 * everything — the safe direction for a gated dataset). Pure.
 */
export function drawnAreaPolygons(input: DrawnAreaInput): PolygonRings[] {
  if (!input) return [];
  const geometry =
    "type" in input && input.type === "Feature"
      ? (input.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | null)
      : (input as GeoJSON.Polygon | GeoJSON.MultiPolygon);
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return Array.isArray(geometry.coordinates) ? [geometry.coordinates as PolygonRings] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return Array.isArray(geometry.coordinates) ? (geometry.coordinates as PolygonRings[]) : [];
  }
  return [];
}

/** Collinearity/containment tolerance for the on-boundary test. */
const EDGE_EPSILON = 1e-12;

/** Whether (px,py) lies on the segment a→b, within EDGE_EPSILON. Pure. */
function pointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (Math.abs(cross) > EDGE_EPSILON) return false;
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
  if (dot < -EDGE_EPSILON) return false;
  const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
  if (lengthSquared === 0) return Math.abs(px - ax) <= EDGE_EPSILON && Math.abs(py - ay) <= EDGE_EPSILON;
  return dot - lengthSquared <= EDGE_EPSILON;
}

/** Whether (px,py) lies on any edge of `ring`. Pure. */
function pointOnRing(px: number, py: number, ring: number[][]): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (!a || !b) continue;
    if (pointOnSegment(px, py, a[0], a[1], b[0], b[1])) return true;
  }
  return false;
}

/** Even-odd ray cast against a single ring (boundary result undefined — callers
 * test the boundary explicitly first). Pure. */
function rayCastRing(px: number, py: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    const straddles = yi > py !== yj > py;
    if (!straddles) continue;
    if (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Ray-cast point-in-polygon over normalized MultiPolygon coordinates, with
 * interior rings (holes) honored.
 *
 * BOUNDARY CONVENTION: a point lying exactly ON a ring edge counts as INSIDE.
 * A hand-drawn selection should include what its outline traces, and the
 * alternative (an arbitrary even-odd result on the edge) would make an identical
 * polygon select a different set depending on winding order. Documented here
 * because the unit tests pin it.
 *
 * Non-finite coordinates are never inside. Pure / deterministic.
 */
export function pointInPolygon(
  point: readonly [number, number],
  polygons: readonly PolygonRings[],
): boolean {
  const [px, py] = point;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  for (const rings of polygons) {
    if (!Array.isArray(rings) || rings.length === 0) continue;
    let onEdge = false;
    for (const ring of rings) {
      if (Array.isArray(ring) && pointOnRing(px, py, ring)) {
        onEdge = true;
        break;
      }
    }
    if (onEdge) return true;
    if (!rayCastRing(px, py, rings[0])) continue;
    let inHole = false;
    for (let h = 1; h < rings.length; h += 1) {
      if (Array.isArray(rings[h]) && rayCastRing(px, py, rings[h])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * The investment point features whose coordinates fall inside the drawn area.
 * Order-preserving. An empty/invalid drawn area selects NOTHING. Pure.
 */
export function selectInvestmentPointsInArea(
  area: DrawnAreaInput,
  features: readonly InvestmentPointFeature[],
): InvestmentPointFeature[] {
  const polygons = drawnAreaPolygons(area);
  if (polygons.length === 0) return [];
  return features.filter((feature) => {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
    return pointInPolygon([coordinates[0], coordinates[1]], polygons);
  });
}

// ── Capital buckets ──────────────────────────────────────────────────────────

export const POLYGON_INVESTMENT_BUCKET_KEYS = [
  "awarded",
  "announcedDevelopment",
  "tifAuthorized",
  "federalProgram",
  "taxCredit",
  "stateAppropriation",
  "historicalRecovery",
  "other",
] as const;

export type PolygonInvestmentBucketKey = (typeof POLYGON_INVESTMENT_BUCKET_KEYS)[number];

export interface PolygonInvestmentBucketConfig {
  key: PolygonInvestmentBucketKey;
  /** What KIND of money this bucket holds (the section label). */
  label: string;
  /**
   * The ONLY correct verb for this bucket's dollars. Never "received", never
   * "available", and never shared across buckets.
   */
  noun: string;
  /** Column header for this bucket's dollars in the drawn-area CSV. */
  csvColumn: string;
  /** False for `other`, whose records are counted but whose dollars are never summed. */
  hasMoney: boolean;
  /**
   * Optional one-sentence provenance caveat rendered under this bucket's row.
   * Present only where the RECORD COUNT can mislead even though the dollars are
   * sound, so the warning sits at the figure rather than in a footnote nobody reads.
   */
  caption?: string;
}

/**
 * HUD CDBG/HOME activities are geocoded to the address on the activity record,
 * which for many rows is the administering agency rather than the served site —
 * so a drawn area containing an agency's office absorbs its entire activity
 * list. Verified against the live export: a downtown box put 181 federal-program
 * records on ONE coordinate near LaSalle & Randolph. The committed dollars are
 * real; the COUNT reads as site density and must not be taken for it.
 */
export const POLYGON_INVESTMENT_FEDERAL_PROGRAM_CAPTION =
  "CDBG/HOME activity counts can cluster at administering-agency addresses; dollars are real, site density may over-read.";

/**
 * The buckets in display order, each with its own noun and CSV column. This is
 * the single source of truth the panel, the CSV, and the tests all read, so a
 * noun can never drift between the screen and the export.
 */
export const POLYGON_INVESTMENT_BUCKETS: readonly PolygonInvestmentBucketConfig[] = [
  {
    key: "awarded",
    label: "Grants",
    noun: CAPITAL_CLASS_MONEY_NOUN.grant, // "Awarded"
    csvColumn: "Awarded (grant, $)",
    hasMoney: true,
  },
  {
    key: "announcedDevelopment",
    label: "Private development",
    noun: "Announced",
    csvColumn: "Announced private capital ($)",
    hasMoney: true,
  },
  {
    key: "tifAuthorized",
    label: "TIF assistance",
    noun: CAPITAL_CLASS_MONEY_NOUN.tif_subsidy, // "Authorized"
    csvColumn: "TIF authorized ($)",
    hasMoney: true,
  },
  {
    key: "federalProgram",
    label: "Federal program",
    noun: CAPITAL_CLASS_MONEY_NOUN.federal_program, // "Federal program funding"
    csvColumn: "Federal program funding ($)",
    hasMoney: true,
    caption: POLYGON_INVESTMENT_FEDERAL_PROGRAM_CAPTION,
  },
  {
    key: "taxCredit",
    label: "Tax credit",
    noun: CAPITAL_CLASS_MONEY_NOUN.tax_credit, // "Tax-credit allocation"
    csvColumn: "Tax-credit allocation ($)",
    hasMoney: true,
  },
  {
    key: "stateAppropriation",
    label: "State appropriation",
    noun: CAPITAL_CLASS_MONEY_NOUN.state_appropriation, // "Published appropriation balance"
    csvColumn: "Published appropriation balance ($)",
    hasMoney: true,
  },
  {
    key: "historicalRecovery",
    label: "Closed relief programs",
    noun: "Historical award",
    csvColumn: "Historical award ($)",
    hasMoney: true,
  },
  {
    key: "other",
    label: "Unclassified capital",
    noun: "Not summed",
    csvColumn: "",
    hasMoney: false,
  },
];

const BUCKET_BY_KEY: Record<PolygonInvestmentBucketKey, PolygonInvestmentBucketConfig> =
  Object.fromEntries(POLYGON_INVESTMENT_BUCKETS.map((b) => [b.key, b])) as Record<
    PolygonInvestmentBucketKey,
    PolygonInvestmentBucketConfig
  >;

/** The bucket config for a key. Pure. */
export function polygonInvestmentBucket(
  key: PolygonInvestmentBucketKey,
): PolygonInvestmentBucketConfig {
  return BUCKET_BY_KEY[key];
}

/**
 * Route ONE record to exactly one bucket. Order matters and is the enforcement
 * point for iron rules 2, 3 and 5:
 *   1. a private development is "Announced" before anything else looks at its
 *      capitalClass (which is nominally "grant");
 *   2. a closed historical-recovery record is a "Historical award", never an
 *      award of currently available money;
 *   3. only a plain grant-class record reaches `awarded`;
 *   4. an unrecognized capitalClass falls to `other` — counted, never summed.
 * Pure.
 */
export function investmentBucketForPoint(
  props: Pick<InvestmentPointProps, "funderType" | "capitalClass" | "recoverySourceId">,
): PolygonInvestmentBucketKey {
  if (props.funderType === "private_development") return "announcedDevelopment";
  if (props.recoverySourceId) return "historicalRecovery";
  switch (props.capitalClass) {
    case "tif_subsidy":
      return "tifAuthorized";
    case "federal_program":
      return "federalProgram";
    case "tax_credit":
      return "taxCredit";
    case "state_appropriation":
      return "stateAppropriation";
    case "grant":
      return "awarded";
    default:
      return "other";
  }
}

/**
 * The ONE money field a bucket may read. Reading any other field would silently
 * relabel the dollars, so this mapping is deliberately exhaustive and total.
 * Pure.
 */
export function investmentAmountForBucket(
  bucket: PolygonInvestmentBucketKey,
  props: InvestmentPointProps,
): number | null {
  switch (bucket) {
    case "awarded":
      return props.amountAwarded ?? null;
    case "announcedDevelopment":
      return props.announcedInvestment ?? null;
    case "tifAuthorized":
    case "federalProgram":
      return props.authorizedAmount ?? null;
    case "taxCredit":
      return props.creditAmount ?? null;
    case "stateAppropriation":
      return props.publishedBalance ?? null;
    case "historicalRecovery":
      return props.historicalRecoveryAmount ?? null;
    case "other":
    default:
      return null;
  }
}

export interface PolygonInvestmentBucketTotal {
  key: PolygonInvestmentBucketKey;
  label: string;
  /** The only correct verb for this figure. */
  noun: string;
  /** Records of this kind inside the drawn area. */
  count: number;
  /**
   * Sum of THIS bucket's own money field only (nulls skipped). Never combined
   * with any other bucket. Always 0 for `other`.
   */
  total: number;
  /** How many of `count` published no figure at all. */
  undisclosedCount: number;
}

export interface PolygonInvestmentRecipient {
  recipient: string;
  /** Awarded GRANT dollars only — the sole basis for this ranking. */
  awarded: number;
  /** Grant records for this recipient inside the area. */
  count: number;
}

/**
 * Records the drawn area COULD NOT select because their source publishes no
 * point location. These are not zeros — they are absences, and the panel says so.
 */
export interface PolygonInvestmentExclusions {
  /**
   * ZIP-aggregate relief award records (Cook County 2023 Source Grant, Illinois
   * BIG, Illinois Back to Business). Their official lists carry a ZIP, never a
   * street address, so they are mapped as ZIP aggregates and can never fall
   * inside a hand-drawn shape.
   */
  zipAggregateReliefRecords: number;
  /**
   * Citywide-geometry records — foundation intermediaries, NMTC placements,
   * entity-wide development commitments, DCEO listings and SBA RRF / Illinois
   * Hospitality rows the sources could not site to a point.
   */
  citywideRecords: number;
}

export const EMPTY_POLYGON_INVESTMENT_EXCLUSIONS: PolygonInvestmentExclusions = {
  zipAggregateReliefRecords: 0,
  citywideRecords: 0,
};

/**
 * Derive the exclusion counts from a loaded layer result. The three ZIP-aggregate
 * summaries carry per-ZIP award counts; the citywide figures come from the base
 * citywide summary plus the three overlay-source citywide counts (which the base
 * summary deliberately filters out, so nothing is double counted). Pure.
 */
export function investmentExclusionsFromLayer(
  layer: Pick<
    CommunityInvestmentLayerResult,
    | "citywide"
    | "countyReliefByZip"
    | "state2020ReliefByZip"
    | "stateRecoveryByZip"
    | "stateCapitalCitywideCount"
    | "federalRestaurantReliefCitywideCount"
    | "state2020HospitalityCitywideCount"
  >,
): PolygonInvestmentExclusions {
  const zipSum = (rows: readonly { awardCount: number }[] | undefined): number =>
    (rows ?? []).reduce((sum, row) => sum + (Number.isFinite(row?.awardCount) ? row.awardCount : 0), 0);

  return {
    zipAggregateReliefRecords:
      zipSum(layer.countyReliefByZip) +
      zipSum(layer.state2020ReliefByZip) +
      zipSum(layer.stateRecoveryByZip),
    citywideRecords:
      (layer.citywide?.count ?? 0) +
      (layer.stateCapitalCitywideCount ?? 0) +
      (layer.federalRestaurantReliefCitywideCount ?? 0) +
      (layer.state2020HospitalityCitywideCount ?? 0),
  };
}

export interface PolygonInvestmentSummary {
  /** Point records inside the drawn area, across every bucket. */
  selectedCount: number;
  /** Every bucket, in display order — including empty ones (the panel filters). */
  buckets: PolygonInvestmentBucketTotal[];
  /** Top 5 recipients by AWARDED GRANT dollars only. */
  topRecipients: PolygonInvestmentRecipient[];
  /** Inclusive year span across selected records with a year, or null. */
  yearSpan: { minYear: number; maxYear: number } | null;
  exclusions: PolygonInvestmentExclusions;
}

/** How many recipients the summary ranks. */
export const POLYGON_TOP_RECIPIENT_LIMIT = 5;

/**
 * Aggregate the selected investment points into per-kind buckets. There is no
 * combined total by construction (iron rule 1) — every figure is reported under
 * its own noun. Pure / deterministic.
 */
export function aggregateInvestmentPoints(
  selected: readonly InvestmentPointFeature[],
  exclusions: PolygonInvestmentExclusions = EMPTY_POLYGON_INVESTMENT_EXCLUSIONS,
): PolygonInvestmentSummary {
  const totals = new Map<PolygonInvestmentBucketKey, PolygonInvestmentBucketTotal>(
    POLYGON_INVESTMENT_BUCKETS.map((config) => [
      config.key,
      {
        key: config.key,
        label: config.label,
        noun: config.noun,
        count: 0,
        total: 0,
        undisclosedCount: 0,
      },
    ]),
  );

  const awardedByRecipient = new Map<string, PolygonInvestmentRecipient>();
  let minYear: number | null = null;
  let maxYear: number | null = null;

  for (const feature of selected) {
    const props = feature.properties;
    if (!props) continue;
    const key = investmentBucketForPoint(props);
    const config = BUCKET_BY_KEY[key];
    const bucket = totals.get(key);
    if (!bucket) continue;
    bucket.count += 1;

    const amount = config.hasMoney ? investmentAmountForBucket(key, props) : null;
    if (amount == null || !Number.isFinite(amount)) {
      bucket.undisclosedCount += 1;
    } else {
      bucket.total += amount;
    }

    if (key === "awarded" && amount != null && Number.isFinite(amount)) {
      const name = (props.recipient || "").trim() || "(unnamed recipient)";
      const entry = awardedByRecipient.get(name) ?? { recipient: name, awarded: 0, count: 0 };
      entry.awarded += amount;
      entry.count += 1;
      awardedByRecipient.set(name, entry);
    }

    if (typeof props.year === "number" && Number.isFinite(props.year)) {
      minYear = minYear == null ? props.year : Math.min(minYear, props.year);
      maxYear = maxYear == null ? props.year : Math.max(maxYear, props.year);
    }
  }

  const topRecipients = [...awardedByRecipient.values()]
    .sort((a, b) => b.awarded - a.awarded || a.recipient.localeCompare(b.recipient))
    .slice(0, POLYGON_TOP_RECIPIENT_LIMIT);

  return {
    selectedCount: selected.length,
    buckets: POLYGON_INVESTMENT_BUCKETS.map((config) => totals.get(config.key)!),
    topRecipients,
    yearSpan: minYear != null && maxYear != null ? { minYear, maxYear } : null,
    exclusions,
  };
}

/**
 * The whole drawn-area investment analysis in one call: select by
 * point-in-polygon, then aggregate. Pure / deterministic.
 */
export function summarizePolygonInvestment(
  area: DrawnAreaInput,
  features: readonly InvestmentPointFeature[],
  exclusions: PolygonInvestmentExclusions = EMPTY_POLYGON_INVESTMENT_EXCLUSIONS,
): PolygonInvestmentSummary {
  return aggregateInvestmentPoints(selectInvestmentPointsInArea(area, features), exclusions);
}

// ── Display copy ─────────────────────────────────────────────────────────────

export const POLYGON_INVESTMENT_HEADING = "Community investment in this area";

/**
 * The standing warning that the figures below are DIFFERENT INSTRUMENTS. Shared
 * by the panel and the CSV so the two can never drift, and pinned by a unit test
 * (iron rules 1–4 in one sentence a reader can act on).
 */
export const POLYGON_INVESTMENT_NO_TOTAL_NOTE =
  "Each figure below is a different kind of capital and is never combined into one total. Awarded dollars are grants only; private development figures are announced project capital, not awarded dollars.";

/** Empty-selection copy — an absence of sited records, not an absence of money. */
export const POLYGON_INVESTMENT_EMPTY_NOTE =
  "No sited community-investment records fall inside this area.";

/** Format a bucket total for display: whole dollars, thousands-separated. Pure. */
export function formatPolygonInvestmentAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "$0";
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/**
 * The exclusion sentence(s) for the panel and the CSV footer — one clause per
 * non-zero exclusion, each naming WHY the records are absent. Returns an empty
 * array when nothing was excluded. Pure.
 */
export function polygonInvestmentExclusionNotes(
  exclusions: PolygonInvestmentExclusions,
): string[] {
  const notes: string[] = [];
  const zip = exclusions.zipAggregateReliefRecords;
  if (zip > 0) {
    notes.push(
      `${zip.toLocaleString("en-US")} ZIP-aggregate relief record${zip === 1 ? "" : "s"} not included (no point location).`,
    );
  }
  const citywide = exclusions.citywideRecords;
  if (citywide > 0) {
    notes.push(
      `${citywide.toLocaleString("en-US")} citywide record${citywide === 1 ? "" : "s"} not included (no point location).`,
    );
  }
  return notes;
}

/** Inclusive year-span label ("2019–2025", or "2021" for a single year). Pure. */
export function polygonInvestmentYearSpanLabel(
  span: PolygonInvestmentSummary["yearSpan"],
): string {
  if (!span) return "";
  return span.minYear === span.maxYear ? String(span.minYear) : `${span.minYear}–${span.maxYear}`;
}

// ── Area label ("Ellen's label fix") ─────────────────────────────────────────

const AREA_NAME_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * The default name for a freshly drawn area — "Drawn area — Jul 29, 2026".
 * Every drawn area starts with a name so the export is never anonymous, and the
 * user can overwrite it. Local (not UTC) date parts: the label describes when
 * the analyst drew the shape, in their own day. Pure for a given Date.
 */
export function defaultDrawnAreaName(date: Date = new Date()): string {
  const month = AREA_NAME_MONTHS[date.getMonth()] ?? "";
  return `Drawn area — ${month} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Filesystem-safe slug of an area name for the CSV filename. Pure. */
export function drawnAreaFilenameSlug(areaName: string): string {
  const slug = areaName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "drawn-area";
}

// ── CSV ──────────────────────────────────────────────────────────────────────

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(",");
}

/** Vacancy-table columns, after the leading "Area Name". */
export const DRAWN_AREA_VACANCY_COLUMNS = [
  "Address",
  "Property Type",
  "Ward",
  "Community Area",
  "Zoning Class",
  "Sq Ft",
  "Owner Name",
  "Owner Type",
  "Incentive Count",
  "Zone Matches",
] as const;

/**
 * Investment-table columns, after the leading "Area Name". One column PER MONEY
 * NOUN (rather than a single "Amount") so a reader who sums a column is summing
 * one instrument — the CSV shape itself enforces iron rule 1.
 */
export const DRAWN_AREA_INVESTMENT_COLUMNS: readonly string[] = [
  "Recipient",
  "Funder",
  "Funder Type",
  "Capital Class",
  "Year",
  ...POLYGON_INVESTMENT_BUCKETS.filter((b) => b.hasMoney).map((b) => b.csvColumn),
];

export interface DrawnAreaCsvInput {
  /** The user-editable area label. Lands on the title line AND every data row. */
  areaName: string;
  /** Vacancy features already scoped to the drawn area by /api/vacant. */
  vacancyFeatures: readonly GeoJSON.Feature[];
  /**
   * The admin investment analysis, or null for a non-admin / not-yet-loaded
   * viewer — in which case the CSV carries the vacancy table alone and mentions
   * investment nowhere.
   */
  investment?: {
    summary: PolygonInvestmentSummary;
    selected: readonly InvestmentPointFeature[];
  } | null;
}

/**
 * Build the drawn-area CSV. Two tables in one file, each with its own honest
 * header, separated by a blank line — a single wide sparse table would force
 * vacancy and investment columns into the same rows, which they do not share.
 *
 * The AREA NAME appears on the title line and as the FIRST CELL OF EVERY ROW of
 * both tables and both headers, so a row pasted out of context still says which
 * area it came from (the whole point of the label fix).
 *
 * The investment table is emitted ONLY when `investment` is supplied — a
 * non-admin export is byte-identical to the pre-existing vacancy CSV plus its
 * area-name column. Pure / deterministic.
 */
export function buildDrawnAreaCsv(input: DrawnAreaCsvInput): string {
  const areaName = input.areaName.trim() || defaultDrawnAreaName();
  const lines: string[] = [];

  lines.push(csvRow(["Area Name", areaName]));
  lines.push("");
  lines.push(csvRow(["Section", "Vacancy"]));
  lines.push(csvRow(["Area Name", ...DRAWN_AREA_VACANCY_COLUMNS]));
  for (const feature of input.vacancyFeatures) {
    const p = (feature?.properties ?? {}) as Record<string, unknown>;
    const zoneMatches = Array.isArray(p.zoneMatches) ? p.zoneMatches : [];
    lines.push(
      csvRow([
        areaName,
        p.address ?? "",
        p.propertyType ?? "",
        p.ward ?? "",
        p.communityArea ?? "",
        p.zoningClass ?? "",
        p.squareFeet ?? "",
        p.ownerName ?? "",
        p.ownerType ?? "",
        p.incentiveCount ?? "",
        zoneMatches
          .map((z) => (z && typeof z === "object" ? ((z as { zoneKey?: string }).zoneKey ?? "") : z))
          .join("; "),
      ]),
    );
  }

  if (input.investment) {
    const { summary, selected } = input.investment;
    const moneyBuckets = POLYGON_INVESTMENT_BUCKETS.filter((b) => b.hasMoney);
    lines.push("");
    lines.push(csvRow(["Section", "Community investment"]));
    lines.push(csvRow([POLYGON_INVESTMENT_NO_TOTAL_NOTE]));
    lines.push(csvRow(["Area Name", ...DRAWN_AREA_INVESTMENT_COLUMNS]));
    for (const feature of selected) {
      const props = feature.properties;
      if (!props) continue;
      const key = investmentBucketForPoint(props);
      const amount = polygonInvestmentBucket(key).hasMoney
        ? investmentAmountForBucket(key, props)
        : null;
      lines.push(
        csvRow([
          areaName,
          props.recipient ?? "",
          props.funderName ?? "",
          props.funderType ?? "",
          props.capitalClass ?? "",
          props.year ?? "",
          ...moneyBuckets.map((bucket) =>
            bucket.key === key && amount != null && Number.isFinite(amount) ? amount : "",
          ),
        ]),
      );
    }

    lines.push("");
    lines.push(csvRow(["Section", "Community investment totals"]));
    lines.push(csvRow(["Area Name", "Kind of capital", "Money noun", "Records", "Amount"]));
    for (const bucket of summary.buckets) {
      if (bucket.count === 0) continue;
      const config = polygonInvestmentBucket(bucket.key);
      lines.push(
        csvRow([
          areaName,
          bucket.label,
          bucket.noun,
          bucket.count,
          config.hasMoney ? bucket.total : "",
        ]),
      );
    }

    for (const note of polygonInvestmentExclusionNotes(summary.exclusions)) {
      lines.push(csvRow([areaName, "Excluded", note]));
    }
  }

  return lines.join("\n");
}
