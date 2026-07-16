import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { OwnerFile } from "@/lib/owner-file";

const { isConfiguredMock, hasSessionMock, getOwnerFileMock } = vi.hoisted(() => ({
  isConfiguredMock: vi.fn(),
  hasSessionMock: vi.fn(),
  getOwnerFileMock: vi.fn(),
}));

vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "cie_owner_files_admin",
  isOwnerFilesAdminConfigured: isConfiguredMock,
  hasValidOwnerFilesAdminSession: hasSessionMock,
}));

vi.mock("@/lib/owner-file", () => ({
  getOwnerFile: getOwnerFileMock,
}));

import { GET } from "./route";

function req(url: string, cookie?: string) {
  const headers = cookie ? { cookie } : undefined;
  return new NextRequest(url, { headers });
}

const fakeOwnerFile: OwnerFile = {
  cluster: {
    clusterKey: "mail:foo",
    pins: [],
    ownerName: "TEST OWNER",
    ownerMailingAddress: null,
    ownerType: null,
    parcelCount: 1,
    vacantParcelCount: 1,
    businessCount: 0,
    businessNames: [],
    sampleAddresses: [],
    latestTransferDate: null,
    latestBuyerName: null,
    latestSellerName: null,
    confidence: "High",
    evidence: "",
    distressSignals: {
      buildingViolationCount: null,
      vacantBuildingViolationCount: null,
      delinquentTaxCount: null,
      scavengerOrAnnualSaleFlag: null,
      cclbaInventoryFlag: null,
    },
  },
  verification: null,
  notes: [],
  outreachEvents: [],
  resolvedTier: "B",
};

beforeEach(() => {
  isConfiguredMock.mockReset().mockReturnValue(true);
  hasSessionMock.mockReset().mockReturnValue(true);
  getOwnerFileMock.mockReset();
});

describe("GET /api/owner-file/[clusterKey]", () => {
  it("returns 503 when the gate is not configured", async () => {
    isConfiguredMock.mockReturnValue(false);
    const res = await GET(req("http://localhost/api/owner-file/mail:foo?zip=60617"), {
      params: Promise.resolve({ clusterKey: "mail:foo" }),
    });
    expect(res.status).toBe(503);
  });

  it("returns 401 without a valid session", async () => {
    hasSessionMock.mockReturnValue(false);
    const res = await GET(req("http://localhost/api/owner-file/mail:foo?zip=60617"), {
      params: Promise.resolve({ clusterKey: "mail:foo" }),
    });
    expect(res.status).toBe(401);
    expect(getOwnerFileMock).not.toHaveBeenCalled();
  });

  it("rejects a missing/invalid zip with 400", async () => {
    const res = await GET(req("http://localhost/api/owner-file/mail:foo"), {
      params: Promise.resolve({ clusterKey: "mail:foo" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when no owner file resolves", async () => {
    getOwnerFileMock.mockResolvedValue(null);
    const res = await GET(req("http://localhost/api/owner-file/mail:foo?zip=60617"), {
      params: Promise.resolve({ clusterKey: "mail:foo" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns the merged owner file with a no-store cache header", async () => {
    getOwnerFileMock.mockResolvedValue(fakeOwnerFile);
    const res = await GET(req("http://localhost/api/owner-file/mail:foo?zip=60617"), {
      params: Promise.resolve({ clusterKey: "mail:foo" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ownerFile: fakeOwnerFile });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getOwnerFileMock).toHaveBeenCalledWith("60617", "mail:foo");
  });

  it("decodes a percent-encoded clusterKey route param before resolving (App Router params arrive percent-encoded)", async () => {
    getOwnerFileMock.mockResolvedValue(fakeOwnerFile);
    const res = await GET(req("http://localhost/api/owner-file/mail%3Afoo?zip=60617"), {
      params: Promise.resolve({ clusterKey: "mail%3Afoo" }),
    });
    expect(res.status).toBe(200);
    expect(getOwnerFileMock).toHaveBeenCalledWith("60617", "mail:foo");
  });
});
