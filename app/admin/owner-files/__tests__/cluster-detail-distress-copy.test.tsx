import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OwnerCluster } from "@/lib/corridor-owners";
import type { OwnerFile } from "@/lib/owner-file";

/**
 * Distress Signals honesty-pass coverage for the Owner File detail page
 * (app/admin/owner-files/[zip]/[clusterKey]/page.tsx): the two now-live
 * cards (vacant-building violations, tax-sale exposure) render real values,
 * and the two manual-import-pending cards (delinquent-tax exposure, CCLBA
 * inventory) carry their specific reasons rather than the generic "hasn't
 * loaded yet" copy. Mirrors gating.test.tsx's pattern of calling the async
 * Server Component directly and inspecting renderToStaticMarkup output — the
 * page's client subcomponents (OwnerFileVerificationForm, OutreachLog) call
 * useRouter() at render time, so next/navigation is mocked alongside
 * next/headers and the admin-auth/owner-file data dependencies.
 */

const { isConfiguredMock, hasSessionMock, cookiesMock, getOwnerFileMock } = vi.hoisted(() => ({
  isConfiguredMock: vi.fn(),
  hasSessionMock: vi.fn(),
  cookiesMock: vi.fn(),
  getOwnerFileMock: vi.fn(),
}));

vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "cie_owner_files_admin",
  isOwnerFilesAdminConfigured: isConfiguredMock,
  hasValidOwnerFilesAdminSession: hasSessionMock,
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called unexpectedly");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/owner-file", () => ({
  getOwnerFile: getOwnerFileMock,
}));

vi.mock("@/lib/analytics-events", () => ({
  trackEvent: vi.fn(),
}));

import OwnerFileDetailPage from "../[zip]/[clusterKey]/page";

const ZIP = "60617";
const CLUSTER_KEY = "mail:testowner";

const baseCluster: OwnerCluster = {
  clusterKey: CLUSTER_KEY,
  pins: ["17213210180000"],
  ownerName: "TEST OWNER LLC",
  ownerMailingAddress: "1 MAIN ST, CHICAGO, IL",
  ownerType: "corporate_llc",
  parcelCount: 1,
  vacantParcelCount: 0,
  businessCount: 0,
  businessNames: [],
  sampleAddresses: ["100 MAIN ST"],
  latestTransferDate: null,
  latestBuyerName: null,
  latestSellerName: null,
  confidence: "High",
  evidence: "grouped by recorded owner mailing address",
  distressSignals: {
    buildingViolationCount: 0,
    vacantBuildingViolationCount: null,
    delinquentTaxCount: null,
    scavengerOrAnnualSaleFlag: null,
    cclbaInventoryFlag: null,
  },
};

function makeOwnerFile(cluster: OwnerCluster): OwnerFile {
  return {
    cluster,
    verification: null,
    notes: [],
    outreachEvents: [],
    resolvedTier: "B",
    isEntityOwner: true,
    snapshotGeneratedAt: "2026-07-16T00:00:00.000Z",
  };
}

async function renderPage() {
  const element = await OwnerFileDetailPage({
    params: Promise.resolve({ zip: ZIP, clusterKey: CLUSTER_KEY }),
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  isConfiguredMock.mockReset().mockReturnValue(true);
  hasSessionMock.mockReset().mockReturnValue(true);
  cookiesMock.mockReset().mockResolvedValue({ get: () => ({ value: "session" }) });
  getOwnerFileMock.mockReset();
});

describe("Distress Signals — manual-import-pending cards", () => {
  it("always carries the specific pending reason, not the generic 'hasn't loaded' copy", async () => {
    getOwnerFileMock.mockResolvedValue(makeOwnerFile(baseCluster));
    const html = await renderPage();
    expect(html).toContain("Requires the Cook County Clerk&#x27;s monthly delinquency file (manual import)");
    expect(html).toContain("sale-exposure below is the public signal in the meantime");
    expect(html).toContain("CCLBA publishes no public API");
    expect(html).toContain("needs a periodic manual snapshot import");
  });

  it("updates the section footer to reflect two live signals and two manual-import-pending ones", async () => {
    getOwnerFileMock.mockResolvedValue(makeOwnerFile(baseCluster));
    const html = await renderPage();
    expect(html).toContain("Vacant-building violations and tax-sale exposure are live");
    expect(html).toContain("Delinquent-tax exposure and Cook County");
    expect(html).toContain("require a periodic manual import");
  });
});

describe("Distress Signals — vacant-building violations card", () => {
  it("renders 'Data pending' when the join hasn't run (null)", async () => {
    getOwnerFileMock.mockResolvedValue(makeOwnerFile(baseCluster));
    const html = await renderPage();
    expect(html).toContain("Vacant-building violations");
    expect(html).toMatch(/Vacant-building violations[\s\S]*Data pending/);
  });

  it("renders the real count when the join has run", async () => {
    const cluster: OwnerCluster = {
      ...baseCluster,
      distressSignals: { ...baseCluster.distressSignals, vacantBuildingViolationCount: 4 },
    };
    getOwnerFileMock.mockResolvedValue(makeOwnerFile(cluster));
    const html = await renderPage();
    expect(html).toContain("4 recorded");
    expect(html).toContain("u7si-yh3t");
  });
});

describe("Distress Signals — tax-sale exposure card", () => {
  it("shows the flag, latest year, and sold count when exposure is found", async () => {
    const cluster: OwnerCluster = {
      ...baseCluster,
      distressSignals: { ...baseCluster.distressSignals, scavengerOrAnnualSaleFlag: true },
      latestTaxSaleYear: 2013,
      taxSaleSoldCount: 1,
    };
    getOwnerFileMock.mockResolvedValue(makeOwnerFile(cluster));
    const html = await renderPage();
    expect(html).toContain("Sale exposure found");
    expect(html).toContain("2013");
    expect(html).toContain("1 matched entry actually sold at auction");
  });

  it("never renders a silent gap when no PIN matched — shows the explicit 'no exposure' copy", async () => {
    const cluster: OwnerCluster = {
      ...baseCluster,
      distressSignals: { ...baseCluster.distressSignals, scavengerOrAnnualSaleFlag: false },
      latestTaxSaleYear: null,
      taxSaleSoldCount: 0,
    };
    getOwnerFileMock.mockResolvedValue(makeOwnerFile(cluster));
    const html = await renderPage();
    expect(html).toContain("No sale exposure found in the loaded records");
  });

  it("renders 'Data pending' when the join hasn't run (null)", async () => {
    getOwnerFileMock.mockResolvedValue(makeOwnerFile(baseCluster));
    const html = await renderPage();
    expect(html).toMatch(/Scavenger \/ annual tax sale exposure[\s\S]*Data pending/);
  });
});
