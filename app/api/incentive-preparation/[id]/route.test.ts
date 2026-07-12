import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getAllProgramsMock, getCurrentUserIdMock, sqlMock } = vi.hoisted(() => ({
  getAllProgramsMock: vi.fn(),
  getCurrentUserIdMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: getCurrentUserIdMock }));
vi.mock("@/lib/db", () => ({ getSQL: () => sqlMock }));
vi.mock("@/lib/programs-data", () => ({ getAllPrograms: getAllProgramsMock }));

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

const foundationPacketRow = {
  id: "packet-1",
  title: "Business File",
  goal_type: null,
  program_name: null,
  program_id: null,
  project_address: "9000 S Commercial Ave",
  status: "waiting_on_others",
  business_name: "South Shore Supply",
  tasks_json: [
    {
      id: "foundation-business-identity",
      title: "Confirm the business identity",
      description: "",
      status: "complete",
      owner: "business",
      category: "foundation",
      dependsOn: [],
      estimatedMinWeeks: 0.5,
      estimatedMaxWeeks: 1,
    },
    {
      id: "foundation-addresses",
      title: "Confirm addresses",
      description: "",
      status: "complete",
      owner: "business",
      category: "foundation",
      dependsOn: [],
      estimatedMinWeeks: 0.5,
      estimatedMaxWeeks: 1,
    },
    {
      id: "foundation-authorized-contact",
      title: "Confirm the authorized contact",
      description: "",
      status: "needs_owner_answer",
      owner: "business",
      category: "foundation",
      dependsOn: ["foundation-business-identity"],
      estimatedMinWeeks: 0.5,
      estimatedMaxWeeks: 1,
    },
    {
      id: "accountant-financials",
      title: "Prepare accountant-reviewed financials",
      description: "",
      status: "complete",
      owner: "accountant",
      category: "dependency",
      dependsOn: ["foundation-business-identity"],
      estimatedMinWeeks: 1,
      estimatedMaxWeeks: 3,
    },
    {
      id: "tax-good-standing",
      title: "Obtain tax and good-standing records",
      description: "",
      status: "external_dependency",
      owner: "accountant",
      category: "dependency",
      dependsOn: ["foundation-business-identity"],
      estimatedMinWeeks: 1,
      estimatedMaxWeeks: 3,
    },
  ],
  timeline_json: {},
  profile_snapshot_json: {
    legalName: "South Shore Supply",
    physicalAddress: "9000 S Commercial Ave",
    contactName: "Jordan Lee",
    contactEmail: "jordan@example.com",
  },
  created_at: "2026-07-10T00:00:00.000Z",
  updated_at: "2026-07-10T00:00:00.000Z",
};

beforeEach(() => {
  getAllProgramsMock.mockReset();
  getAllProgramsMock.mockReturnValue([]);
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

    const body = (await res.json()) as {
      packet: {
        timeline: { estimatedWeeks: unknown };
        timelines: {
          foundation: { estimatedWeeks: unknown };
          application: { estimatedWeeks: unknown };
        };
      };
    };
    expect(body.packet.timeline).toBeTruthy();
    expect(body.packet.timelines.foundation.estimatedWeeks).toBeTruthy();
    expect(body.packet.timelines.application.estimatedWeeks).toBeTruthy();
    expect(body.packet.timelines.application).toEqual(body.packet.timeline);
  });

  it("layers a chosen program into a foundation-only packet, preserving confirmed statuses", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    getAllProgramsMock.mockReturnValue([
      {
        id: "sbif",
        name: "Small Business Improvement Fund",
        requiredDocs: [],
        verificationSteps: [],
      },
    ]);
    sqlMock
      .mockResolvedValueOnce([foundationPacketRow])
      .mockResolvedValueOnce([
        {
          ...foundationPacketRow,
          goal_type: "improve-storefront",
          program_id: "sbif",
          program_name: "Small Business Improvement Fund",
          title: "Small Business Improvement Fund application prep",
          updated_at: "2026-07-11T00:00:00.000Z",
        },
      ]);

    const res = await PATCH(
      request({
        goalType: "improve-storefront",
        programId: "sbif",
        programName: "Small Business Improvement Fund",
      }),
      params
    );

    expect(res.status).toBe(200);

    // The merge writes goal/program columns but never the immutable snapshot.
    const updateSql = String(sqlMock.mock.calls[1][0]);
    expect(updateSql).toContain("goal_type");
    expect(updateSql).toContain("program_name");
    expect(updateSql).not.toContain("profile_snapshot_json");

    const updateValues = sqlMock.mock.calls[1].slice(1);
    const tasksJson = updateValues.find(
      (value) =>
        typeof value === "string" && value.includes("storefront-improvement-scope")
    ) as string;
    const mergedTasks = JSON.parse(tasksJson) as Array<{ id: string; status: string }>;

    // Program/goal/certification tasks were layered in.
    expect(mergedTasks.some((task) => task.id === "storefront-improvement-scope")).toBe(true);
    expect(mergedTasks.some((task) => task.id === "official-certification-submission")).toBe(
      true
    );
    // The confirmed foundation status survived the merge.
    expect(
      mergedTasks.find((task) => task.id === "accountant-financials")?.status
    ).toBe("complete");
    // Foundation tasks are not duplicated.
    const ids = mergedTasks.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The generic Business File title is replaced with the program's prep title.
    expect(updateValues).toContain("Small Business Improvement Fund");
    expect(updateValues).toContain("improve-storefront");
  });

  it("refuses to re-point a packet that already targets a different program", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([
      { ...foundationPacketRow, goal_type: "buy-equipment", program_name: "Existing program" },
    ]);

    const res = await PATCH(
      request({
        goalType: "improve-storefront",
        programId: "sbif",
        programName: "Small Business Improvement Fund",
      }),
      params
    );

    expect(res.status).toBe(400);
    // Only the load happened; no UPDATE was attempted.
    expect(sqlMock).toHaveBeenCalledTimes(1);
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
