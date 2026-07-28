/**
 * Admin-only VIEW MODES for the Community Investment map layer
 * (components/map/MapView.tsx + MapLegendPanel.tsx). Pure, client-safe helpers
 * only — this module NEVER imports `node:fs`/`node:path` and never touches the
 * DOM beyond the sessionStorage seam, so it is unit-testable in the node vitest
 * env and safe to import into the browser bundle. All deck.gl rendering itself
 * lives in MapView; this module supplies the state model + the pure data
 * transforms the deck layers are fed (arc-source join, hex weighting inputs,
 * palettes), mirroring the split between lib/community-investment-layer.ts
 * (client transforms) and MapView (imperative map wiring).
 *
 * Three modes, sessionStorage-persisted exactly like the layer toggle
 * (lib/community-investment-toggle.ts):
 *   • dots    — the existing mapbox circle layer, unchanged (the default).
 *   • arcs    — a deck.gl ArcLayer of PHILANTHROPIC grants drawn from the
 *               funder's HQ (data/curated/foundation-hqs.csv, served through the
 *               gated API) to the recipient point. Philanthropic grants whose
 *               funder has no HQ row fall back to dots and are counted.
 *   • density — a deck.gl HexagonLayer over ALL point records weighted by
 *               amountAwarded (null → 0), 250m bins, 2D (elevation off).
 */

import type { InvestmentPointFeature } from "./community-investment-layer";
import type { FunderType } from "./community-investment";

// ── View-mode state model ────────────────────────────────────────────────────

/** The three view modes, in control order. `dots` first (the unchanged default). */
export const INVESTMENT_VIEW_MODES = ["dots", "arcs", "density"] as const;
export type InvestmentViewMode = (typeof INVESTMENT_VIEW_MODES)[number];

export const DEFAULT_INVESTMENT_VIEW_MODE: InvestmentViewMode = "dots";

/** Human labels for the segmented control (doubles as the legend caption source). */
export const INVESTMENT_VIEW_MODE_LABELS: Record<InvestmentViewMode, string> = {
  dots: "Dots",
  arcs: "Arcs",
  density: "Density",
};

/**
 * sessionStorage key for the persisted mode. Distinct from the toggle's
 * `cie_community_investment_visible` — the mode is a second, independent UI
 * preference that must also survive the /report round-trip that remounts
 * MapView (see lib/community-investment-toggle.ts module doc).
 */
export const INVESTMENT_VIEW_MODE_STORAGE_KEY = "cie_investment_view_mode";

/** Type guard: is `value` one of the three known modes. */
export function isInvestmentViewMode(value: unknown): value is InvestmentViewMode {
  return typeof value === "string" && (INVESTMENT_VIEW_MODES as readonly string[]).includes(value);
}

/** Read the persisted mode. Default on SSR, missing/invalid key, or a blocked store. */
export function loadStoredInvestmentViewMode(): InvestmentViewMode {
  if (typeof window === "undefined") return DEFAULT_INVESTMENT_VIEW_MODE;
  try {
    const raw = window.sessionStorage.getItem(INVESTMENT_VIEW_MODE_STORAGE_KEY);
    return isInvestmentViewMode(raw) ? raw : DEFAULT_INVESTMENT_VIEW_MODE;
  } catch {
    return DEFAULT_INVESTMENT_VIEW_MODE;
  }
}

/**
 * Persist the mode. The default (`dots`) is stored as key-removal, mirroring the
 * toggle's "off = removed" convention so a fresh tab reads the unchanged default.
 */
export function storeInvestmentViewMode(mode: InvestmentViewMode): void {
  if (typeof window === "undefined") return;
  try {
    if (mode === DEFAULT_INVESTMENT_VIEW_MODE) {
      window.sessionStorage.removeItem(INVESTMENT_VIEW_MODE_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(INVESTMENT_VIEW_MODE_STORAGE_KEY, mode);
    }
  } catch {
    // Persistence is best-effort; a full/blocked store must never break the map.
  }
}

// ── Funder-HQ join (Arcs mode) ───────────────────────────────────────────────

/**
 * One foundation headquarters row from data/curated/foundation-hqs.csv, carrying
 * only the fields the arc source needs. The CSV is read server-side (the gated
 * /api/owner-file/investment route) and shipped to the client as `funderHqs` so
 * the browser never fetches a raw data-file path.
 */
export interface FunderHq {
  /** Foundation name as published (the join key against a record's funderName). */
  foundation: string;
  lat: number;
  lng: number;
}

/**
 * Parse the foundation-HQ CSV text into HQ rows. Column-positioned by the header
 * (foundation, lat, lng required; ein/street/city/state/zip ignored) so a column
 * reorder never silently mis-reads coordinates. Rows without a foundation name or
 * a finite lat/lng are skipped. Pure — the server passes in file text, keeping
 * `node:fs` out of this client-safe module. No embedded commas exist in the
 * committed file, so a plain split is sufficient; a quoted-field row is skipped
 * rather than mis-parsed.
 */
export function parseFunderHqCsv(text: string): FunderHq[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const iName = header.indexOf("foundation");
  const iLat = header.indexOf("lat");
  const iLng = header.indexOf("lng");
  if (iName === -1 || iLat === -1 || iLng === -1) return [];

  const out: FunderHq[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const foundation = (cells[iName] ?? "").trim();
    const lat = Number((cells[iLat] ?? "").trim());
    const lng = Number((cells[iLng] ?? "").trim());
    if (foundation === "" || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ foundation, lat, lng });
  }
  return out;
}

/**
 * Normalize a funder name for the HQ join: upper-case, drop every non-alphanumeric
 * character to a space, collapse whitespace, trim. "Robert R. McCormick Foundation"
 * and "Robert R McCormick Foundation" fold to the same key. Returns "" for a
 * null/blank input (an unusable key that never joins). Pure/deterministic.
 */
export function normalizeFunderNameForHqJoin(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Index HQ rows by normalized foundation name for O(1) lookup during the join.
 * The first row for a given normalized name wins (the CSV carries one row per
 * foundation, so collisions are not expected). Pure.
 */
export function indexFunderHqsByName(hqs: readonly FunderHq[]): Map<string, FunderHq> {
  const index = new Map<string, FunderHq>();
  for (const hq of hqs) {
    const key = normalizeFunderNameForHqJoin(hq.foundation);
    if (key !== "" && !index.has(key)) index.set(key, hq);
  }
  return index;
}

// ── Arc geometry ─────────────────────────────────────────────────────────────

/** Pixel width bounds for an arc (the spec's clamp). */
export const ARC_WIDTH_MIN = 1;
export const ARC_WIDTH_MAX = 8;

/**
 * Build a stroke-width scale across the ACTUAL dollar domain of the arcs being
 * drawn: sqrt(amount) normalized between the dataset min and max, mapped to
 * [1, 8] px. A raw sqrt-then-clamp saturated at 8px for every real grant (all
 * philanthropic grants exceed $64), so width carried no information. Degenerate
 * domains (one arc / all-equal amounts) render at the midpoint width.
 * Null/negative amounts count as 0. Pure/deterministic.
 */
export function makeArcWidthScale(
  amounts: readonly (number | null | undefined)[],
): (amount: number | null | undefined) => number {
  const roots = amounts.map((a) => Math.sqrt(Math.max(0, a ?? 0)));
  const lo = roots.length ? Math.min(...roots) : 0;
  const hi = roots.length ? Math.max(...roots) : 0;
  const span = hi - lo;
  if (span <= 0) return () => (ARC_WIDTH_MIN + ARC_WIDTH_MAX) / 2;
  return (amount) => {
    const v = Math.sqrt(Math.max(0, amount ?? 0));
    return ARC_WIDTH_MIN + ((v - lo) / span) * (ARC_WIDTH_MAX - ARC_WIDTH_MIN);
  };
}

/**
 * The single philanthropic green (#059669) at 80% alpha, as an RGBA tuple for
 * deck.gl. Per the "cycle-free" rule: EVERY arc uses this one color — funder
 * identity comes from the HQ tooltip, never from hue, so the map never implies a
 * per-funder color legend it does not have.
 */
export const PHILANTHROPIC_ARC_COLOR: [number, number, number, number] = [5, 150, 105, 204];

/** One rendered arc: HQ source → recipient target, plus the tooltip fields. */
export interface InvestmentArcDatum {
  id: string;
  recipient: string;
  funderName: string;
  funderType: FunderType;
  amountAwarded: number | null;
  /** [lng, lat] of the funder's HQ. */
  sourcePosition: [number, number];
  /** [lng, lat] of the recipient point. */
  targetPosition: [number, number];
  /** Clamped stroke width (px). */
  width: number;
}

export interface InvestmentArcBuild {
  /** Arcs for philanthropic grants whose funder HQ was found. */
  arcs: InvestmentArcDatum[];
  /**
   * Philanthropic grants whose funderName had NO HQ row — rendered as fallback
   * dots (never dropped) and surfaced in the legend caption.
   */
  fallbackFeatures: InvestmentPointFeature[];
  /** fallbackFeatures.length — the "N grants without a mapped funder HQ" count. */
  missingHqCount: number;
}

/**
 * Join PHILANTHROPIC point features to their funder HQ to build the arc source.
 * Non-philanthropic features are ignored entirely (Arcs mode is a philanthropic-
 * flow view). A philanthropic feature whose normalized funderName is not in the
 * HQ index falls back to a dot and is counted in `missingHqCount`; every input
 * feature is therefore either an arc or a fallback dot — none is silently lost.
 * Pure/deterministic (order-preserving).
 */
export function buildInvestmentArcData(
  features: readonly InvestmentPointFeature[],
  hqIndex: ReadonlyMap<string, FunderHq>
): InvestmentArcBuild {
  const arcs: InvestmentArcDatum[] = [];
  const fallbackFeatures: InvestmentPointFeature[] = [];
  for (const f of features) {
    const p = f.properties;
    if (p.funderType !== "philanthropic") continue;
    const key = normalizeFunderNameForHqJoin(p.funderName);
    const hq = key === "" ? undefined : hqIndex.get(key);
    if (!hq) {
      fallbackFeatures.push(f);
      continue;
    }
    arcs.push({
      id: p.id,
      recipient: p.recipient,
      funderName: p.funderName,
      funderType: p.funderType,
      amountAwarded: p.amountAwarded,
      sourcePosition: [hq.lng, hq.lat],
      targetPosition: [f.geometry.coordinates[0], f.geometry.coordinates[1]],
      width: 0, // sized in the second pass, once the full arc domain is known
    });
  }
  const widthOf = makeArcWidthScale(arcs.map((a) => a.amountAwarded));
  for (const a of arcs) a.width = widthOf(a.amountAwarded);
  return { arcs, fallbackFeatures, missingHqCount: fallbackFeatures.length };
}

// ── Density (Hexagon) palette + config ───────────────────────────────────────

/**
 * Density-mode color weight for one point feature — AWARDED dollars only
 * (amountAwarded, null → 0). Named + exported (rather than an inline lambda) so
 * a unit test can pin the invariant that the HexagonLayer weight NEVER reads
 * announcedInvestment: development records (amountAwarded null, announcedInvestment
 * in the billions) must contribute 0 to a density bin, keeping the heat map a
 * pure picture of awarded grant dollars, not announced development capital. Pure.
 */
export function densityColorWeight(f: InvestmentPointFeature): number {
  return f.properties.amountAwarded ?? 0;
}

/**
 * The two density metrics (Sol #4: give density both a dollars and a record-count
 * mode). `dollars` weights each bin by AWARDED dollars (densityColorWeight);
 * `records` weights every point equally (count of grants in the bin). Persisting
 * the choice is out of scope — it is component state on the map.
 */
export const INVESTMENT_DENSITY_METRICS = ["dollars", "records"] as const;
export type InvestmentDensityMetric = (typeof INVESTMENT_DENSITY_METRICS)[number];

export const DEFAULT_INVESTMENT_DENSITY_METRIC: InvestmentDensityMetric = "dollars";

/**
 * Records-mode density weight: EVERY point contributes 1, so a summed bin is a
 * plain count of records — a picture of grant DENSITY, not dollars. Named +
 * exported (not an inline `() => 1`) so a unit test can pin that the records
 * metric never reads a dollar field. Pure.
 */
export function densityRecordWeight(_f: InvestmentPointFeature): number {
  return 1;
}

/**
 * Pick the HexagonLayer `getColorWeight` for a density metric. `dollars` →
 * densityColorWeight (amountAwarded only — a development's announced billions
 * never heat a bin); `records` → densityRecordWeight (count). Keeping this as the
 * single selector means the map and its test agree on which weight each metric
 * uses. Pure.
 */
export function densityWeightForMetric(
  metric: InvestmentDensityMetric,
): (f: InvestmentPointFeature) => number {
  return metric === "records" ? densityRecordWeight : densityColorWeight;
}

/** Hexagon bin radius in meters (2D bins; elevation is off). */
export const HEXAGON_RADIUS_M = 250;

/**
 * 5-step SINGLE-HUE sequential ramp (light → dark) derived from the app's
 * canonical accent blue (#2563EB — "Warm Bureau" accent, LEVEL_COLORS). One hue
 * only, per the sequential-palette rule: density encodes a MAGNITUDE ($ awarded
 * per bin), not a category, so it must not cycle through funder-type hues. Used
 * for both the deck HexagonLayer colorRange and the legend's mini ramp, so the
 * two can never drift.
 */
export const DENSITY_RAMP_HEXES: readonly string[] = [
  "#DBEAFE", // blue-100
  "#93C5FD", // blue-300
  "#60A5FA", // blue-400
  "#2563EB", // blue-600 (app accent)
  "#1E3A8A", // blue-900
];

/** Parse "#RRGGBB" into an [r, g, b] tuple (0–255). Pure. */
export function hexToRgbArray(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** The density ramp as deck.gl RGB color stops (light → dark). */
export const DENSITY_COLOR_RANGE: [number, number, number][] = DENSITY_RAMP_HEXES.map(hexToRgbArray);
