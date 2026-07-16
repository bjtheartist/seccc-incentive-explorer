import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { OwnerCluster } from "@/lib/corridor-owners";
import type { ParcelProgramContext } from "@/lib/owner-file-letter-context";

const {
  isConfiguredMock,
  hasSessionMock,
  getSQLMock,
  addOutreachEventMock,
  getOwnerClusterMock,
  getOwnerFileVerificationMock,
  listOutreachEventsMock,
  resolveParcelProgramContextMock,
} = vi.hoisted(() => ({
  isConfiguredMock: vi.fn(),
  hasSessionMock: vi.fn(),
  getSQLMock: vi.fn(),
  addOutreachEventMock: vi.fn(),
  getOwnerClusterMock: vi.fn(),
  getOwnerFileVerificationMock: vi.fn(),
  listOutreachEventsMock: vi.fn(),
  resolveParcelProgramContextMock: vi.fn(),
}));

vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "cie_owner_files_admin",
  isOwnerFilesAdminConfigured: isConfiguredMock,
  hasValidOwnerFilesAdminSession: hasSessionMock,
}));

vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));

vi.mock("@/lib/owner-file", async () => {
  const actual = await vi.importActual<typeof import("@/lib/owner-file")>("@/lib/owner-file");
  return {
    ...actual,
    addOutreachEvent: addOutreachEventMock,
    getOwnerCluster: getOwnerClusterMock,
    getOwnerFileVerification: getOwnerFileVerificationMock,
    listOutreachEvents: listOutreachEventsMock,
  };
});

vi.mock("@/lib/owner-file-letter-context", () => ({
  resolveParcelProgramContext: resolveParcelProgramContextMock,
}));

import { GET, POST } from "./route";

const cluster: OwnerCluster = {
  clusterKey: "mail:foo",
  pins: [],
  ownerName: "TEST OWNER",
  ownerMailingAddress: "1 MAIN ST",
  ownerType: null,
  parcelCount: 1,
  vacantParcelCount: 1,
  businessCount: 0,
  businessNames: [],
  sampleAddresses: ["1 MAIN ST"],
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
};

function getReq(url: string) {
  return new NextRequest(url);
}

function postReq(body: unknown) {
  return new NextRequest("http://localhost/api/owner-file/mail:foo/outreach", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function params() {
  return { params: Promise.resolve({ clusterKey: "mail:foo" }) };
}

beforeEach(() => {
  isConfiguredMock.mockReset().mockReturnValue(true);
  hasSessionMock.mockReset().mockReturnValue(true);
  getSQLMock.mockReset().mockReturnValue({});
  addOutreachEventMock.mockReset();
  getOwnerClusterMock.mockReset().mockResolvedValue(cluster);
  getOwnerFileVerificationMock.mockReset().mockResolvedValue(null);
  listOutreachEventsMock.mockReset().mockResolvedValue([]);
  resolveParcelProgramContextMock.mockReset().mockResolvedValue([]);
});

describe("GET /api/owner-file/[clusterKey]/outreach", () => {
  it("returns 401 without a valid session", async () => {
    hasSessionMock.mockReturnValue(false);
    const res = await GET(getReq("http://localhost/api/owner-file/mail:foo/outreach"), params());
    expect(res.status).toBe(401);
  });

  it("lists outreach events for the cluster", async () => {
    listOutreachEventsMock.mockResolvedValue([{ id: "e1" }]);
    const res = await GET(getReq("http://localhost/api/owner-file/mail:foo/outreach"), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [{ id: "e1" }] });
  });
});

describe("POST /api/owner-file/[clusterKey]/outreach", () => {
  it("rejects an invalid eventType", async () => {
    const res = await POST(postReq({ zip: "60617", eventType: "bogus" }), params());
    expect(res.status).toBe(400);
  });

  it("rejects an invalid outcome", async () => {
    const res = await POST(
      postReq({ zip: "60617", eventType: "outcome_logged", outcome: "bogus" }),
      params()
    );
    expect(res.status).toBe(400);
  });

  it("blocks letter_generated when the cluster has no verified verification", async () => {
    getOwnerFileVerificationMock.mockResolvedValue({ status: "draft" });
    const res = await POST(postReq({ zip: "60617", eventType: "letter_generated" }), params());
    expect(res.status).toBe(400);
    expect(addOutreachEventMock).not.toHaveBeenCalled();
  });

  it("blocks letter_downloaded when the cluster has no verified verification", async () => {
    const res = await POST(postReq({ zip: "60617", eventType: "letter_downloaded" }), params());
    expect(res.status).toBe(400);
  });

  it("allows outcome_logged and letter_mailed regardless of verification status", async () => {
    addOutreachEventMock.mockResolvedValue({ id: "e1", eventType: "outcome_logged" });
    const res = await POST(
      postReq({ zip: "60617", eventType: "outcome_logged", outcome: "responded", actorName: "Jane" }),
      params()
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.event.id).toBe("e1");
    expect(data.parcelProgramContext).toBeUndefined();
  });

  it("resolves and returns per-parcel program context on letter_generated for a verified cluster", async () => {
    getOwnerFileVerificationMock.mockResolvedValue({ id: "v1", status: "verified" });
    addOutreachEventMock.mockResolvedValue({ id: "e1", eventType: "letter_generated" });
    const context: ParcelProgramContext[] = [
      { address: "1 MAIN ST", lat: 41.7, lon: -87.6, programs: [], resolutionNote: null },
    ];
    resolveParcelProgramContextMock.mockResolvedValue(context);

    const res = await POST(
      postReq({ zip: "60617", eventType: "letter_generated", actorName: "Jane" }),
      params()
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.event.id).toBe("e1");
    expect(data.parcelProgramContext).toEqual(context);
    expect(resolveParcelProgramContextMock).toHaveBeenCalledWith(["1 MAIN ST"]);
    expect(addOutreachEventMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ verificationId: "v1", eventType: "letter_generated" })
    );
  });
});
