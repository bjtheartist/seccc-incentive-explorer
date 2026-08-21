import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VacancyIndexExport } from "@/lib/vacancy-index";

/**
 * build-spec.md PR-A item 1/6 (F1) — the web report's site-index Verify
 * column used to recover a row's PIN by re-joining `edition.sitePoints` on
 * `${lat},${lon}` (a last-write-wins Map). Real failing case (60651,
 * siteIndex[8]): 3232 W DIVISION ST's own `pin` is 16022280270000, but four
 * co-located sitePoints (270000/300000/290000/280000, in that order) used to
 * resolve the row's CookViewer/Clerk links to 16022280280000 instead — a
 * wrong-parcel link. The fix reads `row.pin` directly and deletes the join.
 * Follows app/vacancy/[zip]/__tests__/gating.test.tsx's pattern: the async
 * Server Component is called directly with next/headers + client islands
 * stubbed, so renderToStaticMarkup can inspect the actual rendered hrefs.
 */

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));

vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "cie_owner_files_admin",
  isOwnerFilesAdminConfigured: () => false,
  hasValidOwnerFilesAdminSession: () => false,
}));
vi.mock("@/lib/analytics-admin-auth", () => ({ ANALYTICS_ADMIN_COOKIE: "cie_analytics_admin" }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));

vi.mock("@/lib/vacancy-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vacancy-index")>();
  return { ...actual, loadVacancyIndex: () => fakeExport };
});
// The web report's site-index table reads `row.pin` straight off
// `edition.siteIndex` — NOT off `pdfInput.topSites` — so the adapter can stay
// stubbed here; its own row.pin correctness is covered independently by
// lib/__tests__/vacancy-index-adapter-row-pin.test.ts.
vi.mock("@/lib/vacancy-index-adapter", () => ({
  buildVacancyIndexPdfInput: () => ({
    counts: { total: 20, cityOwned: 5, privatelyHeld: 15, inIncentiveZones: 20 },
    matrixRows: [],
  }),
}));
vi.mock("@/lib/vacancy-corridor-rings", () => ({ loadCorridorRings: () => null }));
vi.mock("@/lib/exemption-anomalies", () => ({ exemptionReferralRowsForZip: () => [] }));
vi.mock("@/lib/vacancy-opportunity-areas", () => ({
  deriveOpportunityAreas: () => ({ areas: [], hiddenCount: 0, totalQualifying: 0 }),
}));

vi.mock("@/components/vacancy/VacancyMapIsland", () => ({ default: () => null }));
vi.mock("@/components/vacancy/VacancyClustersIsland", () => ({ default: () => null }));
vi.mock("@/components/vacancy/VacancyDirectory", () => ({ default: () => null }));
vi.mock("@/components/vacancy/VacancySubNav", () => ({ VacancySubNav: () => null }));
vi.mock("@/components/owner-file/VacancyIndexPdfButton", () => ({ VacancyIndexPdfButton: () => null }));

const ROW_PIN = "16022280270000";
const COLOCATED_WRONG_PIN = "16022280280000";
const SHARED_LAT = 41.899;
const SHARED_LON = -87.71;

function cookieStore() {
  return { get: () => undefined };
}

const fakeExport = {
  generatedAt: "2026-08-13T00:00:00.000Z",
  sources: {
    trackedInventory: "src-a",
    vacantLandOwnership: "src-b",
    corridorMetrics: "src-c",
    zipBoundaries: "src-d",
    transportNetwork: "src-e",
    asOf: "2026-08-13",
  },
  matrix: [],
  editions: {
    "60651": {
      zip: "60651",
      neighborhood: "Austin",
      secondaryAreas: [],
      editionNumber: 4,
      headline: {
        vacantPropertyCount: 20,
        vacantLandCount: 8,
        vacantBuildingCount: 12,
        cityOwnedCount: 5,
        inIncentiveZoneCount: 20,
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
      boundary: null,
      centroid: { lat: SHARED_LAT, lon: SHARED_LON },
      transport: [],
      siteIndex: [
        {
          markerNumber: 9,
          address: "3232 W DIVISION ST",
          ownerType: "local_private",
          propertyType: "vacant_building",
          zoningClass: "B3-2",
          squareFeet: 2400,
          incentiveCount: 1,
          nextStep: "Verify ownership",
          lat: SHARED_LAT,
          lon: SHARED_LON,
          pin: ROW_PIN,
          ownerStructure: "llc",
          ownerGeography: "in_state",
        },
      ],
      sitePoints: [
        // The wrong pin (280000) is deliberately LAST — the deleted
        // coordinate-keyed Map join (last write wins) would have resolved to
        // it instead of the row's own pin.
        { lat: SHARED_LAT, lon: SHARED_LON, pin: ROW_PIN, ownerType: "local_private", propertyType: "vacant_building", markerNumber: 9, address: "3232 W DIVISION ST", squareFeet: 2400, zoningClass: "B3-2", incentiveCount: 1, ownerConfidence: "pin_matched", clusterId: null, saleYear: null, violation: false, ownerStructure: "llc", ownerGeography: "in_state", pinMatch: "inventory" },
        { lat: SHARED_LAT, lon: SHARED_LON, pin: "16022280300000", ownerType: "local_private", propertyType: "vacant_building", markerNumber: null, address: "3230 W DIVISION ST", squareFeet: 2400, zoningClass: "B3-2", incentiveCount: 1, ownerConfidence: "pin_matched", clusterId: null, saleYear: null, violation: false, ownerStructure: "llc", ownerGeography: "in_state", pinMatch: "inventory" },
        { lat: SHARED_LAT, lon: SHARED_LON, pin: "16022280290000", ownerType: "local_private", propertyType: "vacant_building", markerNumber: null, address: "3228 W DIVISION ST", squareFeet: 2400, zoningClass: "B3-2", incentiveCount: 1, ownerConfidence: "pin_matched", clusterId: null, saleYear: null, violation: false, ownerStructure: "llc", ownerGeography: "in_state", pinMatch: "inventory" },
        { lat: SHARED_LAT, lon: SHARED_LON, pin: COLOCATED_WRONG_PIN, ownerType: "local_private", propertyType: "vacant_building", markerNumber: null, address: "3226 W DIVISION ST", squareFeet: 2400, zoningClass: "B3-2", incentiveCount: 1, ownerConfidence: "pin_matched", clusterId: null, saleYear: null, violation: false, ownerStructure: "llc", ownerGeography: "in_state", pinMatch: "inventory" },
      ],
      sitePointsTruncated: false,
      landPoints: null,
      landPointsTruncated: false,
      landPointsTotal: null,
      directoryCount: 0,
      buildingPinMatch: null,
      clusters: [],
      clustersNote: "",
      corridors: [],
      anchors: null,
    },
  },
} as unknown as VacancyIndexExport;

import VacancyReportPage from "../report/page";

beforeEach(() => {
  cookiesMock.mockReset().mockResolvedValue(cookieStore());
});

async function render() {
  return renderToStaticMarkup(await VacancyReportPage({ params: Promise.resolve({ zip: "60651" }) }));
}

describe("Vacancy report site index — Verify links use the row's own pin (F1)", () => {
  it("builds BOTH the CookViewer and Clerk hrefs from row.pin, never the co-located neighbor sitePoint's pin", async () => {
    const html = await render();
    expect(html).toContain("3232 W DIVISION ST");

    // Both deep links must carry the row's real pin...
    expect(html).toContain(`pin14=${ROW_PIN}`);
    expect(html).toContain(`id1=${ROW_PIN}`);
    // ...and never the co-located neighbor that the deleted coordinate join
    // would have picked (last write wins).
    expect(html).not.toContain(`pin14=${COLOCATED_WRONG_PIN}`);
    expect(html).not.toContain(`id1=${COLOCATED_WRONG_PIN}`);
  });
});
