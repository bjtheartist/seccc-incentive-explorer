import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getSQLMock,
  sqlMock,
  isConfiguredMock,
  hasSessionMock,
  getOwnerClusterMock,
} = vi.hoisted(() => ({
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
  isConfiguredMock: vi.fn(),
  hasSessionMock: vi.fn(),
  getOwnerClusterMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));
vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "cie_owner_files_admin",
  isOwnerFilesAdminConfigured: isConfiguredMock,
  hasValidOwnerFilesAdminSession: hasSessionMock,
}));
vi.mock("@/lib/owner-file", () => ({ getOwnerCluster: getOwnerClusterMock }));

import { GET, POST } from "./route";

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/parcel-space", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validSubmission() {
  return {
    pin: "20-12-345-678-9012",
    zip: "60617",
    clusterKey: "mail:test-owner",
    availableSpaceSqft: 4_500,
    sourceKey: "owner_confirmation",
    sourceUrl: "https://example.com/verification",
    verifiedAt: new Date().toISOString().slice(0, 10),
    verifierName: "Test Verifier",
    notes: "Confirmed with the owner.",
    confirmedUsableVacantInteriorSpace: true,
  };
}

beforeEach(() => {
  getSQLMock.mockReset().mockReturnValue(sqlMock);
  sqlMock.mockReset();
  isConfiguredMock.mockReset().mockReturnValue(true);
  hasSessionMock.mockReset().mockReturnValue(true);
  getOwnerClusterMock.mockReset().mockResolvedValue({
    clusterKey: "mail:test-owner",
    pins: ["20123456789012"],
  });
});

describe("GET /api/parcel-space", () => {
  it("requires a valid PIN or ZIP", async () => {
    const response = await GET(new NextRequest("http://localhost/api/parcel-space?zip=606"));
    expect(response.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("degrades honestly when the current-view ledger is unavailable", async () => {
    sqlMock.mockRejectedValue(new Error("missing relation"));
    const response = await GET(
      new NextRequest("http://localhost/api/parcel-space?zip=60617"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "unavailable", measurements: [] });
  });

  it("returns only public-safe, current availability fields", async () => {
    sqlMock.mockResolvedValue([
      {
        pin: "20123456789012",
        sqft: "4500",
        source_key: "owner_confirmation",
        verified_at: "2026-08-05T00:00:00.000Z",
        reconfirm_after: "2099-01-01T00:00:00.000Z",
        verifier_name: "Must not leave the admin surface",
        raw_json: { sourceUrl: "private" },
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/parcel-space?pin=20-12-345-678-9012"),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "available",
      measurements: [
        {
          pin: "20123456789012",
          availableSpaceSqft: 4_500,
          source: "Owner confirmation",
          verifiedAt: "2026-08-05T00:00:00.000Z",
          reconfirmAfter: "2099-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/verifier|sourceUrl|raw_json|notes/i);
    expect(String(sqlMock.mock.calls[0][0])).toContain("current_available_space_measurements");
  });

  it("filters future-dated or expired verification rows even if a view drifts", async () => {
    sqlMock.mockResolvedValue([
      {
        pin: "20123456789012",
        sqft: 4_500,
        source_key: "owner_confirmation",
        verified_at: "2099-01-01T00:00:00.000Z",
        reconfirm_after: "2099-04-01T00:00:00.000Z",
      },
      {
        pin: "21111111111111",
        sqft: 2_000,
        source_key: "city_record",
        verified_at: "2025-01-01T00:00:00.000Z",
        reconfirm_after: "2025-04-01T00:00:00.000Z",
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/parcel-space?zip=60617"),
    );
    expect(await response.json()).toEqual({ status: "available", measurements: [] });
  });
});

describe("POST /api/parcel-space", () => {
  it("requires an admin session", async () => {
    hasSessionMock.mockReturnValue(false);
    const response = await POST(postRequest(validSubmission()));
    expect(response.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("requires an explicit largest-contiguous-space attestation", async () => {
    const response = await POST(
      postRequest({
        ...validSubmission(),
        confirmedUsableVacantInteriorSpace: false,
      }),
    );
    expect(response.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("requires the PIN to belong to the selected Owner File and ZIP", async () => {
    getOwnerClusterMock.mockResolvedValue({
      clusterKey: "mail:test-owner",
      pins: ["21111111111111"],
    });
    const response = await POST(postRequest(validSubmission()));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "PIN does not belong to this Owner File and ZIP",
    });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("requires documented evidence and a recent verification date", async () => {
    const noEvidence = await POST(
      postRequest({ ...validSubmission(), sourceUrl: "", notes: "" }),
    );
    expect(noEvidence.status).toBe(400);

    const stale = new Date();
    stale.setUTCDate(stale.getUTCDate() - 91);
    const staleResponse = await POST(
      postRequest({ ...validSubmission(), verifiedAt: stale.toISOString() }),
    );
    expect(staleResponse.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("writes append-history lifecycle data without returning private verification details", async () => {
    const verifiedAt = new Date(`${validSubmission().verifiedAt}T00:00:00.000Z`);
    const reconfirmAfter = new Date(verifiedAt.getTime() + 90 * 24 * 60 * 60 * 1000);
    sqlMock.mockResolvedValue([
      {
        pin: "20123456789012",
        sqft: 4_500,
        source_key: "owner_confirmation",
        verified_at: verifiedAt.toISOString(),
        reconfirm_after: reconfirmAfter.toISOString(),
      },
    ]);

    const response = await POST(postRequest(validSubmission()));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.measurement).toEqual({
      pin: "20123456789012",
      availableSpaceSqft: 4_500,
      source: "Owner confirmation",
      verifiedAt: verifiedAt.toISOString(),
      reconfirmAfter: reconfirmAfter.toISOString(),
    });
    expect(JSON.stringify(body)).not.toMatch(/Test Verifier|Confirmed with the owner|sourceUrl/i);
    const query = String(sqlMock.mock.calls[0][0]);
    expect(query).toContain("UPDATE parcel_space_measurements");
    expect(query).toContain("largest_contiguous_usable_interior_space");
    expect(query).toContain("reconfirm_after");
  });
});
