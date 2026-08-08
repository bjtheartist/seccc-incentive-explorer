import { jsPDF } from "jspdf";
import { ZONE_KEYS, ZONE_COLORS } from "./constants";
import type { LookupResult, Program } from "./types";
import {
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  normalizePublicReportForDisplay,
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
} from "./report-engine";
import type { GeneratedReport } from "./report-engine";
import { PROJECT_TYPE_LABELS } from "./report-wizard-config";
import { CAPITAL_PARTNER_SECTION_TITLE } from "./capital-partner-report";

/**
 * PDF print order is intentionally action-first. The web report can support
 * exploration, while the downloadable report should help someone decide what
 * to do, who to contact, and what to prepare before they read the evidence.
 * Unknown sections keep their relative order between the action and context
 * groups so other report types remain predictable.
 */
export function orderSectionsForPdf(
  sections: GeneratedReport["sections"],
): GeneratedReport["sections"] {
  const confirmedSectionTitles = new Set([
    CONFIRMED_PROGRAMS_SECTION_TITLE,
    GOAL_MATCH_PROGRAMS_SECTION_TITLE,
    OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
    "Eligible Incentive Programs",
  ]);

  const priority = (title: string): number => {
    if (title === GOAL_MATCH_PROGRAMS_SECTION_TITLE) return 10;
    if (title === OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE) return 11;
    if (confirmedSectionTitles.has(title)) return 12;
    if (title === CAPITAL_PARTNER_SECTION_TITLE) return 20;
    if (title === "Upcoming Deadlines Near This Address") return 30;
    if (title === "Your Support Network") return 40;
    if (title === "Additional Programs to Explore") return 50;
    if (title === "Required Documents") return 60;
    if (title === "Document Readiness Checklist") return 61;
    if (title === "Site Overview") return 80;
    if (title === "Project Intake") return 81;
    if (title === "Incentive Zone Coverage & Program Interactions") return 82;
    if (title === "Neighborhood Economic Context") return 90;
    if (title === "Local Impact Anchors") return 91;
    return 70;
  };

  return sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => priority(a.section.title) - priority(b.section.title) || a.index - b.index)
    .map(({ section }) => section);
}

/* ── Brand Colors ── */
const NAVY = "#0C1B33";
const BLUE = "#2563EB";
const WHITE = "#FFFFFF";
const LIGHT_GRAY = "#9CA3AF";
const MEDIUM_GRAY = "#6B7280";
const GREEN = "#16A34A";
const AMBER = "#D97706";

/* ── Page Dimensions (letter, mm) ── */
const W = 215.9;
const H = 279.4;
const MARGIN = 20;
const CONTENT_W = W - MARGIN * 2;

/* ── Helpers ── */

type ReportPortal = {
  label?: string;
  url?: string;
  type?: string;
  language?: string;
};

type ReportVerificationStep = {
  label?: string;
  agency?: string;
  url?: string;
};

type ReportItemWithProvenance = GeneratedReport["sections"][number]["items"][number] & {
  applicationPortals?: ReportPortal[];
  verificationSteps?: ReportVerificationStep[];
  stale?: boolean;
};

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

function drawAccentBar(doc: jsPDF, x: number, y: number) {
  fillRect(doc, x, y, 30, 1.5, BLUE);
}

function drawLine(doc: jsPDF, x1: number, y: number, x2: number, hex = "#D8DDE6") {
  const [r, g, b] = hexToRgb(hex);
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.3);
  doc.line(x1, y, x2, y);
}

/** Wrap text and return lines + height consumed. */
function wrapText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  lines.forEach((line: string, i: number) => {
    doc.text(line, x, y + i * lineHeight);
  });
  return lines.length * lineHeight;
}

function compactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
    const display = `${parsed.hostname}${path}`;
    return display.length > 92 ? `${display.slice(0, 89)}...` : display;
  } catch {
    return url.length > 92 ? `${url.slice(0, 89)}...` : url;
  }
}

function formatDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function conciseText(text: string, maxLength = 190): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;

  const sentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  if (sentence && sentence.length <= maxLength) return sentence;

  const clipped = normalized.slice(0, maxLength - 3);
  const wordBoundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, Math.max(wordBoundary, maxLength - 24)).trim()}...`;
}

/**
 * jsPDF's standard "helvetica"/"times" fonts use WinAnsiEncoding, which is
 * missing math comparison operators and several dash variants. Left alone,
 * those glyphs corrupt the whole string they appear in (jsPDF falls back to
 * an incorrect substitute glyph *and* mis-measures the string, which can
 * visually manifest as stray letter-spacing on the rest of the line). Route
 * every piece of report-authored text through this before it reaches jsPDF.
 */
export function sanitizeForPdf(text: string): string {
  if (!text) return text;
  return text
    .replace(/≤\s?/g, "up to ")
    .replace(/≥\s?/g, "at least ")
    .replace(/[‐‑‒–—−]/g, "-");
}

function sanitizeForPdfDeep<T>(value: T): T {
  if (typeof value === "string") return sanitizeForPdf(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === "string" ? sanitizeForPdf(entry) : entry,
    ) as unknown as T;
  }
  return value;
}

/**
 * Creates a jsPDF instance whose text-writing and text-measuring methods all
 * sanitize their input first. This guarantees every `doc.text`, `doc.
 * textWithLink`, `doc.splitTextToSize`, and `doc.getTextWidth` call in every
 * builder below is routed through `sanitizeForPdf`, without having to thread
 * a sanitize call through each of the hundreds of individual call sites.
 * Sanitizing before `splitTextToSize`/`getTextWidth` (not just before the
 * final `doc.text`) matters: wrapping and right-alignment must measure the
 * same string that eventually gets drawn, or the layout drifts.
 */
export function createSanitizedDoc(): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const originalText = doc.text.bind(doc);
  const originalSplitTextToSize = doc.splitTextToSize.bind(doc);
  const originalTextWithLink = doc.textWithLink.bind(doc);
  const originalGetTextWidth = doc.getTextWidth.bind(doc);

  doc.text = ((text: unknown, x: number, y: number, options?: unknown) =>
    originalText(sanitizeForPdfDeep(text) as string, x, y, options as never)) as typeof doc.text;
  doc.splitTextToSize = ((text: unknown, maxWidth: number, options?: unknown) =>
    originalSplitTextToSize(sanitizeForPdfDeep(text) as string, maxWidth, options as never)) as typeof doc.splitTextToSize;
  doc.textWithLink = ((text: string, x: number, y: number, options: never) =>
    originalTextWithLink(sanitizeForPdf(text), x, y, options)) as typeof doc.textWithLink;
  doc.getTextWidth = ((text: string) => originalGetTextWidth(sanitizeForPdf(text))) as typeof doc.getTextWidth;

  return doc;
}

/** Wrap text to `maxWidth`, capping at `maxLines` and ellipsizing the last visible line. */
function fitLines(doc: jsPDF, text: string, width: number, maxLines: number): string[] {
  const lines = doc.splitTextToSize(text, width) as string[];
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] = `${visible[maxLines - 1].replace(/\.{0,3}$/, "")}...`;
  return visible;
}

function isCompactContextSection(title: string): boolean {
  return [
    "Site Overview",
    "Project Intake",
    "Neighborhood Economic Context",
    "Local Impact Anchors",
  ].includes(title);
}

function suppressItemProvenance(title: string): boolean {
  return isCompactContextSection(title) || [
    "Required Documents",
    "Document Readiness Checklist",
    "Incentive Zone Coverage & Program Interactions",
  ].includes(title);
}

function drawLinkedWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  url?: string
): number {
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  lines.forEach((line: string, i: number) => {
    if (url && i === 0) {
      doc.textWithLink(line, x, y + i * lineHeight, { url });
    } else {
      doc.text(line, x, y + i * lineHeight);
    }
  });
  return lines.length * lineHeight;
}

function drawProgramProvenance(
  doc: jsPDF,
  item: ReportItemWithProvenance,
  x: number,
  y: number,
  maxWidth: number
): number {
  const lines: { text: string; url?: string; color: string }[] = [];
  const sourceUrl = hasText(item.sourceUrl) ? item.sourceUrl.trim() : undefined;
  const itemUrl = hasText(item.url) ? item.url.trim() : undefined;
  const officialUrl = sourceUrl || itemUrl;

  if (officialUrl) {
    const sourceName = hasText(item.sourceLabel) ? `${item.sourceLabel.trim()} - ` : "";
    lines.push({
      text: `Official source: ${sourceName}${compactUrl(officialUrl)}`,
      url: officialUrl,
      color: BLUE,
    });
  }

  const portal = item.applicationPortals?.find((p) => hasText(p.url));
  if (portal?.url) {
    const label = hasText(portal.label) ? portal.label.trim() : "Application portal";
    const portalCount = item.applicationPortals?.filter((p) => hasText(p.url)).length || 1;
    const moreCount = Math.max(portalCount - 1, 0);
    lines.push({
      text: `Apply: ${label} - ${compactUrl(portal.url)}${moreCount > 0 ? ` (+${moreCount} more)` : ""}`,
      url: portal.url,
      color: GREEN,
    });
  }

  const nextStep = item.verificationSteps?.find((step) => hasText(step.label) || hasText(step.url));
  if (nextStep) {
    const label = hasText(nextStep.label) ? nextStep.label.trim() : "Confirm current requirements";
    const agency = hasText(nextStep.agency) ? ` (${nextStep.agency.trim()})` : "";
    const stepUrl = hasText(nextStep.url) ? nextStep.url.trim() : undefined;
    const moreCount = Math.max((item.verificationSteps?.length || 1) - 1, 0);
    const stepUrlText = stepUrl ? ` - ${compactUrl(stepUrl)}` : "";
    const moreText = moreCount > 0 ? ` (+${moreCount} more)` : "";
    lines.push({
      text: `Suggested next step: ${label}${agency}${stepUrlText}${moreText}`,
      url: stepUrl,
      color: BLUE,
    });
  }

  const isStale = item.isStale || item.stale;
  if (item.lastVerifiedAt || isStale) {
    lines.push({
      text: item.lastVerifiedAt
        ? `${isStale ? "Verify before relying" : "Verified"}: ${formatDateLabel(item.lastVerifiedAt)}`
        : "Verify before relying: source may be stale",
      color: isStale ? AMBER : LIGHT_GRAY,
    });
  }

  if (lines.length === 0) return y;

  let nextY = y;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  for (const line of lines) {
    nextY = checkPage(doc, nextY, 7);
    setColor(doc, line.color);
    const used = drawLinkedWrappedText(doc, line.text, x, nextY, maxWidth, 3.2, line.url);
    nextY += used + 1;
  }
  return nextY;
}

/** Check if we need a new page; if so add one and return reset Y. */
function checkPage(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > H - MARGIN) {
    doc.addPage();
    return MARGIN + 10;
  }
  return y;
}

/* ══════════════════════════════════════════════════════
   GENERATE PDF
   ══════════════════════════════════════════════════════ */

function _buildReport(
  result: LookupResult,
  programs: Program[]
): { doc: jsPDF; slug: string } {
  const doc = createSanitizedDoc();
  const programMap = new Map(programs.map((p) => [p.zoneKey, p]));

  const name = result.business?.name || "Address Lookup";
  const address = result.business
    ? `${result.business.address}, Chicago, IL ${result.business.zip}`
    : result.address || `${result.lat.toFixed(4)}, ${result.lon.toFixed(4)}`;
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const eligibleKeys = ZONE_KEYS.filter((k) => result.zones[k]);
  const eligiblePrograms = eligibleKeys
    .map((k) => programMap.get(k))
    .filter((p): p is Program => !!p);

  // Also include non-zone programs that are relevant (county-level)
  const countyPrograms = programs.filter(
    (p) => !p.zoneKey && !eligiblePrograms.find((ep) => ep.id === p.id)
  );

  /* ── PAGE 1: COVER ── */
  // Full navy background
  fillRect(doc, 0, 0, W, H, NAVY);

  // Top accent bar
  fillRect(doc, MARGIN, 30, 40, 2, BLUE);

  // Eyebrow
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, "#FFFFFF80");
  doc.text("CHICAGO ECONOMIC DEVELOPMENT", MARGIN, 42);

  // Main title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(36);
  setColor(doc, WHITE);
  doc.text("Chicago", MARGIN, 72);
  doc.setFontSize(36);
  setColor(doc, "#FFFFFF66");
  doc.text("Business", MARGIN, 86);
  setColor(doc, WHITE);
  doc.text("Incentive Report", MARGIN, 100);

  // Divider
  fillRect(doc, MARGIN, 112, CONTENT_W, 0.5, "#FFFFFF20");

  // Business / Address info
  let coverY = 125;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, "#FFFFFF60");
  doc.text("PREPARED FOR", MARGIN, coverY);
  coverY += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  setColor(doc, WHITE);
  doc.text(name, MARGIN, coverY);
  coverY += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  setColor(doc, "#FFFFFF80");
  doc.text(address, MARGIN, coverY);
  coverY += 12;

  if (result.business?.category) {
    doc.setFontSize(8);
    setColor(doc, "#FFFFFF50");
    doc.text(result.business.category.toUpperCase(), MARGIN, coverY);
    coverY += 8;
  }

  // City Zoning
  if (result.cityZoning) {
    coverY += 4;
    fillRect(doc, MARGIN, coverY, CONTENT_W, 0.3, "#FFFFFF15");
    coverY += 8;
    doc.setFontSize(8);
    setColor(doc, "#FFFFFF60");
    doc.text("CITY ZONING CLASSIFICATION", MARGIN, coverY);
    coverY += 7;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    setColor(doc, BLUE);
    doc.text(result.cityZoning.zoneClass, MARGIN, coverY);
    if (result.cityZoning.zoneType) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      setColor(doc, "#FFFFFF80");
      doc.text(`  ${result.cityZoning.zoneType}`, MARGIN + doc.getTextWidth(result.cityZoning.zoneClass) + 3, coverY);
    }
    coverY += 8;
  }

  // Factual mapped-zone count
  coverY = Math.max(coverY + 10, 195);
  fillRect(doc, MARGIN, coverY, CONTENT_W, 40, "#FFFFFF08");
  fillRect(doc, MARGIN, coverY, 3, 40, BLUE);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, "#FFFFFF60");
  doc.text("MAPPED INCENTIVE ZONES", MARGIN + 12, coverY + 12);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  setColor(doc, WHITE);
  doc.text(`${result.incentiveCount}`, MARGIN + 12, coverY + 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  setColor(doc, "#FFFFFF50");
  doc.text(`zones intersect this location`, MARGIN + 12 + doc.getTextWidth(`${result.incentiveCount} `) + 5, coverY + 28);

  // Footer
  doc.setFontSize(8);
  setColor(doc, "#FFFFFF40");
  doc.text(dateStr, MARGIN, H - 25);
  doc.text("Generated by Chicago Site Incentive Map", MARGIN, H - 18);
  doc.setFontSize(7);
  setColor(doc, "#FFFFFF30");
  doc.text("Southeast Chicago Chamber of Commerce", MARGIN, H - 12);

  /* ── PAGE 2: PROGRAMS RECORDED AT THIS LOCATION ── */
  doc.addPage();
  let y = MARGIN + 5;

  drawAccentBar(doc, MARGIN, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, LIGHT_GRAY);
  doc.text("02", MARGIN, y);
  doc.text("PROGRAM REVIEW", MARGIN + 12, y);
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  setColor(doc, NAVY);
  doc.text("Programs Recorded", MARGIN, y);
  y += 9;
  setColor(doc, "#0C1B3366");
  doc.text("at This Location", MARGIN, y);
  y += 14;

  // Employment info if present
  if (result.employment?.unemploymentRate) {
    fillRect(doc, MARGIN, y, CONTENT_W, 18, "#FFF7ED");
    fillRect(doc, MARGIN, y, 3, 18, "#EA580C");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(doc, "#EA580C");
    doc.text("HIGH UNEMPLOYMENT ZONE", MARGIN + 10, y + 7);
    doc.setFontSize(9);
    setColor(doc, NAVY);
    doc.text(
      `Unemployment Rate: ${result.employment.unemploymentRate} — review current WOTC and workforce-program requirements.`,
      MARGIN + 10,
      y + 13
    );
    y += 24;
  }

  // Eligible zone-based programs summary table
  if (eligiblePrograms.length > 0) {
    // Table header
    fillRect(doc, MARGIN, y, CONTENT_W, 8, "#EFF3FB");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setColor(doc, NAVY);
    doc.text("PROGRAM", MARGIN + 4, y + 5.5);
    doc.text("LEVEL", MARGIN + 90, y + 5.5);
    doc.text("STATUS", MARGIN + 125, y + 5.5);
    y += 10;

    for (const prog of eligiblePrograms) {
      y = checkPage(doc, y, 10);
      drawLine(doc, MARGIN, y, W - MARGIN, "#E5E7EB");
      y += 6;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setColor(doc, NAVY);
      doc.text(prog.name, MARGIN + 4, y);

      doc.setFontSize(7);
      setColor(doc, MEDIUM_GRAY);
      doc.text(prog.level, MARGIN + 90, y);

      // Neutral mapped-location badge
      const badgeX = MARGIN + 125;
      fillRect(doc, badgeX, y - 3.5, 20, 5, "#DCFCE7");
      doc.setFontSize(6);
      setColor(doc, GREEN);
      doc.text("MAPPED", badgeX + 2, y);
      y += 6;
    }
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    setColor(doc, MEDIUM_GRAY);
    doc.text("No zone-based programs matched this location.", MARGIN, y);
    y += 8;
  }

  // County / non-zone programs always available
  if (countyPrograms.length > 0) {
    y += 8;
    y = checkPage(doc, y, 30);
    drawAccentBar(doc, MARGIN, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setColor(doc, NAVY);
    doc.text("Additional Programs (County-Wide)", MARGIN, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(doc, MEDIUM_GRAY);
    doc.text("These broader programs are not established by zone location alone:", MARGIN, y);
    y += 6;

    for (const prog of countyPrograms) {
      y = checkPage(doc, y, 8);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      setColor(doc, NAVY);
      doc.text(`\u2022  ${prog.name} (${prog.level})`, MARGIN + 4, y);
      y += 5;
    }
  }

  /* ── COOK COUNTY ASSESSOR — Property Valuation ── */
  y += 8;
  y = checkPage(doc, y, 40);
  drawAccentBar(doc, MARGIN, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setColor(doc, NAVY);
  doc.text("Cook County Property Valuation", MARGIN, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, MEDIUM_GRAY);
  y += wrapText(
    doc,
    "The Cook County Assessor\u2019s Office determines the assessed value of commercial properties for tax purposes. " +
    "Understanding your property\u2019s valuation can help you review published assessment rules and prepare questions about appeals.",
    MARGIN,
    y,
    CONTENT_W,
    4
  );
  y += 4;

  fillRect(doc, MARGIN, y, CONTENT_W, 20, "#F5F3FF");
  fillRect(doc, MARGIN, y, 3, 20, "#7C3AED");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  setColor(doc, "#7C3AED");
  doc.text("HOW COMMERCIAL PROPERTIES ARE VALUED", MARGIN + 10, y + 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, NAVY);
  doc.text("cookcountyassessoril.gov/commercial/how-commercial-properties-are-valued", MARGIN + 10, y + 13);
  doc.setFontSize(7);
  setColor(doc, BLUE);
  doc.text("https://www.cookcountyassessoril.gov", MARGIN + 10, y + 18);
  y += 26;

  /* ── PAGES 3+: DETAILED PROGRAM BREAKDOWNS ── */
  const detailedPrograms = [...eligiblePrograms, ...countyPrograms];

  for (const prog of detailedPrograms) {
    doc.addPage();
    y = MARGIN + 5;

    // Program header
    const color = ZONE_COLORS[prog.zoneKey] || BLUE;
    fillRect(doc, MARGIN, y, CONTENT_W, 28, NAVY);
    fillRect(doc, MARGIN, y, 3, 28, color);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, "#FFFFFF60");
    doc.text(prog.level.toUpperCase(), MARGIN + 10, y + 8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    setColor(doc, WHITE);
    doc.text(prog.name, MARGIN + 10, y + 20);
    y += 35;

    // Summary
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setColor(doc, MEDIUM_GRAY);
    y += wrapText(doc, prog.summary, MARGIN, y, CONTENT_W, 4.5);
    y += 8;

    // ── PUBLISHED PROGRAM TERMS ──
    y = checkPage(doc, y, 30);
    fillRect(doc, MARGIN, y, 3, 1.5, GREEN);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, NAVY);
    doc.text("PUBLISHED PROGRAM TERMS", MARGIN + 8, y + 1);
    y += 8;

    for (const benefit of prog.benefits) {
      y = checkPage(doc, y, 8);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setColor(doc, GREEN);
      doc.text("+", MARGIN + 4, y);
      setColor(doc, NAVY);
      const bH = wrapText(doc, benefit, MARGIN + 10, y, CONTENT_W - 14, 4.5);
      y += Math.max(bH, 5);
    }
    y += 6;

    // ── WHAT IT REQUIRES (Who Qualifies + Required Docs) ──
    y = checkPage(doc, y, 30);
    fillRect(doc, MARGIN, y, 3, 1.5, "#D97706");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, NAVY);
    doc.text("WHAT IT REQUIRES", MARGIN + 8, y + 1);
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setColor(doc, NAVY);
    y += wrapText(doc, prog.whoQualifies, MARGIN + 4, y, CONTENT_W - 8, 4.5);
    y += 5;

    if (prog.requiredDocs.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      setColor(doc, LIGHT_GRAY);
      doc.text("REQUIRED DOCUMENTS", MARGIN + 4, y);
      y += 5;

      for (const docItem of prog.requiredDocs) {
        y = checkPage(doc, y, 6);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        setColor(doc, MEDIUM_GRAY);
        doc.text("\u25A1", MARGIN + 6, y);
        doc.text(docItem, MARGIN + 13, y);
        y += 5;
      }
    }
    y += 6;

    // ── TIMELINE / HOW TO APPLY ──
    y = checkPage(doc, y, 30);
    fillRect(doc, MARGIN, y, 3, 1.5, BLUE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, NAVY);
    doc.text("TIMELINE & HOW TO APPLY", MARGIN + 8, y + 1);
    y += 8;

    prog.howToApply.forEach((step, i) => {
      y = checkPage(doc, y, 10);

      // Step number circle
      fillRect(doc, MARGIN + 4, y - 3, 5, 5, BLUE);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      setColor(doc, WHITE);
      doc.text(`${i + 1}`, MARGIN + 5.5, y);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setColor(doc, NAVY);
      const sH = wrapText(doc, step, MARGIN + 13, y, CONTENT_W - 17, 4.5);
      y += Math.max(sH, 6) + 1;
    });
    y += 6;

    // ── WHO TO REACH OUT TO ──
    y = checkPage(doc, y, 25);
    fillRect(doc, MARGIN, y, CONTENT_W, 22, "#EFF3FB");
    fillRect(doc, MARGIN, y, 3, 22, BLUE);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setColor(doc, BLUE);
    doc.text("WHO TO REACH OUT TO", MARGIN + 10, y + 7);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setColor(doc, NAVY);
    doc.text(prog.contact, MARGIN + 10, y + 14);

    if (prog.url) {
      doc.setFontSize(7);
      setColor(doc, BLUE);
      doc.text(prog.url, MARGIN + 10, y + 19);
    }
    y += 28;

    // Page footer
    doc.setFontSize(7);
    setColor(doc, LIGHT_GRAY);
    doc.text(`${prog.name}  |  Chicago Site Incentive Map`, MARGIN, H - 10);
  }

  /* ── LAST PAGE: NEXT STEPS ── */
  doc.addPage();
  y = MARGIN + 15;

  drawAccentBar(doc, MARGIN, y);
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  setColor(doc, NAVY);
  doc.text("Next Steps", MARGIN, y);
  y += 14;

  const nextSteps = [
    "Review each program in this report and confirm the published requirements with its administrator.",
    "Gather the required documents listed for each program you want to pursue.",
    "Contact the program administrators listed in the \"Who to Reach Out To\" sections.",
    "Visit the Southeast Chicago Chamber of Commerce for hands-on assistance.",
    "Consider scheduling a free advising session through Cook County Small Business Source.",
  ];

  nextSteps.forEach((step, i) => {
    y = checkPage(doc, y, 18);
    fillRect(doc, MARGIN, y, CONTENT_W, 14, i % 2 === 0 ? "#FAFAFA" : WHITE);
    fillRect(doc, MARGIN, y, 3, 14, BLUE);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setColor(doc, BLUE);
    doc.text(`${i + 1}`, MARGIN + 8, y + 9);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setColor(doc, NAVY);
    wrapText(doc, step, MARGIN + 18, y + 9, CONTENT_W - 22, 4.5);
    y += 18;
  });

  // Final footer
  doc.setFontSize(7);
  setColor(doc, LIGHT_GRAY);
  doc.text(
    `Report generated ${dateStr} by Chicago Site Incentive Map. Data is informational and not a guarantee of eligibility.`,
    MARGIN,
    H - 10
  );

  const slug = name.replace(/\s+/g, "-").toLowerCase();
  return { doc, slug };
}

export function generateReport(
  result: LookupResult,
  programs: Program[]
): void {
  const { doc, slug } = _buildReport(result, programs);
  doc.save(`chicago-incentive-report-${slug}.pdf`);
}

/** Return report PDF as base64 string (for email attachment) */
export function generateReportBase64(
  result: LookupResult,
  programs: Program[]
): { base64: string; filename: string } {
  const { doc, slug } = _buildReport(result, programs);
  const base64 = doc.output("datauristring").split(",")[1];
  return { base64, filename: `chicago-incentive-report-${slug}.pdf` };
}

/* ══════════════════════════════════════════════════════
   GENERATE ENHANCED PDF from GeneratedReport
   ══════════════════════════════════════════════════════ */

function _buildLegacyReportPdf(report: GeneratedReport): { doc: jsPDF; slug: string } {
  const doc = createSanitizedDoc();
  const dateStr = new Date(report.generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const address = report.metadata?.address || "Address Lookup";

  /* ── PAGE 1: COVER ── */
  fillRect(doc, 0, 0, W, H, NAVY);
  fillRect(doc, MARGIN, 30, 40, 2, BLUE);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, "#FFFFFF80");
  doc.text("CHICAGO ECONOMIC DEVELOPMENT", MARGIN, 42);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  setColor(doc, WHITE);
  const titleLines = doc.splitTextToSize(report.title, CONTENT_W) as string[];
  let coverY = 68;
  for (const line of titleLines) {
    doc.text(line, MARGIN, coverY);
    coverY += 12;
  }

  if (report.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    setColor(doc, "#FFFFFF60");
    doc.text(report.subtitle, MARGIN, coverY + 4);
    coverY += 14;
  }

  fillRect(doc, MARGIN, coverY, CONTENT_W, 0.5, "#FFFFFF20");
  coverY += 12;

  // Verdict banner on cover
  if (report.verdict) {
    const vColor = BLUE;
    fillRect(doc, MARGIN, coverY, CONTENT_W, 32, "#FFFFFF08");
    fillRect(doc, MARGIN, coverY, 3, 32, vColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, vColor);
    doc.text("LOCATION FINDINGS", MARGIN + 10, coverY + 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    setColor(doc, WHITE);
    doc.text(report.verdict.headline, MARGIN + 10, coverY + 20);
    doc.setFontSize(8);
    setColor(doc, "#FFFFFF60");
    doc.text(report.verdict.subheadline, MARGIN + 10, coverY + 27);
    coverY += 38;
  }

  // Metadata on cover
  coverY = Math.max(coverY + 5, 180);
  doc.setFontSize(8);
  setColor(doc, "#FFFFFF40");
  if (report.metadata?.industry) {
    doc.text(`Industry: ${report.metadata.industry}`, MARGIN, coverY);
    coverY += 6;
  }
  if (report.metadata?.projectType) {
    const goalLabel = PROJECT_TYPE_LABELS[report.metadata.projectType] || report.metadata.projectType;
    doc.text(`Primary goal: ${goalLabel}`, MARGIN, coverY);
    coverY += 6;
  }
  if (report.metadata?.zoneClass) doc.text(`Zoning: ${report.metadata.zoneClass}`, MARGIN, coverY);

  doc.setFontSize(8);
  setColor(doc, "#FFFFFF40");
  doc.text(dateStr, MARGIN, H - 25);
  doc.text("Generated by Chicago Site Incentive Map", MARGIN, H - 18);
  doc.setFontSize(7);
  setColor(doc, "#FFFFFF30");
  doc.text("Southeast Chicago Chamber of Commerce", MARGIN, H - 12);

  /* ── PAGE 2: EXECUTIVE SUMMARY + VERDICT DETAIL ── */
  doc.addPage();
  let y = MARGIN + 5;
  drawAccentBar(doc, MARGIN, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, LIGHT_GRAY);
  doc.text("02", MARGIN, y);
  doc.text("EXECUTIVE SUMMARY", MARGIN + 12, y);
  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  setColor(doc, NAVY);
  doc.text("Key Findings", MARGIN, y);
  y += 10;

  const confirmedTitles = new Set([
    CONFIRMED_PROGRAMS_SECTION_TITLE,
    GOAL_MATCH_PROGRAMS_SECTION_TITLE,
    OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
  ]);
  const confirmedCount = report.sections
    .filter((section) => confirmedTitles.has(section.title))
    .reduce((count, section) => count + section.items.length, 0);
  const discoveryCount = report.sections.find(
    (section) => section.title === "Additional Programs to Explore",
  )?.items.length || 0;
  const deadlineCount = report.sections.find(
    (section) => section.title === "Upcoming Deadlines Near This Address",
  )?.items.length || 0;
  const metricGap = 4;
  const metricWidth = (CONTENT_W - metricGap * 2) / 3;
  const metrics = [
    { value: String(confirmedCount), label: "ADDRESS-LINKED", color: BLUE },
    { value: String(discoveryCount), label: "TO EXPLORE", color: AMBER },
    { value: String(deadlineCount), label: "UPCOMING DATES", color: GREEN },
  ];
  metrics.forEach((metric, index) => {
    const x = MARGIN + index * (metricWidth + metricGap);
    fillRect(doc, x, y, metricWidth, 20, "#F6F8FC");
    fillRect(doc, x, y, 2, 20, metric.color);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    setColor(doc, NAVY);
    doc.text(metric.value, x + 7, y + 9);
    doc.setFontSize(6.5);
    setColor(doc, MEDIUM_GRAY);
    doc.text(metric.label, x + 7, y + 15);
  });
  y += 28;

  if (report.summary) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setColor(doc, MEDIUM_GRAY);
    y += wrapText(doc, report.summary, MARGIN, y, CONTENT_W, 4.5);
    y += 8;
  }

  // Verdict reasons
  if (report.verdict && report.verdict.topReasons.length > 0) {
    const vColor = BLUE;
    fillRect(doc, MARGIN, y, 3, 1.5, vColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, NAVY);
    doc.text("KEY REASONS", MARGIN + 8, y + 1);
    y += 8;
    for (const reason of report.verdict.topReasons) {
      y = checkPage(doc, y, 8);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setColor(doc, NAVY);
      doc.text("\u2022", MARGIN + 4, y);
      const rH = wrapText(doc, reason, MARGIN + 10, y, CONTENT_W - 14, 4.5);
      y += Math.max(rH, 5);
    }
    y += 6;
  }

  /* ── ACTIONS BELONG IN THE DECISION BRIEF, NOT AT THE END ── */
  if (report.recommendedActions && report.recommendedActions.length > 0) {
    drawAccentBar(doc, MARGIN, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setColor(doc, NAVY);
    doc.text("Recommended Actions", MARGIN, y);
    y += 7;

    report.recommendedActions.forEach((action, i) => {
      const labelLines = doc.splitTextToSize(action.label, CONTENT_W - 34) as string[];
      const description = conciseText(action.description, 170);
      const descriptionLines = doc.splitTextToSize(description, CONTENT_W - 34) as string[];
      const cardHeight = Math.max(18, 9 + labelLines.length * 3.8 + descriptionLines.length * 3.4);
      y = checkPage(doc, y, cardHeight + 4);
      fillRect(doc, MARGIN, y, CONTENT_W, cardHeight, i % 2 === 0 ? "#F8FAFD" : WHITE);
      fillRect(doc, MARGIN, y, 3, cardHeight, action.priority === "high" ? BLUE : "#93A4BD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      setColor(doc, BLUE);
      doc.text(`${i + 1}`, MARGIN + 8, y + 8);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      setColor(doc, NAVY);
      labelLines.forEach((line, lineIndex) => {
        doc.text(line, MARGIN + 18, y + 7 + lineIndex * 3.8);
      });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      setColor(doc, MEDIUM_GRAY);
      const descriptionY = y + 8 + labelLines.length * 3.8;
      descriptionLines.forEach((line, lineIndex) => {
        doc.text(line, MARGIN + 18, descriptionY + lineIndex * 3.4);
      });
      y += cardHeight + 3;
    });
  }

  fillRect(doc, MARGIN, y + 3, CONTENT_W, 16, "#EFF3FB");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  setColor(doc, BLUE);
  doc.text("HOW TO USE THIS REPORT", MARGIN + 8, y + 10);
  doc.setFont("helvetica", "normal");
  setColor(doc, MEDIUM_GRAY);
  doc.text("Act first, prepare documents next, then use the final sections for supporting context.", MARGIN + 48, y + 10);
  y += 24;

  // Keep page 2 as a self-contained decision brief.
  doc.addPage();
  y = MARGIN + 10;

  /* ── PAGE 3+: SECTIONS ── */
  for (const section of orderSectionsForPdf(report.sections)) {
    y = checkPage(doc, y, 35);
    if (y > H - 60) { doc.addPage(); y = MARGIN + 10; }

    drawAccentBar(doc, MARGIN, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setColor(doc, NAVY);
    doc.text(section.title, MARGIN, y);
    y += 5;

    if (section.description) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      setColor(doc, LIGHT_GRAY);
      const description = section.title === "Additional Programs to Explore"
        ? "Useful leads that are not confirmed by the address alone. Verify project, property, timing, and administrator requirements before relying on them."
        : isCompactContextSection(section.title)
          ? conciseText(section.description, 180)
          : section.description;
      y += wrapText(doc, description, MARGIN, y, CONTENT_W, 3.5);
      y += 3;
    }
    y += 3;

    for (const item of section.items) {
      y = checkPage(doc, y, 16);
      drawLine(doc, MARGIN, y, W - MARGIN, "#E5E7EB");
      y += 5;

      // Color dot
      if (item.color) {
        const [r, g, b] = hexToRgb(item.color);
        doc.setFillColor(r, g, b);
        doc.circle(MARGIN + 2, y - 1.5, 1.2, "F");
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      setColor(doc, NAVY);

      const hasGroupedDetail = Boolean(item.detailGroups?.length);
      const valueColumnWidth = 54;
      const labelWidth = hasGroupedDetail ? CONTENT_W - 10 : CONTENT_W - valueColumnWidth - 16;
      const labelLines = doc.splitTextToSize(item.label, labelWidth) as string[];
      labelLines.forEach((line, lineIndex) => {
        doc.text(line, MARGIN + 6, y + lineIndex * 3.8);
      });

      let valueLines: string[] = [];

      if (item.value && !hasGroupedDetail) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        setColor(doc, MEDIUM_GRAY);
        valueLines = doc.splitTextToSize(item.value, valueColumnWidth) as string[];
        valueLines.forEach((line, lineIndex) => {
          const valW = doc.getTextWidth(line);
          doc.text(line, W - MARGIN - valW, y + lineIndex * 3.5);
        });
      }

      const headingLines = Math.max(labelLines.length, valueLines.length, 1);
      y += (headingLines - 1) * 3.8;

      if (hasGroupedDetail && item.detailGroups) {
        if (item.value) {
          y += 4;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          setColor(doc, MEDIUM_GRAY);
          y += wrapText(doc, item.value, MARGIN + 6, y, CONTENT_W - 10, 3.5);
        }

        for (const group of item.detailGroups) {
          y = checkPage(doc, y + 3, 12);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(7);
          setColor(doc, NAVY);
          doc.text(group.label, MARGIN + 6, y);
          y += 4;

          const visibleEntries = group.items.slice(0, 2);
          for (const entry of visibleEntries) {
            y = checkPage(doc, y, 8);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7);
            setColor(doc, MEDIUM_GRAY);
            doc.text("\u2022", MARGIN + 8, y);
            y += wrapText(doc, entry, MARGIN + 13, y, CONTENT_W - 17, 3.5);
          }
          if (group.items.length > visibleEntries.length) {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(6.5);
            setColor(doc, LIGHT_GRAY);
            doc.text(`+ ${group.items.length - visibleEntries.length} more nearby`, MARGIN + 13, y);
            y += 4;
          }
        }

        if (item.detailCaveat) {
          y = checkPage(doc, y + 3, 10);
          doc.setFont("helvetica", "italic");
          doc.setFontSize(6.5);
          setColor(doc, LIGHT_GRAY);
          y += wrapText(doc, item.detailCaveat, MARGIN + 6, y, CONTENT_W - 10, 3.3);
        }
      } else if (item.detail) {
        y += isCompactContextSection(section.title) ? 3 : 4;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        setColor(doc, LIGHT_GRAY);
        const compactDetail = section.title === "Additional Programs to Explore"
          ? conciseText(item.detail, 210)
          : isCompactContextSection(section.title)
            ? conciseText(item.detail, 175)
            : section.title === "Document Readiness Checklist"
              ? "Prepare if available; confirm exact requirements with the program administrator."
              : item.detail;
        y += wrapText(doc, compactDetail, MARGIN + 6, y, CONTENT_W - 10, 3.5);
      }

      if (item.projectFit && item.projectFit.level !== "location-only") {
        y = checkPage(doc, y + 3, 9);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.5);
        setColor(doc, item.projectFit.level === "industry-check" ? AMBER : BLUE);
        const fitText = section.title === "Additional Programs to Explore" && item.projectFit.level !== "industry-check"
          ? item.projectFit.label
          : `${item.projectFit.label}: ${conciseText(item.projectFit.reason, 145)}`;
        y += wrapText(
          doc,
          fitText,
          MARGIN + 6,
          y,
          CONTENT_W - 10,
          3.3,
        );
      }

      if (!suppressItemProvenance(section.title)) {
        const provenanceStartY = y + 3;
        const provenanceEndY = drawProgramProvenance(
          doc,
          item as ReportItemWithProvenance,
          MARGIN + 6,
          provenanceStartY,
          CONTENT_W - 10
        );
        if (provenanceEndY !== provenanceStartY) {
          y = provenanceEndY + 3;
        }
      }
      y += isCompactContextSection(section.title) ? 2 : 4;
    }
    y += isCompactContextSection(section.title) ? 3 : 6;
  }

  /* ── DATA SOURCES ── */
  if (report.dataSources && report.dataSources.length > 0) {
    y += 8;
    y = checkPage(doc, y, 50);
    if (y > H - 60) { doc.addPage(); y = MARGIN + 10; }
    drawAccentBar(doc, MARGIN, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setColor(doc, NAVY);
    doc.text("Sources & Verification", MARGIN, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, LIGHT_GRAY);
    y += wrapText(
      doc,
      "Official and public-data sources used for this screening. Open the linked source and confirm current requirements before making a decision.",
      MARGIN,
      y,
      CONTENT_W,
      3.5,
    );
    y += 4;

    for (const src of report.dataSources) {
      y = checkPage(doc, y, 10);
      drawLine(doc, MARGIN, y, W - MARGIN, "#EEF1F5");
      y += 4;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      setColor(doc, NAVY);
      doc.text(src.label, MARGIN + 4, y);
      if (src.url) {
        setColor(doc, BLUE);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        const sourceText = compactUrl(src.url);
        const sourceWidth = doc.getTextWidth(sourceText);
        doc.textWithLink(sourceText, W - MARGIN - sourceWidth, y, { url: src.url });
      }
      y += 6;
    }
  }

  /* ── PAGE HEADERS & FOOTERS ── */
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    // Footer: page number on all pages
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, LIGHT_GRAY);
    const pageText = `Page ${i} of ${totalPages}`;
    const pageTextW = doc.getTextWidth(pageText);
    doc.text(pageText, W - MARGIN - pageTextW, H - 8);
    // Footer: date on left (pages 2+)
    if (i >= 2) {
      doc.text(dateStr, MARGIN, H - 8);
    }
    // Header on pages 2+
    if (i >= 2) {
      doc.setFontSize(6);
      setColor(doc, "#D8DDE6");
      doc.text("Chicago Site Incentive Map", MARGIN, MARGIN - 2);
      drawLine(doc, MARGIN, MARGIN, W - MARGIN, "#E5E7EB");
    }
  }

  doc.setFontSize(7);
  setColor(doc, LIGHT_GRAY);
  doc.setPage(totalPages);
  doc.text(
    `Report generated ${dateStr} by Chicago Site Incentive Map. Data is informational and not a guarantee of eligibility.`,
    MARGIN,
    H - 14
  );

  const slug = address.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  return { doc, slug };
}

type ReportRow = GeneratedReport["sections"][number]["items"][number];

function _buildSevenPageActionReportPdf(report: GeneratedReport): { doc: jsPDF; slug: string } {
  const doc = createSanitizedDoc();
  const address = report.metadata?.address || "Address Lookup";
  const dateStr = new Date(report.generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const primaryGoal = report.metadata?.projectType
    ? PROJECT_TYPE_LABELS[report.metadata.projectType] || report.metadata.projectType
    : "Confirm the project goal with an advisor";
  const neighborhoodLabel = report.communityAssets?.communityArea || report.neighborhoodEconomics?.geographyLabel;
  const preparedFor = hasText(report.metadata?.preparedFor) ? report.metadata.preparedFor.trim() : undefined;

  const section = (title: string) => report.sections.find((candidate) => candidate.title === title);
  const sections = (titles: Set<string>) => report.sections.filter((candidate) => titles.has(candidate.title));
  const confirmedTitles = new Set([
    CONFIRMED_PROGRAMS_SECTION_TITLE,
    GOAL_MATCH_PROGRAMS_SECTION_TITLE,
    OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
  ]);
  const confirmedItems = sections(confirmedTitles).flatMap((candidate) => candidate.items);
  const discoveryItems = section("Additional Programs to Explore")?.items || [];
  const deadlineItems = section("Upcoming Deadlines Near This Address")?.items || [];
  const financingItems = section(CAPITAL_PARTNER_SECTION_TITLE)?.items || [];
  const supportItems = (section("Your Support Network")?.items || []).filter((item) => Boolean(item.url));
  const requiredItems = section("Required Documents")?.items || [];
  const readinessItems = section("Document Readiness Checklist")?.items || [];
  const siteItems = [
    ...(section("Site Overview")?.items || []),
    ...(section("Project Intake")?.items || []),
    ...(section("Incentive Zone Coverage & Program Interactions")?.items || []),
  ];
  const neighborhoodItems = section("Neighborhood Economic Context")?.items || [];

  /* ── Layout constants ── */
  const SECTION_GAP = 10; // gap between the end of one section and the next heading (spec: ~10-12mm)
  const HEADING_TO_ROW_GAP = 11; // gap from a section heading to its first row
  const ROW_GAP = 2; // gap between rows within the same section
  // layoutList doesn't know a row's height until after it's drawn, so this
  // stays generous enough to cover the tallest card types it renders.
  const SAFE_BOTTOM = H - 24; // never *start* a layoutList row below this; protects the footer
  // The readiness-checklist and sources grids are hand-rolled with a fixed,
  // known row height, so their safe line can sit much closer to the footer
  // (H - 8) without any real collision risk — using SAFE_BOTTOM here was
  // needlessly dropping rows that had plenty of room.
  const GRID_SAFE_BOTTOM = H - 12;

  /**
   * Wrap text to `maxWidth`, capping at `maxLines`. jsPDF measures against
   * whatever font/size/style is *currently set on the doc* — so this always
   * sets that font first, rather than relying on callers to sequence their
   * `doc.setFont`/`setFontSize` calls before every measurement. Getting that
   * ordering wrong is exactly what caused the address-linked card's title to
   * overrun its reserved column and collide with the value text on the
   * first pass at this rewrite: the line count was measured against
   * whatever font a previous element had left active, then drawn bold/7.8pt.
   */
  const fit = (
    text: string,
    width: number,
    maxLines: number,
    size: number,
    style: "normal" | "bold" = "normal",
  ): string[] => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    return fitLines(doc, text, width, maxLines);
  };

  /** Clamp a right-aligned "value" column to one line (spec defect 8):
   *  strip parenthetical asides and abbreviate "years" before truncating, so
   *  real content survives instead of being chopped mid-word. */
  const shortValue = (value: string, width: number, size: number): string => {
    const cleaned = value
      .replace(/\s*\(vs\.[^)]*\)/gi, "")
      .replace(/\byears\b/gi, "yrs")
      .replace(/\s*\/\s*/g, "/");
    return fit(cleaned, width, 1, size)[0] ?? "";
  };

  type ParsedContact = { helpWith?: string; phone?: string; email?: string; address?: string };

  /** report-engine's localSupportDetail() joins recognizable "Label: value"
   *  facts with "\n"; upstream whitespace-collapsing turns that into one
   *  run-on string (spec defect 4). Parse the original labeled lines back
   *  out so each fact prints on its own line, dropping "Serves"/"Status"/
   *  "Website" noise entirely. */
  const parseContactDetail = (detail?: string): ParsedContact => {
    if (!detail) return {};
    const result: ParsedContact = {};
    for (const line of detail.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const address = line.match(/^Address:\s*(.+)$/i);
      const phone = line.match(/^Phone:\s*(.+)$/i);
      const email = line.match(/^Email:\s*(.+)$/i);
      const help = line.match(/^Can help with:\s*(.+)$/i);
      if (address) result.address = address[1];
      else if (phone) result.phone = phone[1];
      else if (email) result.email = email[1];
      else if (help) result.helpWith = help[1];
      // "Serves:" / "Status:" / "Website: not listed..." / "Organization
      // focus:" / "Reason:" lines are intentionally dropped as noise.
    }
    return result;
  };

  /** Structured "Call or Text: … | Email: …" and "Office: …" lines for a
   *  contact card, omitting any line whose facts are absent. */
  const contactLines = (parsed: ParsedContact): string[] => {
    const lines: string[] = [];
    if (parsed.phone || parsed.email) {
      lines.push(
        [parsed.phone ? `Call or Text: ${parsed.phone}` : null, parsed.email ? `Email: ${parsed.email}` : null]
          .filter(Boolean)
          .join("  |  "),
      );
    }
    if (parsed.address) lines.push(`Office: ${parsed.address}`);
    return lines;
  };

  /** Extract a YYYY-MM-DD date from anywhere in a deadline item's value
   *  ("2026-08-14", "Today (2026-08-14)", "In 5 days — 2026-08-14") for the
   *  calendar chip — the previous bare-string match dropped the chip (and
   *  fell back to a plain rank digit) for every framed value.
   *
   *  Both `month`/`day` (for the chip) and `label` (for the right-aligned
   *  readable date) are built directly from the regex groups rather than by
   *  parsing the substring with `new Date(...)`: a bare "YYYY-MM-DD" parses
   *  as UTC midnight, and formatting that with a US-negative-offset local
   *  timezone rolls it back to the *previous* calendar day — which would
   *  show a different day here than the chip does two lines over. */
  const parseDateChip = (value: string): { month: string; day: string; label: string } | null => {
    const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const monthsShort = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const monthsLabel = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    return {
      month: monthsShort[monthIndex] ?? "",
      day: match[3],
      label: `${monthsLabel[monthIndex] ?? ""} ${day}, ${match[1]}`,
    };
  };

  /** Required Documents rows join "docName — Program A, Program B" per
   *  document; pull just the deduped document names for Priority Documents
   *  (spec page-4 fix: real names, not a bare count). */
  const parseDocumentNames = (detail?: string): string[] => {
    if (!detail) return [];
    const names = detail
      .split("\n")
      .map((line) => line.split(/\s+—\s+/)[0]?.trim())
      .filter((name): name is string => Boolean(name));
    return [...new Set(names)];
  };

  const matchExplanationLines = (item: ReportRow): string[] => {
    const explanation = item.matchExplanation;
    if (!explanation) return [];
    const first = (values: string[]) => values[0];
    return [
      first(explanation.whyItAppears) ? `Why it appears: ${first(explanation.whyItAppears)}` : undefined,
      first(explanation.knownFromPublicData) ? `Public data: ${first(explanation.knownFromPublicData)}` : undefined,
      first(explanation.basedOnUserAnswers) ? `Your answers: ${first(explanation.basedOnUserAnswers)}` : undefined,
      first(explanation.stillToConfirm) ? `Still to confirm: ${first(explanation.stillToConfirm)}` : undefined,
      first(explanation.currentDocumentsToGather) ? `Document: ${first(explanation.currentDocumentsToGather)}` : undefined,
      explanation.confirmWith[0] ? `Confirm with: ${explanation.confirmWith[0].agency}` : undefined,
      explanation.lastVerifiedAt ? `Information reviewed: ${explanation.lastVerifiedAt}` : undefined,
    ].filter((line): line is string => Boolean(line));
  };

  /* ── Small drawn glyphs (spec: square/circle chips with centered numbers, not tall rectangles) ── */

  const drawPersonGlyph = (cx: number, cy: number, radius: number) => {
    const [r, g, b] = hexToRgb(WHITE);
    doc.setFillColor(r, g, b);
    doc.circle(cx, cy - radius * 0.32, radius * 0.26, "F");
    doc.ellipse(cx, cy + radius * 0.42, radius * 0.5, radius * 0.34, "F");
  };

  const drawCheckGlyph = (cx: number, cy: number) => {
    const [r, g, b] = hexToRgb(WHITE);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.9);
    doc.line(cx - 2.1, cy, cx - 0.5, cy + 1.7);
    doc.line(cx - 0.5, cy + 1.7, cx + 2.3, cy - 2.1);
  };

  const drawDocGlyph = (x: number, y: number, hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.35);
    doc.rect(x, y, 3.4, 4.4);
    doc.line(x + 0.7, y + 1.3, x + 2.7, y + 1.3);
    doc.line(x + 0.7, y + 2.3, x + 2.7, y + 2.3);
    doc.line(x + 0.7, y + 3.3, x + 2, y + 3.3);
  };

  /* ── Header / footer chrome (unchanged from the ported draft — already matches spec) ── */

  const drawGridMotif = () => {
    const x = W - MARGIN - 39;
    const y = 12;
    const width = 39;
    const height = 72;
    const [r, g, b] = hexToRgb("#E9EFF8");
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.22);
    for (let offset = 0; offset <= width; offset += 8) doc.line(x + offset, y, x + offset, y + height);
    for (let offset = 0; offset <= height; offset += 8) doc.line(x, y + offset, x + width, y + offset);
    doc.line(x, y + 22, x + width, y + 48);
    doc.line(x + 10, y, x + 31, y + height);
  };

  /** `pageNumber: null` renders the brand row with no page-number tab — used
   *  only by the cover, which is unnumbered per the addendum. */
  const drawBrand = (pageNumber: number | null) => {
    drawGridMotif();
    fillRect(doc, MARGIN, 15, 32, 1.8, BLUE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setColor(doc, BLUE);
    doc.text("CHICAGO INCENTIVE EXPLORER", MARGIN, 23);
    if (pageNumber !== null) {
      const tabX = W - MARGIN - 12;
      fillRect(doc, tabX, 12, 12, 16, BLUE);
      doc.setFontSize(11);
      setColor(doc, WHITE);
      const pageLabel = String(pageNumber);
      const pageLabelWidth = doc.getTextWidth(pageLabel);
      doc.text(pageLabel, tabX + (12 - pageLabelWidth) / 2, 22.5);
    }
    drawLine(doc, MARGIN, 29, W - MARGIN, "#B8C8E2");
  };

  const drawPageTitle = (pageNumber: number, step: string, title: string, subtitle: string) => {
    drawBrand(pageNumber);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setColor(doc, BLUE);
    doc.text(step.toUpperCase(), MARGIN, 39);
    doc.setFont("times", "bold");
    doc.setFontSize(20);
    setColor(doc, NAVY);
    doc.text(title, MARGIN, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(doc, MEDIUM_GRAY);
    doc.text(subtitle, MARGIN, 57);
  };

  const drawSectionHeading = (title: string, y: number, note?: string) => {
    fillRect(doc, MARGIN, y - 2, 18, 1.4, BLUE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    setColor(doc, BLUE);
    doc.text(title.toUpperCase(), MARGIN, y + 5);
    if (note) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      setColor(doc, LIGHT_GRAY);
      const noteWidth = doc.getTextWidth(note);
      doc.text(note, W - MARGIN - noteWidth, y + 5);
    }
  };

  /**
   * Draws a heading followed by a vertical list of rows, advancing a cursor
   * by each row's *actual measured height* (never a fixed guess) so pages
   * flow evenly instead of leaving dead whitespace bands (spec defect 1).
   * Stops drawing further rows once SAFE_BOTTOM is reached so long/stress
   * content degrades gracefully instead of colliding with the footer.
   */
  function layoutList<T>(
    title: string,
    note: string | undefined,
    y: number,
    items: T[],
    drawRow: (item: T, rowY: number, index: number) => number,
    emptyMessage?: string,
  ): number {
    drawSectionHeading(title, y, note);
    let rowY = y + HEADING_TO_ROW_GAP;
    if (items.length === 0) {
      if (emptyMessage) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        setColor(doc, MEDIUM_GRAY);
        doc.text(emptyMessage, MARGIN, rowY + 3);
        rowY += 12;
      }
      return rowY + SECTION_GAP;
    }
    items.forEach((item, index) => {
      if (rowY > SAFE_BOTTOM) return;
      const h = drawRow(item, rowY, index);
      rowY += h + (index < items.length - 1 ? ROW_GAP : 0);
    });
    return rowY + SECTION_GAP;
  }

  /* ── Row renderers (each measures its own content, then draws, then returns the height it used) ── */

  /** Bordered, left-accented card with an optional circular badge (number,
   *  check glyph, or person glyph): label + right-aligned value on the
   *  header line, wrapped detail, optional structured contact lines, and an
   *  optional source link — used for Address-Linked Opportunities, Start
   *  Here, and Recommended Actions. */
  const drawOpportunityCard = (
    item: ReportRow,
    y: number,
    options: {
      accent?: string;
      badge?: "check" | "person" | string;
      showSource?: boolean;
      detailMaxLines?: number;
      /** Skip the generic item.detail block entirely — used when the caller
       *  supplies its own structured `extraLines` instead (e.g. Start Here's
       *  parsed contact facts), so the raw run-on detail string never prints
       *  alongside the structured version (spec defect 4). */
      suppressDetail?: boolean;
      extraLines?: string[];
    } = {},
  ): number => {
    const accent = options.accent || BLUE;
    const hasBadge = Boolean(options.badge);
    const contentX = hasBadge ? MARGIN + 19 : MARGIN + 7;
    const rightPad = 7;
    const valueWidth = item.value ? 44 : 0;
    const labelWidth = CONTENT_W - (contentX - MARGIN) - rightPad - (item.value ? valueWidth + 4 : 0);
    const labelLines = fit(item.label, labelWidth, 2, 7.8, "bold");
    const valueLines = item.value ? fit(item.value, valueWidth, 2, 6.5) : [];
    const headerLines = Math.max(labelLines.length, valueLines.length, 1);

    const detail = options.suppressDetail
      ? undefined
      : item.matchExplanation?.whyItAppears[0] || item.detail || item.projectFit?.reason;
    const detailLines = detail
      ? fit(conciseText(detail, 220), CONTENT_W - (contentX - MARGIN) - rightPad, options.detailMaxLines ?? 2, 6.6)
      : [];

    const extraLines = options.extraLines ?? [];
    const sourceUrl = hasText(item.sourceUrl) ? item.sourceUrl : hasText(item.url) ? item.url : undefined;
    const showLink = Boolean(options.showSource && sourceUrl);

    const topPad = 4;
    const headerHeight = headerLines * 3.3;
    const detailBlockHeight = detailLines.length ? 2.6 + detailLines.length * 3 : 0;
    const extraBlockHeight = extraLines.length ? 2 + extraLines.length * 3.4 : 0;
    const linkHeight = showLink ? 4 : 0;
    const bottomPad = 3.2;
    const height = topPad + headerHeight + detailBlockHeight + extraBlockHeight + linkHeight + bottomPad;

    fillRect(doc, MARGIN, y, CONTENT_W, height, "#F6F8FC");
    const [borderR, borderG, borderB] = hexToRgb("#DCE4F0");
    doc.setDrawColor(borderR, borderG, borderB);
    doc.setLineWidth(0.25);
    doc.rect(MARGIN, y, CONTENT_W, height);
    fillRect(doc, MARGIN, y, 2.5, height, accent);

    if (hasBadge) {
      const cx = MARGIN + 10.5;
      const cy = y + height / 2;
      const [badgeR, badgeG, badgeB] = hexToRgb(accent);
      doc.setFillColor(badgeR, badgeG, badgeB);
      doc.circle(cx, cy, 5.2, "F");
      if (options.badge === "check") {
        drawCheckGlyph(cx, cy);
      } else if (options.badge === "person") {
        drawPersonGlyph(cx, cy, 5.2);
      } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        setColor(doc, WHITE);
        const badgeWidth = doc.getTextWidth(options.badge as string);
        doc.text(options.badge as string, cx - badgeWidth / 2, cy + 2.3);
      }
    }

    let ty = y + topPad + 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.8);
    setColor(doc, NAVY);
    labelLines.forEach((line, index) => doc.text(line, contentX, ty + index * 3.3));

    if (item.value) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      setColor(doc, MEDIUM_GRAY);
      valueLines.forEach((line, index) => {
        const lineWidth = doc.getTextWidth(line);
        doc.text(line, W - MARGIN - lineWidth - 3, ty + index * 3.1);
      });
    }
    ty += headerHeight; // advance past the header block

    if (detailLines.length) {
      ty += 2.6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.6);
      setColor(doc, MEDIUM_GRAY);
      detailLines.forEach((line, index) => doc.text(line, contentX, ty + index * 3));
      ty += detailLines.length * 3;
    }

    if (extraLines.length) {
      ty += 2;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.6);
      setColor(doc, MEDIUM_GRAY);
      extraLines.forEach((line, index) => {
        doc.text(fit(line, CONTENT_W - (contentX - MARGIN) - rightPad, 1, 6.6)[0], contentX, ty + index * 3.4);
      });
      ty += extraLines.length * 3.4;
    }

    if (showLink && sourceUrl) {
      ty += 1.6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      setColor(doc, BLUE);
      doc.textWithLink(compactUrl(sourceUrl), contentX, ty + 1.8, { url: sourceUrl });
    }

    return height;
  };

  /** Square, filled rank chip (spec defect 5: never a tall rectangle) +
   *  bold name + one-line gray description, with a clamped one-line value
   *  on the right — used for Best Programs to Explore. */
  const drawRankedRow = (item: ReportRow, y: number, rank: number): number => {
    const chip = 6.6;
    const contentX = MARGIN + chip + 5;
    const rightPad = 3;
    const valueWidth = item.value ? 52 : 0;
    const labelWidth = CONTENT_W - (contentX - MARGIN) - rightPad - (item.value ? valueWidth + 3 : 0);
    const labelLines = fit(item.label, labelWidth, 2, 7.4, "bold");
    const rankedDetail = item.matchExplanation?.whyItAppears[0] || item.detail;
    const detailLines = rankedDetail
      ? fit(conciseText(rankedDetail, 190), CONTENT_W - (contentX - MARGIN) - rightPad, 1, 6.3)
      : [];

    const topPad = 4;
    const bottomPad = 3;
    const textHeight = labelLines.length * 3.2 + (detailLines.length ? 2.6 + detailLines.length * 2.9 : 0);
    const height = Math.max(chip + topPad + 2, topPad + textHeight + bottomPad);

    drawLine(doc, MARGIN, y, W - MARGIN, "#E8EDF4");
    const chipTop = y + (height - chip) / 2;
    fillRect(doc, MARGIN, chipTop, chip, chip, AMBER);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.4);
    setColor(doc, WHITE);
    const rankText = String(rank);
    const rankWidth = doc.getTextWidth(rankText);
    doc.text(rankText, MARGIN + (chip - rankWidth) / 2, chipTop + chip / 2 + 1.3);

    let ty = y + topPad + 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.4);
    setColor(doc, NAVY);
    labelLines.forEach((line, index) => doc.text(line, contentX, ty + index * 3.2));

    if (item.value) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.4);
      setColor(doc, MEDIUM_GRAY);
      const valueText = shortValue(item.value, valueWidth, 6.4);
      const valueTextWidth = doc.getTextWidth(valueText);
      doc.text(valueText, W - MARGIN - valueTextWidth, ty);
    }
    ty += labelLines.length * 3.2;

    if (detailLines.length) {
      ty += 2.6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.3);
      setColor(doc, LIGHT_GRAY);
      detailLines.forEach((line, index) => doc.text(line, contentX, ty + index * 2.9));
    }

    return height;
  };

  /** Square green calendar tile (month over day) + wrapped bold title + one
   *  gray subtitle line, with a dedicated right-hand date column reserved
   *  up front so the title can never run into it (spec defect 2). */
  const drawDateRow = (item: ReportRow, y: number): number => {
    const chip = 9;
    const dateColWidth = 26;
    const contentX = MARGIN + chip + 5;
    const rightPad = 3;
    const labelWidth = CONTENT_W - (contentX - MARGIN) - rightPad - dateColWidth - 3;
    const labelLines = fit(item.label, labelWidth, 2, 7.2, "bold");
    const chipInfo = parseDateChip(item.value);
    const detailLines = item.detail ? fit(conciseText(item.detail, 170), labelWidth, 1, 6.2) : [];

    const topPad = 4;
    const bottomPad = 3;
    const textHeight = labelLines.length * 3.2 + (detailLines.length ? 2.6 + detailLines.length * 2.8 : 0);
    const height = Math.max(chip + topPad + 2, topPad + textHeight + bottomPad);

    drawLine(doc, MARGIN, y, W - MARGIN, "#E8EDF4");
    const chipTop = y + (height - chip) / 2;
    fillRect(doc, MARGIN, chipTop, chip, chip, GREEN);
    doc.setFont("helvetica", "bold");
    setColor(doc, WHITE);
    if (chipInfo) {
      doc.setFontSize(4.4);
      const monthWidth = doc.getTextWidth(chipInfo.month);
      doc.text(chipInfo.month, MARGIN + (chip - monthWidth) / 2, chipTop + 3.6);
      doc.setFontSize(6.2);
      const dayWidth = doc.getTextWidth(chipInfo.day);
      doc.text(chipInfo.day, MARGIN + (chip - dayWidth) / 2, chipTop + 7.4);
    } else {
      doc.setFontSize(10);
      const dot = "•";
      const dotWidth = doc.getTextWidth(dot);
      doc.text(dot, MARGIN + (chip - dotWidth) / 2, chipTop + chip / 2 + 2);
    }

    let ty = y + topPad + 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    setColor(doc, NAVY);
    labelLines.forEach((line, index) => doc.text(line, contentX, ty + index * 3.2));
    ty += labelLines.length * 3.2;

    if (detailLines.length) {
      ty += 2.6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.2);
      setColor(doc, LIGHT_GRAY);
      detailLines.forEach((line, index) => doc.text(line, contentX, ty + index * 2.8));
    }

    const dateLabel = chipInfo ? chipInfo.label : item.value;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.4);
    setColor(doc, MEDIUM_GRAY);
    const dateText = fit(dateLabel, dateColWidth, 1, 6.4)[0] ?? "";
    const dateWidth = doc.getTextWidth(dateText);
    doc.text(dateText, W - MARGIN - dateWidth, y + topPad + 2);

    return height;
  };

  /** Small gray circle with a person glyph + bold org name + one gray
   *  context line (what they help with), up to 2 lines — used for
   *  Additional Local Support. Deliberately omits the "Serves"/"Status"
   *  noise (defect 4). */
  const drawSupportRow = (item: ReportRow, y: number): number => {
    const circleR = 3.2;
    const contentX = MARGIN + circleR * 2 + 5;
    const rightPad = 4;
    const labelLines = fit(item.label, CONTENT_W - (contentX - MARGIN) - rightPad, 1, 7.4, "bold");
    const parsed = parseContactDetail(item.detail);
    const contextLines = parsed.helpWith
      ? fit(parsed.helpWith, CONTENT_W - (contentX - MARGIN) - rightPad, 2, 6.6)
      : [];

    const topPad = 4;
    const bottomPad = 3;
    const height = topPad + labelLines.length * 3.3 + (contextLines.length ? 2.4 + contextLines.length * 3 : 0) + bottomPad;

    drawLine(doc, MARGIN, y, W - MARGIN, "#E8EDF4");
    const cy = y + height / 2;
    const cx = MARGIN + circleR;
    const [r, g, b] = hexToRgb("#9AA9BE");
    doc.setFillColor(r, g, b);
    doc.circle(cx, cy, circleR, "F");
    drawPersonGlyph(cx, cy, circleR);

    let ty = y + topPad + 2.6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.4);
    setColor(doc, NAVY);
    doc.text(labelLines[0], contentX, ty);
    ty += labelLines.length * 3.3;

    if (contextLines.length) {
      ty += 2.4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.6);
      setColor(doc, MEDIUM_GRAY);
      contextLines.forEach((line, index) => doc.text(line, contentX, ty + index * 3));
    }

    return height;
  };

  /** Small green square glyph + bold name + right-aligned fixed label — used
   *  for Financing Resources (spec: no numeric/circular badge here). */
  const drawFinancingRow = (item: ReportRow, y: number): number => {
    const sq = 3;
    const contentX = MARGIN + sq + 6;
    const rightLabel = "Financing resources & options";
    const height = 9;

    drawLine(doc, MARGIN, y, W - MARGIN, "#E8EDF4");
    fillRect(doc, MARGIN, y + height / 2 - sq / 2, sq, sq, GREEN);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.3);
    setColor(doc, MEDIUM_GRAY);
    const rightWidth = doc.getTextWidth(rightLabel);
    const labelLines = fit(item.label, CONTENT_W - (contentX - MARGIN) - 4 - rightWidth - 4, 1, 7.4, "bold");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.4);
    setColor(doc, NAVY);
    doc.text(labelLines[0], contentX, y + height / 2 + 1.3);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.3);
    setColor(doc, MEDIUM_GRAY);
    doc.text(rightLabel, W - MARGIN - rightWidth, y + height / 2 + 1.3);

    return height;
  };

  /** Orange left stripe + small document glyph + bold category name, with
   *  the ACTUAL document names (grouped/deduped upstream, capped with
   *  "+N more") as a gray line underneath — this is the page-4 key fix:
   *  counts alone are never shown without names. */
  const drawDocumentCategoryRow = (item: ReportRow, y: number): number => {
    const names = parseDocumentNames(item.detail);
    const capped = names.slice(0, 3);
    const overflow = names.length - capped.length;
    const namesText = capped.length
      ? `${capped.join(", ")}${overflow > 0 ? `, +${overflow} more` : ""}`
      : "Document names to be confirmed with the program administrator.";

    const glyphX = MARGIN + 6;
    const contentX = glyphX + 8;
    const rightPad = 4;
    const countText = item.value ?? "";
    const nameLines = fit(namesText, CONTENT_W - (contentX - MARGIN) - rightPad, 1, 6.5);

    const topPad = 4;
    const bottomPad = 3;
    const categoryHeight = 3.4;
    const namesGap = 2.2;
    const height = topPad + categoryHeight + namesGap + nameLines.length * 3 + bottomPad;

    fillRect(doc, MARGIN, y, 2.2, height, AMBER);
    drawDocGlyph(glyphX, y + topPad - 0.4, AMBER);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.6);
    setColor(doc, NAVY);
    const categoryLabel = fit(item.label, CONTENT_W - (contentX - MARGIN) - rightPad - 28, 1, 7.6, "bold")[0];
    doc.text(categoryLabel, contentX, y + topPad + 3);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.3);
    setColor(doc, LIGHT_GRAY);
    const countWidth = doc.getTextWidth(countText);
    doc.text(countText, W - MARGIN - countWidth, y + topPad + 3);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    setColor(doc, MEDIUM_GRAY);
    nameLines.forEach((line, index) =>
      doc.text(line, contentX, y + topPad + categoryHeight + namesGap + 2 + index * 3),
    );

    return height;
  };

  /** Small colored square glyph + bold factor name + right-aligned value —
   *  used for Site Snapshot and Neighborhood Snapshot. */
  const drawSnapshotRow = (item: ReportRow, y: number, accent: string): number => {
    const sq = 3;
    const contentX = MARGIN + sq + 6;
    const rightPad = 4;
    const valueWidth = 60;
    const labelText = fit(item.label, CONTENT_W - (contentX - MARGIN) - rightPad - valueWidth - 3, 1, 7.4, "bold")[0];
    const valueText = fit(item.value, valueWidth, 1, 6.8)[0] ?? "";
    const height = 11;
    const baseline = y + height / 2 + 1.3;

    drawLine(doc, MARGIN, y, W - MARGIN, "#E8EDF4");
    fillRect(doc, MARGIN, y + height / 2 - sq / 2, sq, sq, accent);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.4);
    setColor(doc, NAVY);
    doc.text(labelText, contentX, baseline);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    setColor(doc, MEDIUM_GRAY);
    const valueTextWidth = doc.getTextWidth(valueText);
    doc.text(valueText, W - MARGIN - valueTextWidth, baseline);

    return height;
  };

  /* COVER (physical page 1) — no page-number tab; numbering starts at Key Findings. */
  drawBrand(null);
  const coverTitleLines = fit("Chicago Business Incentive Report", CONTENT_W, 3, 30, "bold");
  // fit() measures in helvetica and leaves it active — restore the serif
  // display face before drawing (times runs narrower, so the measured wrap
  // still fits).
  doc.setFont("times", "bold");
  doc.setFontSize(30);
  setColor(doc, NAVY);
  let coverY = 108;
  coverTitleLines.forEach((line, index) => {
    doc.text(line, MARGIN, coverY + index * 11);
  });
  coverY += (coverTitleLines.length - 1) * 11 + 16;

  fillRect(doc, MARGIN, coverY, 24, 1.8, BLUE);
  coverY += 11;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  setColor(doc, MEDIUM_GRAY);
  doc.text(address, MARGIN, coverY);
  coverY += 8;

  if (neighborhoodLabel) {
    doc.setFontSize(9.5);
    setColor(doc, LIGHT_GRAY);
    doc.text(neighborhoodLabel, MARGIN, coverY);
    coverY += 7;
  }

  if (preparedFor) {
    coverY += 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    setColor(doc, "#8A97A8");
    doc.text(`PREPARED FOR ${preparedFor.toUpperCase()}`, MARGIN, coverY);
  }

  const coverChipY = 214;
  const coverChipHeight = 22;
  fillRect(doc, MARGIN, coverChipY, CONTENT_W, coverChipHeight, NAVY);
  fillRect(doc, MARGIN, coverChipY, 3, coverChipHeight, BLUE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  setColor(doc, "#8CB4FF");
  doc.text("PRIMARY GOAL", MARGIN + 10, coverChipY + 8);
  setColor(doc, WHITE);
  doc.text(fit(primaryGoal, CONTENT_W - 20, 1, 11, "bold")[0], MARGIN + 10, coverChipY + 17);

  /* PAGE 2 - KEY FINDINGS */
  doc.addPage();
  drawBrand(2);
  doc.setFont("times", "bold");
  doc.setFontSize(27);
  setColor(doc, NAVY);
  doc.text("Key Findings", MARGIN, 45);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, MEDIUM_GRAY);
  doc.text(address, MARGIN, 55);

  fillRect(doc, MARGIN, 66, CONTENT_W, 32, NAVY);
  fillRect(doc, MARGIN, 66, 3, 32, BLUE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  setColor(doc, "#8CB4FF");
  doc.text("PRIMARY GOAL", MARGIN + 10, 76);
  doc.setFontSize(15);
  setColor(doc, WHITE);
  fit(primaryGoal, CONTENT_W - 20, 2, 15, "bold").forEach((line, index) => {
    doc.text(line, MARGIN + 10, 88 + index * 6);
  });

  const metricGap = 4;
  const metricWidth = (CONTENT_W - metricGap * 2) / 3;
  const metricY = 108;
  const metricHeight = 30;
  const metrics = [
    { value: confirmedItems.length, label: "ADDRESS-LINKED", detail: "Mapped incentive zones were recorded at this address.", color: BLUE },
    { value: discoveryItems.length, label: "TO EXPLORE", detail: "Broader programs included for review.", color: AMBER },
    { value: deadlineItems.length, label: "UPCOMING DATES", detail: "Important deadlines to keep on your radar.", color: GREEN },
  ];
  metrics.forEach((metric, index) => {
    const x = MARGIN + index * (metricWidth + metricGap);
    fillRect(doc, x, metricY, metricWidth, metricHeight, "#F6F8FC");
    const [borderR, borderG, borderB] = hexToRgb("#DCE4F0");
    doc.setDrawColor(borderR, borderG, borderB);
    doc.setLineWidth(0.25);
    doc.rect(x, metricY, metricWidth, metricHeight);
    fillRect(doc, x, metricY, 2, metricHeight, metric.color);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    setColor(doc, NAVY);
    doc.text(String(metric.value), x + 7, metricY + 9);
    doc.setFontSize(6.2);
    setColor(doc, metric.color);
    doc.text(metric.label, x + 7, metricY + 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.6);
    setColor(doc, MEDIUM_GRAY);
    fit(metric.detail, metricWidth - 12, 2, 5.6).forEach((line, lineIndex) => {
      doc.text(line, x + 7, metricY + 22 + lineIndex * 3.3);
    });
  });

  const pathHeadingY = metricY + metricHeight + SECTION_GAP;
  drawSectionHeading("Your Path Forward", pathHeadingY);
  const pathFirstY = pathHeadingY + HEADING_TO_ROW_GAP;
  const pathSteps = [
    { number: "1", title: "Review the findings", detail: "Start with address-linked opportunities, best discovery leads, and upcoming dates." },
    { number: "2", title: "Identify who you should contact next", detail: "Use the primary local contact first, then reach the program or financing resource." },
    { number: "3", title: "Take the next step", detail: "Confirm fit, gather the priority documents, and schedule the first conversation." },
  ];
  pathSteps.forEach((step, index) => {
    const y = pathFirstY + index * 25;
    fillRect(doc, MARGIN, y, CONTENT_W, 20, index === 0 ? "#EFF4FD" : "#F8FAFD");
    const cardBorder = index === 0 ? "#7EA6EB" : "#D7E0ED";
    const [cardR, cardG, cardB] = hexToRgb(cardBorder);
    doc.setDrawColor(cardR, cardG, cardB);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN, y, CONTENT_W, 20);
    const circleColor = index === 0 ? BLUE : "#74869F";
    const [circleR, circleG, circleB] = hexToRgb(circleColor);
    doc.setFillColor(circleR, circleG, circleB);
    doc.circle(MARGIN + 9, y + 10, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, WHITE);
    const numberWidth = doc.getTextWidth(step.number);
    doc.text(step.number, MARGIN + 9 - numberWidth / 2, y + 12.4);
    doc.setFontSize(8);
    setColor(doc, NAVY);
    doc.text(step.title, MARGIN + 19, y + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.6);
    setColor(doc, MEDIUM_GRAY);
    doc.text(step.detail, MARGIN + 19, y + 14);
  });

  /* PAGE 3 - REVIEW */
  doc.addPage();
  drawPageTitle(3, "Step 1", "Review the Findings", "Start with mapped address records. Address-linked does not establish program approval.");
  let y2 = 64;

  y2 = layoutList(
    "Address-Linked Opportunities",
    `${confirmedItems.length} found`,
    y2,
    confirmedItems.slice(0, 2),
    (item, rowY) => drawOpportunityCard(item, rowY, {
      detailMaxLines: 2,
      showSource: true,
      extraLines: matchExplanationLines(item),
    }),
    "No address-linked opportunity was found. Continue with the discovery leads below.",
  );

  y2 = layoutList(
    "Best Programs to Explore",
    `Top ${Math.min(4, discoveryItems.length)} of ${discoveryItems.length}`,
    y2,
    discoveryItems.slice(0, 4),
    (item, rowY, index) => drawRankedRow(item, rowY, index + 1),
  );

  layoutList(
    "Upcoming Dates",
    `Next ${Math.min(3, deadlineItems.length)}`,
    y2,
    deadlineItems.slice(0, 3),
    (item, rowY) => drawDateRow(item, rowY),
  );

  /* PAGE 4 - CONTACT */
  doc.addPage();
  drawPageTitle(4, "Step 2", "Who to Contact Next", "Start with the most relevant local guide, then contact the program or financing resource directly.");
  let y3 = 64;
  const primaryContact = supportItems[0];
  const additionalSupport = supportItems.slice(1, 5);

  if (primaryContact) {
    y3 = layoutList("Start Here", undefined, y3, [primaryContact], (item, rowY) => {
      const parsed = parseContactDetail(item.detail);
      return drawOpportunityCard(item, rowY, {
        accent: BLUE,
        badge: "person",
        showSource: true,
        suppressDetail: true,
        extraLines: [parsed.helpWith, ...contactLines(parsed)].filter((line): line is string => Boolean(line)),
      });
    });
  }

  y3 = layoutList(
    "Additional Local Support",
    `Top ${Math.min(4, additionalSupport.length)}`,
    y3,
    additionalSupport,
    (item, rowY) => drawSupportRow(item, rowY),
    "No additional local organizations were mapped for this address yet.",
  );

  layoutList(
    "Financing Resources",
    `Top ${Math.min(2, financingItems.length)}`,
    y3,
    financingItems.slice(0, 2),
    (item, rowY) => drawFinancingRow(item, rowY),
  );

  /* PAGE 5 - NEXT STEP */
  doc.addPage();
  drawPageTitle(5, "Step 3", "Take the Next Step", "Turn the report into a short, practical preparation list for the next conversation.");
  let y4 = 64;

  y4 = layoutList(
    "Recommended Actions",
    undefined,
    y4,
    report.recommendedActions.slice(0, 3),
    (action, rowY, index) => {
      const item: ReportRow = { label: action.label, value: index === 0 ? "FIRST" : "NEXT", detail: action.description };
      return drawOpportunityCard(item, rowY, {
        detailMaxLines: 2,
        accent: index === 0 ? BLUE : index === 1 ? AMBER : "#74869F",
        badge: index === 0 ? "check" : String(index + 1),
      });
    },
  );

  y4 = layoutList(
    "Priority Documents",
    `Top ${Math.min(4, requiredItems.length)} categories`,
    y4,
    requiredItems.slice(0, 4),
    (item, rowY) => drawDocumentCategoryRow(item, rowY),
  );

  drawSectionHeading("Readiness Checklist", y4, `Top ${Math.min(8, readinessItems.length)} items`);
  const checklistFirstY = y4 + HEADING_TO_ROW_GAP;
  const checklistWidth = (CONTENT_W - 5) / 2;
  const checklistRowHeight = 8.5;
  readinessItems.slice(0, 8).forEach((item, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = MARGIN + col * (checklistWidth + 5);
    const rowY = checklistFirstY + row * checklistRowHeight;
    // Defensive: this hand-rolled grid isn't covered by layoutList's guard.
    // Skip rows that would otherwise collide with the footer (two sections
    // deep on a dense-data page) instead of overflowing.
    if (rowY > GRID_SAFE_BOTTOM) return;
    doc.setDrawColor(160, 174, 195);
    doc.setLineWidth(0.3);
    doc.rect(x, rowY - 3.2, 3.6, 3.6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.6);
    setColor(doc, NAVY);
    doc.text(fit(item.label, checklistWidth - 26, 1, 6.6)[0], x + 6.5, rowY - 0.2);
    doc.setFontSize(5.9);
    setColor(doc, LIGHT_GRAY);
    const status = fit(item.value || "Confirm", 20, 1, 5.9)[0] ?? "";
    const statusWidth = doc.getTextWidth(status);
    doc.text(status, x + checklistWidth - statusWidth, rowY - 0.2);
  });

  /* PAGE 6 - SUPPORTING CONTEXT */
  doc.addPage();
  drawPageTitle(6, "Reference", "Supporting Context", "Use these signals to prepare questions. They are context, not proof of program eligibility.");
  let y5 = 64;

  y5 = layoutList(
    "Site Snapshot",
    `Top ${Math.min(6, siteItems.length)} signals`,
    y5,
    siteItems.slice(0, 6),
    (item, rowY) => drawSnapshotRow(item, rowY, BLUE),
  );

  y5 = layoutList(
    "Neighborhood Snapshot",
    `Top ${Math.min(5, neighborhoodItems.length)} indicators`,
    y5,
    neighborhoodItems.slice(0, 5),
    (item, rowY) => drawSnapshotRow(item, rowY, "#9AA9BE"),
  );

  drawSectionHeading("Sources & Verification", y5, `Top ${Math.min(4, report.dataSources?.length || 0)} source groups`);
  const sourceItems = (report.dataSources || []).slice(0, 4);
  const sourceColumnWidth = (CONTENT_W - 8) / 2;
  const sourceFirstY = y5 + HEADING_TO_ROW_GAP;
  const sourceRowHeight = 13;
  sourceItems.forEach((source, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = MARGIN + col * (sourceColumnWidth + 8);
    const rowY = sourceFirstY + row * sourceRowHeight;
    // Defensive: same footer-collision guard as the readiness checklist.
    if (rowY > GRID_SAFE_BOTTOM) return;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    setColor(doc, NAVY);
    doc.text(fit(source.label, sourceColumnWidth, 1, 7.2, "bold")[0], x, rowY);
    if (source.url) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      setColor(doc, BLUE);
      doc.textWithLink(compactUrl(source.url), x, rowY + 4.4, { url: source.url });
    }
  });

  /* PAGE 7 - CTA ("what happens after this report") */
  doc.addPage();
  drawPageTitle(7, "Get Support", "Want a Hand with the Next Steps?", "You do not have to figure this out alone.");
  let y7 = 64;

  const ctaCopy =
    "If you'd like one-on-one support or an introduction to any program or financing partner in this report, reach out. A real person will pick it up.";
  const ctaCopyLines = fit(ctaCopy, CONTENT_W - 20, 3, 8.5);
  const ctaEmailGap = 9;
  const ctaCardHeight = 11 + ctaCopyLines.length * 4 + ctaEmailGap + 6;

  fillRect(doc, MARGIN, y7, CONTENT_W, ctaCardHeight, "#F6F8FC");
  const [ctaBorderR, ctaBorderG, ctaBorderB] = hexToRgb("#DCE4F0");
  doc.setDrawColor(ctaBorderR, ctaBorderG, ctaBorderB);
  doc.setLineWidth(0.25);
  doc.rect(MARGIN, y7, CONTENT_W, ctaCardHeight);
  fillRect(doc, MARGIN, y7, 2.5, ctaCardHeight, BLUE);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setColor(doc, NAVY);
  ctaCopyLines.forEach((line, index) => doc.text(line, MARGIN + 10, y7 + 11 + index * 4));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  setColor(doc, BLUE);
  doc.text("info@southeastchgochamber.org", MARGIN + 10, y7 + 11 + ctaCopyLines.length * 4 + ctaEmailGap);

  y7 += ctaCardHeight + SECTION_GAP;

  const recapSteps = [
    { number: "1", title: "Review", detail: "Start with address-linked opportunities, best discovery leads, and upcoming dates." },
    { number: "2", title: "Contact", detail: "Use the primary local contact first, then reach the program or financing resource." },
    { number: "3", title: "Next step", detail: "Confirm fit, gather the priority documents, and schedule the first conversation." },
  ];
  const recapRowHeight = 9;
  recapSteps.forEach((step, index) => {
    const rowY = y7 + index * recapRowHeight;
    const [circleR, circleG, circleB] = hexToRgb(BLUE);
    doc.setFillColor(circleR, circleG, circleB);
    doc.circle(MARGIN + 3, rowY - 1, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    setColor(doc, WHITE);
    const numberWidth = doc.getTextWidth(step.number);
    doc.text(step.number, MARGIN + 3 - numberWidth / 2, rowY + 0.7);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.6);
    setColor(doc, NAVY);
    const titleText = `${step.title}:`;
    doc.text(titleText, MARGIN + 10, rowY);
    const titleWidth = doc.getTextWidth(`${titleText} `);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, MEDIUM_GRAY);
    doc.text(fit(step.detail, CONTENT_W - 10 - titleWidth, 1, 7)[0], MARGIN + 10 + titleWidth, rowY);
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  setColor(doc, LIGHT_GRAY);
  doc.text(
    "Informational screening only. Confirm current eligibility, timing, and approval requirements with the administering organization.",
    MARGIN,
    H - 14,
  );

  /* PAGE HEADERS/FOOTERS across all physical pages. The cover carries no
     page-number tab and no "Page N of M" — date only, per the addendum. */
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    setColor(doc, LIGHT_GRAY);
    doc.text(dateStr, MARGIN, H - 8);
    if (page > 1) {
      const pageText = `Page ${page} of ${totalPages}`;
      const pageTextWidth = doc.getTextWidth(pageText);
      doc.text(pageText, W - MARGIN - pageTextWidth, H - 8);
    }
  }

  const slug = address.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  return { doc, slug };
}

function _buildReportPdf(report: GeneratedReport): { doc: jsPDF; slug: string } {
  const publicReport = normalizePublicReportForDisplay(report);
  if (publicReport.reportType === "site-incentives" || publicReport.reportType === "location-incentives") {
    return _buildSevenPageActionReportPdf(publicReport);
  }
  return _buildLegacyReportPdf(publicReport);
}

export function generateReportPdf(report: GeneratedReport): void {
  const { doc, slug } = _buildReportPdf(report);
  doc.save(`chicago-incentive-report-${slug}.pdf`);
}

/** Return enhanced report PDF as base64 string (for email attachment) */
export function generateReportPdfBase64(
  report: GeneratedReport
): { base64: string; filename: string } {
  const { doc, slug } = _buildReportPdf(report);
  const base64 = doc.output("datauristring").split(",")[1];
  return { base64, filename: `chicago-incentive-report-${slug}.pdf` };
}
