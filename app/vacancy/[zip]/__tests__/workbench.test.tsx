import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VacancyCaseRecord } from "@/lib/vacancy-cases";

/**
 * Render coverage for the Find Vacant Sites page (app/vacancy/[zip]/page.tsx).
 * The page is an async Server Component
 * called directly with a fixture record set (buildCaseRecords stubbed) and the
 * client island stubbed out, so renderToStaticMarkup can inspect the unified
 * inventory contract, methodology disclosure, as-of line, and legacy ?case=
 * compatibility — with NO owner name anywhere in the output.
 *
 * The workspace itself is a client island, so these assertions check the SERVER
 * CONTRACT: the island receives every tracked record (not a case subset or sampled preview),
 * the edition geography, and parsed shareable filter state.
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
      areas: [],
      recordsAsOf: "July 22, 2026",
      universe: actual.deriveCaseUniverse(records, landTotal),
    }),
  };
});
vi.mock("@/components/vacancy/VacancySubNav", () => ({ VacancySubNav: () => null }));

// The synchronized workspace — stubbed to a marker element that echoes the
// Server Component contract without loading mapbox-gl in Node.
vi.mock("@/components/vacancy/CaseWorkspace", () => ({
  default: ({
    zip,
    records,
    boundary,
    centroid,
    initialView,
    initialUniverse,
    initialQuery,
    initialBounds,
  }: {
    zip: string;
    records: readonly { universe: string; lat: number | null; lon: number | null }[];
    boundary: unknown;
    centroid: unknown;
    initialView: string;
    initialUniverse: string;
    initialQuery: string;
    initialBounds: unknown;
  }) => (
    <div
      id="case-results"
      data-testid="case-workspace"
      data-zip={zip}
      data-records={records.length}
      data-mapped={records.filter((record) => record.lat != null && record.lon != null).length}
      data-universes={records.map((record) => record.universe).join(",")}
      data-boundary={boundary ? "yes" : "no"}
      data-centroid={centroid ? "yes" : "no"}
      data-view={initialView}
      data-universe={initialUniverse}
      data-query={initialQuery}
      data-bounds={initialBounds ? "yes" : "no"}
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

async function render(search: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await CaseWorkbenchPage({
      params: Promise.resolve({ zip: "60617" }),
      searchParams: Promise.resolve(search),
    }),
  );
}

describe("Find Vacant Sites page", () => {
  it("renders one record workspace without the overlapping pathway chooser", async () => {
    const html = await render();
    expect(html).toContain("Find vacant sites");
    expect(html).toContain("Search the tracked public records in one list or map.");
    expect(html).toContain('id="case-results"');
    expect(html).toContain("Public records as of July 22, 2026");
    expect(html).not.toContain("What do you need to do?");
    expect(html).not.toContain("Choose one pathway.");
    expect(html).not.toContain("Selected pathway");
    expect(html).not.toContain("Find public land");
    expect(html).not.toContain("Identify a title holder");
    expect(html).not.toContain("Investigate a property");
  });

  it("hands the workspace the full tracked inventory and ZIP geography", async () => {
    const html = await render();
    expect(html).toContain('data-testid="case-workspace"');
    expect(html).toContain('data-zip="60617"');
    expect(html).toContain('data-records="8"');
    expect(html).toContain('data-mapped="7"');
    expect(html).toContain(
      'data-universes="land,land,land,land,land,land,building_report,building_report"',
    );
    expect(html).toContain('data-boundary="yes"');
    expect(html).toContain('data-centroid="yes"');
  });

  it.each([
    "public-land",
    "title-holder",
    "property-review",
    "ownership-check",
    "building-review",
    "tax-title",
    "private-outreach",
    "not-a-real-case",
  ])("keeps legacy ?case=%s links on the same unified inventory", async (legacyCase) => {
    const html = await render({ case: legacyCase });
    expect(html).toContain('id="case-results"');
    expect(html).toContain('data-records="8"');
    expect(html).not.toContain("Selected pathway");
  });

  it("does not sample or cap the synchronized record set", async () => {
    const { CASE_POINT_CAP } = await import("@/lib/vacancy-cases");
    const original = records;
    records = Array.from({ length: CASE_POINT_CAP + 25 }, (_, i) =>
      r({ id: `m${i}`, universe: "land", ownerType: "city_public", lat: 41.7 + i * 1e-4, lon: -87.5 }),
    );
    try {
      const html = await render();
      expect(html).toContain(`data-records="${CASE_POINT_CAP + 25}"`);
      expect(html).toContain(`data-mapped="${CASE_POINT_CAP + 25}"`);
    } finally {
      records = original;
    }
  });

  it("parses shareable workspace state even when an older case parameter is present", async () => {
    const html = await render({
      case: "property-review",
      view: "map",
      universe: "land",
      q: "Commercial",
      bounds: "-87.6000,41.7000,-87.5000,41.8000",
    });
    expect(html).toContain('data-view="map"');
    expect(html).toContain('data-universe="land"');
    expect(html).toContain('data-query="Commercial"');
    expect(html).toContain('data-bounds="yes"');
  });

  it("prints the land and reported-building denominators for the unified inventory", async () => {
    const html = await render();
    expect(html).toContain("How these records work");
    expect(html).toContain(
      "This inventory contains 6 land parcels and 2 reported buildings tracked in this ZIP.",
    );
    expect(html).toContain("All Properties directory");
    expect(html).toContain('href="/vacancy/60617/directory"');
  });

  it("discloses that land counts are a floor when the edition publishes fewer parcels", async () => {
    const original = landTotal;
    landTotal = 6; // enumerable === total
    try {
      expect(await render()).not.toContain("so the land count is a floor");
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
    expect(html).toContain("owner TYPE only, never owner names");
    expect(html).not.toMatch(/taxpayer/i);
    expect(html).not.toMatch(/owner ?name["'=:]/i);
  });

  it("removes the separate permit-activity promo now that permit analysis is a record CTA", async () => {
    const html = await render();
    expect(html).not.toContain("Development signals");
    expect(html).not.toContain("Choose a neighborhood");
    expect(html).not.toContain('href="/permit-activity"');
  });
});
