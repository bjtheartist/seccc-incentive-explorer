import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUserIdMock, sqlMock } = vi.hoisted(() => ({
  getCurrentUserIdMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: getCurrentUserIdMock }));
vi.mock("@/lib/db", () => ({ getSQL: () => sqlMock }));

import { GET, PATCH } from "./route";

const params = { params: Promise.resolve({ id: "profile-1" }) };

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/business-profiles/profile-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const profileRow = {
  id: "profile-1",
  legal_name: "South Shore Supply",
  physical_address: "9000 S Commercial Ave",
  contact_name: "Jordan Lee",
  contact_email: "jordan@example.com",
  licenses_json: [],
  field_provenance_json: {},
  created_at: "2026-07-10T00:00:00.000Z",
  updated_at: "2026-07-10T00:00:00.000Z",
};

beforeEach(() => {
  getCurrentUserIdMock.mockReset();
  sqlMock.mockReset();
});

describe("/api/business-profiles/[id]", () => {
  it("does not expose another user's profile", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([]);

    expect((await GET(new NextRequest("http://localhost"), params)).status).toBe(404);
    expect(sqlMock.mock.calls[0].slice(1)).toEqual(expect.arrayContaining(["profile-1", "user-1"]));
  });

  it("updates an owned profile only after loading it through the owner scope", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([profileRow]).mockResolvedValueOnce([
      { ...profileRow, dba_name: "South Shore Supply Co." },
    ]);

    const res = await PATCH(patchRequest({ dbaName: "South Shore Supply Co." }), params);

    expect(res.status).toBe(200);
    expect((await res.json()).profile.dbaName).toBe("South Shore Supply Co.");
    for (const call of sqlMock.mock.calls) {
      expect(call.slice(1)).toEqual(expect.arrayContaining(["profile-1", "user-1"]));
    }
  });
});
