import { describe, expect, it } from "vitest";

import { renderZoningHandoffPdf } from "../handoff-pdf";
import type { ZoningHandoffInput } from "../stage-handoff";

/** The heaviest input the share text's own caps allow. */
const MAX_REALISTIC: ZoningHandoffInput = {
  address: "8701 S Commercial Ave, Chicago, IL 60617",
  businessType: "Community fresh market and cafe with prepared foods",
  zoneClass: "B3-2",
  activityLabel: "Grocery or fresh market",
  reviewAnswers: Array.from({ length: 6 }, (_, i) => ({
    question: `Question ${i + 1} about the project's configuration and operations?`,
    answer: "A realistic short answer with a bit of detail attached",
  })),
  officialLinks: [
    {
      label: "Business and commercial use table (Section 17-3-0207)",
      url: "https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2681344",
    },
    {
      label: "City of Chicago ArcGIS zoning boundaries",
      url: "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1",
    },
    { label: "Site-specific ordinance record", url: "https://data.cityofchicago.org/d/dj47-wfun" },
  ],
  reportUrl:
    "https://chicagoincentiveexplorer.com/report?instant=true&addr=8701%20S%20Commercial%20Ave&lat=41.7367&lon=-87.5518",
};

describe("renderZoningHandoffPdf", () => {
  it("stays on one page at maximum realistic content", () => {
    const doc = renderZoningHandoffPdf(MAX_REALISTIC);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it("stays on one page when nearly empty", () => {
    const doc = renderZoningHandoffPdf({});
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it("produces a parseable PDF with real weight", () => {
    const bytes = renderZoningHandoffPdf(MAX_REALISTIC).output("arraybuffer");
    expect(bytes.byteLength).toBeGreaterThan(2000);
    const head = new TextDecoder().decode(new Uint8Array(bytes).slice(0, 8));
    expect(head.startsWith("%PDF-")).toBe(true);
  });

  it("renders from the shared handoff sections, not its own copy", async () => {
    // The renderer must not author content: every sentence it draws has
    // to exist in the share text. Extract the PDF's text stream markers
    // is overkill; instead assert at the source level that handoff-pdf.ts
    // contains no sentence-like string literals beyond layout constants.
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../handoff-pdf.ts", import.meta.url), "utf8");
    const suspicious = src.match(/"[A-Z][a-z]+ [a-z]+ [a-z]+ [a-z]+ [a-z]+[^"]*"/g) ?? [];
    // Allowed: the generated-date line and the fallback band title.
    const disallowed = suspicious.filter(
      (s) => !s.includes("Generated") && !s.includes("Zoning-stage handoff"),
    );
    expect(disallowed).toEqual([]);
  });
});
