import { jsPDF, GState } from "jspdf";
import { createSanitizedDoc, sanitizeForPdf } from "./pdf-report";
import {
  OWNER_TYPE_COLORS,
  OWNER_TYPE_LABELS,
  OWNER_TYPE_ORDER,
  normalizeOwnerType,
  type OwnerType,
} from "./owner-classify";

/**
 * Vacancy Opportunity Index — the shareable, anonymized per-neighborhood PDF.
 * Swiss/survey-instrument identity: helvetica-bold display type (faux-condensed
 * via horizontalScale + fillThenStroke at large sizes, no font embedding) over
 * courier mono captions, INK on PAPER with three accent colors used only where
 * the plan permits. Five sheets: COVER, 01 Executive Brief, 02 System Overview,
 * 03 Property Network Map, 04 Site Index.
 *
 * Two-tier builder convention (lib/pdf-report.ts / lib/owner-file-pdf.ts):
 * `_buildVacancyIndexPdf` -> `generateVacancyIndexPdf` (client `.save()`) /
 * `generateVacancyIndexPdfBase64` (server base64). Pure/synchronous — no network
 * or DB — so it stays safe to import from a client component. Geometry helpers
 * are duplicated locally per the owner-file-pdf.ts precedent (deliberately not
 * shared out of pdf-report.ts, whose helpers are module-private).
 *
 * Honesty rails: no fabricated projections or scores; nulls print
 * "NOT YET AVAILABLE" / "PENDING" / "N/A" / "—" (never a silent zero); the
 * litigated verification disclaimer sits in every footer; the anonymization
 * boundary (owner TYPE only, never owner names/addresses) is enforced upstream
 * at the export SELECT — this builder only ever receives owner-type buckets.
 */

/* ── Input contract (meets the export adapter in lib/vacancy-index.ts) ── */

export type VacancyPropertyType = "vacant_land" | "vacant_building";
export type VacancyPriorityTier = "high" | "medium" | "low";

/** Page-01 decision band. Copy is caller-supplied (fixed templates driven only
 *  by real fields upstream) — this builder never invents a projection. */
export interface VacancyIndexDecision {
  title: string;
  body: string;
}

/** One comparison-matrix cell: a within-cohort quintile dot rating (1–5) plus
 *  its printable value. `value: null` -> `dots: null` -> renders "—". */
export interface VacancyIndexMatrixCell {
  label: string;
  value: string | null;
  dots: number | null;
}

export interface VacancyIndexMatrixRow {
  area: string;
  zip: string;
  isSubject: boolean;
  cells: VacancyIndexMatrixCell[]; // exactly 5, in the fixed metric order
}

export interface VacancyIndexSitePoint {
  lat: number;
  lon: number;
  ownerType: string | null;
}

export interface VacancyIndexTransportLine {
  kind: "expressway" | "rail";
  points: [number, number][]; // [lon, lat][], pre-clipped to the edition bbox
}

export interface VacancyIndexTopSite {
  address: string;
  ownerType: string | null;
  propertyType: VacancyPropertyType;
  zoning: string | null;
  sqft: number | null;
  priority: VacancyPriorityTier;
  nextStep: string;
}

export interface VacancyIndexInput {
  neighborhood: string;
  zipCode: string;
  editionNumber: number;
  asOf: string;
  counts: {
    total: number;
    cityOwned: number;
    privatelyHeld: number;
    inIncentiveZones: number;
  };
  brief: string;
  decisions?: VacancyIndexDecision[]; // capped at 3
  /** COMPLETE vacant-land ownership from the parcels dataset. `null` = not yet
   *  available (renders the honesty-rail state), never an empty/zero series. */
  ownerTypeDistribution: Partial<Record<OwnerType, number>> | null;
  /** Tracked inventory (COLS + 311) — the same universe as the headline count,
   *  map dots, and site index, so these bars reconcile with everything else. */
  trackedInventoryByOwnerType: Partial<Record<OwnerType, number>>;
  propertyTypeBreakdown: { vacantLand: number; vacantBuilding: number };
  priorityDistribution: { high: number; medium: number; low: number };
  matrixRows: VacancyIndexMatrixRow[]; // 9 rows (all editions), subject flagged
  /** Pre-simplified outer boundary ring as [lon, lat][]. `null` -> the cover
   *  falls back to a dot-field silhouette built from sitePoints alone. */
  boundary: [number, number][] | null;
  centroid: { lat: number; lon: number };
  /** Priority-ordered; sitePoints[0..11] positionally align with
   *  topSites[0..11] so the map's numbered markers carry the index addresses. */
  sitePoints: VacancyIndexSitePoint[];
  transport: VacancyIndexTransportLine[];
  topSites: VacancyIndexTopSite[];
  sources: string[];
}

/* ── Palette (color discipline per the plan) ── */

const INK = "#111111";
const INK_70 = "#4B4B4B"; // secondary text
const INK_45 = "#8A8A8A"; // captions / tertiary
const INK_15 = "#D9D9D9"; // empty-dot outlines, low segments, gray fills
const PAPER = "#FFFFFF";
const SWISS_BLUE = "#2563EB"; // cover silhouette, decision numerals, subject row, footer mark ONLY
const SWISS_RED = "#DC2626"; // locator dot, HIGH segments/chips ONLY
const SWISS_YELLOW = "#EAB308"; // scale chip, subject-row tick, MEDIUM ONLY
const GRID_GRAY = "#EEF1F5"; // coordinate grid
const EXPRESSWAY_GRAY = "#C9CFDA";

/* ── Fixed geometry (letter, mm) ── */

const W = 215.9; // letter width (mm); height 279.4 is implicit in the fixed y-coordinates below
const MARGIN = 20;
const CONTENT_W = W - MARGIN * 2; // 175.9
const RIGHT = W - MARGIN; // 195.9

const TOTAL_SHEETS = "04";

/* ── Fixed copy ── */

const DISCLAIMER =
  "Informational screening only. Confirm current eligibility, timing, and approval requirements with the administering organization.";

const QUINTILE_NOTE =
  "Dot ratings rank the nine pilot editions against each other (quintiles). They are not citywide scores or grades.";

const PRIORITY_RUBRIC_NOTE =
  "Priority score = incentive count (up to 4) + size bonus (2 at 10,000+ sq ft, 1 at 5,000+, 0 if unknown) + 2 if a City/Public owner or city-owned status + 1 if a vacant building with an open 311 report. Sites rank by score, then incentive count, then size (largest first, unknowns last).";

const OWNER_CLASSIFICATION_NOTE =
  "Owner type is inferred from public taxpayer-of-record patterns and is anonymized: no owner names or mailing addresses appear in this document. Records indicate — verify before relying.";

/* ── Owner-type abbreviations for the tight site-index column ── */
const OWNER_TYPE_ABBR: Record<OwnerType, string> = {
  corporate_llc: "LLC",
  out_of_state: "OUT-OF-ST",
  local_private: "LOCAL",
  city_public: "CITY",
  unknown: "UNK",
};

/* ── Low-level drawing helpers (duplicated per owner-file-pdf.ts precedent) ── */

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function setColor(doc: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  doc.setTextColor(r, g, b);
}

function fillRect(doc: jsPDF, x: number, y: number, w: number, h: number, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  doc.setFillColor(r, g, b);
  doc.rect(x, y, w, h, "F");
}

function strokeRect(doc: jsPDF, x: number, y: number, w: number, h: number, hex: string, lineWidth = 0.3) {
  const [r, g, b] = hexToRgb(hex);
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(lineWidth);
  doc.rect(x, y, w, h, "S");
}

function hLine(doc: jsPDF, x1: number, x2: number, y: number, hex = INK, lineWidth = 0.2) {
  const [r, g, b] = hexToRgb(hex);
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(lineWidth);
  doc.line(x1, y, x2, y);
}

function fillCircle(doc: jsPDF, x: number, y: number, r: number, hex: string) {
  const [rr, gg, bb] = hexToRgb(hex);
  doc.setFillColor(rr, gg, bb);
  doc.circle(x, y, r, "F");
}

function strokeCircle(doc: jsPDF, x: number, y: number, r: number, hex: string, lineWidth = 0.2) {
  const [rr, gg, bb] = hexToRgb(hex);
  doc.setDrawColor(rr, gg, bb);
  doc.setLineWidth(lineWidth);
  doc.circle(x, y, r, "S");
}

/** Wrap to width, cap at maxLines, ellipsize the last visible line. */
function fit(doc: jsPDF, text: string, width: number, maxLines: number): string[] {
  const lines = doc.splitTextToSize(sanitizeForPdf(text), width) as string[];
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] = `${visible[maxLines - 1].replace(/\.{0,3}$/, "")}...`;
  return visible;
}

/** Single line, hard-clamped to width with an ellipsis. */
function clampLine(doc: jsPDF, text: string, width: number): string {
  return fit(doc, text, width, 1)[0] ?? "";
}

/** Display type: helvetica bold + horizontalScale; fillThenStroke faux-bold at
 *  >=30pt only (the plan's condensed-identity trick, 0KB). */
function displayText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  sizePt: number,
  hScale: number,
  color: string
) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(sizePt);
  setColor(doc, color);
  if (sizePt >= 30) {
    const [r, g, b] = hexToRgb(color);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.25);
    doc.text(text, x, y, { horizontalScale: hScale, renderingMode: "fillThenStroke" });
  } else {
    doc.text(text, x, y, { horizontalScale: hScale });
  }
}

/** Right-align horizontally-scaled text: measure width * scale manually rather
 *  than trusting {align:"right"} with a non-1 horizontalScale (plan gotcha). */
function displayTextRight(
  doc: jsPDF,
  text: string,
  rightX: number,
  y: number,
  sizePt: number,
  hScale: number,
  color: string
) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(sizePt);
  const width = doc.getTextWidth(text) * hScale;
  displayText(doc, text, rightX - width, y, sizePt, hScale, color);
}

/** Courier eyebrow: bold mono, uppercased, with charSpace tracking (mm). */
function eyebrow(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  sizePt: number,
  color: string,
  charSpace = 0.5
) {
  doc.setFont("courier", "bold");
  doc.setFontSize(sizePt);
  setColor(doc, color);
  doc.text(text.toUpperCase(), x, y, { charSpace });
  doc.setCharSpace(0);
}

/* ── Map projection: equirectangular with cos(midLat) correction, y flipped ── */

interface Projection {
  project: (lon: number, lat: number) => [number, number];
  unproject: (px: number, py: number) => [number, number];
  metersPerMm: number;
}

function computeBbox(points: [number, number][], padFraction = 0.06): [number, number, number, number] {
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  // Degenerate/empty fallback centered on Chicago.
  if (!Number.isFinite(minLon)) return [-87.72, 41.72, -87.52, 41.82];
  const lonPad = Math.max((maxLon - minLon) * padFraction, 0.002);
  const latPad = Math.max((maxLat - minLat) * padFraction, 0.002);
  return [minLon - lonPad, minLat - latPad, maxLon + lonPad, maxLat + latPad];
}

function makeProjection(
  bbox: [number, number, number, number],
  panel: { x: number; y: number; w: number; h: number }
): Projection {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180); // longitude compression
  const geoW = Math.max((maxLon - minLon) * kx, 1e-6);
  const geoH = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min(panel.w / geoW, panel.h / geoH); // mm per corrected degree
  const drawW = geoW * scale;
  const drawH = geoH * scale;
  const offX = panel.x + (panel.w - drawW) / 2;
  const offY = panel.y + (panel.h - drawH) / 2;
  const project = (lon: number, lat: number): [number, number] => [
    offX + (lon - minLon) * kx * scale,
    offY + (maxLat - lat) * scale, // y flipped: north up
  ];
  const unproject = (px: number, py: number): [number, number] => [
    minLon + (px - offX) / (kx * scale),
    maxLat - (py - offY) / scale,
  ];
  const metersPerMm = 111320 / scale; // 1 deg latitude ~= 111,320 m
  return { project, unproject, metersPerMm };
}

/** Absolute ring points -> jsPDF `lines` deltas (relative to the previous point). */
function ringToDeltas(points: [number, number][]): [number, number][] {
  const deltas: [number, number][] = [];
  for (let i = 1; i < points.length; i++) {
    deltas.push([points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]]);
  }
  return deltas;
}

function drawCoordinateGrid(
  doc: jsPDF,
  panel: { x: number; y: number; w: number; h: number },
  proj: Projection
) {
  const pitch = 8;
  const [rr, gg, bb] = hexToRgb(GRID_GRAY);
  doc.setDrawColor(rr, gg, bb);
  doc.setLineWidth(0.1);
  for (let gx = panel.x; gx <= panel.x + panel.w + 0.01; gx += pitch) {
    doc.line(gx, panel.y, gx, panel.y + panel.h);
  }
  for (let gy = panel.y; gy <= panel.y + panel.h + 0.01; gy += pitch) {
    doc.line(panel.x, gy, panel.x + panel.w, gy);
  }
  // Corner crosshairs.
  const ch = 3;
  const corners: [number, number][] = [
    [panel.x, panel.y],
    [panel.x + panel.w, panel.y],
    [panel.x, panel.y + panel.h],
    [panel.x + panel.w, panel.y + panel.h],
  ];
  const [ir, ig, ib] = hexToRgb(INK_45);
  doc.setDrawColor(ir, ig, ib);
  doc.setLineWidth(0.2);
  for (const [cx, cy] of corners) {
    doc.line(cx - ch, cy, cx + ch, cy);
    doc.line(cx, cy - ch, cx, cy + ch);
  }
  // Real lon/lat tick labels at the quarter grid lines (inverse projection).
  doc.setFont("courier", "normal");
  doc.setFontSize(5);
  setColor(doc, INK_45);
  for (let f = 0.25; f <= 0.751; f += 0.25) {
    const gx = panel.x + panel.w * f;
    const [lon] = proj.unproject(gx, panel.y + panel.h);
    doc.text(lon.toFixed(3), gx, panel.y + panel.h + 3.2, { align: "center" });
    const gy = panel.y + panel.h * f;
    const [, lat] = proj.unproject(panel.x, gy);
    doc.text(lat.toFixed(3), panel.x - 1.5, gy + 1, { align: "right" });
  }
}

function drawScaleBar(doc: jsPDF, x: number, y: number, metersPerMm: number, chipHex = SWISS_YELLOW) {
  // Choose a "nice" metric length that renders 12–30mm wide.
  const targets = [100, 200, 250, 500, 1000, 2000];
  let meters = targets[0];
  for (const t of targets) {
    const mm = t / metersPerMm;
    if (mm >= 12 && mm <= 30) {
      meters = t;
      break;
    }
    meters = t;
  }
  const barMm = meters / metersPerMm;
  fillRect(doc, x, y, barMm, 1.4, chipHex);
  fillRect(doc, x, y, barMm / 2, 1.4, INK);
  doc.setFont("courier", "normal");
  doc.setFontSize(5.5);
  setColor(doc, INK);
  const label = meters >= 1000 ? `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 1)} KM` : `${meters} M`;
  doc.text(label, x, y - 1.2);
}

function drawNorthArrow(doc: jsPDF, x: number, y: number) {
  fillTriangle(doc, x, y - 3.4, x - 1.6, y + 1.2, x + 1.6, y + 1.2, INK);
  doc.setFont("courier", "bold");
  doc.setFontSize(6);
  setColor(doc, INK);
  doc.text("N", x, y + 4.6, { align: "center" });
}

function fillTriangle(
  doc: jsPDF,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  hex: string
) {
  const [r, g, b] = hexToRgb(hex);
  doc.setFillColor(r, g, b);
  doc.triangle(x1, y1, x2, y2, x3, y3, "F");
}

/* ── Micro-components ── */

/** Quintile dot rating (1–5). Filled dots for `value`, stroked outlines for the
 *  rest; `value == null` prints a single em-dash instead. */
function drawDotRating(doc: jsPDF, x: number, y: number, value: number | null, fillHex: string) {
  const pitch = 3.2;
  const r = 1.1;
  if (value == null) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(doc, INK_45);
    doc.text("-", x + pitch * 2, y + 0.6, { align: "center" });
    return;
  }
  const clamped = Math.max(0, Math.min(5, Math.round(value)));
  for (let i = 0; i < 5; i++) {
    const cx = x + i * pitch + r;
    if (i < clamped) fillCircle(doc, cx, y, r, fillHex);
    else strokeCircle(doc, cx, y, r, INK_15, 0.2);
  }
}

/** Priority chip 10x4mm: HIGH red-filled/white, MED yellow-filled/ink, LOW stroked. */
function drawPriorityChip(doc: jsPDF, x: number, y: number, tier: VacancyPriorityTier) {
  const w = 10;
  const h = 4;
  const label = tier.toUpperCase();
  if (tier === "high") {
    fillRect(doc, x, y, w, h, SWISS_RED);
    setColor(doc, PAPER);
  } else if (tier === "medium") {
    fillRect(doc, x, y, w, h, SWISS_YELLOW);
    setColor(doc, INK);
  } else {
    strokeRect(doc, x, y, w, h, INK_45, 0.25);
    setColor(doc, INK_70);
  }
  doc.setFont("courier", "bold");
  doc.setFontSize(5.4);
  doc.text(tier === "medium" ? "MED" : label, x + w / 2, y + 2.7, { align: "center" });
}

/** Segmented bar: HIGH red / MEDIUM yellow / LOW gray, paper gaps, count labels;
 *  labels fold to a legend line when a segment is narrower than 22mm. */
function drawSegmentedBar(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  dist: { high: number; medium: number; low: number }
): number {
  const total = dist.high + dist.medium + dist.low;
  const segs: { key: string; count: number; hex: string; textHex: string }[] = [
    { key: "HIGH", count: dist.high, hex: SWISS_RED, textHex: PAPER },
    { key: "MEDIUM", count: dist.medium, hex: SWISS_YELLOW, textHex: INK },
    { key: "LOW", count: dist.low, hex: INK_15, textHex: INK_70 },
  ];
  const barH = 9;
  const gap = 0.6;
  const legendParts: string[] = [];
  if (total === 0) {
    strokeRect(doc, x, y, width, barH, INK_15, 0.3);
    doc.setFont("courier", "normal");
    doc.setFontSize(6);
    setColor(doc, INK_45);
    doc.text("NO PRIORITY DATA", x + width / 2, y + barH / 2 + 1, { align: "center" });
    return y + barH + 6;
  }
  let cx = x;
  const active = segs.filter((s) => s.count > 0);
  const totalGap = gap * Math.max(0, active.length - 1);
  const usable = width - totalGap;
  active.forEach((s) => {
    const segW = (s.count / total) * usable;
    fillRect(doc, cx, y, segW, barH, s.hex);
    const pct = Math.round((s.count / total) * 100);
    if (segW >= 22) {
      doc.setFont("courier", "bold");
      doc.setFontSize(6);
      setColor(doc, s.textHex);
      doc.text(`${s.key} ${s.count}`, cx + 1.6, y + 3.6);
      doc.setFont("courier", "normal");
      doc.setFontSize(5.6);
      doc.text(`${pct}%`, cx + 1.6, y + 6.6);
    } else {
      legendParts.push(`${s.key} ${s.count} (${pct}%)`);
    }
    cx += segW + gap;
  });
  let ny = y + barH + 4;
  if (legendParts.length > 0) {
    doc.setFont("courier", "normal");
    doc.setFontSize(5.6);
    setColor(doc, INK_45);
    doc.text(legendParts.join("   "), x, ny);
    ny += 4;
  }
  return ny;
}

/** Horizontal INK bar for an owner-type count over a fixed scale. Bars stay INK
 *  (only the 2mm swatch carries the owner-type color) to keep it Swiss. */
function drawOwnershipBars(
  doc: jsPDF,
  x: number,
  y: number,
  barMaxW: number,
  counts: Partial<Record<OwnerType, number>>
): number {
  const values = OWNER_TYPE_ORDER.map((t) => counts[t] ?? 0);
  const max = Math.max(1, ...values);
  const rowH = 8;
  let ry = y;
  OWNER_TYPE_ORDER.forEach((type, i) => {
    const count = values[i];
    // 2mm color swatch (the only owner-type color on this sheet).
    fillRect(doc, x, ry - 2.2, 2, 2, OWNER_TYPE_COLORS[type]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setColor(doc, INK);
    doc.text(clampLine(doc, OWNER_TYPE_LABELS[type], 34), x + 3.4, ry);
    const barX = x + 40;
    const barW = (count / max) * barMaxW;
    if (count > 0) fillRect(doc, barX, ry - 2.6, Math.max(0.6, barW), 2.6, INK); // no zero-width tick
    doc.setFont("courier", "bold");
    doc.setFontSize(7);
    setColor(doc, INK);
    doc.text(String(count), barX + barMaxW + 2, ry);
    ry += rowH;
  });
  return ry;
}

/** Hollow "data pending" chip + NOT YET AVAILABLE label. */
function drawPendingChip(doc: jsPDF, x: number, y: number, w: number, label: string) {
  const h = 11;
  strokeRect(doc, x, y, w, h, INK_15, 0.3);
  doc.setFont("courier", "bold");
  doc.setFontSize(6);
  setColor(doc, INK_70);
  doc.text(clampLine(doc, label.toUpperCase(), w - 4), x + 2, y + 4.4);
  doc.setFont("courier", "normal");
  doc.setFontSize(5.6);
  setColor(doc, INK_45);
  doc.text("NOT YET AVAILABLE", x + 2, y + 8.4);
}

/* ── Page furniture ── */

function drawSwissHeader(doc: jsPDF, neighborhood: string, sheetNumber: number, sectionEyebrow: string) {
  const numeral = String(sheetNumber).padStart(2, "0");
  // Running title (tiny courier, top-left).
  doc.setFont("courier", "normal");
  doc.setFontSize(6.5);
  setColor(doc, INK_45);
  doc.text(clampLine(doc, `VACANCY OPPORTUNITY INDEX — ${neighborhood.toUpperCase()}`, 120), MARGIN, 11);
  // Big sheet numeral (top-right, faux-condensed, manually right-aligned).
  displayTextRight(doc, numeral, RIGHT, 30, 40, 0.85, INK);
  // Ink eyebrow bar + section eyebrow (left).
  fillRect(doc, MARGIN, 20, 30, 1.5, INK);
  eyebrow(doc, sectionEyebrow, MARGIN, 28, 7.5, INK, 0.5);
  // Header hairline.
  hLine(doc, MARGIN, RIGHT, 34, INK, 0.2);
}

function drawSwissFooter(doc: jsPDF, sheetNumber: number, sources: string[], asOf: string) {
  hLine(doc, MARGIN, RIGHT, 261, INK, 0.2);
  // Sources + as-of (left) with room reserved for the blue sheet mark (right).
  doc.setFont("courier", "normal");
  doc.setFontSize(6);
  setColor(doc, INK_45);
  const srcLine = `SOURCES: ${sources.join(" · ")}  ·  AS OF ${asOf}`;
  doc.text(clampLine(doc, srcLine, CONTENT_W - 28), MARGIN, 265);
  // Blue sheet mark (right).
  doc.setFont("courier", "bold");
  doc.setFontSize(7);
  setColor(doc, SWISS_BLUE);
  const mark = `${String(sheetNumber).padStart(2, "0")} / ${TOTAL_SHEETS}`;
  doc.text(mark, RIGHT, 265, { align: "right" });
  // Litigated verification disclaimer.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  setColor(doc, INK_45);
  doc.text(clampLine(doc, DISCLAIMER, CONTENT_W), MARGIN, 270);
}

/* ── Sheet: COVER ── */

function drawCover(doc: jsPDF, input: VacancyIndexInput) {
  const { neighborhood, zipCode, editionNumber, asOf } = input;

  // Chamber / survey-doc header lines.
  eyebrow(doc, "SOUTHEAST CHICAGO CHAMBER OF COMMERCE — INCENTIVE EXPLORER", MARGIN, 24, 7, INK, 0.4);
  doc.setFont("courier", "normal");
  doc.setFontSize(6.5);
  setColor(doc, INK_45);
  doc.text(
    `VACANCY SURVEY  ·  EDITION ${String(editionNumber).padStart(2, "0")} OF 09  ·  ZIP ${zipCode}`,
    MARGIN,
    28.5
  );
  hLine(doc, MARGIN, RIGHT, 33, INK, 0.2);

  // Stacked display title (54pt, faux-condensed) + red locator square.
  displayText(doc, "VACANCY", MARGIN, 52, 54, 0.82, INK);
  displayText(doc, "OPPORTUNITY", MARGIN, 69, 54, 0.82, INK);
  displayText(doc, "INDEX", MARGIN, 86, 54, 0.82, INK);
  const indexW = doc.getTextWidth("INDEX") * 0.82;
  doc.setFontSize(54);
  fillRect(doc, MARGIN + indexW + 4, 82, 3, 3, SWISS_RED);

  // Neighborhood subtitle.
  doc.setFont("courier", "bold");
  doc.setFontSize(10);
  setColor(doc, SWISS_BLUE);
  doc.text(clampLine(doc, `${neighborhood.toUpperCase()} — ZIP ${zipCode}`, CONTENT_W), MARGIN, 95);

  // Map panel (the vacancy footprint IS the shape).
  const panel = { x: MARGIN, y: 100, w: CONTENT_W, h: 126 };
  strokeRect(doc, panel.x, panel.y, panel.w, panel.h, INK, 0.4);
  drawCoverMap(doc, input, panel);

  // Metadata band.
  const bandY = 234;
  hLine(doc, MARGIN, RIGHT, bandY - 4, INK, 0.2);
  const cols: [string, string][] = [
    ["DATE", asOf],
    ["EDITION", `${String(editionNumber).padStart(2, "0")} / 09`],
    ["PREPARED BY", "SECCC INCENTIVE EXPLORER"],
  ];
  const colW = CONTENT_W / 3;
  cols.forEach(([label, value], i) => {
    const cx = MARGIN + i * colW;
    doc.setFont("courier", "bold");
    doc.setFontSize(6);
    setColor(doc, INK_45);
    doc.text(label, cx, bandY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setColor(doc, INK);
    doc.text(clampLine(doc, value, colW - 4), cx, bandY + 5);
  });

  // Disclaimer (cover carries no page number).
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  setColor(doc, INK_45);
  doc.text(clampLine(doc, DISCLAIMER, CONTENT_W), MARGIN, 250);
}

function drawCoverMap(doc: jsPDF, input: VacancyIndexInput, panel: { x: number; y: number; w: number; h: number }) {
  const { boundary, sitePoints, centroid } = input;
  const ringPoints: [number, number][] =
    boundary && boundary.length >= 3 ? boundary : sitePoints.map((p) => [p.lon, p.lat]);
  const bbox = computeBbox(ringPoints);
  const proj = makeProjection(bbox, panel);
  drawCoordinateGrid(doc, panel, proj);

  if (boundary && boundary.length >= 3) {
    // Filled SWISS_BLUE ZIP-boundary polygon via lines(deltas, ..., "F", closed).
    const abs = boundary.map(([lon, lat]) => proj.project(lon, lat));
    const [br, bg, bb] = hexToRgb(SWISS_BLUE);
    doc.setFillColor(br, bg, bb);
    doc.lines(ringToDeltas(abs), abs[0][0], abs[0][1], [1, 1], "F", true);
    // Punch the parcel dot-field through as PAPER-white dots.
    for (const p of sitePoints) {
      const [px, py] = proj.project(p.lon, p.lat);
      fillCircle(doc, px, py, 0.35, PAPER);
    }
  } else {
    // Fallback: dense blue dot-field silhouette from the points alone.
    for (const p of sitePoints) {
      const [px, py] = proj.project(p.lon, p.lat);
      fillCircle(doc, px, py, 0.5, SWISS_BLUE);
    }
  }

  // Red locator dot + crosshair at the centroid.
  const [cx, cy] = proj.project(centroid.lon, centroid.lat);
  const [lr, lg, lb] = hexToRgb(SWISS_RED);
  doc.setDrawColor(lr, lg, lb);
  doc.setLineWidth(0.3);
  doc.line(cx - 4, cy, cx + 4, cy);
  doc.line(cx, cy - 4, cx, cy + 4);
  fillCircle(doc, cx, cy, 1.2, SWISS_RED);

  // Yellow scale chip.
  drawScaleBar(doc, panel.x + 4, panel.y + panel.h - 4, proj.metersPerMm, SWISS_YELLOW);
}

/* ── Sheet 01: EXECUTIVE BRIEF ── */

function drawExecutiveBrief(doc: jsPDF, input: VacancyIndexInput) {
  drawSwissHeader(doc, input.neighborhood, 1, "EXECUTIVE BRIEF");
  const { counts } = input;
  let y = 52;

  // Huge headline stat + three mini-stats to the right.
  displayText(doc, String(counts.total), MARGIN, y + 10, 64, 0.85, INK);
  doc.setFont("courier", "bold");
  doc.setFontSize(7);
  setColor(doc, INK_45);
  doc.text("TRACKED VACANT PROPERTIES", MARGIN, y + 17);

  const miniX = 118;
  const minis: [string, number][] = [
    ["CITY-OWNED", counts.cityOwned],
    ["PRIVATELY HELD", counts.privatelyHeld],
    ["IN INCENTIVE ZONES", counts.inIncentiveZones],
  ];
  let my = y - 4;
  minis.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    setColor(doc, INK);
    const text = String(value);
    doc.text(text, miniX, my, { horizontalScale: 0.85 });
    // Label keys off the measured numeral width so 4-digit stats never collide.
    const numW = doc.getTextWidth(text) * 0.85;
    doc.setFont("courier", "normal");
    doc.setFontSize(6);
    setColor(doc, INK_45);
    doc.text(label, miniX + numW + 4, my - 1.8);
    my += 12;
  });
  y += 26;

  hLine(doc, MARGIN, RIGHT, y, INK_15, 0.2);
  y += 8;

  // Executive brief (<=6 lines).
  eyebrow(doc, "BRIEF", MARGIN, y, 7, INK_45, 0.5);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, INK);
  const briefLines = fit(doc, input.brief, CONTENT_W, 6);
  briefLines.forEach((line) => {
    doc.text(line, MARGIN, y);
    y += 4.5;
  });
  y += 6;

  // Three decisions (blue numerals, hairline-separated 28mm bands).
  eyebrow(doc, "THREE DECISIONS", MARGIN, y, 7, INK_45, 0.5);
  y += 6;
  const decisions = (input.decisions ?? []).slice(0, 3);
  decisions.forEach((decision, i) => {
    const bandTop = y;
    hLine(doc, MARGIN, RIGHT, bandTop, INK_15, 0.2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    setColor(doc, SWISS_BLUE);
    doc.text(String(i + 1).padStart(2, "0"), MARGIN, bandTop + 8, { horizontalScale: 0.85 });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setColor(doc, INK);
    doc.text(clampLine(doc, decision.title, CONTENT_W - 16), MARGIN + 16, bandTop + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(doc, INK_70);
    const bodyLines = fit(doc, decision.body, CONTENT_W - 16, 2);
    let by = bandTop + 11;
    bodyLines.forEach((line) => {
      doc.text(line, MARGIN + 16, by);
      by += 4;
    });
    y = bandTop + 28;
  });

  // Priority distribution.
  y = Math.max(y, 210);
  eyebrow(doc, "PRIORITY DISTRIBUTION", MARGIN, y, 7, INK_45, 0.5);
  y += 4;
  drawSegmentedBar(doc, MARGIN, y, CONTENT_W, input.priorityDistribution);

  drawSwissFooter(doc, 1, input.sources, input.asOf);
}

/* ── Sheet 02: SYSTEM OVERVIEW ── */

function drawSystemOverview(doc: jsPDF, input: VacancyIndexInput) {
  drawSwissHeader(doc, input.neighborhood, 2, "SYSTEM OVERVIEW");
  let y = 44;

  // Ownership of tracked inventory (reconciles with the headline count).
  eyebrow(doc, "OWNERSHIP — TRACKED VACANT INVENTORY (COLS + 311)", MARGIN, y, 7, INK_45, 0.4);
  y += 6;
  y = drawOwnershipBars(doc, MARGIN, y, 90, input.trackedInventoryByOwnerType);
  y += 2;

  // Complete vacant-land ownership (all parcels) — a distinct, labeled universe.
  eyebrow(doc, "COMPLETE VACANT-LAND OWNERSHIP (ALL PARCELS)", MARGIN, y, 7, INK_45, 0.4);
  y += 5;
  if (input.ownerTypeDistribution == null) {
    drawPendingChip(doc, MARGIN, y, CONTENT_W, "PARCEL-LEVEL OWNERSHIP DATASET");
    y += 15;
  } else {
    doc.setFont("courier", "normal");
    doc.setFontSize(6.6);
    const parts = OWNER_TYPE_ORDER.map(
      (t) => `${OWNER_TYPE_ABBR[t]} ${input.ownerTypeDistribution?.[t] ?? 0}`
    );
    let px = MARGIN;
    OWNER_TYPE_ORDER.forEach((t, i) => {
      fillRect(doc, px, y - 2, 2, 2, OWNER_TYPE_COLORS[t]);
      setColor(doc, INK);
      doc.text(parts[i], px + 3, y);
      px += doc.getTextWidth(parts[i]) + 10;
    });
    y += 8;
  }
  y += 2;

  // Property-type stacked bar.
  eyebrow(doc, "PROPERTY TYPE", MARGIN, y, 7, INK_45, 0.4);
  y += 5;
  drawPropertyTypeBar(doc, MARGIN, y, CONTENT_W, input.propertyTypeBreakdown);
  y += 20;

  // Data-pending strip.
  eyebrow(doc, "DISTRESS OVERLAYS — PENDING", MARGIN, y, 7, INK_45, 0.4);
  y += 5;
  const chipW = (CONTENT_W - 8) / 2;
  drawPendingChip(doc, MARGIN, y, chipW, "DELINQUENT-TAX EXPOSURE");
  drawPendingChip(doc, MARGIN + chipW + 8, y, chipW, "CCLBA INVENTORY");
  y += 17;

  // Comparison matrix (9 rows x 5 quintile-dot metrics).
  drawComparisonMatrix(doc, input, y);

  drawSwissFooter(doc, 2, input.sources, input.asOf);
}

function drawPropertyTypeBar(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  breakdown: { vacantLand: number; vacantBuilding: number }
) {
  const total = breakdown.vacantLand + breakdown.vacantBuilding;
  const barH = 9;
  if (total === 0) {
    strokeRect(doc, x, y, width, barH, INK_15, 0.3);
    doc.setFont("courier", "normal");
    doc.setFontSize(6);
    setColor(doc, INK_45);
    doc.text("NO PROPERTY-TYPE DATA", x + width / 2, y + barH / 2 + 1, { align: "center" });
    return;
  }
  const landW = (breakdown.vacantLand / total) * width;
  fillRect(doc, x, y, landW, barH, INK);
  fillRect(doc, x + landW, y, width - landW, barH, INK_15);
  doc.setFont("courier", "bold");
  doc.setFontSize(6);
  if (landW >= 24) {
    setColor(doc, PAPER);
    doc.text(`LAND ${breakdown.vacantLand}`, x + 1.6, y + 5.6);
  }
  if (width - landW >= 24) {
    setColor(doc, INK_70);
    doc.text(`BLDG ${breakdown.vacantBuilding}`, x + landW + 1.6, y + 5.6);
  }
  doc.setFont("courier", "normal");
  doc.setFontSize(5.6);
  setColor(doc, INK_45);
  doc.text(
    `VACANT LAND ${breakdown.vacantLand}  ·  VACANT BUILDING ${breakdown.vacantBuilding}`,
    x,
    y + barH + 4
  );
}

function drawComparisonMatrix(doc: jsPDF, input: VacancyIndexInput, top: number) {
  const rows = input.matrixRows;
  eyebrow(doc, "NINE-EDITION COMPARISON (QUINTILE RATINGS)", MARGIN, top, 7, INK_45, 0.4);
  let y = top + 6;

  const areaW = 62;
  const metricX = MARGIN + areaW;
  const colW = (RIGHT - metricX) / 5;
  const headLabels = (rows[0]?.cells ?? []).map((c) => c.label);

  // Column heads (two-line courier).
  doc.setFont("courier", "bold");
  doc.setFontSize(6);
  setColor(doc, INK_70);
  headLabels.forEach((label, i) => {
    const cx = metricX + i * colW;
    const words = label.toUpperCase().split(" ");
    const line1 = words[0] ?? "";
    const line2 = words.slice(1).join(" ");
    doc.text(clampLine(doc, line1, colW - 1), cx, y);
    if (line2) doc.text(clampLine(doc, line2, colW - 1), cx, y + 3);
  });
  y += 6;
  hLine(doc, MARGIN, RIGHT, y, INK, 0.2);
  y += 4.5;

  const rowH = 8.2;
  rows.forEach((row) => {
    const rowMid = y + 1.5;
    if (row.isSubject) {
      // Yellow left tick.
      fillRect(doc, MARGIN - 2.5, y - 3.6, 1.6, rowH - 1.5, SWISS_YELLOW);
    }
    doc.setFont("helvetica", row.isSubject ? "bold" : "normal");
    doc.setFontSize(7.5);
    setColor(doc, INK);
    doc.text(clampLine(doc, row.area, areaW - 16), MARGIN, rowMid);
    doc.setFont("courier", "normal");
    doc.setFontSize(6);
    setColor(doc, INK_45);
    doc.text(row.zip, MARGIN + areaW - 15, rowMid);
    // Dot ratings (subject row = blue dots).
    const dotHex = row.isSubject ? SWISS_BLUE : INK;
    row.cells.forEach((cell, i) => {
      drawDotRating(doc, metricX + i * colW, rowMid - 0.6, cell.dots, dotHex);
    });
    y += rowH;
    hLine(doc, MARGIN, RIGHT, y - 3.4, INK_15, 0.15);
  });

  // Quintile note.
  y += 1;
  doc.setFont("courier", "normal");
  doc.setFontSize(5.6);
  setColor(doc, INK_45);
  fit(doc, QUINTILE_NOTE, CONTENT_W, 2).forEach((line) => {
    doc.text(line, MARGIN, y);
    y += 3.2;
  });
}

/* ── Sheet 03: PROPERTY NETWORK MAP ── */

function drawPropertyNetworkMap(doc: jsPDF, input: VacancyIndexInput) {
  drawSwissHeader(doc, input.neighborhood, 3, "PROPERTY NETWORK MAP");
  const panel = { x: MARGIN, y: 40, w: CONTENT_W, h: 150 };
  strokeRect(doc, panel.x, panel.y, panel.w, panel.h, INK, 0.4);

  const ringPoints: [number, number][] =
    input.boundary && input.boundary.length >= 3
      ? input.boundary
      : input.sitePoints.map((p) => [p.lon, p.lat]);
  const bbox = computeBbox(ringPoints);
  const proj = makeProjection(bbox, panel);

  drawCoordinateGrid(doc, panel, proj);

  // Real transport lines (no fake streets).
  for (const line of input.transport) {
    if (line.points.length < 2) continue;
    const abs = line.points.map(([lon, lat]) => proj.project(lon, lat));
    if (line.kind === "expressway") {
      const [r, g, b] = hexToRgb(EXPRESSWAY_GRAY);
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(0.5);
      doc.setLineDashPattern([], 0);
    } else {
      const [r, g, b] = hexToRgb(INK_45);
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(0.3);
      doc.setLineDashPattern([0.8, 0.8], 0);
    }
    doc.lines(ringToDeltas(abs), abs[0][0], abs[0][1], [1, 1], "S", false);
  }
  doc.setLineDashPattern([], 0);

  // ZIP boundary stroked INK.
  if (input.boundary && input.boundary.length >= 3) {
    const abs = input.boundary.map(([lon, lat]) => proj.project(lon, lat));
    const [r, g, b] = hexToRgb(INK);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.4);
    doc.lines(ringToDeltas(abs), abs[0][0], abs[0][1], [1, 1], "S", true);
  }

  // Dot field: owner-type colors at 0.85 opacity, unknown drawn first.
  doc.saveGraphicsState();
  doc.setGState(new GState({ opacity: 0.85 }));
  const ordered = [...input.sitePoints].sort(
    (a, b) => (normalizeOwnerType(a.ownerType) === "unknown" ? 0 : 1) - (normalizeOwnerType(b.ownerType) === "unknown" ? 0 : 1)
  );
  for (const p of ordered) {
    const [px, py] = proj.project(p.lon, p.lat);
    fillCircle(doc, px, py, 0.9, OWNER_TYPE_COLORS[normalizeOwnerType(p.ownerType)]);
  }
  doc.restoreGraphicsState();

  // Numbered markers (top-12; sitePoints[i] aligns with topSites[i]).
  drawSiteMarkers(doc, panel, proj, input);

  // North arrow + scale bar.
  drawNorthArrow(doc, panel.x + panel.w - 8, panel.y + 10);
  drawScaleBar(doc, panel.x + 4, panel.y + panel.h - 4, proj.metersPerMm, SWISS_YELLOW);

  // Edition-geography caveat (small courier under the panel).
  doc.setFont("courier", "normal");
  doc.setFontSize(5.6);
  setColor(doc, INK_45);
  doc.text(
    clampLine(
      doc,
      `Edition geography: ZIP ${input.zipCode} (primarily ${input.neighborhood}). ZIP and community-area boundaries do not align exactly.`,
      CONTENT_W
    ),
    panel.x,
    panel.y + panel.h + 5
  );

  drawMapLegend(doc, input, panel.y + panel.h + 9);
  drawSwissFooter(doc, 3, input.sources, input.asOf);
}

function drawSiteMarkers(
  doc: jsPDF,
  panel: { x: number; y: number; w: number; h: number },
  proj: Projection,
  input: VacancyIndexInput
) {
  const count = Math.min(12, input.topSites.length, input.sitePoints.length);
  const placed: { x: number; y: number }[] = [];
  const dirs: [number, number][] = [
    [1, 0],
    [0.7, -0.7],
    [0, -1],
    [-0.7, -0.7],
    [-1, 0],
    [-0.7, 0.7],
    [0, 1],
    [0.7, 0.7],
  ];
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  for (let i = 0; i < count; i++) {
    const sp = input.sitePoints[i];
    const [tx, ty] = proj.project(sp.lon, sp.lat);
    // True-point anchor ring.
    strokeCircle(doc, tx, ty, 1.2, INK, 0.3);
    fillCircle(doc, tx, ty, 0.5, INK);
    // Greedy 8-direction offset to avoid label collisions.
    let lx = tx;
    let ly = ty;
    const collides = (x: number, y: number) => placed.some((p) => Math.hypot(p.x - x, p.y - y) < 5.5);
    if (collides(lx, ly)) {
      let found = false;
      for (const radius of [6, 10]) {
        for (const [dx, dy] of dirs) {
          const cx = clamp(tx + dx * radius, panel.x + 3, panel.x + panel.w - 3);
          const cy = clamp(ty + dy * radius, panel.y + 3, panel.y + panel.h - 3);
          if (!collides(cx, cy)) {
            lx = cx;
            ly = cy;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
    lx = clamp(lx, panel.x + 3, panel.x + panel.w - 3);
    ly = clamp(ly, panel.y + 3, panel.y + panel.h - 3);
    // Leader line if offset.
    if (Math.hypot(lx - tx, ly - ty) > 1.5) {
      const [r, g, b] = hexToRgb(INK);
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(0.3);
      doc.line(tx, ty, lx, ly);
    }
    // Numbered label disc.
    fillCircle(doc, lx, ly, 2.2, INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    setColor(doc, PAPER);
    doc.text(String(i + 1), lx, ly + 1, { align: "center" });
    placed.push({ x: lx, y: ly });
  }
}

function drawMapLegend(doc: jsPDF, input: VacancyIndexInput, top: number) {
  // Owner-type key with counts (left) + numbered site key (right).
  const counts: Record<OwnerType, number> = {
    corporate_llc: 0,
    out_of_state: 0,
    local_private: 0,
    city_public: 0,
    unknown: 0,
  };
  for (const p of input.sitePoints) counts[normalizeOwnerType(p.ownerType)] += 1;

  let ly = top;
  eyebrow(doc, "OWNER TYPE", MARGIN, ly, 6, INK_45, 0.4);
  ly += 4;
  OWNER_TYPE_ORDER.forEach((type) => {
    fillCircle(doc, MARGIN + 1, ly - 0.8, 0.9, OWNER_TYPE_COLORS[type]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    setColor(doc, INK);
    doc.text(clampLine(doc, `${OWNER_TYPE_LABELS[type]}`, 34), MARGIN + 3.5, ly);
    doc.setFont("courier", "bold");
    doc.setFontSize(6);
    setColor(doc, INK_45);
    doc.text(String(counts[type]), MARGIN + 40, ly, { align: "right" });
    ly += 4;
  });

  // Numbered site key (two columns on the right).
  const keyX = MARGIN + 52;
  const keyW = RIGHT - keyX;
  const colW = keyW / 2;
  eyebrow(doc, "NUMBERED SITES", keyX, top, 6, INK_45, 0.4);
  const count = Math.min(12, input.topSites.length);
  doc.setFont("courier", "normal");
  doc.setFontSize(5.8);
  for (let i = 0; i < count; i++) {
    const col = i < 6 ? 0 : 1;
    const rowInCol = i % 6;
    const cx = keyX + col * colW;
    const cyy = top + 4 + rowInCol * 3.4;
    setColor(doc, INK);
    const label = `${String(i + 1).padStart(2, "0")} ${input.topSites[i].address}`;
    doc.text(clampLine(doc, label, colW - 2), cx, cyy);
  }
}

/* ── Sheet 04: SITE INDEX ── */

function drawSiteIndex(doc: jsPDF, input: VacancyIndexInput) {
  drawSwissHeader(doc, input.neighborhood, 4, "SITE INDEX");
  let y = 44;

  eyebrow(doc, "PRIORITY SITE INDEX", MARGIN, y, 7, INK_45, 0.5);
  y += 6;

  // Column geometry.
  const cNum = MARGIN; // #
  const cAddr = MARGIN + 8; // ADDRESS (46mm)
  const cOwner = cAddr + 46; // OWNER
  const cType = cOwner + 24; // TYPE
  const cZone = cType + 14; // ZONING
  const cArea = cZone + 16; // AREA (sqft)
  const cPri = cArea + 16; // PRI chip
  const cNext = cPri + 14; // NEXT STEP
  const nextW = RIGHT - cNext;

  // Table head.
  doc.setFont("courier", "bold");
  doc.setFontSize(6.5);
  setColor(doc, INK_70);
  doc.text("#", cNum, y);
  doc.text("ADDRESS", cAddr, y);
  doc.text("OWNER", cOwner, y);
  doc.text("TYPE", cType, y);
  doc.text("ZONING", cZone, y);
  doc.text("AREA", cArea, y);
  doc.text("PRI", cPri, y);
  doc.text("NEXT STEP", cNext, y);
  y += 2;
  hLine(doc, MARGIN, RIGHT, y, INK, 0.2);
  y += 5;

  const rows = input.topSites.slice(0, 15);
  const rowH = 7.5;
  rows.forEach((site, i) => {
    const ot = normalizeOwnerType(site.ownerType);
    doc.setFont("courier", "bold");
    doc.setFontSize(6.5);
    setColor(doc, INK_45);
    doc.text(String(i + 1).padStart(2, "0"), cNum, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, INK);
    fit(doc, site.address, 45, 2).forEach((line, li) => doc.text(line, cAddr, y + li * 3.2));

    // Owner: 2mm dot + abbreviation.
    fillCircle(doc, cOwner + 0.9, y - 0.9, 0.9, OWNER_TYPE_COLORS[ot]);
    doc.setFont("courier", "normal");
    doc.setFontSize(6);
    setColor(doc, INK);
    doc.text(OWNER_TYPE_ABBR[ot], cOwner + 3, y);

    doc.text(site.propertyType === "vacant_building" ? "BLDG" : "LAND", cType, y);

    if (site.zoning) {
      setColor(doc, INK);
      doc.text(clampLine(doc, site.zoning, 15), cZone, y);
    } else {
      setColor(doc, INK_45);
      doc.text("PENDING", cZone, y);
    }

    if (site.sqft && site.sqft > 0) {
      setColor(doc, INK);
      doc.text(site.sqft.toLocaleString("en-US"), cArea, y);
    } else {
      setColor(doc, INK_45);
      doc.text("N/A", cArea, y);
    }

    drawPriorityChip(doc, cPri, y - 3, site.priority);

    doc.setFont("courier", "normal");
    doc.setFontSize(6);
    setColor(doc, INK_70);
    fit(doc, site.nextStep, nextW, 2).forEach((line, li) => doc.text(line, cNext, y + li * 3));

    y += rowH;
    hLine(doc, MARGIN, RIGHT, y - 3.4, INK_15, 0.15);
  });

  // Overflow line.
  const additional = input.counts.total - rows.length;
  if (additional > 0) {
    y += 1;
    doc.setFont("courier", "bold");
    doc.setFontSize(6.5);
    setColor(doc, SWISS_BLUE);
    doc.text(`+ ${additional} ADDITIONAL SITES IN THE ONLINE INDEX`, MARGIN, y);
    y += 4;
  }

  // Methodology block above the footer.
  drawMethodology(doc, input, 226);
  drawSwissFooter(doc, 4, input.sources, input.asOf);
}

function drawMethodology(doc: jsPDF, input: VacancyIndexInput, top: number) {
  let y = top;
  hLine(doc, MARGIN, RIGHT, y, INK, 0.2);
  y += 4;
  eyebrow(doc, "METHODOLOGY", MARGIN, y, 6, INK_45, 0.4);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  setColor(doc, INK_70);
  fit(doc, PRIORITY_RUBRIC_NOTE, CONTENT_W, 3).forEach((line) => {
    doc.text(line, MARGIN, y);
    y += 3;
  });
  y += 1;
  fit(doc, OWNER_CLASSIFICATION_NOTE, CONTENT_W, 2).forEach((line) => {
    doc.text(line, MARGIN, y);
    y += 3;
  });
  y += 1;
  doc.setFont("courier", "normal");
  doc.setFontSize(5.6);
  setColor(doc, INK_45);
  doc.text(clampLine(doc, `DATA AS OF ${input.asOf}  ·  SOURCES: ${input.sources.join(" · ")}`, CONTENT_W), MARGIN, y);
}

/* ── Builder + public API ── */

function slugify(text: string): string {
  return text.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "edition";
}

function _buildVacancyIndexPdf(input: VacancyIndexInput): { doc: jsPDF; slug: string } {
  const doc = createSanitizedDoc();

  drawCover(doc, input);
  doc.addPage();
  drawExecutiveBrief(doc, input);
  doc.addPage();
  drawSystemOverview(doc, input);
  doc.addPage();
  drawPropertyNetworkMap(doc, input);
  doc.addPage();
  drawSiteIndex(doc, input);

  const slug = slugify(input.neighborhood || input.zipCode);
  return { doc, slug };
}

export function generateVacancyIndexPdf(input: VacancyIndexInput): void {
  const { doc, slug } = _buildVacancyIndexPdf(input);
  doc.save(`vacancy-opportunity-index-${slug}.pdf`);
}

export function generateVacancyIndexPdfBase64(
  input: VacancyIndexInput
): { base64: string; filename: string } {
  const { doc, slug } = _buildVacancyIndexPdf(input);
  const base64 = doc.output("datauristring").split(",")[1];
  return { base64, filename: `vacancy-opportunity-index-${slug}.pdf` };
}
