import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { OwnerClusterGeoFeatureCollection } from "@/lib/owner-cluster-geo";

const { isConfiguredMock, hasSessionMock, loadMock, filterMock } = vi.hoisted(() => ({
  isConfiguredMock: vi.fn(),
  hasSessionMock: vi.fn(),
  loadMock: vi.fn(),
  filterMock: vi.fn(),
}));

vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "cie_owner_files_admin",
  isOwnerFilesAdminConfigured: isConfiguredMock,
  hasValidOwnerFilesAdminSession: hasSessionMock,
}));

vi.mock("@/lib/owner-cluster-geo", () => ({
  loadOwnerClusterGeoFile: loadMock,
  filterOwnerClusterGeoByZips: filterMock,
}));

import { GET } from "./route";

function req(url: string, cookie?: string) {
  const headers = cookie ? { cookie } : undefined;
  return new NextRequest(url, { headers });
}

const fakeFc: OwnerClusterGeoFeatureCollection = {
  type: "FeatureCollection",
  generatedAt: "2026-01-01T00:00:00.000Z",
  meta: { skippedNullLatLng: 0, zips: ["60617"] },
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-87.5605, 41.7137] },
      properties: {
        pin: "FAKE-1",
        address: "100 E 100TH ST",
        vacant: true,
        zip: "60617",
        clusterKey: "mail:foo",
        ownerName: "TEST OWNER",
        ownerType: "corporate_llc",
        clusterParcelCount: 3,
        clusterVacantCount: 2,
        confidence: "High",
      },
    },
  ],
};

beforeEach(() => {
  isConfiguredMock.mockReset().mockReturnValue(true);
  hasSessionMock.mockReset().mockReturnValue(true);
  loadMock.mockReset().mockReturnValue(fakeFc);
  filterMock.mockReset().mockImplementation((fc) => fc);
});

describe("GET /api/owner-file/geo", () => {
  it("returns 503 when the gate is not configured", async () => {
    isConfiguredMock.mockReturnValue(false);
    const res = await GET(req("http://localhost/api/owner-file/geo"));
    expect(res.status).toBe(503);
  });

  it("returns 401 without a valid session", async () => {
    hasSessionMock.mockReturnValue(false);
    const res = await GET(req("http://localhost/api/owner-file/geo"));
    expect(res.status).toBe(401);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the geo export has not been generated yet", async () => {
    loadMock.mockReturnValue(null);
    const res = await GET(req("http://localhost/api/owner-file/geo"));
    expect(res.status).toBe(503);
  });

  it("returns the full collection with a private no-store cache header when no zips filter is given", async () => {
    const res = await GET(req("http://localhost/api/owner-file/geo"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeFc);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(filterMock).toHaveBeenCalledWith(fakeFc, null);
  });

  it("parses and forwards a valid zips filter, dropping invalid entries", async () => {
    await GET(req("http://localhost/api/owner-file/geo?zips=60617,abcde,60624"));
    expect(filterMock).toHaveBeenCalledWith(fakeFc, ["60617", "60624"]);
  });

  it("treats an all-invalid zips param as an empty filter list", async () => {
    await GET(req("http://localhost/api/owner-file/geo?zips=abcde"));
    expect(filterMock).toHaveBeenCalledWith(fakeFc, []);
  });
});
