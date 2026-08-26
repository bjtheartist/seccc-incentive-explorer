import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FIXTURE_PERMIT_EXHIBIT_MIXED } from "@/lib/permit-exhibit-fixtures";

const {
  hasAccessMock,
  loadPermitExhibitMock,
  reserveMock,
  createSnapshotMock,
  clientIdentifierMock,
} = vi.hoisted(() => ({
  hasAccessMock: vi.fn(),
  loadPermitExhibitMock: vi.fn(),
  reserveMock: vi.fn(),
  createSnapshotMock: vi.fn(),
  clientIdentifierMock: vi.fn(() => "test-client"),
}));

vi.mock("@/lib/shortlist-access", () => ({
  SHORTLIST_ACCESS_COOKIE: "cie_shortlist_access",
  hasValidShortlistAccessSession: hasAccessMock,
}));
vi.mock("@/lib/permit-exhibit-source", () => ({ loadPermitExhibit: loadPermitExhibitMock }));
vi.mock("@/lib/permit-exhibit-snapshot", () => {
  class StorageUnavailable extends Error {}
  return {
    PermitExhibitSnapshotStorageUnavailableError: StorageUnavailable,
    reservePermitExhibitSnapshotCreate: reserveMock,
    createPermitExhibitSnapshot: createSnapshotMock,
    permitExhibitSnapshotClientIdentifier: clientIdentifierMock,
  };
});

import { POST } from "./route";
import { PermitExhibitSnapshotStorageUnavailableError } from "@/lib/permit-exhibit-snapshot";

const REQUEST_ID = "35d9a3a4-d98a-4f49-9f95-f86b5a41bfb0";
const VALID_BODY = { pin: "17091190280000", radiusFt: 500, requestId: REQUEST_ID };

function request(body: unknown, cookie = "signed-session") {
  return new NextRequest("http://localhost/api/permit-exhibit-snapshots", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `cie_shortlist_access=${cookie}`,
      "x-forwarded-for": "192.0.2.1",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hasAccessMock.mockReturnValue(true);
  reserveMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  loadPermitExhibitMock.mockResolvedValue({ ok: true, data: FIXTURE_PERMIT_EXHIBIT_MIXED });
  createSnapshotMock.mockResolvedValue({
    publicId: "ps_abcdefghijklmnopqrstuvwx",
    displayId: "PX-17091190280000-20260826-ABCD",
  });
});

describe("POST /api/permit-exhibit-snapshots", () => {
  it("fails closed before parsing, rate limiting, or data work without valid access", async () => {
    hasAccessMock.mockReturnValue(false);

    const response = await POST(request(VALID_BODY, "tampered"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(reserveMock).not.toHaveBeenCalled();
    expect(loadPermitExhibitMock).not.toHaveBeenCalled();
    expect(createSnapshotMock).not.toHaveBeenCalled();
  });

  it("rejects malformed and extra client-owned fields before downstream work", async () => {
    const response = await POST(
      request({
        ...VALID_BODY,
        snapshot_json: { subject: [{ permitNumber: "forged" }] },
        content_hash: "forged",
        saved_at: "1900-01-01T00:00:00.000Z",
        public_id: "ps_attackercontrolled0000000",
      }),
    );

    expect(response.status).toBe(400);
    expect(reserveMock).not.toHaveBeenCalled();
    expect(loadPermitExhibitMock).not.toHaveBeenCalled();
    expect(createSnapshotMock).not.toHaveBeenCalled();
  });

  it("rate-limits before rebuilding or persisting evidence", async () => {
    reserveMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 3600 });

    const response = await POST(request(VALID_BODY));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
    expect(loadPermitExhibitMock).not.toHaveBeenCalled();
    expect(createSnapshotMock).not.toHaveBeenCalled();
  });

  it("builds on the server, persists only that result, and returns the opaque saved URL", async () => {
    const response = await POST(request(VALID_BODY));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      publicId: "ps_abcdefghijklmnopqrstuvwx",
      displayId: "PX-17091190280000-20260826-ABCD",
      url: "/permit-exhibit/snapshots/ps_abcdefghijklmnopqrstuvwx",
    });
    expect(loadPermitExhibitMock).toHaveBeenCalledWith({ pin: "17091190280000", radiusFt: 500 });
    expect(createSnapshotMock).toHaveBeenCalledWith({
      exhibit: FIXTURE_PERMIT_EXHIBIT_MIXED,
      requestId: REQUEST_ID,
    });
    expect(Object.keys(createSnapshotMock.mock.calls[0][0]).sort()).toEqual(["exhibit", "requestId"]);
  });

  it("keeps the current exhibit in place when the live build fails", async () => {
    loadPermitExhibitMock.mockResolvedValue({ ok: false, error: { kind: "database_unavailable" } });

    const response = await POST(request(VALID_BODY));

    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/temporarily unavailable/i);
    expect(createSnapshotMock).not.toHaveBeenCalled();
  });

  it("returns an explicit recoverable state when snapshot storage is unavailable", async () => {
    createSnapshotMock.mockRejectedValue(new PermitExhibitSnapshotStorageUnavailableError());

    const response = await POST(request(VALID_BODY));

    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/snapshot storage is temporarily unavailable/i);
  });
});
