import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VacancyIndexExport } from "@/lib/vacancy-index";

/**
 * Rail-2 coverage for the now-PUBLIC vacancy report (app/vacancy/[zip]/page.tsx).
 * The page renders publicly (no password wall), but the parcel-level EXEMPTION
 * REFERRAL table must stay admin-only — gated server-side by the same
 * Owner Files / analytics admin session check. Mirrors
 * app/admin/owner-files/__tests__/gating.test.tsx: the page is an async Server
 * Component called directly with next/headers mocked and the data loaders +
 * client islands stubbed, so renderToStaticMarkup can inspect the result.
 */

const { hasSessionMock, isConfiguredMock, cookiesMock, referralMock } = vi.hoisted(() => ({
  hasSessionMock: vi.fn(),
  isConfiguredMock: vi.fn(),
  cookiesMock: vi.fn(),
  referralMock: vi.fn(),
}));

vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "cie_owner_files_admin",
  isOwnerFilesAdminConfigured: isConfiguredMock,
  hasValidOwnerFilesAdminSession: hasSessionMock,
}));
vi.mock("@/lib/analytics-admin-auth", () => ({ ANALYTICS_ADMIN_COOKIE: "cie_analytics_admin" }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));

// Data loaders — keep the pure functions real, override only the file loader.
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
vi.mock("@/lib/tif-briefs", () => ({
  loadTifBriefs: () => null,
  buildTifFundingPicture: () => [],
  TIF_RELATION_LABELS: { touching: "Touching", near: "Near" },
  TIF_STANDING_EXPLAINER: "",
  TIF_BALANCE_CAVEAT: "",
  TIF_BALANCE_MISSING: "",
  TIF_VINTAGE_NOTE: "",
  TIF_PROJECTIONS_NULL_NOTE: "",
  TIF_ADJACENCY_HEADING: "",
  TIF_ADJACENCY_BODY: "",
  TIF_ADJACENCY_MAP_NOTE: "",
  TIF_VACANCY_DISCLAIMER: "",
  TIF_DPD_AUTHORITY_HEADING: "",
  TIF_DPD_AUTHORITY_BODY: "",
  TIF_DPD_AUTHORITY_CTA: "",
  TIF_PROCESS_LINE: "",
  TIF_PARTNERS_NOTE: "",
}));
vi.mock("@/lib/vacancy-corridor-rings", () => ({ loadCorridorRings: () => null }));
vi.mock("@/lib/exemption-anomalies", () => ({ exemptionReferralRowsForZip: referralMock }));
vi.mock("@/lib/vacancy-opportunity-areas", () => ({
  deriveOpportunityAreas: () => ({ areas: [], hiddenCount: 0, totalQualifying: 4 }),
}));

// Client islands — stub to keep mapbox / jsPDF out of the render.
vi.mock("@/components/vacancy/VacancyMapIsland", () => ({ default: () => null }));
vi.mock("@/components/vacancy/VacancyClustersIsland", () => ({ default: () => null }));
vi.mock("@/components/vacancy/VacancyDirectory", () => ({ default: () => null }));
vi.mock("@/components/vacancy/VacancySubNav", () => ({ VacancySubNav: () => null }));
vi.mock("@/components/owner-file/VacancyIndexPdfButton", () => ({ VacancyIndexPdfButton: () => null }));

const fakeExport = {
  generatedAt: "2026-07-22T00:00:00.000Z",
  sources: {
    trackedInventory: "src-a",
    vacantLandOwnership: "src-b",
    corridorMetrics: "src-c",
    zipBoundaries: "src-d",
    transportNetwork: "src-e",
    asOf: "2026-07-22",
  },
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

const REFERRAL_ROW = {
  pin: "21322110390000",
  address: "1 FAKE ST",
  classCode: "100",
  universe: "land" as const,
  exemptions: { homeowner: 100, senior: 0, freeze: 0, disabled: 0, vet: 0, longtime: 0 },
  taxYear: 2024,
  latestTransferDate: null,
};

function cookieStore() {
  return { get: () => undefined };
}

import VacancyReportPage from "../page";

beforeEach(() => {
  isConfiguredMock.mockReset().mockReturnValue(true);
  hasSessionMock.mockReset().mockReturnValue(false);
  cookiesMock.mockReset().mockResolvedValue(cookieStore());
  referralMock.mockReset().mockReturnValue([REFERRAL_ROW]);
});

async function render() {
  return renderToStaticMarkup(await VacancyReportPage({ params: Promise.resolve({ zip: "60617" }) }));
}

describe("public vacancy report + admin-only referral table", () => {
  it("renders publicly with NO password wall when there is no admin session", async () => {
    hasSessionMock.mockReturnValue(false);
    const html = await render();
    expect(html).not.toContain("Enter admin password");
    expect(html).toContain("Scale of the challenge");
    expect(html).toContain("South Chicago");
  });

  it("HIDES the parcel-level referral table for a non-admin visitor", async () => {
    hasSessionMock.mockReturnValue(false);
    const html = await render();
    expect(html).not.toContain("Exemption anomalies — referral review");
    // The public aggregate block heading still renders for everyone.
    expect(html).toContain("Exemption anomalies — records for review");
    // Defect F: the private-packet fs read must not even run for anonymous requests.
    expect(referralMock).not.toHaveBeenCalled();
  });

  it("SHOWS the referral table (with its PIN) for a valid admin session", async () => {
    hasSessionMock.mockReturnValue(true);
    const html = await render();
    expect(html).toContain("Exemption anomalies — referral review");
    expect(html).toContain("Admin only");
    expect(html).toContain("21322110390000");
    expect(referralMock).toHaveBeenCalledWith("60617");
  });

  it("keeps the table hidden even for an admin when the admin gate is unconfigured", async () => {
    isConfiguredMock.mockReturnValue(false);
    hasSessionMock.mockReturnValue(true);
    const html = await render();
    expect(html).not.toContain("Exemption anomalies — referral review");
  });
});
