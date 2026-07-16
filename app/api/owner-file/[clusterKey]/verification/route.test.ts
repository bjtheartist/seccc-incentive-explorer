import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { OwnerCluster } from "@/lib/corridor-owners";

const {
  isConfiguredMock,
  hasSessionMock,
  getSQLMock,
  getOwnerClusterMock,
  addOwnerFileNoteMock,
  listOwnerFileNotesMock,
  upsertOwnerFileVerificationMock,
} = vi.hoisted(() => ({
  isConfiguredMock: vi.fn(),
  hasSessionMock: vi.fn(),
  getSQLMock: vi.fn(),
  getOwnerClusterMock: vi.fn(),
  addOwnerFileNoteMock: vi.fn(),
  listOwnerFileNotesMock: vi.fn(),
  upsertOwnerFileVerificationMock: vi.fn(),
}));

vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "cie_owner_files_admin",
  isOwnerFilesAdminConfigured: isConfiguredMock,
  hasValidOwnerFilesAdminSession: hasSessionMock,
}));

vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));

vi.mock("@/lib/corridor-owners", () => ({
  loadStaticOwnerClustersGeneratedAt: () => "2026-07-10T00:00:00.000Z",
}));

vi.mock("@/lib/owner-file", async () => {
  const actual = await vi.importActual<typeof import("@/lib/owner-file")>("@/lib/owner-file");
  return {
    ...actual,
    getOwnerCluster: getOwnerClusterMock,
    addOwnerFileNote: addOwnerFileNoteMock,
    listOwnerFileNotes: listOwnerFileNotesMock,
    upsertOwnerFileVerification: upsertOwnerFileVerificationMock,
  };
});

import { POST } from "./route";

const cluster: OwnerCluster = {
  clusterKey: "mail:foo",
  pins: ["17111000010000"],
  ownerName: "TEST OWNER",
  ownerMailingAddress: "1 MAIN ST",
  ownerType: "corporate_llc",
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

function req(body: unknown) {
  return new NextRequest("http://localhost/api/owner-file/mail:foo/verification", {
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
  getOwnerClusterMock.mockReset().mockResolvedValue(cluster);
  addOwnerFileNoteMock.mockReset();
  listOwnerFileNotesMock.mockReset().mockResolvedValue([]);
  upsertOwnerFileVerificationMock.mockReset().mockImplementation(async (_sql, input) => ({
    id: "v1",
    ...input,
    checklist: input.checklist ?? [],
    status: input.status ?? "draft",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  }));
});

describe("POST /api/owner-file/[clusterKey]/verification", () => {
  it("returns 401 without a valid session", async () => {
    hasSessionMock.mockReturnValue(false);
    const res = await POST(req({ zip: "60617", verifierName: "Jane" }), params());
    expect(res.status).toBe(401);
  });

  it("requires a 5-digit zip", async () => {
    const res = await POST(req({ zip: "606", verifierName: "Jane" }), params());
    expect(res.status).toBe(400);
  });

  it("requires verifierName", async () => {
    const res = await POST(req({ zip: "60617", verifierName: "  " }), params());
    expect(res.status).toBe(400);
  });

  it("rejects an invalid status", async () => {
    const res = await POST(req({ zip: "60617", verifierName: "Jane", status: "not-a-status" }), params());
    expect(res.status).toBe(400);
  });

  it("returns 404 when the cluster can't be resolved", async () => {
    getOwnerClusterMock.mockResolvedValue(null);
    const res = await POST(req({ zip: "60617", verifierName: "Jane" }), params());
    expect(res.status).toBe(404);
  });

  it("never trusts a client-submitted confidenceTier — always server-computes via resolveConfidenceTier", async () => {
    const res = await POST(
      req({ zip: "60617", verifierName: "Jane", status: "verified", confidenceTier: "A" }),
      params()
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // No il_sos_lookup_url and no entity_lookup note -> falls to the
    // algorithmic tier (High confidence -> B), never the client-asserted A.
    expect(data.resolvedTier).toBe("B");
    expect(upsertOwnerFileVerificationMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ confidenceTier: "B" })
    );
  });

  it("grants Tier A when verified with an il_sos_lookup_url on the request", async () => {
    const res = await POST(
      req({
        zip: "60617",
        verifierName: "Jane",
        status: "verified",
        ilSosLookupUrl: "https://apps.ilsos.gov/businessentitysearch/",
      }),
      params()
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.resolvedTier).toBe("A");
  });

  it("creates an entity_lookup note alongside the verification when note is provided", async () => {
    const createdNote = {
      id: "n1",
      clusterKey: "mail:foo",
      zip: "60617",
      authorName: "Jane",
      noteType: "entity_lookup",
      body: "Confirmed active/good standing.",
      sourceUrl: "https://apps.ilsos.gov/businessentitysearch/",
      createdAt: "2026-07-15T00:00:00.000Z",
    };
    addOwnerFileNoteMock.mockResolvedValue(createdNote);
    // listOwnerFileNotes runs AFTER the note insert in the route handler, so
    // it should reflect the just-created note (a real DB would).
    listOwnerFileNotesMock.mockResolvedValue([createdNote]);
    const res = await POST(
      req({
        zip: "60617",
        verifierName: "Jane",
        status: "verified",
        note: {
          noteType: "entity_lookup",
          body: "Confirmed active/good standing.",
          sourceUrl: "https://apps.ilsos.gov/businessentitysearch/",
        },
      }),
      params()
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(addOwnerFileNoteMock).toHaveBeenCalled();
    expect(data.note.id).toBe("n1");
    expect(data.resolvedTier).toBe("A");
  });

  it("rejects a note with an invalid noteType", async () => {
    const res = await POST(
      req({ zip: "60617", verifierName: "Jane", note: { noteType: "bogus", body: "x" } }),
      params()
    );
    expect(res.status).toBe(400);
    expect(addOwnerFileNoteMock).not.toHaveBeenCalled();
  });

  it("rejects verifierName over 200 characters", async () => {
    const res = await POST(
      req({ zip: "60617", verifierName: "x".repeat(201) }),
      params()
    );
    expect(res.status).toBe(400);
  });

  it("rejects note.body over 5000 characters", async () => {
    const res = await POST(
      req({
        zip: "60617",
        verifierName: "Jane",
        note: { noteType: "general", body: "x".repeat(5001) },
      }),
      params()
    );
    expect(res.status).toBe(400);
    expect(addOwnerFileNoteMock).not.toHaveBeenCalled();
  });

  it("rejects note.sourceUrl over 500 characters", async () => {
    const res = await POST(
      req({
        zip: "60617",
        verifierName: "Jane",
        note: {
          noteType: "general",
          body: "short body",
          sourceUrl: "https://example.com/" + "x".repeat(500),
        },
      }),
      params()
    );
    expect(res.status).toBe(400);
    expect(addOwnerFileNoteMock).not.toHaveBeenCalled();
  });

  it("rejects IL-SOS free-text fields over 500 characters", async () => {
    const long = "x".repeat(501);
    for (const field of ["registeredAgentName", "registeredAgentAddress", "ilSosFileNumber", "ilSosLookupUrl"]) {
      const res = await POST(
        req({ zip: "60617", verifierName: "Jane", [field]: long }),
        params()
      );
      expect(res.status).toBe(400);
    }
    expect(upsertOwnerFileVerificationMock).not.toHaveBeenCalled();
  });
});
