/**
 * The handoff one-pager: a single-page PDF of the zoning-stage handoff,
 * for the navigator who gets handed paper, an email attachment, or a
 * printout — the offline twin of the share-sheet text.
 *
 * SINGLE COMPOSITION PATH
 * -----------------------
 * This renders `buildZoningHandoff(...).sections` — the same structure
 * the plain-text share body is joined from. There is no second copy of
 * any sentence here; a copy change in lib/stage-handoff.ts changes the
 * share text and this PDF together. Layout only, no authorship.
 *
 * ONE PAGE IS A CONTRACT
 * ----------------------
 * The share text is capped (~35 lines) by the handoff's own limits, so
 * everything fits a Letter page at these sizes. If future content ever
 * threatens the footer band, the renderer shrinks the body face one
 * step rather than spilling — a navigator brief that runs to page two
 * has failed at its one job. A test asserts the page count.
 */

import { jsPDF } from "jspdf";
import {
  buildZoningHandoff,
  type StageHandoffSection,
  type ZoningHandoffInput,
} from "./stage-handoff";

const NAVY = "#0C1B33";
const BLUE = "#2563EB";
const INK_MUTED = "#5A626E";
const RULE = "#D2D7DE";

const PAGE_W = 612; // Letter, points
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_ZONE = PAGE_H - 88;

interface Cursor {
  y: number;
}

function drawTitleBand(doc: jsPDF, titleLine: string, subject: string, cursor: Cursor): void {
  doc.setFillColor(NAVY);
  doc.rect(0, 0, PAGE_W, 96, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(titleLine.toUpperCase(), MARGIN, 40);
  doc.setFontSize(15);
  const subjectLines = doc.splitTextToSize(subject, CONTENT_W) as string[];
  doc.text(subjectLines.slice(0, 2), MARGIN, 62);
  cursor.y = 96 + 28;
}

function drawFields(doc: jsPDF, lines: string[], cursor: Cursor): void {
  doc.setFontSize(10);
  for (const entry of lines) {
    const split = entry.indexOf(": ");
    const label = split > 0 ? entry.slice(0, split) : entry;
    const value = split > 0 ? entry.slice(split + 2) : "";
    doc.setFont("helvetica", "bold");
    doc.setTextColor(INK_MUTED);
    doc.text(label.toUpperCase(), MARGIN, cursor.y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(NAVY);
    const valueLines = doc.splitTextToSize(value, CONTENT_W - 190) as string[];
    doc.text(valueLines, MARGIN + 190, cursor.y);
    cursor.y += Math.max(valueLines.length, 1) * 13 + 4;
  }
  cursor.y += 6;
}

function drawParagraph(doc: jsPDF, lines: string[], cursor: Cursor, accent: boolean): void {
  doc.setFont("helvetica", accent ? "bold" : "normal");
  doc.setFontSize(accent ? 10.5 : 9.5);
  doc.setTextColor(NAVY);
  for (const paragraph of lines) {
    const wrapped = doc.splitTextToSize(paragraph, CONTENT_W - (accent ? 14 : 0)) as string[];
    if (accent) {
      doc.setFillColor(BLUE);
      doc.rect(MARGIN, cursor.y - 9, 3, wrapped.length * 12 + 4, "F");
      doc.text(wrapped, MARGIN + 14, cursor.y);
    } else {
      doc.text(wrapped, MARGIN, cursor.y);
    }
    cursor.y += wrapped.length * 12 + 12;
  }
}

function drawList(doc: jsPDF, section: StageHandoffSection, cursor: Cursor): void {
  if (section.heading) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(INK_MUTED);
    doc.text(section.heading.toUpperCase(), MARGIN, cursor.y);
    cursor.y += 14;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(NAVY);
  for (const item of section.lines) {
    const wrapped = doc.splitTextToSize(item, CONTENT_W - 10) as string[];
    doc.text(wrapped, MARGIN + 10, cursor.y);
    cursor.y += wrapped.length * 12 + 3;
  }
  cursor.y += 10;
}

function drawFooter(doc: jsPDF, lines: string[]): void {
  doc.setDrawColor(RULE);
  doc.setLineWidth(0.75);
  doc.line(MARGIN, FOOTER_ZONE, PAGE_W - MARGIN, FOOTER_ZONE);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(INK_MUTED);
  let y = FOOTER_ZONE + 16;
  for (const entry of lines) {
    const wrapped = doc.splitTextToSize(entry, CONTENT_W) as string[];
    doc.text(wrapped, MARGIN, y);
    y += wrapped.length * 11 + 4;
  }
  doc.setFont("helvetica", "normal");
  doc.text(
    `Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} · chicagoincentiveexplorer.com`,
    MARGIN,
    y + 4,
  );
}

/** Render the one-pager. Exported separately from save for testability. */
export function renderZoningHandoffPdf(input: ZoningHandoffInput): jsPDF {
  const handoff = buildZoningHandoff(input);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const cursor: Cursor = { y: 0 };

  const bodySections = handoff.sections.filter(
    (s) => s.kind !== "title" && s.kind !== "footer",
  );
  const title = handoff.sections.find((s) => s.kind === "title");
  const footer = handoff.sections.find((s) => s.kind === "footer");

  drawTitleBand(doc, title?.lines[0] ?? "Zoning-stage handoff", handoff.subject, cursor);

  let paragraphsDrawn = 0;
  for (const section of bodySections) {
    if (section.kind === "fields") drawFields(doc, section.lines, cursor);
    else if (section.kind === "paragraph") {
      // The first paragraph is the open question — the one thing the
      // recipient must read — and gets the accent treatment.
      drawParagraph(doc, section.lines, cursor, paragraphsDrawn === 0);
      paragraphsDrawn += 1;
    } else if (section.kind === "list") drawList(doc, section, cursor);
    if (cursor.y > FOOTER_ZONE - 20) break; // one page is the contract
  }

  drawFooter(doc, footer?.lines ?? []);
  return doc;
}

/** Browser entry point: render and trigger the download. */
export function downloadZoningHandoffPdf(input: ZoningHandoffInput): void {
  const doc = renderZoningHandoffPdf(input);
  const slug = (input.address ?? "site")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  doc.save(`zoning-handoff-${slug || "site"}.pdf`);
}
