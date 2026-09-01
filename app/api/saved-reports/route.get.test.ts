import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coverage for the LIST read path, `GET /api/saved-reports`.
 *
 * The neighbouring route.test.ts covers POST only, and does so through a
 * tagged-template stub wired to an always-signed-in user — it cannot drive the
 * signed-out branch. GET had no tests at all, so the `WHERE user_id = ${userId}`
 * clause that keeps one user's saved-report index out of another's response was
 * unpinned. This file exists alongside route.test.ts rather than inside it so
 * the POST fixture's always-authenticated mock stays untouched.
 */

const { getCurrentUserIdMock, sqlMock } = vi.hoisted(() => ({
  getCurrentUserIdMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: getCurrentUserIdMock,
}));

vi.mock("@/lib/db", () => ({
  getSQL: () => sqlMock,
}));

const { GET } = await import("./route");

const ROW = {
  id: "report-1",
  project_id: "project-1",
  title: "Saved Incentive Report",
  report_type: "site-incentives",
  address: "1234 S Halsted St",
  lat: 41.8641,
  lon: -87.6467,
  created_at: "2026-07-08T00:00:00Z",
  updated_at: "2026-07-09T00:00:00Z",
};

beforeEach(() => {
  getCurrentUserIdMock.mockReset();
  sqlMock.mockReset();
});

describe("GET /api/saved-reports", () => {
  it("returns 401 when signed out and never touches the database", async () => {
    getCurrentUserIdMock.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Authentication required" });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("scopes the SELECT to the signed-in user", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([]);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ reports: [] });

    // The only interpolated value in this query is the owner id. An unscoped
    // list query would interpolate nothing at all.
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain("user-1");
  });

  it("returns the signed-in user's report summaries", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([ROW]);

    const res = await GET();
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.reports).toHaveLength(1);
    expect(payload.reports[0]).toEqual({
      id: "report-1",
      projectId: "project-1",
      title: "Saved Incentive Report",
      reportType: "site-incentives",
      address: "1234 S Halsted St",
      lat: 41.8641,
      lon: -87.6467,
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
    });
  });

  it("summarizes only listing columns — never the stored report body", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    // Even if the row carried the heavy jsonb columns, the list summary must
    // not forward them; the index is a listing, not a bulk report export.
    sqlMock.mockResolvedValue([
      {
        ...ROW,
        wizard_state_json: { projectType: "hiring" },
        report_data_json: { title: "Saved Incentive Report", sections: [] },
      },
    ]);

    const res = await GET();
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.reports[0]).not.toHaveProperty("reportData");
    expect(payload.reports[0]).not.toHaveProperty("wizardState");
    expect(payload.reports[0]).not.toHaveProperty("report_data_json");
  });

  it("normalizes a null project id and string coordinates", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([
      { ...ROW, project_id: null, address: null, lat: "41.8641", lon: "-87.6467" },
    ]);

    const res = await GET();
    const payload = await res.json();

    expect(payload.reports[0].projectId).toBeNull();
    expect(payload.reports[0].address).toBeNull();
    expect(payload.reports[0].lat).toBe(41.8641);
    expect(payload.reports[0].lon).toBe(-87.6467);
  });
});
