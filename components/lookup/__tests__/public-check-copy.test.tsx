import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IncentiveReport } from "@/components/lookup/IncentiveReport";
import { ReportPreview } from "@/components/lookup/ReportPreview";
import type { Business, LookupResult, Program } from "@/lib/types";

/**
 * Determination language in the public ADDRESS REPORT — the view AddressSearch
 * mounts on the homepage, /start, and the SEO snapshot CTAs.
 *
 * Despite this file's name it covers nothing on /check. That route renders
 * components/check/QuickCheckClient (app/check/page.tsx); its copy contract is
 * components/check/__tests__/quick-check-surface.test.tsx. A green run here is
 * not evidence the quick-check surface was checked.
 *
 * ReportPreview has no importer anywhere in the tree except this file, so its
 * assertions are quarantined in their own block below rather than mixed into
 * the reachable surface's — passing tests on an unmounted component must not
 * read as coverage of what a visitor sees.
 */

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

const business: Business = {
  id: "biz-1",
  name: "Test Business",
  address: "100 E Test St",
  city: "Chicago",
  state: "IL",
  zip: "60601",
  lat: 41.8,
  lon: -87.6,
  phone: "(312) 555-0100",
  website: "https://example.com",
  category: "Retail",
  incentiveCount: 1,
  zones: { tif: true },
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

const availableZoning: LookupResult = {
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

/**
 * Every branch of the report that produces its own copy. The determination
 * rules have to hold in all of them, not only in the one shape a single fixture
 * happens to take. Each state carries a marker that only its own branch emits,
 * so a fixture that quietly stopped reaching that branch fails rather than
 * passing a sweep over identical markup.
 */
const RESULT_STATES: ReadonlyArray<{
  label: string;
  state: LookupResult;
  present?: string;
  absent?: string;
}> = [
  { label: "one mapped zone", state: result, present: "Test TIF District" },
  {
    label: "matched business",
    state: { ...result, matched: true, business },
    present: "Matched Business",
  },
  {
    label: "no mapped zone",
    state: { ...result, zones: {}, zoneNames: {}, incentiveCount: 0 },
    absent: "Test TIF District",
  },
  {
    label: "no employment reading",
    state: { ...result, employment: undefined },
    absent: "High Unemployment Zone",
  },
  { label: "published zoning", state: availableZoning, present: "B3-2" },
  {
    label: "zoning not found",
    state: { ...result, cityZoningStatus: "not_found" },
    present: "No district returned",
  },
  {
    label: "zoning unavailable",
    state: { ...result, cityZoningStatus: "unavailable" },
    present: "Source temporarily unavailable",
  },
];

describe("public address report copy (IncentiveReport)", () => {
  it("uses neutral location-linked language", () => {
    const html = renderToStaticMarkup(
      <IncentiveReport result={result} programs={programs} />,
    );

    expect(html).toContain("Programs to Review");
    expect(html).toContain("zones mapped");
    expect(html).toContain("Review current requirements");
    expect(html).not.toMatch(PROHIBITED_CHECK_COPY);
  });

  it("holds that language in every result state it renders", () => {
    for (const { label, state, present, absent } of RESULT_STATES) {
      const html = renderToStaticMarkup(
        <IncentiveReport result={state} programs={programs} />,
      );
      if (present) expect(html, label).toContain(present);
      if (absent) expect(html, label).not.toContain(absent);
      expect(html, label).not.toMatch(PROHIBITED_CHECK_COPY);
      expect(html, label).not.toMatch(PROHIBITED_ZONING_COPY);
    }
  });

  it("keeps determination phrases out of the copied report text", () => {
    // buildReportText feeds the clipboard and never reaches the DOM, so the
    // rendered states above cannot see it. Reading the file is the only way to
    // hold that copy to the same rule.
    const source = readFileSync(
      join(process.cwd(), "components/lookup/IncentiveReport.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(PROHIBITED_CHECK_COPY);
    expect(source).not.toMatch(PROHIBITED_ZONING_COPY);
  });

  it("shows published zoning with verification, freshness, and source context", () => {
    const html = renderToStaticMarkup(
      <IncentiveReport result={availableZoning} programs={programs} />,
    );

    expect(html).toContain("B3-2");
    expect(html).toContain("Published district classification only");
    expect(html).toContain("Verify whether a proposed use is permitted");
    expect(html).toContain("City of Chicago Zoning Map");
    expect(html).toContain("Record updated Aug 1, 2026");
  });

  it("keeps not-found and unavailable zoning states distinct", () => {
    const notFoundHtml = renderToStaticMarkup(
      <IncentiveReport
        result={{ ...result, cityZoningStatus: "not_found" }}
        programs={programs}
      />,
    );
    const unavailableHtml = renderToStaticMarkup(
      <IncentiveReport
        result={{ ...result, cityZoningStatus: "unavailable" }}
        programs={programs}
      />,
    );

    expect(notFoundHtml).toContain("returned no zoning district for this location");
    expect(notFoundHtml).toContain("not evidence that zoning requirements do not apply");
    expect(notFoundHtml).not.toContain("temporarily unavailable");
    expect(unavailableHtml).toContain("temporarily unavailable");
    expect(unavailableHtml).toContain("No zoning or proposed-use conclusion was made");
    expect(unavailableHtml).not.toContain("returned no zoning district for this location");
  });
});

describe("ReportPreview (no importer outside this file)", () => {
  // Nothing mounts this component, so these assertions protect a surface no
  // visitor reaches. They stay only so the copy cannot rot while the file sits
  // in the tree; they are not coverage of the public report.
  it("carries the same neutral language and distinct zoning states", () => {
    for (const { label, state } of RESULT_STATES) {
      const html = renderToStaticMarkup(
        <ReportPreview result={state} programs={programs} />,
      );
      expect(html, label).not.toMatch(PROHIBITED_CHECK_COPY);
      expect(html, label).not.toMatch(PROHIBITED_ZONING_COPY);
    }

    const notFoundHtml = renderToStaticMarkup(
      <ReportPreview
        result={{ ...result, cityZoningStatus: "not_found" }}
        programs={programs}
      />,
    );
    const unavailableHtml = renderToStaticMarkup(
      <ReportPreview
        result={{ ...result, cityZoningStatus: "unavailable" }}
        programs={programs}
      />,
    );

    expect(notFoundHtml).toContain("No published zoning district was returned");
    expect(notFoundHtml).not.toContain("temporarily unavailable");
    expect(unavailableHtml).toContain("temporarily unavailable");
    expect(unavailableHtml).not.toContain("No published zoning district was returned");
  });
});
