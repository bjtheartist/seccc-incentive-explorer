import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OwnerCluster } from "@/lib/corridor-owners";
import { EMPTY_DISTRESS_SIGNALS } from "@/lib/corridor-owners";

/**
 * Session-gate coverage for the Owner Files landing page
 * (app/admin/owner-files/page.tsx) and the per-ZIP page
 * (app/admin/owner-files/[zip]/page.tsx) — both async Server Components
 * gated by the same isOwnerFilesAdminConfigured/hasValidOwnerFilesAdminSession
 * pair every other Owner Files route uses. Neither page needs a live map,
 * DB, or Next request context to render: called directly as plain async
 * functions with next/headers's cookies() mocked, the result is a React
 * element renderToStaticMarkup can inspect like any other component test in
 * this repo (see components/report/__tests__/admin-ownership-gating.test.tsx).
 */

const { isConfiguredMock, hasSessionMock, cookiesMock, listOwnerClustersMock, generatedAtMock } = vi.hoisted(
  () => ({
    isConfiguredMock: vi.fn(),
    hasSessionMock: vi.fn(),
    cookiesMock: vi.fn(),
    listOwnerClustersMock: vi.fn(),
    generatedAtMock: vi.fn(),
  })
);

vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "cie_owner_files_admin",
  isOwnerFilesAdminConfigured: isConfiguredMock,
  hasValidOwnerFilesAdminSession: hasSessionMock,
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("@/lib/owner-file", () => ({
  listOwnerClusters: listOwnerClustersMock,
}));

vi.mock("@/lib/corridor-owners", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/corridor-owners")>();
  return {
    ...actual,
    loadStaticOwnerClustersGeneratedAt: generatedAtMock,
  };
});

import OwnerFilesLandingPage from "../page";
import OwnerFilesIndexPage from "../[zip]/page";

function makeCluster(overrides: Partial<OwnerCluster>): OwnerCluster {
  return {
    clusterKey: "mail:fake",
    pins: [],
    ownerName: "FAKE OWNER LLC",
    ownerMailingAddress: "1 FAKE ST, CHICAGO IL 60617",
    ownerType: "corporate_llc",
    parcelCount: 5,
    vacantParcelCount: 2,
    businessCount: 0,
    businessNames: [],
    sampleAddresses: ["1 FAKE ST"],
    latestTransferDate: null,
    latestBuyerName: null,
    latestSellerName: null,
    confidence: "High",
    evidence: "",
    distressSignals: { ...EMPTY_DISTRESS_SIGNALS },
    ...overrides,
  };
}

function cookieStore(cookieValue?: string) {
  return {
    get: (name: string) =>
      name === "cie_owner_files_admin" && cookieValue ? { name, value: cookieValue } : undefined,
  };
}

beforeEach(() => {
  isConfiguredMock.mockReset().mockReturnValue(true);
  hasSessionMock.mockReset().mockReturnValue(true);
  cookiesMock.mockReset().mockResolvedValue(cookieStore("valid-session"));
  listOwnerClustersMock.mockReset().mockResolvedValue([makeCluster({})]);
  generatedAtMock.mockReset().mockReturnValue("2026-07-01T00:00:00.000Z");
});

describe("OwnerFilesLandingPage gating", () => {
  it("shows the not-configured message when the admin gate has no password set, without touching cookies or cluster data", async () => {
    isConfiguredMock.mockReturnValue(false);
    const html = renderToStaticMarkup(
      await OwnerFilesLandingPage({ searchParams: Promise.resolve({}) })
    );
    expect(html).toContain("Owner Files not configured");
    expect(cookiesMock).not.toHaveBeenCalled();
    expect(listOwnerClustersMock).not.toHaveBeenCalled();
  });

  it("shows the password form when there is no valid session, without ever fetching cluster data", async () => {
    hasSessionMock.mockReturnValue(false);
    const html = renderToStaticMarkup(
      await OwnerFilesLandingPage({ searchParams: Promise.resolve({}) })
    );
    expect(html).toContain("Enter admin password");
    expect(html).toContain('value="/admin/owner-files"');
    expect(listOwnerClustersMock).not.toHaveBeenCalled();
  });

  it("shows the auth-error message when redirected back with error=1", async () => {
    hasSessionMock.mockReturnValue(false);
    const html = renderToStaticMarkup(
      await OwnerFilesLandingPage({ searchParams: Promise.resolve({ error: "1" }) })
    );
    expect(html).toContain("That password did not match");
  });

  it("renders all 9 neighborhood cards with cluster/vacant summaries for a valid session", async () => {
    listOwnerClustersMock.mockImplementation(async (zip: string) => {
      if (zip === "60617") return [makeCluster({ vacantParcelCount: 3 }), makeCluster({ vacantParcelCount: 4 })];
      return [];
    });
    const html = renderToStaticMarkup(
      await OwnerFilesLandingPage({ searchParams: Promise.resolve({}) })
    );
    expect(html).toContain("Owner Files");
    // All 9 pilot neighborhoods present.
    for (const name of [
      "South Chicago",
      "Chatham",
      "South Shore",
      "West Garfield Park",
      "North Lawndale",
      "Austin",
      "Humboldt Park",
      "Englewood",
      "West Englewood",
    ]) {
      expect(html).toContain(name);
    }
    // 60617's summary reflects the mocked 2 clusters / 7 total vacant parcels.
    expect(html).toContain("2 clusters");
    expect(html).toContain("7 vacant parcels");
    expect(html).toContain(`href="/admin/owner-files/60617"`);
  });
});

describe("OwnerFilesIndexPage ([zip]) gating", () => {
  it("shows the not-configured message for an invalid gate", async () => {
    isConfiguredMock.mockReturnValue(false);
    const html = renderToStaticMarkup(
      await OwnerFilesIndexPage({
        params: Promise.resolve({ zip: "60617" }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(html).toContain("Owner Files not configured");
  });

  it("shows the password form when there is no valid session, with the correct per-ZIP redirect", async () => {
    hasSessionMock.mockReturnValue(false);
    const html = renderToStaticMarkup(
      await OwnerFilesIndexPage({
        params: Promise.resolve({ zip: "60624" }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(html).toContain("Enter admin password");
    expect(html).toContain('value="/admin/owner-files/60624"');
  });

  it("renders the neighborhood name in the header/breadcrumb and the switcher for a valid session", async () => {
    const html = renderToStaticMarkup(
      await OwnerFilesIndexPage({
        params: Promise.resolve({ zip: "60624" }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(html).toContain("West Garfield Park — 60624");
    // Breadcrumb: Admin / Owner Files / {Neighborhood}
    expect(html).toContain(`href="/admin/owner-files"`);
    // Neighborhood switcher links to all 9 pilot ZIPs.
    expect(html).toContain(`href="/admin/owner-files/60617"`);
    expect(html).toContain(`href="/admin/owner-files/60636"`);
  });
});
