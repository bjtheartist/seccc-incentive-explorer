import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SiteMatchmakerResultsTable, {
  SiteMatchmakerContextNotice,
} from "../SiteMatchmakerResultsTable";
import type { VacancyLandPoint, VacancySitePoint } from "@/lib/vacancy-index";

const sitePoint: VacancySitePoint = {
  lat: 41.73,
  lon: -87.55,
  ownerType: "city_public",
  propertyType: "vacant_building",
  markerNumber: null,
  address: "100 E MAIN ST",
  pin: "20123456789012",
  squareFeet: null,
  zoningClass: null,
  incentiveCount: 2,
  ownerConfidence: "pin_matched",
  clusterId: null,
  saleYear: null,
  violation: false,
  ownerStructure: "government",
  ownerGeography: "in_state",
  pinMatch: "inventory",
};

const landPoint: VacancyLandPoint = {
  lat: 41.74,
  lon: -87.56,
  ownerType: "local_private",
  address: "200 E OAK ST",
  pin: "20987654321098",
  squareFeet: 5_000,
  ownerConfidence: "inferred",
  saleYear: 2021,
  ownerStructure: "individual",
  ownerGeography: "in_state",
};

describe("SiteMatchmakerResultsTable", () => {
  it("renders both candidate source views with public-safe unknown states", () => {
    const html = renderToStaticMarkup(
      <SiteMatchmakerResultsTable
        sitePoints={[sitePoint]}
        landPoints={[landPoint]}
        zip="60617"
        neighborhood="South Chicago"
        buildId="build-test"
      />,
    );

    expect(html).toContain('data-testid="site-matchmaker-results-table"');
    expect(html).toContain("South Chicago property comparison");
    expect(html).toContain("Tracked inventory");
    expect(html).toContain("Reconciled vacant land");
    expect(html).toContain('>2</span> of 2 candidate records');
    expect(html).toContain("Not published");
    expect(html).toContain("Not mapped in this source");
    expect(html).toContain("Preparing CSV");
    expect(html).toContain("Loading Census, EPA, and proximity context");
    expect(html).toContain("Population density");
    expect(html).toContain("EPA Walkability Index");
    expect(html).toContain("Nearest expressway");
    expect(html).toContain("Airport proximity");
    expect(html).toContain("Loading context...");
    expect(html).toContain("CookViewer");
    expect(html).toContain("Assessor");
    expect(html).toContain("Clerk documents");
    expect(html).not.toContain("Load 100 more");
    expect(html).not.toMatch(/owner name|explorer score|rank|recommendation bucket|projected incentive|estimated dollars|\$/i);
  });

  it("renders a clear empty universe without fetching another source", () => {
    const html = renderToStaticMarkup(
      <SiteMatchmakerResultsTable
        sitePoints={[]}
        landPoints={null}
        zip="60617"
        neighborhood="South Chicago"
        buildId="build-test"
      />,
    );

    expect(html).toContain('>0</span> of 0 candidate records');
    expect(html).toContain("No candidate records match the current filters.");
    expect(html).toContain("Preparing CSV");
  });

  it("renders the first 100 rows with progressive pagination", () => {
    const points = Array.from({ length: 101 }, (_, index) => ({
      ...sitePoint,
      address: `${String(index + 1).padStart(3, "0")} E MAIN ST`,
      pin: null,
    }));
    const html = renderToStaticMarkup(
      <SiteMatchmakerResultsTable
        sitePoints={points}
        zip="60617"
        neighborhood="South Chicago"
        buildId="build-test"
      />,
    );

    expect(html).toContain("Showing 100 of 101 filtered records");
    expect(html).toContain("Load 100 more");
    expect(html).not.toContain("101 E MAIN ST");
  });

  it("renders a non-blocking context unavailable state", () => {
    const html = renderToStaticMarkup(
      <SiteMatchmakerContextNotice status="unavailable" totalCount={2} />,
    );

    expect(html).toContain("Location context is temporarily unavailable");
    expect(html).toContain("Candidate records and non-context filters still work");
  });

  it("renders a compact available-state match count", () => {
    const html = renderToStaticMarkup(
      <SiteMatchmakerContextNotice status="available" matchedCount={7} totalCount={10} />,
    );

    expect(html).toContain("Context matched for 7 of 10 candidate records");
  });
});
