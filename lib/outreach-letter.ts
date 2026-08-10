import { jsPDF } from "jspdf";
import type { ParcelProgramContext } from "./owner-file-letter-context";

/**
 * Owner outreach letter — the two-tier jsPDF builder convention from
 * lib/pdf-report.ts (`_buildXPdf` -> `generateXPdf` client `.save()` /
 * `generateXPdfBase64` server base64). Pure/synchronous — the per-parcel
 * program context is resolved beforehand (lib/owner-file-letter-context.ts,
 * called server-side from the outreach API route) and passed in here, so
 * this file has no server-only imports and stays safe for the client
 * download button to import directly.
 *
 * Gated on `verificationStatus === "verified"` — enforced primarily by the
 * outreach API route (app/api/owner-file/[clusterKey]/outreach/route.ts)
 * and the calling UI (the button is disabled on an unverified cluster), and
 * re-asserted here as defense in depth: this builder refuses to produce a
 * letter for an unverified owner record.
 */

const NAVY = "#0C1B33";
const BLUE = "#2563EB";
const LIGHT_GRAY = "#9CA3AF";
const MEDIUM_GRAY = "#6B7280";

const W = 215.9;
const H = 279.4;
const MARGIN = 22;
const CONTENT_W = W - MARGIN * 2;

/**
 * The repo's locked verification-disclaimer copy, verbatim from the
 * "Official next steps" block (components/programs/ProgramsCatalog.tsx) — the same
 * string every program mention in the product carries (see
 * docs/business-file/03-design-handoff.md's "locked verification copy" and
 * 04-design-timelines.md). Every per-parcel program-mention block below
 * reuses this exact string rather than paraphrasing it.
 */
export const VERIFICATION_DISCLAIMER =
  "Some incentives require certification, pre-approval, or reporting through the administering agency. Verify current requirements with the official source before applying, purchasing materials, or beginning work.";

export interface OutreachLetterInput {
  ownerName: string;
  ownerMailingAddress: string;
  corridorManagerName: string;
  corridorManagerContact: string;
  organizationName?: string;
  zip: string;
  clusterKey: string;
  /** Must be "verified" — see module doc. */
  verificationStatus: string;
  parcelProgramContext: ParcelProgramContext[];
}

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

function wrapText(doc: jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  lines.forEach((line, i) => doc.text(line, x, y + i * lineHeight));
  return lines.length * lineHeight;
}

function checkPage(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > H - MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function _buildOutreachLetterPdf(input: OutreachLetterInput): { doc: jsPDF; slug: string } {
  if (input.verificationStatus !== "verified") {
    throw new Error(
      "Outreach letters can only be generated for a verified Owner File (verification.status === 'verified')."
    );
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const org = input.organizationName || "Southeast Chicago Chamber of Commerce";
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  let y = MARGIN;

  fillRect(doc, MARGIN, y, 30, 1.2, BLUE);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setColor(doc, NAVY);
  doc.text(org, MARGIN, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, MEDIUM_GRAY);
  doc.text(input.corridorManagerName || "Corridor Manager", MARGIN, y);
  y += 4.5;
  if (input.corridorManagerContact) {
    doc.text(input.corridorManagerContact, MARGIN, y);
    y += 4.5;
  }
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, MEDIUM_GRAY);
  doc.text(dateStr, MARGIN, y);
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setColor(doc, NAVY);
  doc.text(input.ownerName || "Owner of Record", MARGIN, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, MEDIUM_GRAY);
  y += wrapText(doc, input.ownerMailingAddress || "Mailing address on file with the Cook County Assessor", MARGIN, y, CONTENT_W, 4.2);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  setColor(doc, NAVY);
  doc.text(`Dear ${input.ownerName ? "Owner of Record" : "Owner of Record"},`, MARGIN, y);
  y += 8;

  const parcelCount = input.parcelProgramContext.length;
  const intro =
    `Our records show you as the owner of record for ${parcelCount} propert${parcelCount === 1 ? "y" : "ies"} ` +
    `in ZIP ${input.zip} within a corridor served by ${org}. We are reaching out because one or more incentive ` +
    `programs may apply to these properties, and we would like to help you understand your options and connect ` +
    `you with the right local resources.`;
  y += wrapText(doc, intro, MARGIN, y, CONTENT_W, 4.6);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  setColor(doc, NAVY);
  doc.text("Your properties and potentially applicable programs", MARGIN, y);
  y += 6;

  for (const parcel of input.parcelProgramContext) {
    y = checkPage(doc, y, 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setColor(doc, NAVY);
    doc.text(parcel.address, MARGIN, y);
    y += 4.5;

    if (parcel.programs.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      setColor(doc, LIGHT_GRAY);
      y += wrapText(
        doc,
        parcel.resolutionNote || "No mapped incentive zones matched this address in our current data.",
        MARGIN + 4,
        y,
        CONTENT_W - 4,
        3.8
      );
      y += 4;
      continue;
    }

    for (const program of parcel.programs) {
      y = checkPage(doc, y, 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      setColor(doc, BLUE);
      doc.text("•", MARGIN + 2, y);
      setColor(doc, NAVY);
      y += wrapText(doc, `${program.name} (${program.level})`, MARGIN + 6, y, CONTENT_W - 6, 4) - 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      setColor(doc, MEDIUM_GRAY);
      y += 4;
      y += wrapText(doc, program.summary, MARGIN + 6, y, CONTENT_W - 6, 3.8);
      y += 2;
    }

    // Every program-mention block carries the repo's locked verification
    // disclaimer verbatim.
    y = checkPage(doc, y, 10);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    setColor(doc, LIGHT_GRAY);
    y += wrapText(doc, VERIFICATION_DISCLAIMER, MARGIN + 6, y, CONTENT_W - 6, 3.4);
    y += 5;
  }

  y = checkPage(doc, y, 30);
  y += 2;
  const closing =
    `We would welcome the opportunity to discuss these properties with you or a representative you designate. ` +
    `${org} can help connect you with the appropriate program administrators and local delegate-agency partners. ` +
    `Please reach out using the contact information above.`;
  y += wrapText(doc, closing, MARGIN, y, CONTENT_W, 4.6);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setColor(doc, NAVY);
  doc.text("Sincerely,", MARGIN, y);
  y += 12;
  doc.setFont("helvetica", "bold");
  doc.text(input.corridorManagerName || "Corridor Manager", MARGIN, y);
  y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setColor(doc, MEDIUM_GRAY);
  doc.text(org, MARGIN, y);

  // Footer, every page.
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, LIGHT_GRAY);
    const footer = `Page ${i} of ${totalPages} — Generated ${dateStr} by Chicago Incentive Explorer (Owner Files, admin tool)`;
    doc.text(footer, MARGIN, H - 10);
  }

  const slug = (input.ownerName || input.clusterKey).replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  return { doc, slug };
}

export function generateOutreachLetter(input: OutreachLetterInput): void {
  const { doc, slug } = _buildOutreachLetterPdf(input);
  doc.save(`outreach-letter-${slug}.pdf`);
}

/** Return the outreach letter PDF as base64 (for future server-side use, e.g. mailing/attachment). */
export function generateOutreachLetterBase64(
  input: OutreachLetterInput
): { base64: string; filename: string } {
  const { doc, slug } = _buildOutreachLetterPdf(input);
  const base64 = doc.output("datauristring").split(",")[1];
  return { base64, filename: `outreach-letter-${slug}.pdf` };
}
