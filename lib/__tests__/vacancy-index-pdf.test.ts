import { describe, expect, it } from "vitest";
import { extractText } from "unpdf";
import {
  generateVacancyIndexPdfBase64,
  type VacancyIndexInput,
} from "../vacancy-index-pdf";

/**
 * First BEHAVIORAL coverage for lib/vacancy-index-pdf.ts. Until now the module
 * had none: the adapter that feeds it (lib/vacancy-index-adapter.ts) is tested,
 * but nothing ever built a document and read it back, so every honesty rail the
 * builder's own header comment promises — the verification disclaimer in every
 * footer, the anonymization boundary, "NOT YET AVAILABLE" instead of a silent
 * zero, the quintile scope limit — was enforced only by that comment.
 *
 * This is the shareable, anonymized artifact: it leaves the product and is read
 * by people who never saw the web report, so its printed caveats are the only
 * context they get. Mirrors lib/__tests__/pdf-section-order.test.ts — build the
 * real PDF through the base64 entry point, then extract text with unpdf.
 *
 * The fixture is deliberately MINIMAL and, more to the point, deliberately
 * EMPTY where data can be missing: null ownership distributions, no distress
 * table, no sites. That is the shape that most needs a rail, because it is the
 * one where a silent zero would read as a real finding.
 */

const AS_OF = "2026-07-22";
const SOURCE = "Chicago Data Portal — Vacant Land Inventory";

function minimalInput(overrides: Partial<VacancyIndexInput> = {}): VacancyIndexInput {
  return {
    neighborhood: "South Chicago",
    zipCode: "60617",
    editionNumber: 1,
    asOf: AS_OF,
    counts: {
      total: 412,
      cityOwned: 168,
      privatelyHeld: 244,
      inIncentiveZones: 412,
    },
    brief: "Tracked public vacancy records for this ZIP, screened from city and county sources.",
    // Nulls throughout: the honesty-rail shape, not an incomplete fixture.
    ownerTypeDistribution: null,
    reconciledOwnerTypeDistribution: null,
    reconciliationNote: null,
    rawOwnerComparisonNote: null,
    distress: null,
    trackedInventoryByOwnerType: {},
    propertyTypeBreakdown: { vacantLand: 250, vacantBuilding: 162 },
    matrixRows: [],
    boundary: null,
    centroid: { lat: 41.7402, lon: -87.5525 },
    sitePoints: [],
    transport: [],
    topSites: [],
    sources: [SOURCE],
    ...overrides,
  };
}

async function buildPages(input: VacancyIndexInput) {
  const output = generateVacancyIndexPdfBase64(input);
  const extracted = await extractText(
    new Uint8Array(Buffer.from(output.base64, "base64")),
    { mergePages: false },
  );
  return { output, extracted };
}

describe("generateVacancyIndexPdf", () => {
  it("builds a real, multi-sheet document from a minimal edition", async () => {
    const { output, extracted } = await buildPages(minimalInput());

    expect(extracted.totalPages).toBeGreaterThanOrEqual(1);
    // The builder's documented contract is five sheets: COVER, 01 Executive
    // Brief, 02 System Overview, 03 Property Network Map, 04 Site Index.
    expect(extracted.totalPages).toBe(5);
    expect(output.filename).toBe("vacancy-opportunity-index-south-chicago.pdf");
    expect(output.base64.length).toBeGreaterThan(0);
  });

  it("identifies the edition it describes on the cover", async () => {
    const { extracted } = await buildPages(minimalInput());
    const cover = extracted.text[0];

    expect(cover).toContain("VACANCY");
    expect(cover).toContain("OPPORTUNITY");
    expect(cover).toContain("INDEX");
    // A shared PDF must state which ZIP and vintage it speaks for; without
    // both, a reader cannot tell a current edition from a stale one.
    expect(cover).toContain("60617");
    expect(cover).toContain(AS_OF);
  });

  it("prints the verification disclaimer on every sheet, not just the first", async () => {
    const { extracted } = await buildPages(minimalInput());

    // The document is designed to be shared onward and read page by page, so
    // the caveat has to travel with each sheet.
    for (const page of extracted.text) {
      expect(page).toContain("Informational screening only.");
      expect(page).toContain(
        "Confirm current eligibility, timing, and approval requirements with the administering organization.",
      );
    }
  });

  it("carries the source and as-of provenance onto every sheet", async () => {
    const { extracted } = await buildPages(minimalInput());

    // The as-of vintage travels with all five sheets, cover included.
    for (const page of extracted.text) {
      expect(page).toContain(AS_OF);
    }
    // The named source list rides the numbered sheets' footer (the cover
    // carries its own masthead instead).
    for (const page of extracted.text.slice(1)) {
      expect(page).toContain("SOURCES:");
    }
  });

  it("states the anonymization boundary in the methodology block", async () => {
    const { extracted } = await buildPages(minimalInput());
    const whole = extracted.text.join(" ");

    // The builder only ever receives owner-type buckets; the PDF must say so,
    // because a reader cannot otherwise tell an anonymized document from one
    // that simply had no names to show.
    expect(whole).toContain(
      "no owner names or mailing addresses appear in this document",
    );
    // jsPDF's standard fonts cannot render an em dash, so the builder's
    // sanitizer folds it to a hyphen on the way in — assert the string as it
    // actually reaches a reader, not as it reads in source.
    expect(whole).toContain("Records indicate - verify before relying.");
  });

  it("names the limit on its own dot ratings rather than implying a citywide score", async () => {
    const { extracted } = await buildPages(minimalInput());
    const whole = extracted.text.join(" ");

    expect(whole).toContain(
      "They are not citywide scores or grades.",
    );
  });

  it("renders NOT YET AVAILABLE for a null ownership series instead of a silent zero", async () => {
    const { extracted } = await buildPages(minimalInput());
    const whole = extracted.text.join(" ");

    // ownerTypeDistribution / reconciledOwnerTypeDistribution / distress are
    // all null in this fixture. A zero here would be a fabricated finding.
    expect(whole).toContain("NOT YET AVAILABLE");
  });

  it("never prints an owner NAME, only the anonymized owner-type buckets", async () => {
    const { extracted } = await buildPages(
      minimalInput({
        topSites: [
          {
            address: "8300 S Baltimore Ave",
            ownerType: "city_public",
            propertyType: "vacant_land",
            zoning: "RS-3",
            sqft: 3125,
            nextStep: "Confirm with the administering department",
            pin: null,
          },
        ],
        sitePoints: [{ lat: 41.7402, lon: -87.5525, ownerType: "city_public" }],
      }),
    );
    const whole = extracted.text.join(" ");

    // The site index renders the row's address...
    expect(whole).toContain("8300 S Baltimore Ave");
    // ...and its owner type as a reader-facing label, never the raw enum
    // token, which would leak the classifier's internals into a public document.
    expect(whole).not.toContain("city_public");
    expect(whole).not.toContain("out_of_state");
    expect(whole).not.toContain("corporate_llc");
  });
});
