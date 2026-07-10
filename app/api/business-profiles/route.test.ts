import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUserIdMock, getSQLMock, sqlMock } = vi.hoisted(() => ({
  getCurrentUserIdMock: vi.fn(),
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: getCurrentUserIdMock }));
vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));

import { GET, POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/business-profiles", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  getCurrentUserIdMock.mockReset();
  getSQLMock.mockReset();
  getSQLMock.mockReturnValue(sqlMock);
  sqlMock.mockReset();
});

describe("/api/business-profiles", () => {
  it("returns 401 when unauthenticated", async () => {
    getCurrentUserIdMock.mockResolvedValue(null);

    expect((await GET()).status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the database is unavailable", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    getSQLMock.mockReturnValue(null);

    expect((await GET()).status).toBe(503);
  });

  it("requires the core profile facts and a valid email on create", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");

    const missing = await POST(request({ legalName: "South Shore Supply" }));
    expect(missing.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();

    const invalidEmail = await POST(
      request({
        legalName: "South Shore Supply",
        physicalAddress: "9000 S Commercial Ave",
        contactName: "Jordan Lee",
        contactEmail: "not-an-email",
      })
    );
    expect(invalidEmail.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("creates an owned profile", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([
      {
        id: "profile-1",
        legal_name: "South Shore Supply",
        physical_address: "9000 S Commercial Ave",
        contact_name: "Jordan Lee",
        contact_email: "jordan@example.com",
        licenses_json: [],
        field_provenance_json: {},
        created_at: "2026-07-10T00:00:00.000Z",
        updated_at: "2026-07-10T00:00:00.000Z",
      },
    ]);

    const res = await POST(
      request({
        legalName: "South Shore Supply",
        physicalAddress: "9000 S Commercial Ave",
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
      })
    );

    expect(res.status).toBe(201);
    expect((await res.json()).profile).toMatchObject({ id: "profile-1", legalName: "South Shore Supply" });
    expect(sqlMock.mock.calls[0].slice(1)).toContain("user-1");
  });
});
