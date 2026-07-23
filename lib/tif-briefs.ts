/**
 * TIF funding picture — export-side data contract, pure geometry/composition
 * functions, printed-copy constants, and the static-only loader.
 *
 * Chicago allows transferring ("porting") TIF increment between contiguous
 * districts — or districts separated only by a public right-of-way — when both
 * redevelopment plans provide for it. The decision runs through the Department
 * of Planning and Development, the Community Development Commission, and City
 * Council. Corridor groups can't see which neighboring districts hold money or
 * when windows close, so this pipeline computes exactly that at export time and
 * the per-ZIP vacancy web report renders it as a "TIF funding picture" section.
 *
 * The pipeline mirrors lib/vacancy-index.ts:
 *
 *   scripts/export-tif-briefs.ts (reads the committed TIF geojson + Socrata
 *     TIF annual report + the committed vacancy-index.json edition boundaries)
 *     -> public/data/tif-briefs.json (committed)
 *     -> loadTifBriefs() here (static-only, no DB)
 *     -> buildTifFundingPicture() (pure view model)
 *     -> the "TIF funding picture" section on app/vacancy/[zip]/page.tsx.
 *
 * Honesty rails (non-negotiable, mirror the vacancy-index doctrine):
 *   • Discovery, not compliance — only balances, adjacency, dates, and process;
 *     never "you can get $X".
 *   • Every number is sourced + as-of. A district with no Socrata row carries
 *     `finance: null` and renders "not yet available" — NEVER a silent zero.
 *   • Deterministic export: no run-time-dependent ordering. `generatedAt` from
 *     the run clock is the only wall-clock value.
 *   • No new dependencies — the geometry (contiguity, point-in-polygon) is
 *     written here, no turf.
 *
 * No personal data of any kind travels in the committed file.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// ── Data contract ────────────────────────────────────────────────────────────

/** Two labeled adjacency relations, never merged:
 *   • `touching` — the district boundaries intersect / share an edge (0 distance).
 *   • `near`     — the boundaries come within ~60 m of each other (captures
 *                  "separated only by a public right-of-way"; a Chicago arterial
 *                  ROW is ~20–40 m). Rendered as "adjacent across a public way
 *                  (verify)" in the UI. */
export type TifRelation = "touching" | "near";

/** One contiguous (or ROW-adjacent) neighbor of a district. */
export interface TifNeighbor {
  number: string;
  relation: TifRelation;
}

/**
 * The latest-year financial snapshot for one district, from the City's TIF
 * Annual Report (Analysis of Special Tax Allocation Fund, Socrata qm7s-3ctt).
 * Every dollar field is a real reported amount or `null` when the source column
 * was blank/unparseable — never coerced to 0. The whole object is `null` when
 * the district has no report row at all (renders "not yet available").
 */
export interface TifFinance {
  /** The report_year the figures are drawn from (the latest available). */
  reportYear: number;
  /** Fund balance at year end (`fund_balance`). */
  fundBalance: number | null;
  /** Tax-allocation fund balance (`tax_allocation_fund_balance`). */
  taxAllocationFundBalance: number | null;
  /** Property-tax increment collected in the report year (`property_tax_increment_current`). */
  incrementCurrent: number | null;
  /** Surplus distributed in the report year (`distribution_of_surplus`). */
  surplusDistributed: number | null;
}

/**
 * The City's forward-looking programming outlook for one district, aggregated
 * from DPD's 10-Year TIF Projections (Socrata fpsv-qjg3), per the source's own
 * `category_description` — VERBATIM, never normalized (observed: "Current
 * Obligations", "Fund Balance", "Revenue", "Surplus", "Transfers Between TIF
 * Districts"). Each category total is the sum of that district's line items'
 * `fund_and_project_balances + Σ(_2025.._2034) + through_end_date`. Negatives
 * are carried as the source publishes them. `null` when the district has no
 * line items in the projections dataset.
 *
 * This is a DIFFERENT report, vintage, and source than `TifFinance` above — the
 * two are never reconciled or subtracted (that would fabricate an
 * "available-funds" figure the data cannot support).
 */
export interface TifProjections {
  /** DPD publication date of the projections report (fixed constant). */
  publishedDate: string;
  /** Human-readable source label (fixed constant). */
  source: string;
  /** Source `category_description` (verbatim) -> aggregated total. */
  categories: Record<string, number>;
}

/**
 * One TIF district's brief: its administrative facts, its latest financial
 * snapshot (or null), the City's programming outlook (or null), and its
 * contiguity neighbors (canonically sorted by number). This is the porting
 * picture, per district.
 */
export interface TifDistrictBrief {
  /** Normalized TIF number, e.g. "T-87" (source "T- 87" has the space stripped). */
  number: string;
  name: string;
  /** Approval date (YYYY-MM-DD) or null when the source omitted it. */
  approvalDate: string | null;
  /** Expiration date (YYYY-MM-DD) or null. */
  expirationDate: string | null;
  /** True when the district carries the Small Business Improvement Fund (SBIF="Y"). */
  sbif: boolean;
  /** Comma-separated ward list from the source (verbatim). */
  wards: string;
  status: string;
  /** Latest-year finance, or `null` when the district has no annual-report row. */
  finance: TifFinance | null;
  /** City programming outlook (DPD projections), or `null` when the district
   * has no line items in the projections dataset. */
  projections: TifProjections | null;
  /** Contiguity neighbors (relation-labeled), canonically sorted by number. */
  neighbors: TifNeighbor[];
}

/** Per-ZIP membership: the districts intersecting that edition's boundary and,
 * per district, how many tracked vacant sites fall inside it. A `0` here is an
 * honest zero (the point-in-polygon count ran), never "unavailable". */
export interface TifZipBrief {
  /** District numbers intersecting the ZIP's edition boundary, canonically sorted. */
  districtNumbers: string[];
  /** number -> count of tracked vacant sites inside that district. */
  vacantSiteCounts: Record<string, number>;
}

/** Human-readable source + as-of labels for the section footer. */
export interface TifBriefsSources {
  tifBoundaries: string;
  tifAnnualReport: string;
  /** DPD 10-Year TIF Projections provenance. Optional so a committed file that
   * predates the programming-outlook join still parses. */
  tifProjections?: string;
  vacancyIndex: string;
  asOf: string;
}

export interface TifBriefsExport {
  generatedAt: string;
  sources: TifBriefsSources;
  /** number -> district brief. Keys are canonically ordered when serialized. */
  districts: Record<string, TifDistrictBrief>;
  /** ZIP -> membership + per-district vacant-site counts. */
  zips: Record<string, TifZipBrief>;
}

// ── Printed-copy constants ─────────────────────────────────────────────────

/** UI labels for the two relations (the JSON keeps the raw `touching`/`near`). */
export const TIF_RELATION_LABELS: Record<TifRelation, string> = {
  touching: "contiguous",
  near: "adjacent across a public way (verify)",
};

// ── Fixed, verbatim copy blocks ────────────────────────────────────────────
// Ship-ready wording from the DPD-informed editorial consult. These are the
// single source of truth for the "TIF funding picture" section's honesty copy;
// the page imports them rather than inlining strings so they stay auditable and
// testable. Rule: NEVER label a figure "available/free/unused/sitting/unspent",
// and NEVER present a derived "available/remaining/uncommitted" number.

/** DPD projections report metadata (published date + source label). */
export const TIF_PROJECTIONS_PUBLISHED_DATE = "2025-10-15";
export const TIF_PROJECTIONS_SOURCE = "DPD 10-Year TIF Projections (2025–2034)";

/** Rule 2 — the visible caveat printed beside the reported year-end balance. */
export const TIF_BALANCE_CAVEAT =
  "Year-end accounting balance — not a current estimate of funds available for new projects.";

/** Rule 7 — shown in the balance slot when the district has no annual-report row
 * (an honest "no row", never a fabricated $0). */
export const TIF_BALANCE_MISSING = "No annual report row published";

/** Consult §2B — the standing explainer that frames the whole section. */
export const TIF_STANDING_EXPLAINER =
  "TIF finances change between annual reports. The reported balance is a year-end " +
  "accounting snapshot, not the amount open for new projects. The City’s programming " +
  "outlook includes known obligations, proposed projects, and estimated future revenue" +
  "—not all of which are final commitments. DPD must confirm current funding capacity, " +
  "project fit, and the approvals required. Use these figures to prepare a conversation, " +
  "not to predict an award.";

/** Rule 8 — printed under the programming outlook so the two vintages are never
 * read as reconcilable. */
export const TIF_VINTAGE_NOTE =
  "These figures come from different reports and dates; they do not add up to an " +
  "available-funds number, and none is shown here.";

/** Shown in place of the programming outlook when the district has no line items
 * in DPD's latest projections. */
export const TIF_PROJECTIONS_NULL_NOTE =
  "No line items published for this district in DPD’s latest projections.";

/** Rule 5 — the adjacency heading and body (consult §2D, verbatim) plus map note. */
export const TIF_ADJACENCY_HEADING = "Use in a neighboring TIF may be legally possible";
export const TIF_ADJACENCY_BODY =
  "Illinois law permits—but does not require—eligible TIF revenues to support " +
  "eligible costs in certain contiguous districts. Any transfer depends on current funding " +
  "capacity, plan and project eligibility, City review, and required approvals. Adjacency " +
  "does not create an entitlement, and no transfer is shown or promised here.";
export const TIF_ADJACENCY_MAP_NOTE =
  "Mapped proximity is a screening signal, not a legal determination of transfer eligibility.";

/** Rule 6 — appended to the vacancy-count line. */
export const TIF_VACANCY_DISCLAIMER =
  "Location does not establish ownership, project eligibility, or funding.";

/** Consult §4 — DPD-as-authority framing that replaces the old who-decides note. */
export const TIF_DPD_AUTHORITY_HEADING = "Official next step: confirm with DPD";
export const TIF_DPD_AUTHORITY_BODY =
  "This page assembles published district information for an informed first conversation. " +
  "DPD can confirm current commitments, whether a proposal fits the district plan and " +
  "eligible-use rules, and which review and approval steps apply. The Explorer does not " +
  "reserve funds, determine eligibility, or predict a City decision.";
export const TIF_DPD_AUTHORITY_CTA = "Prepare a TIF inquiry for DPD";
export const TIF_PROCESS_LINE =
  "Published record → DPD fit and capacity conversation → applicable public review " +
  "→ City Council approval when required.";
export const TIF_PARTNERS_NOTE =
  "The ward office is a local-context and coordination partner, not a substitute for program " +
  "review; the Community Development Commission reviews and recommends certain TIF financing " +
  "to City Council where applicable.";

/**
 * Structural rail for rule 1: no key anywhere in the committed export may name a
 * derived "available / remaining / uncommitted" figure. The projections
 * categories are the only source-driven (dynamic) keys, so a renamed or
 * hand-edited category that implied a computed remainder is caught here.
 */
export const TIF_FORBIDDEN_FIGURE_KEY_RE = /available|remaining|uncommitted/i;

/** Recursively collect every object key in `value` that matches the forbidden
 * figure-name rail. Returns [] when clean. Pure — used by the export assert and
 * unit-tested directly. */
export function findForbiddenFigureKeys(value: unknown): string[] {
  const hits: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) {
        if (TIF_FORBIDDEN_FIGURE_KEY_RE.test(k)) hits.push(k);
        walk(child);
      }
    }
  };
  walk(value);
  return hits;
}

// ── Normalization (pure) ───────────────────────────────────────────────────

/**
 * Normalize a TIF number to the canonical no-space form: the source geojson
 * carries an embedded space ("T- 87") while Socrata uses "T-186", so both are
 * folded by stripping ALL whitespace and upper-casing. Returns "" for a
 * null/blank input (an unusable key the caller drops).
 */
export function normalizeTifNumber(raw: string | null | undefined): string {
  if (raw == null) return "";
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** The integer portion of a normalized TIF number ("T-87" -> 87), or null when
 * it has no parseable digits. */
function tifNumericPart(number: string): number | null {
  const m = number.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Canonical total order over TIF numbers: by the integer portion ascending,
 * ties broken by the full string. Deterministic and reproducible — used for
 * every neighbor list and district-number list so a re-export is byte-stable.
 */
export function compareTifNumbers(a: string, b: string): number {
  const na = tifNumericPart(a);
  const nb = tifNumericPart(b);
  if (na != null && nb != null && na !== nb) return na - nb;
  if (na != null && nb == null) return -1;
  if (na == null && nb != null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── Geometry (pure, no deps) ───────────────────────────────────────────────

/** [lon, lat]. */
export type LonLat = [number, number];
/** A closed ring of [lon,lat] vertices. */
export type TifRing = LonLat[];
/** A polygon: ring 0 is the outer boundary, rings 1..n are holes. */
export type TifPolygon = TifRing[];
/** [minLon, minLat, maxLon, maxLat]. */
export type TifBbox = [number, number, number, number];

// Global equirectangular projection to metres, referenced at Chicago's
// latitude. Because every coordinate uses the SAME reference, projected metres
// are consistent across districts, so a single grid's cell keys align. The
// small equirectangular error is negligible at the ~60 m adjacency scale.
const REF_LAT = 41.85;
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos((REF_LAT * Math.PI) / 180);

function toMeters(p: LonLat): [number, number] {
  return [p[0] * M_PER_DEG_LON, p[1] * M_PER_DEG_LAT];
}

/** Bounding box over one or more polygons (their outer + hole rings). */
export function tifBbox(polygons: readonly TifPolygon[]): TifBbox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

/** True when two bboxes overlap (touching counts). */
function bboxOverlap(a: TifBbox, b: TifBbox): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/** Ray-cast point-in-ring test. `ring` is [lon,lat] pairs. */
function pointInRing(lon: number, lat: number, ring: TifRing): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Point-in-(multi)polygon: inside any polygon's outer ring and NOT inside one
 * of that polygon's holes. Mirrors scripts/export-vacancy-index.ts's
 * pointInMultiPolygon.
 */
export function pointInTifPolygons(lon: number, lat: number, polygons: readonly TifPolygon[]): boolean {
  for (const polygon of polygons) {
    if (polygon.length === 0) continue;
    if (!pointInRing(lon, lat, polygon[0])) continue;
    let inHole = false;
    for (let h = 1; h < polygon.length; h++) {
      if (pointInRing(lon, lat, polygon[h])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/** Squared distance from point p to segment a→b (all in metres). */
function pointSegDist2M(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  const ex = p[0] - cx;
  const ey = p[1] - cy;
  return ex * ex + ey * ey;
}

function orient(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: [number, number], b: [number, number], p: [number, number]): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}

/** True when segment a1→a2 intersects b1→b2 (proper crossing or collinear
 * touch). Points in metres. */
function segmentsIntersect(
  a1: [number, number],
  a2: [number, number],
  b1: [number, number],
  b2: [number, number],
): boolean {
  const d1 = orient(b1, b2, a1);
  const d2 = orient(b1, b2, a2);
  const d3 = orient(a1, a2, b1);
  const d4 = orient(a1, a2, b2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (d1 === 0 && onSegment(b1, b2, a1)) return true;
  if (d2 === 0 && onSegment(b1, b2, a2)) return true;
  if (d3 === 0 && onSegment(a1, a2, b1)) return true;
  if (d4 === 0 && onSegment(a1, a2, b2)) return true;
  return false;
}

/** Minimum distance in metres between two segments (0 when they intersect). */
function segSegDistM(
  a1: [number, number],
  a2: [number, number],
  b1: [number, number],
  b2: [number, number],
): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  const d = Math.min(
    pointSegDist2M(a1, b1, b2),
    pointSegDist2M(a2, b1, b2),
    pointSegDist2M(b1, a1, a2),
    pointSegDist2M(b2, a1, a2),
  );
  return Math.sqrt(d);
}

// ── Contiguity graph (pure) ────────────────────────────────────────────────

/** One district fed to computeTifContiguity — its number and multipolygon. */
export interface TifContiguityInput {
  number: string;
  polygons: readonly TifPolygon[];
}

/** A district's boundary segments (projected to metres) plus a grid mapping a
 * cell key to the segments overlapping it, for the bbox-prefiltered pair scan. */
interface SegmentIndex {
  number: string;
  bbox: TifBbox;
  segments: Array<[[number, number], [number, number]]>;
  grid: Map<string, number[]>;
}

const DEFAULT_TOUCH_METERS = 1; // sub-metre closest approach ⇒ shared boundary
const DEFAULT_NEAR_METERS = 60; // ROW width upper bound

function buildSegmentIndex(input: TifContiguityInput, cellMeters: number): SegmentIndex {
  const segments: Array<[[number, number], [number, number]]> = [];
  for (const polygon of input.polygons) {
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        segments.push([toMeters(ring[j]), toMeters(ring[i])]);
      }
    }
  }
  const grid = new Map<string, number[]>();
  segments.forEach((seg, idx) => {
    const minX = Math.min(seg[0][0], seg[1][0]);
    const maxX = Math.max(seg[0][0], seg[1][0]);
    const minY = Math.min(seg[0][1], seg[1][1]);
    const maxY = Math.max(seg[0][1], seg[1][1]);
    const c0 = Math.floor(minX / cellMeters);
    const c1 = Math.floor(maxX / cellMeters);
    const r0 = Math.floor(minY / cellMeters);
    const r1 = Math.floor(maxY / cellMeters);
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const key = `${c}:${r}`;
        const arr = grid.get(key);
        if (arr) arr.push(idx);
        else grid.set(key, [idx]);
      }
    }
  });
  return { number: input.number, bbox: tifBbox(input.polygons), segments, grid };
}

/** Minimum boundary distance in metres between two indexed districts, using
 * `b`'s grid to restrict the pairwise segment tests (a's segment vs b's
 * segments in the 3×3 cell neighbourhood it covers). Early-exits at `stopAtM`. */
function minBoundaryDistanceM(a: SegmentIndex, b: SegmentIndex, cellMeters: number, stopAtM: number): number {
  let best = Infinity;
  for (const s of a.segments) {
    const minX = Math.min(s[0][0], s[1][0]);
    const maxX = Math.max(s[0][0], s[1][0]);
    const minY = Math.min(s[0][1], s[1][1]);
    const maxY = Math.max(s[0][1], s[1][1]);
    const c0 = Math.floor(minX / cellMeters) - 1;
    const c1 = Math.floor(maxX / cellMeters) + 1;
    const r0 = Math.floor(minY / cellMeters) - 1;
    const r1 = Math.floor(maxY / cellMeters) + 1;
    const seen = new Set<number>();
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const arr = b.grid.get(`${c}:${r}`);
        if (!arr) continue;
        for (const idx of arr) {
          if (seen.has(idx)) continue;
          seen.add(idx);
          const t = b.segments[idx];
          const d = segSegDistM(s[0], s[1], t[0], t[1]);
          if (d < best) best = d;
          if (best <= stopAtM) return best;
        }
      }
    }
  }
  return best;
}

/**
 * Pairwise contiguity over the districts. Two labeled relations: `touching`
 * (closest boundary approach ≤ touchMeters, i.e. a shared edge / 0 distance)
 * and `near` (≤ nearMeters, capturing a public-way separation). A bbox
 * prefilter (expanded by nearMeters) skips distant pairs; a per-district
 * segment grid (cell ≈ nearMeters) restricts the surviving pairs' segment
 * tests — the same grid-bucketed style as lib/vacancy-index.ts's clustering,
 * no turf.
 *
 * Deterministic: pairs are scanned in input order and each neighbor list is
 * canonically sorted by number, so a shuffled input yields an identical graph.
 */
export function computeTifContiguity(
  inputs: readonly TifContiguityInput[],
  opts: { touchMeters?: number; nearMeters?: number } = {},
): Map<string, TifNeighbor[]> {
  const touchMeters = opts.touchMeters ?? DEFAULT_TOUCH_METERS;
  const nearMeters = opts.nearMeters ?? DEFAULT_NEAR_METERS;
  const cellMeters = nearMeters;

  const indices = inputs.map((input) => buildSegmentIndex(input, cellMeters));
  const neighbors = new Map<string, TifNeighbor[]>();
  for (const idx of indices) neighbors.set(idx.number, []);

  const padLon = nearMeters / M_PER_DEG_LON;
  const padLat = nearMeters / M_PER_DEG_LAT;

  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      const a = indices[i];
      const b = indices[j];
      if (a.number === b.number) continue;
      // bbox prefilter, a expanded by the near threshold on each side.
      const expanded: TifBbox = [a.bbox[0] - padLon, a.bbox[1] - padLat, a.bbox[2] + padLon, a.bbox[3] + padLat];
      if (!bboxOverlap(expanded, b.bbox)) continue;
      const d = minBoundaryDistanceM(a, b, cellMeters, touchMeters);
      if (d > nearMeters) continue;
      const relation: TifRelation = d <= touchMeters ? "touching" : "near";
      neighbors.get(a.number)!.push({ number: b.number, relation });
      neighbors.get(b.number)!.push({ number: a.number, relation });
    }
  }

  for (const list of neighbors.values()) {
    list.sort((x, y) => compareTifNumbers(x.number, y.number));
  }
  return neighbors;
}

// ── ZIP membership (pure) ──────────────────────────────────────────────────

/**
 * True when a district's polygon intersects a ZIP edition boundary (given as
 * one or more outer rings). Tests, cheapest first: bbox overlap; any district
 * outer-ring vertex inside the ZIP; any ZIP-ring vertex inside the district;
 * else a boundary-crossing scan (catches a cross-overlap with no contained
 * vertex). Deterministic, no deps.
 */
export function districtIntersectsZip(
  districtPolygons: readonly TifPolygon[],
  zipRings: readonly TifRing[],
): boolean {
  if (zipRings.length === 0 || districtPolygons.length === 0) return false;
  const zipPolygons: TifPolygon[] = zipRings.map((ring) => [ring]);
  const dBbox = tifBbox(districtPolygons);
  const zBbox = tifBbox(zipPolygons);
  if (!bboxOverlap(dBbox, zBbox)) return false;

  // A district outer-ring vertex inside the ZIP.
  for (const polygon of districtPolygons) {
    const outer = polygon[0];
    if (!outer) continue;
    for (const [lon, lat] of outer) {
      if (pointInTifPolygons(lon, lat, zipPolygons)) return true;
    }
  }
  // A ZIP-ring vertex inside the district.
  for (const ring of zipRings) {
    for (const [lon, lat] of ring) {
      if (pointInTifPolygons(lon, lat, districtPolygons)) return true;
    }
  }
  // Boundary crossing with no contained vertex (rare cross-overlap).
  for (const polygon of districtPolygons) {
    const outer = polygon[0];
    if (!outer) continue;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const a1 = toMeters(outer[j]);
      const a2 = toMeters(outer[i]);
      for (const ring of zipRings) {
        for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
          if (segmentsIntersect(a1, a2, toMeters(ring[l]), toMeters(ring[k]))) return true;
        }
      }
    }
  }
  return false;
}

/** Count how many of `points` fall inside a district's polygon (PIP). Points
 * are {lat, lon}. An honest zero when none land inside. */
export function countPointsInDistrict(
  points: readonly { lat: number; lon: number }[],
  districtPolygons: readonly TifPolygon[],
): number {
  const bbox = tifBbox(districtPolygons);
  let n = 0;
  for (const p of points) {
    if (p.lon < bbox[0] || p.lon > bbox[2] || p.lat < bbox[1] || p.lat > bbox[3]) continue;
    if (pointInTifPolygons(p.lon, p.lat, districtPolygons)) n += 1;
  }
  return n;
}

// ── Finance join (pure) ────────────────────────────────────────────────────

/** One TIF annual-report row after string parsing (network-free input). */
export interface TifAnnualReportRow {
  tifNumber: string;
  reportYear: number;
  fundBalance: number | null;
  taxAllocationFundBalance: number | null;
  incrementCurrent: number | null;
  surplusDistributed: number | null;
}

/**
 * Build number -> latest-year finance. Rows are grouped by NORMALIZED tif
 * number; the row with the greatest reportYear wins (ties keep the first seen,
 * which is deterministic given a stable input order). Rows with an unusable
 * (blank) number are dropped. Pure — unit-tested without a network call.
 */
export function latestFinanceByTif(rows: readonly TifAnnualReportRow[]): Map<string, TifFinance> {
  const out = new Map<string, TifFinance>();
  for (const row of rows) {
    const number = normalizeTifNumber(row.tifNumber);
    if (!number) continue;
    const existing = out.get(number);
    if (existing && existing.reportYear >= row.reportYear) continue;
    out.set(number, {
      reportYear: row.reportYear,
      fundBalance: row.fundBalance,
      taxAllocationFundBalance: row.taxAllocationFundBalance,
      incrementCurrent: row.incrementCurrent,
      surplusDistributed: row.surplusDistributed,
    });
  }
  return out;
}

// ── Projections aggregation (pure) ─────────────────────────────────────────

/** One DPD-projections line item after string parsing (network-free input).
 * `years` is the ten `_2025.._2034` columns in order; any blank/unparseable
 * cell is null and contributes 0 to the aggregate. */
export interface TifProjectionRow {
  tifNumber: string;
  categoryDescription: string;
  fundAndProjectBalances: number | null;
  years: (number | null)[];
  throughEndDate: number | null;
}

/** Coerce a nullable figure to 0 for summation — an absent line-item cell adds
 * nothing to its category total (it never becomes a fabricated value). */
function sumTerm(v: number | null): number {
  return v == null ? 0 : v;
}

/**
 * Build number -> programming outlook from the projections line items. Rows are
 * grouped by NORMALIZED tif number; within a district, each row's total
 * (`fundAndProjectBalances + Σ(years) + throughEndDate`) is added to its
 * `categoryDescription` bucket VERBATIM (the source category name is never
 * normalized). Category keys are inserted in canonical (sorted) order so the
 * serialized JSON is byte-stable. Rows with an unusable number or a blank
 * category are dropped. A district with no rows never appears (the caller stores
 * `null` for it). Pure — unit-tested without a network call.
 */
export function projectionsByTif(rows: readonly TifProjectionRow[]): Map<string, TifProjections> {
  const byNumber = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const number = normalizeTifNumber(row.tifNumber);
    if (!number) continue;
    const category = row.categoryDescription?.trim();
    if (!category) continue;
    const rowTotal =
      sumTerm(row.fundAndProjectBalances) +
      row.years.reduce<number>((acc, y) => acc + sumTerm(y), 0) +
      sumTerm(row.throughEndDate);
    let cats = byNumber.get(number);
    if (!cats) {
      cats = new Map<string, number>();
      byNumber.set(number, cats);
    }
    cats.set(category, (cats.get(category) ?? 0) + rowTotal);
  }

  const out = new Map<string, TifProjections>();
  for (const [number, cats] of byNumber) {
    const categories: Record<string, number> = {};
    for (const name of [...cats.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      categories[name] = cats.get(name)!;
    }
    out.set(number, {
      publishedDate: TIF_PROJECTIONS_PUBLISHED_DATE,
      source: TIF_PROJECTIONS_SOURCE,
      categories,
    });
  }
  return out;
}

// ── View model (pure) ──────────────────────────────────────────────────────

/** The four-digit year of a YYYY-MM-DD date, or null. */
export function tifExpirationYear(date: string | null): number | null {
  if (!date) return null;
  const y = Number(date.slice(0, 4));
  return Number.isInteger(y) ? y : null;
}

/** One neighbor as rendered under a district card: its balance + expiration so
 * the porting picture is legible without a second lookup. */
export interface TifNeighborView {
  number: string;
  name: string;
  relation: TifRelation;
  fundBalance: number | null;
  expirationYear: number | null;
}

/** One district as rendered in the "TIF funding picture" section. */
export interface TifDistrictView {
  number: string;
  name: string;
  /** Statutory end date (YYYY-MM-DD) or null — drives the "Current scheduled
   * end: Dec 31, YYYY" label without re-deriving month/day. */
  expirationDate: string | null;
  expirationYear: number | null;
  /** expirationYear − currentYear (negative = already past), or null. */
  yearsToExpiration: number | null;
  sbif: boolean;
  finance: TifFinance | null;
  /** City programming outlook (DPD projections), or null. */
  projections: TifProjections | null;
  vacantSiteCount: number;
  /** Contiguous / ROW-adjacent neighbors, canonically ordered. No dollar
   * capacity or transfer direction is implied by this list. */
  neighbors: TifNeighborView[];
}

/**
 * Compose the ordered per-district view models for one ZIP (pure): the
 * districts intersecting the ZIP, sorted by vacant-site count desc (ties by
 * fund balance desc, then number), each with its neighbors resolved to their
 * balances + expirations and sorted by fund balance desc (nulls last). Returns
 * `null` when the ZIP is absent from the export or carries no districts, so the
 * page renders no section. `currentYear` drives the "expires in N years"
 * phrasing and is a parameter (not a wall-clock read) to keep this testable.
 */
export function buildTifFundingPicture(
  zip: string,
  briefs: TifBriefsExport,
  currentYear: number,
): TifDistrictView[] | null {
  const zipBrief = briefs.zips[zip];
  if (!zipBrief || zipBrief.districtNumbers.length === 0) return null;

  const views: TifDistrictView[] = [];
  for (const number of zipBrief.districtNumbers) {
    const district = briefs.districts[number];
    if (!district) continue;
    const expirationYear = tifExpirationYear(district.expirationDate);
    const neighbors: TifNeighborView[] = district.neighbors.map((n) => {
      const nd = briefs.districts[n.number];
      return {
        number: n.number,
        name: nd?.name ?? n.number,
        relation: n.relation,
        fundBalance: nd?.finance?.fundBalance ?? null,
        expirationYear: tifExpirationYear(nd?.expirationDate ?? null),
      };
    });
    neighbors.sort((a, b) => compareByBalanceDesc(a.fundBalance, b.fundBalance) || compareTifNumbers(a.number, b.number));
    views.push({
      number: district.number,
      name: district.name,
      expirationDate: district.expirationDate,
      expirationYear,
      yearsToExpiration: expirationYear != null ? expirationYear - currentYear : null,
      sbif: district.sbif,
      finance: district.finance,
      projections: district.projections ?? null,
      vacantSiteCount: zipBrief.vacantSiteCounts[number] ?? 0,
      neighbors,
    });
  }
  if (views.length === 0) return null;

  views.sort(
    (a, b) =>
      b.vacantSiteCount - a.vacantSiteCount ||
      compareByBalanceDesc(a.finance?.fundBalance ?? null, b.finance?.fundBalance ?? null) ||
      compareTifNumbers(a.number, b.number),
  );
  return views;
}

/** Sort comparator: greater balance first, nulls last, equal ⇒ 0. */
function compareByBalanceDesc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

// ── Static-only loader ─────────────────────────────────────────────────────

const TIF_BRIEFS_PATH = path.join(process.cwd(), "public/data/tif-briefs.json");

// Module-level cache, read once per process. `undefined` = not attempted;
// `null` = attempted and the file is absent/unparseable (the expected state
// until the first export is committed).
let cache: TifBriefsExport | null | undefined = undefined;

/**
 * Read and parse the committed export once per process. Static-only (no DB
 * fallback). Returns `null` when the file has not been generated yet, so
 * callers render no section rather than throwing. Mirrors loadVacancyIndex.
 */
export function loadTifBriefs(): TifBriefsExport | null {
  if (cache !== undefined) return cache;
  try {
    if (!existsSync(TIF_BRIEFS_PATH)) {
      cache = null;
      return cache;
    }
    const parsed = JSON.parse(readFileSync(TIF_BRIEFS_PATH, "utf8")) as unknown;
    cache =
      parsed && typeof parsed === "object" && "districts" in (parsed as object) && "zips" in (parsed as object)
        ? (parsed as TifBriefsExport)
        : null;
  } catch {
    cache = null;
  }
  return cache;
}
