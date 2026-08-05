import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUserIdMock, getSQLMock, sqlMock } = vi.hoisted(() => ({
  getCurrentUserIdMock: vi.fn(),
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: getCurrentUserIdMock }));
vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));

import { PUT } from "./route";

const params = { params: Promise.resolve({ id: "packet-1" }) };

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/incentive-preparation/packet-1/support-request/draft",
    {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
  );
}

beforeEach(() => {
  getCurrentUserIdMock.mockReset();
  getSQLMock.mockReset();
  getSQLMock.mockReturnValue(sqlMock);
  sqlMock.mockReset();
});

describe("PUT /api/incentive-preparation/[id]/support-request/draft", () => {
  it("requires authentication and an owned packet", async () => {
    getCurrentUserIdMock.mockResolvedValue(null);
    expect((await PUT(request({}), params)).status).toBe(401);

    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([]);
    expect((await PUT(request({
      requestType: "materials_review",
      requestedHelp: "Review my packet.",
    }), params)).status).toBe(404);
  });

  it("requires an organization only for an introduction", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");

    expect((await PUT(request({
      requestType: "introduction",
      requestedHelp: "Help me connect.",
    }), params)).status).toBe(400);
    expect((await PUT(request({
      requestType: "materials_review",
      requestedHelp: "Review my packet.",
      suggestedScopes: ["everything"],
    }), params)).status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("upserts an editable materials-review draft without consent", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([{ id: "packet-1" }]).mockResolvedValueOnce([
      {
        id: "draft-1",
        packet_id: "packet-1",
        request_type: "materials_review",
        target_organization: null,
        requested_help: "Review my packet.",
        suggested_scope_json: ["packet", "documents"],
        updated_at: "2026-08-04T00:00:00.000Z",
      },
    ]);

    const res = await PUT(request({
      requestType: "materials_review",
      requestedHelp: "Review my packet.",
      suggestedScopes: ["packet", "documents"],
    }), params);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.draft).toMatchObject({
      requestType: "materials_review",
      targetOrganization: "",
      suggestedScopes: ["packet", "documents"],
    });
    expect(payload.note).toContain("Nothing was shared or scheduled");
    expect(String(sqlMock.mock.calls[1][0])).toContain("incentive_support_request_drafts");
  });
});
