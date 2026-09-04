import { describe, expect, it } from "vitest";
import { generateReportData } from "../report-engine";
import { generateReportPdfBase64 } from "../pdf-report";
import type { SiteSignals } from "../site-signals";
import type { Program } from "../types";

/**
 * The report's Site Signals item used to be four counts and a caveat, which a
 * reader could not check against any agency. It now carries one detail group
 * per signal type — the count line as the heading, the individual records
 * beneath it, each with its identifier and its source URL as literal text so
 * the printed PDF is traceable too.
 */

type ReportState = Parameters<typeof generateReportData>[0];

function makeState(): ReportState {
  return {
    reportType: "site-incentives",
    address: "100 E Test St",
    lat: 41.8,
    lon: -87.6,
    neighborhood: "",
    industry: "",
    budgetRange: "",
    projectGoals: [],
    projectType: "",
    customGoal: "",
    proposedUse: "",
    fundingCommitted: "",
    remainingGap: "",
    timeline: "",
    siteControl: "",
    documentsAvailable: [],
    jobsImpact: "",
    supportNeeded: [],
    creditsToAnalyze: [],
  };
}

const SITE_SIGNALS: SiteSignals = {
  brownfield: null,
  openLustNearby: 1,
  nearestOpenLust: { name: "Monterey Gas", miles: 0.12 },
  nofAwardsNearby: 2,
  incentiveParcelsNearby: 0,
  nearestIncentiveParcel: null,
  records: {
    openLust: {
      records: [
        {
          id: "lust-20000054",
          name: "Monterey Gas",
          address: "11201-11203 South Vincennes Avenue",
          miles: 0.12,
          facts: ["Incident no. 20000054", "Status: Open"],
          sourceLabel: "Illinois EPA leaking-UST incident lookup",
          sourceUrl:
            "https://epa.illinois.gov/topics/cleanup-programs/bol-database/leaking-ust.html",
        },
      ],
      truncated: 0,
    },
    nofAwards: {
      records: [
        {
          id: "nof-2020-12-22-0",
          name: "Natural Roots Kids Hair, LLC",
          address: "1851-1855 E 87th St",
          miles: 0.31,
          facts: [
            "NOF Small grant: $190,726",
            "Approved 2020-12-22",
            "Completed 2023-05-23",
            "Ward 8 · Calumet Heights",
          ],
          sourceLabel: "Chicago Data Portal — NOF Small financial incentive projects",
          sourceUrl: "https://data.cityofchicago.org/d/rym7-49n8",
        },
      ],
      truncated: 4,
    },
    incentiveParcels: { records: [], truncated: 0 },
    brownfields: { records: [], truncated: 0 },
  },
};

const NO_PROGRAMS: Program[] = [];

function reportWith(siteSignals: SiteSignals) {
  return generateReportData(makeState(), NO_PROGRAMS, {
    zones: { tif: false, sbif: false, federalOZ: false },
    zoneNames: {},
    siteSignals,
  });
}

function siteSignalsItem(siteSignals: SiteSignals) {
  const item = reportWith(siteSignals)
    .sections.flatMap((section) => section.items)
    .find((candidate) => candidate.label === "Site Signals");
  if (!item) throw new Error("expected a Site Signals item in the report");
  return item;
}

describe("the report's Site Signals item traces back to individual records", () => {
  it("keeps the existing summary lines and the caveat sentence", () => {
    const item = siteSignalsItem(SITE_SIGNALS);

    expect(item.value).toBe("2 nearby public-data signals");
    expect(item.detail).toContain("NOF grants funded within 1/2 mi: 2");
    expect(item.detail).toContain("Open tank-leak incidents within 1/4 mi: 1");
    expect(item.detail).toContain(
      "Public-data proximity signals only; verify with DPD, Cook County, IEPA/EPA, or the administering agency before relying on them.",
    );
    expect(item.detailCaveat).toBe(
      "Public-data proximity signals only; verify with DPD, Cook County, IEPA/EPA, or the administering agency before relying on them.",
    );
  });

  it("carries the NOF record line with its amount and source URL", () => {
    const item = siteSignalsItem(SITE_SIGNALS);

    const nof = item.detailGroups?.find((group) => group.id === "nof-awards");
    expect(nof).toBeTruthy();
    // The heading is the count line the report already showed.
    expect(nof!.label).toBe("NOF grants funded within 1/2 mi: 2");
    expect(nof!.items[0]).toContain("Natural Roots Kids Hair, LLC");
    expect(nof!.items[0]).toContain("1851-1855 E 87th St");
    expect(nof!.items[0]).toContain("0.3 mi");
    expect(nof!.items[0]).toContain("NOF Small grant: $190,726");
    expect(nof!.items[0]).toContain("https://data.cityofchicago.org/d/rym7-49n8");
    expect(nof!.items).toContain("and 4 more within the same radius");
  });

  it("carries the tank-leak incident number and the Illinois EPA lookup URL", () => {
    const lust = siteSignalsItem(SITE_SIGNALS).detailGroups?.find(
      (group) => group.id === "open-lust",
    );

    expect(lust!.label).toBe("Open tank-leak incidents within 1/4 mi: 1");
    expect(lust!.items[0]).toContain("Incident no. 20000054");
    expect(lust!.items[0]).toContain(
      "https://epa.illinois.gov/topics/cleanup-programs/bol-database/leaking-ust.html",
    );
  });

  it("falls back to the original ungrouped detail for a snapshot with no records", () => {
    const { records: _records, ...legacy } = SITE_SIGNALS;
    const item = siteSignalsItem(legacy);

    expect(item.detailGroups).toBeUndefined();
    expect(item.detail).toContain("NOF grants funded within 1/2 mi: 2");
  });

  it("still emits the Site Signals row in the PDF export", () => {
    // NOTE ON THE PDF: the live v2 renderer draws Site Facts items as
    // one-line "snapshot rows" (label + value) via drawSnapshotRow — it never
    // reads `detailGroups`. The only builder in lib/pdf-report.ts that renders
    // detail groups is the unexported, unused `_buildLegacyReportPdf`. So the
    // record lines reach the report PAGE but not the PDF today; this asserts
    // only that the item itself still exports, so the row is not lost while
    // the groups were added. It deliberately does NOT assert their absence.
    const report = reportWith(SITE_SIGNALS);
    const { base64 } = generateReportPdfBase64(report);
    const bytes = Buffer.from(base64, "base64").toString("latin1");

    expect(bytes).toContain("Site Signals");
  });
});
