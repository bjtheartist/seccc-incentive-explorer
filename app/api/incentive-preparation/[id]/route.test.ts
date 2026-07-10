import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUserIdMock, sqlMock } = vi.hoisted(() => ({
  getCurrentUserIdMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: getCurrentUserIdMock }));
vi.mock("@/lib/db", () => ({ getSQL: () => sqlMock }));

import { PATCH } from "./route";

const params = { params: Promise.resolve({ id: "packet-1" }) };

function request(body: unknown) {
  return new NextRequest("http://localhost/api/incentive-preparation/packet-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const packetRow = {
  id: "packet-1",
  title: "Incentive Preparation Packet",
  goal_type: "buy-equipment",
  program_name: "SBIF",
  project_address: "9000 S Commercial Ave",
  status: "needs_information",
  business_name: "South Shore Supply",
  tasks_json: [
    {
      id: "vendor-materials",
      title: "Collect vendor materials",
      description: "Application preparation",
      status: "needs_document",
      owner: "business",
      category: "goal",
      dependsOn: [],
      estimatedMinWeeks: 1,
      estimatedMaxWeeks: 2,
    },
    {
      id: "official-certification-submission",
      title: "Complete official certification and submission",
      description: "Applicant only",
      status: "requires_certification",
      owner: "business",
      category: "certification",
      dependsOn: ["vendor-materials"],
      estimatedMinWeeks: 0.25,
      estimatedMaxWeeks: 0.5,
    },
  ],
  timeline_json: {},
  profile_snapshot_json: { legalName: "South Shore Supply" },
  created_at: "2026-07-10T00:00:00.000Z",
  updated_at: "2026-07-10T00:00:00.000Z",
};

beforeEach(() => {
  getCurrentUserIdMock.mockReset();
  sqlMock.mockReset();
});

describe("PATCH /api/incentive-preparation/[id]", () => {
  it("returns 404 for packets outside the current user's scope", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([]);

    const res = await PATCH(request({ taskId: "vendor-materials", status: "complete" }), params);

    expect(res.status).toBe(404);
    expect(sqlMock.mock.calls[0].slice(1)).toEqual(expect.arrayContaining(["packet-1", "user-1"]));
  });

  it("allows tracking updates for ordinary tasks without changing the profile snapshot", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([packetRow]).mockResolvedValueOnce([
      { ...packetRow, status: "ready_to_submit", updated_at: "2026-07-11T00:00:00.000Z" },
    ]);

    const res = await PATCH(request({ taskId: "vendor-materials", status: "complete" }), params);

    expect(res.status).toBe(200);
    const updateSql = String(sqlMock.mock.calls[1][0]);
    expect(updateSql).toContain("tasks_json");
    expect(updateSql).toContain("timeline_json");
    expect(updateSql).not.toContain("profile_snapshot_json");
  });

  it("never completes the official certification task", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([packetRow]);

    const res = await PATCH(
      request({ taskId: "official-certification-submission", status: "complete" }),
      params
    );

    expect(res.status).toBe(400);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});
