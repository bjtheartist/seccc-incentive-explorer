import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IllinoisArtsCouncilAwardsTable } from "../IllinoisArtsCouncilAwardsTable";
import type { IllinoisArtsCouncilAwardsContext } from "@/lib/investment-analysis";

const data: IllinoisArtsCouncilAwardsContext = {
  fundingPurpose: "arts",
  fiscalYear: 2026,
  sourceVersion: "FY2026 Q1",
  sourceCheckedAt: "2026-08-08",
  sourcePageUrl: "https://arts.illinois.gov/grants",
  sourceDataUrl: "https://arts.illinois.gov/grants.json",
  recordCount: 2,
  recordIdMeaning: "Snapshot-local row key.",
  amountMeaning: "Historical award, not current eligibility.",
  geographyMeaning: "Published city and region only.",
  coverage: {
    capture: "complete_published",
    mapDetail: "aggregate_only",
    refresh: "awaiting_publication",
    review: "complete_published",
  },
  records: [
    {
      recordId: "iac-fy26-q1-row-0001",
      sourceRow: 1,
      program: "CREATIVE ACCELERATOR",
      applicantName: "Artist One",
      grantAmount: 10_000,
      city: "Chicago",
      region: "Metro 5",
      fiscalYear: 2026,
      sourceVersion: "FY2026 Q1",
      sourcePageUrl: "https://arts.illinois.gov/grants",
      sourceDataUrl: "https://arts.illinois.gov/grants.json",
      sourceCheckedAt: "2026-08-08",
    },
    {
      recordId: "iac-fy26-q1-row-0002",
      sourceRow: 2,
      program: "GENERAL OPERATING SUPPORT",
      applicantName: "Arts Organization",
      grantAmount: 20_000,
      city: "Chicago",
      region: "Metro 3",
      fiscalYear: 2026,
      sourceVersion: "FY2026 Q1",
      sourcePageUrl: "https://arts.illinois.gov/grants",
      sourceDataUrl: "https://arts.illinois.gov/grants.json",
      sourceCheckedAt: "2026-08-08",
    },
  ],
};

describe("IllinoisArtsCouncilAwardsTable", () => {
  const html = renderToStaticMarkup(<IllinoisArtsCouncilAwardsTable data={data} />);

  it("renders the searchable, filterable citywide award table", () => {
    expect(html).toContain("State arts funding");
    expect(html).toContain("Illinois Arts Council awards");
    expect(html).toContain("Search applicants");
    expect(html).toContain("All programs");
    expect(html).toContain("All years");
    expect(html).toContain("Artist One");
    expect(html).toContain("$10,000");
  });

  it("carries source completeness, geographic precision, and historical caveats", () => {
    expect(html).toContain("Complete for published source");
    expect(html).toContain("City-level only");
    expect(html).toContain("Arts funding");
    expect(html).toContain("not mapped to neighborhoods or properties");
    expect(html).toContain("Historical award, not current eligibility or proof of payment");
    expect(html).toContain("Source reviewed 2026-08-08");
  });
});
