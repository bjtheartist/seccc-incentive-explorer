import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getAllProgramsMock, getCurrentUserIdMock, getSQLMock, sqlMock } = vi.hoisted(() => ({
  getAllProgramsMock: vi.fn(),
  getCurrentUserIdMock: vi.fn(),
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: getCurrentUserIdMock }));
vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));
vi.mock("@/lib/programs-data", () => ({ getAllPrograms: getAllProgramsMock }));

import { GET, POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/incentive-preparation", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const profile = {
  legalName: "South Shore Supply",
  physicalAddress: "9000 S Commercial Ave",
  contactName: "Jordan Lee",
  contactEmail: "jordan@example.com",
};

beforeEach(() => {
  getAllProgramsMock.mockReset();
  getAllProgramsMock.mockReturnValue([]);
  getCurrentUserIdMock.mockReset();
  getSQLMock.mockReset();
  getSQLMock.mockReturnValue(sqlMock);
  sqlMock.mockReset();
});

describe("/api/incentive-preparation", () => {
  it("returns 401 and 503 before querying packet data", async () => {
    getCurrentUserIdMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();

    getCurrentUserIdMock.mockResolvedValue("user-1");
    getSQLMock.mockReturnValue(null);
    expect((await GET()).status).toBe(503);
  });

  it("requires a valid goal, program name, and exactly one profile source", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");

    expect((await POST(request({ profile, programName: "SBIF" }))).status).toBe(400);
    expect((await POST(request({ goalType: "buy-equipment", profile }))).status).toBe(400);
    expect(
      (await POST(request({ goalType: "buy-equipment", programName: "SBIF", profileId: "p-1", profile }))).status
    ).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns 404 when an optional project is not owned by the current user", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([]);

    const res = await POST(
      request({ goalType: "buy-equipment", programName: "SBIF", profile, projectId: "project-elsewhere" })
    );

    expect(res.status).toBe(404);
    expect(sqlMock.mock.calls[0].slice(1)).toEqual(expect.arrayContaining(["project-elsewhere", "user-1"]));
  });

  it("adds only the selected program's documentation and verification overlay", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    getAllProgramsMock.mockReturnValue([
      {
        id: "known-program",
        name: "Exact likely match",
        requiredDocs: ["Site plan"],
        verificationSteps: [{ label: "Confirm application window", agency: "Program office" }],
        benefits: ["This must not enter the packet"],
        benefitRange: "$1-$999",
      },
    ]);
    sqlMock
      .mockResolvedValueOnce([
        {
          id: "profile-1",
          legal_name: profile.legalName,
          physical_address: profile.physicalAddress,
          contact_name: profile.contactName,
          contact_email: profile.contactEmail,
          licenses_json: [],
          field_provenance_json: {},
          created_at: "2026-07-10T00:00:00.000Z",
          updated_at: "2026-07-10T00:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "packet-1",
          title: "Incentive Preparation Packet",
          goal_type: "buy-equipment",
          program_name: "Exact likely match",
          status: "needs_information",
          tasks_json: [],
          timeline_json: {},
          profile_snapshot_json: profile,
          created_at: "2026-07-10T00:00:00.000Z",
          updated_at: "2026-07-10T00:00:00.000Z",
        },
      ]);

    const res = await POST(
      request({
        goalType: "buy-equipment",
        programId: "unknown-program",
        programName: "Exact likely match",
        profileId: "profile-1",
      })
    );

    expect(res.status).toBe(201);
    expect(getAllProgramsMock).toHaveBeenCalledTimes(1);
    const packetValues = sqlMock.mock.calls[1].slice(1);
    const tasksJson = packetValues.find(
      (value) => typeof value === "string" && value.includes("program-document-1")
    ) as string;
    expect(tasksJson).toContain("Collect program document: Site plan");
    expect(tasksJson).toContain("Confirm program step: Confirm application window");
    expect(tasksJson).not.toContain("This must not enter the packet");
    expect(tasksJson).not.toContain("$1-$999");
  });
});
