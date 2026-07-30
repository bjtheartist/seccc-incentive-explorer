import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VacancyCaseArea, VacancyCaseRecord } from "@/lib/vacancy-cases";

/**
 * Render coverage for the Case Workbench (app/vacancy/[zip]/page.tsx) — the
 * decision-first Vacant Sites landing. The page is an async Server Component
 * called directly with a fixture record set (buildCaseRecords stubbed) and the
 * client islands stubbed out, so renderToStaticMarkup can inspect the
 * result: five case cards with real counts, the active-case panel, the
 * geographic-preview honesty line, the opportunity-areas rail, the as-of line,
 * and the ?case= switch — with NO owner name anywhere in the output.
 *
 * The geographic preview is now the REAL map (CasePreviewMapIsland) instead of
 * the old inline SVG dot map, so its assertions check the SERVER CONTRACT: the
 * island receives the active case's mapped points plus the edition
 * boundary/centroid, the honesty caption still renders server-side, the SVG is
 * gone, and the "Open the property map" link is preserved.
 */

/** The record set the stubbed loader returns. `let`, so one test can swap in an
 *  oversized set to exercise the preview's point-cap disclosure. */
let records: VacancyCaseRecord[] = [
  r({ id: "l1", universe: "land", ownerType: "city_public", lat: 41.7, lon: -87.5 }),
  r({ id: "l2", universe: "land", ownerType: "city_public", lat: 41.71, lon: -87.51 }),
  r({ id: "l3", universe: "land", ownerType: "city_public", lat: null, lon: null }),
  r({ id: "l4", universe: "land", ownerType: "local_private", lat: 41.72, lon: -87.52 }),
  r({ id: "l5", universe: "land", ownerType: "corporate_llc", saleYear: 2015, lat: 41.73, lon: -87.53 }),
  r({ id: "l6", universe: "land", ownerType: "unknown", lat: 41.74, lon: -87.54 }),
  r({ id: "b1", universe: "building_report", ownerType: "unknown", violation: true, lat: 41.75, lon: -87.55 }),
  r({ id: "b2", universe: "building_report", ownerType: "unknown", lat: 41.76, lon: -87.56 }),
];

const areas: VacancyCaseArea[] = [
  {
    id: 3,
    name: "Commercial Avenue Cluster",
    siteCount: 12,
    mappedCount: 10,
    corridor: "Commercial Avenue",
    scenario: "Mixed-use infill",
    needsChecking: "Ownership, condition, and zoning must be verified for each site.",
  },
];

function r(overrides: Partial<VacancyCaseRecord>): VacancyCaseRecord {
  return {
    id: "r",
    address: "1 FAKE ST",
    pin: null,
    universe: "land",
    ownerType: "local_private",
    ownerStructure: null,
    ownerGeography: null,
    saleYear: null,
    violation: false,
    squareFeet: null,
    lat: null,
    lon: null,
    ...overrides,
  };
}

/** The edition's full reconciled land universe. `let`, so one test can raise it
 *  above the enumerable land records and exercise the truncation disclosure. */
let landTotal: number | null = 6;

vi.mock("@/lib/vacancy-cases-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vacancy-cases-data")>();
  return {
    ...actual,
    buildCaseRecords: () => ({
      records,
      areas,
      recordsAsOf: "July 22, 2026",
      universe: actual.deriveCaseUniverse(records, landTotal),
    }),
  };
});
vi.mock("@/components/vacancy/VacancySubNav", () => ({ VacancySubNav: () => null }));
vi.mock("@/components/vacancy/CopyCaseLink", () => ({ CopyCaseLink: () => null }));
vi.mock("@/components/vacancy/CaseAreaSwitcher", () => ({ CaseAreaSwitcher: () => null }));

// The preview map island — stubbed to a marker element that echoes the props
// the Server Component hands it, so the pass-through contract is assertable
// without loading mapbox-gl in Node.
vi.mock("@/components/vacancy/CasePreviewMapIsland", () => ({
  default: ({
    zip,
    points,
    boundary,
    centroid,
  }: {
    zip: string;
    points: readonly { universe: string }[];
    boundary: unknown;
    centroid: unknown;
  }) => (
    <div
      data-testid="case-preview-map"
      data-zip={zip}
      data-points={points.length}
      data-universes={points.map((p) => p.universe).join(",")}
      data-boundary={boundary ? "yes" : "no"}
      data-centroid={centroid ? "yes" : "no"}
    />
  ),
}));

// Edition geography for the preview map. Only getVacancyIndexEdition is
// overridden (the page's single use) — every other export stays real, and the
// committed multi-megabyte export is never read.
vi.mock("@/lib/vacancy-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vacancy-index")>();
  return {
    ...actual,
    getVacancyIndexEdition: () =>
      ({
        boundary: {
          rings: [
            [
              [-87.6, 41.69],
              [-87.49, 41.69],
              [-87.49, 41.78],
              [-87.6, 41.78],
              [-87.6, 41.69],
            ],
          ],
          bbox: [-87.6, 41.69, -87.49, 41.78],
        },
        centroid: { lat: 41.735, lon: -87.545 },
      }) as unknown as ReturnType<typeof actual.getVacancyIndexEdition>,
  };
});

import CaseWorkbenchPage from "../page";

async function render(caseParam?: string) {
  return renderToStaticMarkup(
    await CaseWorkbenchPage({
      params: Promise.resolve({ zip: "60617" }),
      searchParams: Promise.resolve(caseParam ? { case: caseParam } : {}),
    }),
  );
}

describe("Case Workbench page", () => {
  it("renders the five case cards with their real match counts", async () => {
    const html = await render();
    for (const name of [
      "Public-land pathway",
      "Private-owner outreach",
      "Ownership follow-up",
      "Building condition review",
      "Tax and title review",
    ]) {
      expect(html).toContain(name);
    }
    // public-land = 3 city_public land; building-review = 2 buildings.
    expect(html).toMatch(/3 matching records/);
    expect(html).toMatch(/2 matching records/);
  });

  it("defaults the active case to Public-land pathway and shows its stat tiles", async () => {
    const html = await render();
    expect(html).toContain("Active case");
    expect(html).toContain("Start with land that has a public disposition pathway.");
    expect(html).toContain("Land parcels");
    expect(html).toContain("Building reports");
    // 3 land / 0 building for public-land
    expect(html).toContain("Public records as of July 22, 2026");
  });

  it("switches the active case from ?case=", async () => {
    const html = await render("building-review");
    expect(html).toContain("Reported vacant buildings that need condition and status checks.");
    // preview honesty line uses the match count
    expect(html).toMatch(/mapped match(es)? shown/);
  });

  it("falls back to the default case for an unknown ?case=", async () => {
    const html = await render("not-a-real-case");
    expect(html).toContain("Start with land that has a public disposition pathway.");
  });

  it("renders the opportunity-areas rail with a Revitalization File link", async () => {
    const html = await render();
    expect(html).toContain("Opportunity areas");
    expect(html).toContain("Commercial Avenue Cluster");
    expect(html).toContain('href="/vacancy/60617/areas/3"');
    expect(html).toContain('href="/vacancy/60617/areas"'); // All areas
    expect(html).toContain('href="/vacancy/60617/map"'); // Open the property map
  });

  it("hands the preview map island the active case's mapped points and the ZIP geography", async () => {
    const html = await render();
    expect(html).toContain('data-testid="case-preview-map"');
    expect(html).toContain('data-zip="60617"');
    // public-land matches 3 records; only 2 of them carry a coordinate.
    expect(html).toContain('data-points="2"');
    expect(html).toContain('data-universes="land,land"');
    expect(html).toContain('data-boundary="yes"');
    expect(html).toContain('data-centroid="yes"');
    // The honesty caption still renders server-side, over the map.
    expect(html).toContain("Geographic preview");
    expect(html).toContain("2 of 3 mapped matches shown");
  });

  it("swaps the preview map's points when the active case changes", async () => {
    const html = await render("building-review");
    expect(html).toContain('data-points="2"');
    expect(html).toContain('data-universes="building_report,building_report"');
    expect(html).toContain("2 of 2 mapped matches shown");
  });

  it("discloses the point cap in the caption when the preview plots only a slice", async () => {
    // The 8-record fixture is well under the cap, so the line keeps "shown".
    const uncapped = await render();
    expect(uncapped).toContain("2 of 3 mapped matches shown");
    expect(uncapped).not.toContain("evenly sampled");

    // Over the cap, the caption must state how many dots are ACTUALLY on the
    // map: clustered dots carry visible counts that sum to the plotted total,
    // so "all N shown" would be falsifiable on the face of the map.
    const { CASE_POINT_CAP } = await import("@/lib/vacancy-cases");
    const original = records;
    records = Array.from({ length: CASE_POINT_CAP + 25 }, (_, i) =>
      r({ id: `m${i}`, universe: "land", ownerType: "city_public", lat: 41.7 + i * 1e-4, lon: -87.5 }),
    );
    try {
      const capped = await render();
      const total = (CASE_POINT_CAP + 25).toLocaleString("en-US");
      expect(capped).toContain(
        `${total} of ${total} mapped matches · ${CASE_POINT_CAP.toLocaleString("en-US")} evenly sampled`,
      );
      expect(capped).not.toContain("mapped matches shown");
      // ...and the island really does receive only the capped slice.
      expect(capped).toContain(`data-points="${CASE_POINT_CAP}"`);
    } finally {
      records = original;
    }
  });

  it("no longer renders the inline SVG dot preview", async () => {
    const html = await render();
    expect(html).not.toContain("Geographic spread of");
    expect(html).not.toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it("preserves the property-map link beside the preview", async () => {
    const html = await render();
    expect(html).toContain('href="/vacancy/60617/map"');
    expect(html).toContain("Open the property map");
    expect(html).toContain("Dots are matches that carry a coordinate");
  });

  // ── Universe denominators (regression: the case counts shipped with no
  //    denominator on the page, so the only per-ZIP list available to check
  //    them against was the All Properties directory — a different universe). ──

  it("prints the land and reported-building denominators the case counts sit inside", async () => {
    const html = await render();
    // 6 land + 2 building records in the fixture.
    expect(html).toContain("Out of 6 land parcels and 2 reported buildings tracked in this ZIP");
    // ...and names the other per-ZIP list explicitly so the two are not confused.
    expect(html).toContain("All Properties directory");
    expect(html).toContain('href="/vacancy/60617/directory"');
  });

  it("discloses that land counts are a floor when the edition publishes fewer parcels", async () => {
    const original = landTotal;
    landTotal = 6; // enumerable === total
    try {
      expect(await render()).not.toContain("so the land counts on this page are a floor");
      landTotal = 900; // the edition's land universe is larger than what it publishes
      const short = await render();
      expect(short).toContain("This edition publishes 6 of the ZIP’s 900 reconciled land parcels");
      expect(short).toContain("a floor, not a total");
      expect(short).toContain('href="/vacancy/60617/report"');
    } finally {
      landTotal = original;
    }
  });

  it("carries the anonymization disclaimer and no owner-name field in the output", async () => {
    const html = await render();
    // The page states the rail explicitly...
    expect(html).toContain("owner TYPE only, never owner names");
    // ...and never surfaces a taxpayer string or an owner-name label/field.
    expect(html).not.toMatch(/taxpayer/i);
    expect(html).not.toMatch(/owner ?name["'=:]/i);
  });
});
