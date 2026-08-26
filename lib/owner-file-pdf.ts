import { jsPDF } from "jspdf";
import type { OwnerFile } from "./owner-file";
import { clerkRecordsUrl, cookViewerUrl } from "./cook-viewer";

/**
 * Owner File dossier PDF — the two-tier jsPDF builder convention from
 * lib/pdf-report.ts (`_buildXPdf` -> `generateXPdf` client `.save()` /
 * `generateXPdfBase64` server base64). Pure/synchronous — no network or DB
 * calls — so it stays safe to import from client components.
 *
 * For a corridor manager's site visit or LIRI meeting: identity, parcel
 * footprint, distress signals (building violations, vacant-building
 * violations, and tax-sale exposure are live; delinquent-tax exposure and
 * Cook County Land Bank inventory stay "not yet available" until the owner-file
 * companion join is wired — matching the DataPendingRow doctrine, never a
 * silent zero),
 * transfer/business-license context, the current verification record, and
 * outreach history.
 */

const NAVY = "#0C1B33";
const BLUE = "#2563EB";
const WHITE = "#FFFFFF";
const LIGHT_GRAY = "#9CA3AF";
const MEDIUM_GRAY = "#6B7280";
const GREEN = "#16A34A";
const AMBER = "#D97706";

const TIER_COLORS: Record<string, string> = { A: GREEN, B: "#2563EB", C: AMBER, D: "#9CA3AF" };

const W = 215.9;
const H = 279.4;
const MARGIN = 20;
const CONTENT_W = W - MARGIN * 2;

const VERIFICATION_DISCLAIMER =
  "Some incentives require certification, pre-approval, or reporting through the administering agency. Verify current requirements with the official source before applying, purchasing materials, or beginning work.";

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

function wrapText(doc: jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  lines.forEach((line, i) => doc.text(line, x, y + i * lineHeight));
  return lines.length * lineHeight;
}

function checkPage(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > H - MARGIN) {
    doc.addPage();
    return MARGIN + 10;
  }
  return y;
}

function sectionHeader(doc: jsPDF, y: number, label: string): number {
  drawAccentBar(doc, MARGIN, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setColor(doc, NAVY);
  doc.text(label, MARGIN, y);
  return y + 7;
}

function fieldRow(doc: jsPDF, y: number, label: string, value: string): number {
  y = checkPage(doc, y, 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  setColor(doc, LIGHT_GRAY);
  doc.text(label.toUpperCase(), MARGIN, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, NAVY);
  y += wrapText(doc, value, MARGIN, y, CONTENT_W, 4.5);
  return y + 3;
}

function _buildOwnerFileDossierPdf(ownerFile: OwnerFile): { doc: jsPDF; slug: string } {
  const { cluster, verification, notes, outreachEvents, resolvedTier, isEntityOwner, snapshotGeneratedAt } =
    ownerFile;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const ownerLabel = cluster.ownerName || "Owner record unavailable";

  /* ── Cover ── */
  fillRect(doc, 0, 0, W, H, NAVY);
  fillRect(doc, MARGIN, 30, 40, 2, BLUE);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, "#FFFFFF80");
  doc.text("CHICAGO INCENTIVE EXPLORER — WHO OWNS IT?", MARGIN, 42);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  setColor(doc, WHITE);
  const titleLines = doc.splitTextToSize(ownerLabel, CONTENT_W) as string[];
  let coverY = 68;
  for (const line of titleLines) {
    doc.text(line, MARGIN, coverY);
    coverY += 12;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  setColor(doc, "#FFFFFF60");
  doc.text(cluster.ownerMailingAddress || "Mailing address unavailable", MARGIN, coverY + 4);
  coverY += 18;

  fillRect(doc, MARGIN, coverY, CONTENT_W, 0.5, "#FFFFFF20");
  coverY += 14;

  const tierColor = TIER_COLORS[resolvedTier] ?? LIGHT_GRAY;
  fillRect(doc, MARGIN, coverY, CONTENT_W, 32, "#FFFFFF08");
  fillRect(doc, MARGIN, coverY, 3, 32, tierColor);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setColor(doc, tierColor);
  doc.text(`CONFIDENCE TIER ${resolvedTier}`, MARGIN + 10, coverY + 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, "#FFFFFF80");
  doc.text(
    resolvedTier === "A"
      ? "Human-verified entity with a current contact path."
      : "Records indicate — verify before relying. Not a human-confirmed entity match yet.",
    MARGIN + 10,
    coverY + 19
  );
  coverY += 40;

  coverY = Math.max(coverY + 8, 185);
  doc.setFontSize(8);
  setColor(doc, "#FFFFFF60");
  doc.text(`${cluster.parcelCount} PARCEL${cluster.parcelCount === 1 ? "" : "S"} — ${cluster.vacantParcelCount} VACANT`, MARGIN, coverY);

  // Snapshot as-of date — unconditional (previously this only surfaced
  // inside the Verification section, and only once a verification existed).
  coverY += 9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setColor(doc, "#FFFFFF50");
  const snapshotLabel = snapshotGeneratedAt
    ? `Records snapshot as of ${new Date(snapshotGeneratedAt).toLocaleDateString("en-US")} — records indicate, verify before relying.`
    : "Records snapshot date unavailable — records indicate, verify before relying.";
  wrapText(doc, snapshotLabel, MARGIN, coverY, CONTENT_W, 3.6);

  doc.setFontSize(8);
  setColor(doc, "#FFFFFF40");
  doc.text(dateStr, MARGIN, H - 25);
  doc.text("Generated by Chicago Incentive Explorer — Owner Files (admin)", MARGIN, H - 18);
  doc.setFontSize(7);
  setColor(doc, "#FFFFFF30");
  doc.text("Southeast Chicago Chamber of Commerce", MARGIN, H - 12);

  /* ── Identity + parcels ── */
  doc.addPage();
  let y = MARGIN + 5;
  y = sectionHeader(doc, y, "Owner Identity");
  y = fieldRow(doc, y, "Owner name", ownerLabel);
  y = fieldRow(doc, y, "Owner type (assessor record)", cluster.ownerType || "Not recorded");
  y = fieldRow(doc, y, "Mailing address", cluster.ownerMailingAddress || "Not recorded");
  y = fieldRow(doc, y, "Confidence tier", `${resolvedTier} — ${cluster.confidence} algorithmic confidence at last export (${cluster.evidence || "n/a"})`);
  if (!isEntityOwner) {
    y = checkPage(doc, y, 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, AMBER);
    doc.text("Individually owned — handle with care", MARGIN, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setColor(doc, MEDIUM_GRAY);
    y += wrapText(
      doc,
      "This cluster's taxpayer of record appears to be an individual, not a registered entity. Automated " +
        "outreach letters are reserved for entity owners — coordinate a personal contact through a local " +
        "partner instead.",
      MARGIN,
      y,
      CONTENT_W,
      3.6
    );
  }
  y += 4;

  y = checkPage(doc, y, 40);
  y = sectionHeader(doc, y, "Parcels");
  y = fieldRow(doc, y, "Parcel / vacant-parcel footprint", `${cluster.parcelCount} parcels, ${cluster.vacantParcelCount} carrying a vacancy signal`);
  y = fieldRow(doc, y, `PINs on file (${cluster.pins.length})`, cluster.pins.length > 0 ? cluster.pins.join(", ") : "Not available in this snapshot");
  y = fieldRow(doc, y, "Sample addresses", cluster.sampleAddresses.length > 0 ? cluster.sampleAddresses.join("; ") : "Not available");

  // Per-parcel record links — paired official destinations: CookViewer (the
  // parcel record) and the Cook County Clerk recordings search (recorded deeds,
  // grantors, grantees, liens, releases). Each PIN that normalizes to 14 digits
  // gets both links side by side (plain text is ASCII-only; jsPDF's standard
  // fonts don't carry an arrow glyph). Links only — no scraped owners, no
  // implied title search.
  const cookViewerPins = cluster.pins.filter((pin) => cookViewerUrl(pin) != null);
  if (cookViewerPins.length > 0) {
    y = checkPage(doc, y, 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, LIGHT_GRAY);
    doc.text("PROPERTY & OWNERSHIP RECORDS (COOKVIEWER PARCEL RECORD / CLERK RECORDED DEEDS)", MARGIN, y);
    y += 4.5;
    doc.setFontSize(8.5);
    const shownPins = cookViewerPins.slice(0, 12);
    for (const pin of shownPins) {
      const viewerUrl = cookViewerUrl(pin)!;
      const clerkUrl = clerkRecordsUrl(pin)!;
      y = checkPage(doc, y, 5);
      const viewerLabel = `${pin} — CookViewer`;
      setColor(doc, BLUE);
      doc.textWithLink(viewerLabel, MARGIN, y, { url: viewerUrl });
      const sepX = MARGIN + doc.getTextWidth(viewerLabel);
      setColor(doc, MEDIUM_GRAY);
      doc.text(" | ", sepX, y);
      setColor(doc, BLUE);
      doc.textWithLink("Clerk records", sepX + doc.getTextWidth(" | "), y, { url: clerkUrl });
      y += 4.5;
    }
    if (cookViewerPins.length > shownPins.length) {
      y = checkPage(doc, y, 5);
      doc.setFontSize(7.5);
      setColor(doc, MEDIUM_GRAY);
      doc.text(
        `+${cookViewerPins.length - shownPins.length} more PIN(s) verifiable in CookViewer and the Clerk's recordings search — see the PINs-on-file list above.`,
        MARGIN,
        y,
      );
      y += 4.5;
    }
  }
  y += 4;

  /* ── Distress signals ── */
  y = checkPage(doc, y, 40);
  y = sectionHeader(doc, y, "Distress Signals");
  const ds = cluster.distressSignals;
  const saleExposureValue = ds.scavengerOrAnnualSaleFlag == null
    ? "Not yet available"
    : ds.scavengerOrAnnualSaleFlag
      ? [
          "Yes",
          cluster.latestTaxSaleYear != null ? `latest tax-sale year ${cluster.latestTaxSaleYear}` : null,
          cluster.taxSaleSoldCount != null
            ? `${cluster.taxSaleSoldCount} matched entr${cluster.taxSaleSoldCount === 1 ? "y" : "ies"} sold at auction`
            : null,
        ].filter(Boolean).join(" — ")
      : "No sale exposure found in the loaded records";
  const distressRows: [string, string][] = [
    ["Building violations", ds.buildingViolationCount != null ? String(ds.buildingViolationCount) : "Not yet available"],
    ["Vacant-building violations", ds.vacantBuildingViolationCount != null ? String(ds.vacantBuildingViolationCount) : "Not yet available"],
    [
      "Delinquent-tax exposure",
      "Requires the Cook County Clerk's monthly delinquency file (manual import) — sale-exposure below is the public signal in the meantime.",
    ],
    ["Scavenger/annual tax sale exposure", saleExposureValue],
    [
      "Cook County Land Bank inventory",
      "CCLBA publishes a public property inventory, but this owner-file view does not yet join it. No row-level result is asserted here.",
    ],
  ];
  for (const [label, value] of distressRows) {
    y = fieldRow(doc, y, label, value);
  }
  y += 2;

  /* ── Transfer + business context ── */
  y = checkPage(doc, y, 40);
  y = sectionHeader(doc, y, "Transfer & Business-License Context");
  y = fieldRow(
    doc,
    y,
    "Latest transfer",
    cluster.latestTransferDate
      ? `${cluster.latestTransferDate} — buyer: ${cluster.latestBuyerName || "n/a"}; seller: ${cluster.latestSellerName || "n/a"}`
      : "No transfer record in this snapshot"
  );
  y = fieldRow(
    doc,
    y,
    `Business-license site matches (${cluster.businessCount})`,
    cluster.businessNames.length > 0 ? cluster.businessNames.join("; ") : "No business-license site match found"
  );

  /* ── Verification ── */
  y = checkPage(doc, y, 50);
  y = sectionHeader(doc, y, "Verification");
  if (verification) {
    y = fieldRow(doc, y, "Status", verification.status);
    y = fieldRow(doc, y, "Verified by", `${verification.verifierName} (updated ${new Date(verification.updatedAt).toLocaleDateString("en-US")})`);
    y = fieldRow(
      doc,
      y,
      "IL SOS entity lookup",
      verification.ilSosFileNumber || verification.ilSosLookupUrl || verification.registeredAgentName
        ? [
            verification.ilSosFileNumber ? `File #${verification.ilSosFileNumber}` : null,
            verification.registeredAgentName ? `Registered agent: ${verification.registeredAgentName}` : null,
            verification.registeredAgentAddress ? `Agent address: ${verification.registeredAgentAddress}` : null,
            verification.ilSosLookupUrl ? verification.ilSosLookupUrl : null,
          ].filter(Boolean).join(" — ")
        : "Not on file"
    );
    y = fieldRow(
      doc,
      y,
      "Taxpayer mailing address confirmed",
      verification.taxpayerMailingAddressConfirmed == null
        ? "Not assessed"
        : verification.taxpayerMailingAddressConfirmed
          ? "Yes"
          : "No"
    );
    y = fieldRow(doc, y, "Local vs. absentee", verification.localVsAbsentee || "Not assessed");
    if (verification.checklist.length > 0) {
      y = checkPage(doc, y, 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      setColor(doc, LIGHT_GRAY);
      doc.text("CHECKLIST", MARGIN, y);
      y += 4;
      for (const item of verification.checklist) {
        y = checkPage(doc, y, 6);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        setColor(doc, item.completed ? GREEN : MEDIUM_GRAY);
        doc.text(item.completed ? "✓" : "□", MARGIN, y);
        setColor(doc, NAVY);
        doc.text(item.label, MARGIN + 6, y);
        y += 5;
      }
    }
    if (verification.exportGeneratedAt) {
      y = fieldRow(
        doc,
        y,
        "Snapshot as of",
        `${new Date(verification.exportGeneratedAt).toLocaleDateString("en-US")} — re-verify if the parcel/ownership export has refreshed since.`
      );
    }
  } else {
    y = fieldRow(doc, y, "Status", "No verification on file yet — draft only.");
  }

  if (notes.length > 0) {
    y = checkPage(doc, y, 20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, LIGHT_GRAY);
    doc.text("NOTES", MARGIN, y);
    y += 4;
    for (const note of notes.slice(0, 10)) {
      y = checkPage(doc, y, 12);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      setColor(doc, NAVY);
      doc.text(`${note.noteType} — ${note.authorName} — ${new Date(note.createdAt).toLocaleDateString("en-US")}`, MARGIN, y);
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      setColor(doc, MEDIUM_GRAY);
      y += wrapText(doc, note.body, MARGIN, y, CONTENT_W, 4);
      y += 3;
    }
  }

  /* ── Outreach history ── */
  y = checkPage(doc, y, 30);
  y = sectionHeader(doc, y, "Outreach History");
  if (outreachEvents.length === 0) {
    y = fieldRow(doc, y, "Events", "No outreach logged yet.");
  } else {
    for (const event of outreachEvents.slice(0, 20)) {
      y = checkPage(doc, y, 8);
      drawLine(doc, MARGIN, y, W - MARGIN, "#E5E7EB");
      y += 5;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      setColor(doc, NAVY);
      doc.text(event.eventType.replace(/_/g, " "), MARGIN, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      setColor(doc, LIGHT_GRAY);
      const dateLabel = new Date(event.occurredAt).toLocaleDateString("en-US");
      doc.text(dateLabel, W - MARGIN - doc.getTextWidth(dateLabel), y);
      y += 4;
      if (event.outcome || event.actorName || event.notes) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        setColor(doc, MEDIUM_GRAY);
        const parts = [
          event.actorName ? `by ${event.actorName}` : null,
          event.outcome ? `outcome: ${event.outcome.replace(/_/g, " ")}` : null,
          event.notes || null,
        ].filter(Boolean);
        if (parts.length > 0) y += wrapText(doc, parts.join(" — "), MARGIN, y, CONTENT_W, 3.6) + 1;
      }
      y += 2;
    }
  }

  /* ── Disclaimer + footer ── */
  y = checkPage(doc, y, 24);
  y += 4;
  fillRect(doc, MARGIN, y, CONTENT_W, 0.3, "#E5E7EB");
  y += 6;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  setColor(doc, LIGHT_GRAY);
  y += wrapText(
    doc,
    "Records indicate — verify before relying. Owner and parcel data come from public assessor, transfer, and business-license records that are only intermittently updated. This dossier is discovery context for a corridor manager's own outreach, not a legal or eligibility determination.",
    MARGIN,
    y,
    CONTENT_W,
    3.6
  );
  y += 3;
  setColor(doc, LIGHT_GRAY);
  wrapText(doc, VERIFICATION_DISCLAIMER, MARGIN, y, CONTENT_W, 3.6);

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, LIGHT_GRAY);
    const pageText = `Page ${i} of ${totalPages}`;
    doc.text(pageText, W - MARGIN - doc.getTextWidth(pageText), H - 8);
    if (i >= 2) doc.text(dateStr, MARGIN, H - 8);
  }

  const slug = (cluster.ownerName || cluster.clusterKey).replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  return { doc, slug };
}

export function generateOwnerFileDossierPdf(ownerFile: OwnerFile): void {
  const { doc, slug } = _buildOwnerFileDossierPdf(ownerFile);
  doc.save(`owner-file-${slug}.pdf`);
}

/** Return the dossier PDF as base64 (for future server-side use, e.g. email attachment). */
export function generateOwnerFileDossierPdfBase64(
  ownerFile: OwnerFile
): { base64: string; filename: string } {
  const { doc, slug } = _buildOwnerFileDossierPdf(ownerFile);
  const base64 = doc.output("datauristring").split(",")[1];
  return { base64, filename: `owner-file-${slug}.pdf` };
}
