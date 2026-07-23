import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VacancyIndexExport } from "@/lib/vacancy-index";
import type { TifBriefsExport } from "@/lib/tif-briefs";

/**
 * Copy coverage for the reworked "TIF funding picture" section on
 * app/vacancy/[zip]/page.tsx (the no-overreach framing). Renders the async
 * Server Component directly with next/headers mocked and the data loaders +
 * client islands stubbed, then string-asserts the rendered output for a fixture
 * district. The tif-briefs MODULE stays real (pure view builder + verbatim copy
 * constants); only its file loader is overridden with a fixture, so the page
 * renders the actual honesty copy.
 */

const { hasSessionMock, isConfiguredMock, cookiesMock } = vi.hoisted(() => ({
  hasSessionMock: vi.fn(),
  isConfiguredMock: vi.fn(),
  cookiesMock: vi.fn(),
}));

vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "cie_owner_files_admin",
  isOwnerFilesAdminConfigured: isConfiguredMock,
  hasValidOwnerFilesAdminSession: hasSessionMock,
}));
vi.mock("@/lib/analytics-admin-auth", () => ({ ANALYTICS_ADMIN_COOKIE: "cie_analytics_admin" }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));

vi.mock("@/lib/vacancy-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vacancy-index")>();
  return { ...actual, loadVacancyIndex: () => fakeExport };
});
vi.mock("@/lib/vacancy-index-adapter", () => ({
  buildVacancyIndexPdfInput: () => ({
    counts: { total: 100, cityOwned: 40, privatelyHeld: 60 },
    matrixRows: [],
  }),
}));
// Keep the tif-briefs module REAL (pure builder + copy constants); override only
// the committed-file loader with a fixture export.
vi.mock("@/lib/tif-briefs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tif-briefs")>();
  return { ...actual, loadTifBriefs: () => fakeTifBriefs };
});
vi.mock("@/lib/vacancy-corridor-rings", () => ({ loadCorridorRings: () => null }));
vi.mock("@/lib/exemption-anomalies", () => ({ exemptionReferralRowsForZip: () => [] }));
vi.mock("@/lib/vacancy-opportunity-areas", () => ({
  deriveOpportunityAreas: () => ({ areas: [], hiddenCount: 0, totalQualifying: 4 }),
}));

vi.mock("@/components/vacancy/VacancyMapIsland", () => ({ default: () => null }));
vi.mock("@/components/vacancy/VacancyClustersIsland", () => ({ default: () => null }));
vi.mock("@/components/vacancy/VacancyDirectory", () => ({ default: () => null }));
vi.mock("@/components/vacancy/VacancySubNav", () => ({ VacancySubNav: () => null }));
vi.mock("@/components/owner-file/VacancyIndexPdfButton", () => ({ VacancyIndexPdfButton: () => null }));

const fakeExport = {
  generatedAt: "2026-07-22T00:00:00.000Z",
  sources: { asOf: "2026-07-22" },
  matrix: [],
  editions: {
    "60617": {
      zip: "60617",
      neighborhood: "South Chicago",
      secondaryAreas: [],
      editionNumber: 1,
      headline: {
        vacantPropertyCount: 100,
        vacantLandCount: 60,
        vacantBuildingCount: 40,
        cityOwnedCount: 40,
        inIncentiveZoneCount: 100,
        priorityMix: { high: 10, medium: 20, low: 70 },
      },
      ownership: {
        vacantLandParcelsByOwnerType: null,
        vacantLandParcelTotal: null,
        trackedInventoryByOwnerType: [],
        reconciledVacantLandByOwnerType: null,
        reconciliation: null,
        structureBreakdown: null,
      },
      distress: null,
      exemptionAnomalies: null,
      sitePoints: [],
      sitePointsTruncated: false,
      siteIndex: [],
      landPoints: null,
      landPointsTruncated: false,
      landPointsTotal: null,
      directoryCount: 0,
      buildingPinMatch: null,
      boundary: null,
      centroid: { lat: 41.74, lon: -87.55 },
      transport: [],
      clusters: [],
      clustersNote: "",
      corridors: [],
      anchors: null,
    },
  },
} as unknown as VacancyIndexExport;

const fakeTifBriefs: TifBriefsExport = {
  generatedAt: "2026-07-22T00:00:00.000Z",
  sources: {
    tifBoundaries: "TIF boundaries source",
    tifAnnualReport: "TIF annual report source",
    tifProjections: "DPD projections source",
    vacancyIndex: "Vacancy index source",
    asOf: "2026-07-22",
  },
  districts: {
    "T-115": {
      number: "T-115",
      name: "Chicago/Central Park",
      approvalDate: null,
      expirationDate: "2026-12-31",
      sbif: false,
      wards: "",
      status: "Active",
      finance: {
        reportYear: 2024,
        fundBalance: 68744348,
        taxAllocationFundBalance: null,
        incrementCurrent: null,
        surplusDistributed: null,
      },
      projections: {
        publishedDate: "2025-10-15",
        source: "DPD 10-Year TIF Projections (2025–2034)",
        categories: {
          "Current Obligations": -92273755,
          "Fund Balance": 68744348,
        },
      },
      neighbors: [{ number: "T-200", relation: "touching" }],
    },
    "T-200": {
      number: "T-200",
      name: "Neighbor District",
      approvalDate: null,
      expirationDate: "2030-12-31",
      sbif: false,
      wards: "",
      status: "Active",
      // No annual-report row + no projections → the missing-data paths render.
      finance: null,
      projections: null,
      neighbors: [{ number: "T-115", relation: "touching" }],
    },
  },
  zips: {
    "60617": {
      districtNumbers: ["T-115", "T-200"],
      vacantSiteCounts: { "T-115": 12, "T-200": 3 },
    },
  },
};

function cookieStore() {
  return { get: () => undefined };
}

import VacancyReportPage from "../page";

beforeEach(() => {
  isConfiguredMock.mockReset().mockReturnValue(true);
  hasSessionMock.mockReset().mockReturnValue(false);
  cookiesMock.mockReset().mockResolvedValue(cookieStore());
});

async function render(): Promise<string> {
  return renderToStaticMarkup(await VacancyReportPage({ params: Promise.resolve({ zip: "60617" }) }));
}

describe("TIF funding picture — no-overreach framing", () => {
  it("renders the reported-balance framing, caveat, and scheduled-end (no urgency)", async () => {
    const html = await render();
    expect(html).toContain("Reported year-end balance");
    expect(html).toContain(
      "Year-end accounting balance — not a current estimate of funds available for new projects.",
    );
    expect(html).toContain("As of Dec 31, 2024 · City of Chicago TIF Annual Report");
    expect(html).toContain("Current scheduled end");
    expect(html).toContain("under current law");
  });

  it("renders the §2B standing explainer and the DPD-authority framing", async () => {
    const html = await render();
    expect(html).toContain("TIF finances change between annual reports");
    expect(html).toContain("confirm with DPD");
    expect(html).toContain("Prepare a TIF inquiry for DPD");
    expect(html).toContain("Published record");
  });

  it("renders the programming outlook with verbatim categories + the vintage non-reconciliation line", async () => {
    const html = await render();
    expect(html).toContain("City programming outlook");
    expect(html).toContain("Current Obligations");
    expect(html).toContain("Fund Balance");
    expect(html).toContain("DPD 10-Year TIF Projections, published Oct 15, 2025");
    expect(html).toContain("they do not add up to an available-funds number");
  });

  it("renders the adjacency screening-signal note + the vacancy disclaimer", async () => {
    const html = await render();
    expect(html).toContain("Use in a neighboring TIF may be legally possible");
    expect(html).toContain("screening signal, not a legal determination");
    expect(html).toContain("Location does not establish ownership, project eligibility, or funding.");
  });

  it("distinguishes a missing annual-report row from a real $0", async () => {
    const html = await render();
    expect(html).toContain("No annual report row published");
    expect(html).toContain("No line items published for this district");
  });

  it("does NOT render the old urgency/race phrasing", async () => {
    const html = await render();
    expect(html).not.toContain("Expires this year");
    expect(html).not.toContain("Expires in");
  });

  it("never labels a dollar figure with a banned word (available/free/unused/unspent/sitting)", async () => {
    const html = await render();
    const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;/g, "'");
    // A banned adjective directly qualifying a $ figure, in either order.
    expect(text).not.toMatch(/(available|free|unused|unspent|sitting)\s*:?\s*-?\$\s*[\d]/i);
    expect(text).not.toMatch(/-?\$[\d,]+(\.\d+)?\s+(available|free|unused|unspent|sitting)\b/i);
  });
});
