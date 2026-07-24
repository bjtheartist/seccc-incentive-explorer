import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VacancyCaseArea, VacancyCaseRecord } from "@/lib/vacancy-cases";

/**
 * Render coverage for the Case Workbench (app/vacancy/[zip]/page.tsx) — the
 * decision-first Vacant Sites landing. The page is an async Server Component
 * called directly with a fixture record set (buildCaseRecords stubbed) and the
 * three client islands stubbed out, so renderToStaticMarkup can inspect the
 * result: five case cards with real counts, the active-case panel, the
 * geographic-preview honesty line, the opportunity-areas rail, the as-of line,
 * and the ?case= switch — with NO owner name anywhere in the output.
 */

const records: VacancyCaseRecord[] = [
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

vi.mock("@/lib/vacancy-cases-data", () => ({
  buildCaseRecords: () => ({ records, areas, recordsAsOf: "July 22, 2026" }),
}));
vi.mock("@/components/vacancy/VacancySubNav", () => ({ VacancySubNav: () => null }));
vi.mock("@/components/vacancy/CopyCaseLink", () => ({ CopyCaseLink: () => null }));
vi.mock("@/components/vacancy/CaseAreaSwitcher", () => ({ CaseAreaSwitcher: () => null }));

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

  it("carries the anonymization disclaimer and no owner-name field in the output", async () => {
    const html = await render();
    // The page states the rail explicitly...
    expect(html).toContain("owner TYPE only, never owner names");
    // ...and never surfaces a taxpayer string or an owner-name label/field.
    expect(html).not.toMatch(/taxpayer/i);
    expect(html).not.toMatch(/owner ?name["'=:]/i);
  });
});
