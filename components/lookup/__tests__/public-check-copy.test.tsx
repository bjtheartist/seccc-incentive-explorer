import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IncentiveReport } from "@/components/lookup/IncentiveReport";
import { ReportPreview } from "@/components/lookup/ReportPreview";
import type { LookupResult, Program } from "@/lib/types";

const PROHIBITED_CHECK_COPY =
  /Eligible Programs|may qualify|\d+\s+of\s+\d+\s+eligible|Top Eligible Programs/i;
const PROHIBITED_ZONING_COPY =
  /Zoning determines permitted land uses|district determines whether a proposed use is permitted/i;

const result: LookupResult = {
  matched: false,
  address: "100 E Test St",
  lat: 41.8,
  lon: -87.6,
  zones: { tif: true },
  zoneNames: { tif: "Test TIF District" },
  incentiveCount: 1,
  employment: {
    censusTract: "17031010100",
    unemploymentRate: "12.0%",
    population: 2_000,
  },
};

const programs: Program[] = [{
  id: "tif",
  name: "Test TIF Program",
  level: "City",
  zoneKey: "tif",
  summary: "Published program summary.",
  whoQualifies: "Eligible applicants must meet the published requirements.",
  benefits: ["Published program terms."],
  howToApply: ["Review the official source."],
  requiredDocs: ["Project budget"],
  contact: "Test Agency",
  url: "https://example.com/program",
}];

describe("public /check copy", () => {
  it("uses neutral location-linked language in both report views", () => {
    const html = renderToStaticMarkup(
      <>
        <ReportPreview result={result} programs={programs} />
        <IncentiveReport result={result} programs={programs} />
      </>,
    );

    expect(html).toContain("Programs to Review");
    expect(html).toContain("zones mapped");
    expect(html).toContain("Review current requirements");
    expect(html).not.toMatch(PROHIBITED_CHECK_COPY);
  });

  it("keeps prohibited determination phrases out of both source files", () => {
    for (const path of [
      "components/lookup/IncentiveReport.tsx",
      "components/lookup/ReportPreview.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source).not.toMatch(PROHIBITED_CHECK_COPY);
      expect(source).not.toMatch(PROHIBITED_ZONING_COPY);
    }
  });

  it("shows published zoning with verification, freshness, and source context", () => {
    const availableResult: LookupResult = {
      ...result,
      cityZoningStatus: "available",
      cityZoning: {
        zoneClass: "B3-2",
        zoneType: "Business",
        recordUpdatedAt: "2026-08-01T00:00:00.000Z",
        source: {
          id: "chicago-arcgis-zoning",
          label: "City of Chicago Zoning Map",
          url: "https://gisapps.chicago.gov/zoning",
          retrievedAt: "2026-08-08T00:00:00.000Z",
          recordUpdatedAt: "2026-08-01T00:00:00.000Z",
        },
      },
    };

    const html = renderToStaticMarkup(
      <>
        <ReportPreview result={availableResult} programs={programs} />
        <IncentiveReport result={availableResult} programs={programs} />
      </>,
    );

    expect(html).toContain("B3-2");
    expect(html).toContain("Published district classification only");
    expect(html).toContain("Verify whether a proposed use is permitted");
    expect(html).toContain("City of Chicago Zoning Map");
    expect(html).toContain("Record updated Aug 1, 2026");
    expect(html).not.toMatch(PROHIBITED_ZONING_COPY);
  });

  it("keeps not-found and unavailable zoning states distinct", () => {
    const notFoundHtml = renderToStaticMarkup(
      <>
        <ReportPreview
          result={{ ...result, cityZoningStatus: "not_found" }}
          programs={programs}
        />
        <IncentiveReport
          result={{ ...result, cityZoningStatus: "not_found" }}
          programs={programs}
        />
      </>,
    );
    const unavailableHtml = renderToStaticMarkup(
      <>
        <ReportPreview
          result={{ ...result, cityZoningStatus: "unavailable" }}
          programs={programs}
        />
        <IncentiveReport
          result={{ ...result, cityZoningStatus: "unavailable" }}
          programs={programs}
        />
      </>,
    );

    expect(notFoundHtml).toContain("No published zoning district was returned");
    expect(notFoundHtml).toContain("not evidence that zoning requirements do not apply");
    expect(notFoundHtml).not.toContain("temporarily unavailable");
    expect(unavailableHtml).toContain("temporarily unavailable");
    expect(unavailableHtml).toContain("No zoning or proposed-use conclusion was made");
    expect(unavailableHtml).not.toContain("No published zoning district was returned");
  });
});
