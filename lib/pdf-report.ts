import { jsPDF } from "jspdf";
import { ZONE_KEYS, ZONE_LABELS, ZONE_COLORS } from "./constants";
import type { LookupResult, Program } from "./types";
import type { GeneratedReport, DataSourceCitation } from "./report-engine";

/* ── Brand Colors ── */
const NAVY = "#0C1B33";
const BLUE = "#2563EB";
const WHITE = "#FFFFFF";
const OFF_WHITE = "#FAF9F6";
const LIGHT_GRAY = "#9CA3AF";
const MEDIUM_GRAY = "#6B7280";
const GREEN = "#16A34A";

/* ── Page Dimensions (letter, mm) ── */
const W = 215.9;
const H = 279.4;
const MARGIN = 20;
const CONTENT_W = W - MARGIN * 2;

/* ── Helpers ── */

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

export function generateReport(
  result: LookupResult,
  programs: Program[]
): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const programMap = new Map(programs.map((p) => [p.zoneKey, p]));
  const allPrograms = new Map(programs.map((p) => [p.id, p]));

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

  // Score box
  coverY = Math.max(coverY + 10, 195);
  fillRect(doc, MARGIN, coverY, CONTENT_W, 40, "#FFFFFF08");
  fillRect(doc, MARGIN, coverY, 3, 40, BLUE);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, "#FFFFFF60");
  doc.text("INCENTIVE STACKING SCORE", MARGIN + 12, coverY + 12);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  setColor(doc, WHITE);
  doc.text(`${result.incentiveCount}`, MARGIN + 12, coverY + 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  setColor(doc, "#FFFFFF50");
  doc.text(`of ${ZONE_KEYS.length} incentive zones`, MARGIN + 12 + doc.getTextWidth(`${result.incentiveCount} `) + 5, coverY + 28);

  // Footer
  doc.setFontSize(8);
  setColor(doc, "#FFFFFF40");
  doc.text(dateStr, MARGIN, H - 25);
  doc.text("Generated by Chicago Site Incentive Map", MARGIN, H - 18);
  doc.setFontSize(7);
  setColor(doc, "#FFFFFF30");
  doc.text("Southeast Chicago Chamber of Commerce", MARGIN, H - 12);

  /* ── PAGE 2: WHAT YOU MAY BE ELIGIBLE FOR ── */
  doc.addPage();
  let y = MARGIN + 5;

  drawAccentBar(doc, MARGIN, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, LIGHT_GRAY);
  doc.text("02", MARGIN, y);
  doc.text("ELIGIBILITY SUMMARY", MARGIN + 12, y);
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  setColor(doc, NAVY);
  doc.text("Here\u2019s What You", MARGIN, y);
  y += 9;
  setColor(doc, "#0C1B3366");
  doc.text("May Be Eligible For", MARGIN, y);
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
      `Unemployment Rate: ${result.employment.unemploymentRate} — Your business may qualify for WOTC and workforce incentives.`,
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

      // Green "Eligible" badge
      const badgeX = MARGIN + 125;
      fillRect(doc, badgeX, y - 3.5, 20, 5, "#DCFCE7");
      doc.setFontSize(6);
      setColor(doc, GREEN);
      doc.text("ELIGIBLE", badgeX + 2, y);
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
    doc.text("These programs are available regardless of zone location:", MARGIN, y);
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
    "Understanding your property\u2019s valuation can help you estimate tax incentive savings and appeal assessments.",
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

    // ── WHAT YOU MAY BE ELIGIBLE FOR (Benefits) ──
    y = checkPage(doc, y, 30);
    fillRect(doc, MARGIN, y, 3, 1.5, GREEN);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, NAVY);
    doc.text("WHAT YOU MAY BE ELIGIBLE FOR", MARGIN + 8, y + 1);
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
    "Review each eligible program in this report and confirm you meet the requirements.",
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

  // SECCC Contact block
  y += 10;
  y = checkPage(doc, y, 40);
  fillRect(doc, MARGIN, y, CONTENT_W, 35, NAVY);
  fillRect(doc, MARGIN, y, CONTENT_W, 2, BLUE);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setColor(doc, WHITE);
  doc.text("SOUTHEAST CHICAGO CHAMBER OF COMMERCE", MARGIN + 10, y + 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, "#FFFFFF80");
  doc.text("Phone: (773) 721-1999", MARGIN + 10, y + 20);
  doc.text("Web: www.secchicago.org", MARGIN + 10, y + 26);
  doc.text("Serving the 7th, 8th, and 10th Wards of Chicago", MARGIN + 10, y + 32);

  // Final footer
  doc.setFontSize(7);
  setColor(doc, LIGHT_GRAY);
  doc.text(
    `Report generated ${dateStr} by Chicago Site Incentive Map. Data is informational and not a guarantee of eligibility.`,
    MARGIN,
    H - 10
  );

  /* ── SAVE ── */
  const slug = name.replace(/\s+/g, "-").toLowerCase();
  doc.save(`chicago-incentive-report-${slug}.pdf`);
}

/* ══════════════════════════════════════════════════════
   GENERATE ENHANCED PDF from GeneratedReport
   ══════════════════════════════════════════════════════ */

export function generateReportPdf(report: GeneratedReport): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
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
    const vColor = report.verdict.signal === "strong" ? "#16A34A" : report.verdict.signal === "moderate" ? "#D97706" : "#EF4444";
    fillRect(doc, MARGIN, coverY, CONTENT_W, 32, "#FFFFFF08");
    fillRect(doc, MARGIN, coverY, 3, 32, vColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, vColor);
    doc.text(report.verdict.signal.toUpperCase(), MARGIN + 10, coverY + 10);
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
  if (report.metadata?.industry) doc.text(`Industry: ${report.metadata.industry}`, MARGIN, coverY);
  if (report.metadata?.zoneClass) { coverY += 6; doc.text(`Zoning: ${report.metadata.zoneClass}`, MARGIN, coverY); }

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

  if (report.summary) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setColor(doc, MEDIUM_GRAY);
    y += wrapText(doc, report.summary, MARGIN, y, CONTENT_W, 4.5);
    y += 8;
  }

  // Verdict reasons
  if (report.verdict && report.verdict.topReasons.length > 0) {
    const vColor = report.verdict.signal === "strong" ? "#16A34A" : report.verdict.signal === "moderate" ? "#D97706" : "#EF4444";
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

  /* ── PAGE 3+: SECTIONS ── */
  for (const section of report.sections) {
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
      y += wrapText(doc, section.description, MARGIN, y, CONTENT_W, 3.5);
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
      doc.text(item.label, MARGIN + 6, y);

      if (item.value) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        setColor(doc, MEDIUM_GRAY);
        const valW = doc.getTextWidth(item.value);
        doc.text(item.value, W - MARGIN - valW, y);
      }

      if (item.detail) {
        y += 4;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        setColor(doc, LIGHT_GRAY);
        y += wrapText(doc, item.detail, MARGIN + 6, y, CONTENT_W - 10, 3.5);
      }
      y += 4;
    }
    y += 6;
  }

  /* ── RECOMMENDED ACTIONS ── */
  if (report.recommendedActions && report.recommendedActions.length > 0) {
    y = checkPage(doc, y, 40);
    if (y > H - 50) { doc.addPage(); y = MARGIN + 10; }
    drawAccentBar(doc, MARGIN, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setColor(doc, NAVY);
    doc.text("Recommended Actions", MARGIN, y);
    y += 8;

    report.recommendedActions.forEach((action, i) => {
      y = checkPage(doc, y, 16);
      fillRect(doc, MARGIN, y, CONTENT_W, 12, i % 2 === 0 ? "#FAFAFA" : WHITE);
      fillRect(doc, MARGIN, y, 3, 12, BLUE);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      setColor(doc, BLUE);
      doc.text(`${i + 1}`, MARGIN + 8, y + 8);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      setColor(doc, NAVY);
      doc.text(action.label, MARGIN + 16, y + 8);
      y += 15;
    });
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
    doc.text("Data Sources", MARGIN, y);
    y += 8;

    for (const src of report.dataSources) {
      y = checkPage(doc, y, 16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      setColor(doc, NAVY);
      doc.text(src.label, MARGIN + 4, y);
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      setColor(doc, LIGHT_GRAY);
      y += wrapText(doc, src.description, MARGIN + 4, y, CONTENT_W - 8, 3.5);
      if (src.url) {
        y += 1;
        setColor(doc, BLUE);
        doc.setFontSize(6);
        doc.text(src.url, MARGIN + 4, y);
        y += 4;
      }
      y += 3;
    }
  }

  // SECCC Contact block
  y += 8;
  y = checkPage(doc, y, 40);
  fillRect(doc, MARGIN, y, CONTENT_W, 35, NAVY);
  fillRect(doc, MARGIN, y, CONTENT_W, 2, BLUE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setColor(doc, WHITE);
  doc.text("SOUTHEAST CHICAGO CHAMBER OF COMMERCE", MARGIN + 10, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, "#FFFFFF80");
  doc.text("Phone: (773) 721-1999", MARGIN + 10, y + 20);
  doc.text("Web: www.secchicago.org", MARGIN + 10, y + 26);
  doc.text("Serving the 7th, 8th, and 10th Wards of Chicago", MARGIN + 10, y + 32);

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

  /* ── SAVE ── */
  const slug = address.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  doc.save(`chicago-incentive-report-${slug}.pdf`);
}
