import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { VacancyLandPoint, VacancySitePoint } from "@/lib/vacancy-index";

vi.mock("../VacancyReportMap", () => ({
  default: ({ sitePoints }: { sitePoints: VacancySitePoint[] }) => (
    <div data-testid="map">{sitePoints.length} map candidates</div>
  ),
}));

vi.mock("../SiteMatchmakerResultsTable", () => ({
  default: ({
    sitePoints,
    landPoints,
    buildId,
  }: {
    sitePoints: VacancySitePoint[];
    landPoints?: VacancyLandPoint[] | null;
    buildId: string;
  }) => (
    <div data-testid="results-table">
      {sitePoints.length} tracked and {landPoints?.length ?? 0} land candidates · {buildId}
    </div>
  ),
}));

vi.mock("../vacancy-focus", () => ({
  useFocusBbox: () => null,
}));

import VacancyMapIsland from "../VacancyMapIsland";

const sitePoint = { lat: 41.73, lon: -87.55 } as VacancySitePoint;
const landPoint = { lat: 41.74, lon: -87.56 } as VacancyLandPoint;

const baseProps = {
  zip: "60617",
  boundary: null,
  bbox: null,
  centroid: { lat: 41.73, lon: -87.55 },
  sitePoints: [sitePoint],
  siteIndex: [],
  totalCount: 1,
  landPoints: [landPoint],
  landPointsTruncated: false,
  landPointsTotal: 1,
  neighborhood: "South Chicago",
};

describe("VacancyMapIsland Site Matchmaker results", () => {
  it("renders the spreadsheet below the map from the same candidate arrays", () => {
    const html = renderToStaticMarkup(
      <VacancyMapIsland
        {...baseProps}
        showSiteMatchmakerResults
        siteMatchmakerBuildId="build-map"
      />,
    );

    expect(html).toContain('id="site-matchmaker-map"');
    expect(html).toContain("1 map candidates");
    expect(html).toContain("1 tracked and 1 land candidates");
    expect(html).toContain("build-map");
    expect(html.indexOf("1 map candidates")).toBeLessThan(
      html.indexOf("1 tracked and 1 land candidates"),
    );
  });

  it("does not add the spreadsheet to ordinary vacancy maps", () => {
    const html = renderToStaticMarkup(<VacancyMapIsland {...baseProps} />);

    expect(html).toContain("1 map candidates");
    expect(html).not.toContain("results-table");
    expect(html).not.toContain("site-matchmaker-map");
  });
});
