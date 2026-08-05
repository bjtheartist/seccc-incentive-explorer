import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUserIdMock, getSQLMock, sqlMock } = vi.hoisted(() => ({
  getCurrentUserIdMock: vi.fn(),
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: getCurrentUserIdMock }));
vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));

import { POST } from "./route";

const params = { params: Promise.resolve({ id: "packet-1" }) };

function request(body: unknown) {
  return new NextRequest("http://localhost/api/incentive-preparation/packet-1/support-request", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const validBody = {
  consent: true,
  requestType: "introduction",
  targetOrganization: "South East Chicago Commission",
  requestedHelp: "Review the documents needed for this likely match.",
  scope: ["business_profile", "documents"],
};

beforeEach(() => {
  getCurrentUserIdMock.mockReset();
  getSQLMock.mockReset();
  getSQLMock.mockReturnValue(sqlMock);
  sqlMock.mockReset();
});

describe("POST /api/incentive-preparation/[id]/support-request", () => {
  it("returns 401 or 503 before recording a request", async () => {
    getCurrentUserIdMock.mockResolvedValue(null);
    expect((await POST(request(validBody), params)).status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();

    getCurrentUserIdMock.mockResolvedValue("user-1");
    getSQLMock.mockReturnValue(null);
    expect((await POST(request(validBody), params)).status).toBe(503);
  });

  it("requires explicit consent, help, and allowlisted scopes", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");

    expect((await POST(request({ ...validBody, consent: false }), params)).status).toBe(400);
    expect((await POST(request({ ...validBody, requestedHelp: " " }), params)).status).toBe(400);
    expect((await POST(request({ ...validBody, scope: ["everything"] }), params)).status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("does not create a request for a packet owned by another user", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([]);

    const res = await POST(request(validBody), params);

    expect(res.status).toBe(404);
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(sqlMock.mock.calls[0].slice(1)).toEqual(expect.arrayContaining(["packet-1", "user-1"]));
  });

  it("records a pending request with consent metadata and no outreach side effect", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([{ id: "packet-1" }]).mockResolvedValueOnce([
      {
        id: "support-1",
        packet_id: "packet-1",
        request_type: validBody.requestType,
        target_organization: validBody.targetOrganization,
        requested_help: validBody.requestedHelp,
        consent_scope_json: validBody.scope,
        status: "pending",
        consented_at: "2026-07-10T00:00:00.000Z",
        created_at: "2026-07-10T00:00:00.000Z",
        updated_at: "2026-07-10T00:00:00.000Z",
      },
    ]);

    const res = await POST(request(validBody), params);
    const payload = await res.json();

    expect(res.status).toBe(201);
    expect(payload.supportRequest).toMatchObject({
      requestType: "introduction",
      status: "pending",
      dataScopes: validBody.scope,
    });
    expect(String(sqlMock.mock.calls[1][0])).toContain("incentive_support_requests");
    expect(sqlMock.mock.calls[1].slice(1)).toEqual(expect.arrayContaining(["user-1", "packet-1"]));
  });

  it("records a materials-review request without an external organization", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([{ id: "packet-1" }]).mockResolvedValueOnce([
      {
        id: "support-2",
        packet_id: "packet-1",
        request_type: "materials_review",
        target_organization: null,
        requested_help: "Review my assembled materials for missing information.",
        consent_scope_json: ["packet", "documents"],
        status: "pending",
        consented_at: "2026-08-04T00:00:00.000Z",
        created_at: "2026-08-04T00:00:00.000Z",
        updated_at: "2026-08-04T00:00:00.000Z",
      },
    ]);

    const res = await POST(request({
      consent: true,
      requestType: "materials_review",
      requestedHelp: "Review my assembled materials for missing information.",
      scope: ["packet", "documents"],
    }), params);
    const payload = await res.json();

    expect(res.status).toBe(201);
    expect(payload.supportRequest).toMatchObject({
      requestType: "materials_review",
      targetOrganization: "Chicago Incentive Explorer support",
    });
  });
});
