import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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

import { DELETE, GET, PATCH } from "./route";

const params = { params: Promise.resolve({ id: "report-1" }) };

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/saved-reports/report-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function deleteRequest(): NextRequest {
  return new NextRequest("http://localhost/api/saved-reports/report-1", {
    method: "DELETE",
  });
}

function getRequest(): NextRequest {
  return new NextRequest("http://localhost/api/saved-reports/report-1", {
    method: "GET",
  });
}

beforeEach(() => {
  getCurrentUserIdMock.mockReset();
  sqlMock.mockReset();
});

/**
 * GET is the read path for a whole saved report — it selects `*`, so the
 * response body carries wizard_state_json and report_data_json verbatim. That
 * makes its `AND user_id = ${userId}` predicate the single control standing
 * between one signed-in user and another user's full report. PATCH/DELETE were
 * already pinned here; GET had no tests at all, so a dropped predicate on the
 * one route that RETURNS the body would have shipped under a green suite.
 */
describe("GET /api/saved-reports/[id]", () => {
  const OWNED_ROW = {
    id: "report-1",
    project_id: "project-1",
    title: "Saved Incentive Report",
    report_type: "site-incentives",
    address: "1234 S Halsted St",
    lat: 41.8641,
    lon: -87.6467,
    wizard_state_json: { projectType: "hiring" },
    report_data_json: { title: "Saved Incentive Report", sections: [] },
    created_at: "2026-07-08T00:00:00Z",
    updated_at: "2026-07-08T00:00:00Z",
  };

  it("returns 401 when signed out and never touches the database", async () => {
    getCurrentUserIdMock.mockResolvedValue(null);

    const res = await GET(getRequest(), params);

    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns 404 — not the report — when it belongs to another user", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    // The owner-scoped SELECT matches nothing for a report owned by user-2.
    sqlMock.mockResolvedValue([]);

    const res = await GET(getRequest(), params);
    const payload = await res.json();

    expect(res.status).toBe(404);
    expect(payload).toEqual({ error: "Report not found" });
    expect(payload).not.toHaveProperty("report");
  });

  it("scopes the SELECT to the signed-in owner, not the id alone", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([]);

    await GET(getRequest(), params);

    // Ownership scoping: the interpolated values carry BOTH the report id and
    // the session user id. An id-only lookup would omit the user id here.
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain("report-1");
    expect(values).toContain("user-1");
  });

  it("returns an owned report with its wizard state and report data", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([OWNED_ROW]);

    const res = await GET(getRequest(), params);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.report).toMatchObject({
      id: "report-1",
      projectId: "project-1",
      title: "Saved Incentive Report",
      reportType: "site-incentives",
      address: "1234 S Halsted St",
      wizardState: { projectType: "hiring" },
      reportData: { title: "Saved Incentive Report", sections: [] },
    });
    expect(payload.report.createdAt).toBe("2026-07-08T00:00:00.000Z");
    expect(payload.report.updatedAt).toBe("2026-07-08T00:00:00.000Z");

    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain("report-1");
    expect(values).toContain("user-1");
  });

  it("parses jsonb columns that arrive as strings", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([
      {
        ...OWNED_ROW,
        wizard_state_json: JSON.stringify({ projectType: "rehab" }),
        report_data_json: JSON.stringify({ title: "Stringified", sections: [] }),
      },
    ]);

    const res = await GET(getRequest(), params);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.report.wizardState).toEqual({ projectType: "rehab" });
    expect(payload.report.reportData).toEqual({ title: "Stringified", sections: [] });
  });
});

describe("PATCH /api/saved-reports/[id]", () => {
  it("returns 401 when signed out", async () => {
    getCurrentUserIdMock.mockResolvedValue(null);

    const res = await PATCH(patchRequest({ title: "New title" }), params);

    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns 400 when title is missing or blank", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");

    const res = await PATCH(patchRequest({ title: "   " }), params);

    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("rejects an overlong title before updating the database", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    const res = await PATCH(patchRequest({ title: "x".repeat(201) }), params);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "title must be 200 characters or fewer",
    });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the report belongs to another user", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([]);

    const res = await PATCH(patchRequest({ title: "New title" }), params);

    expect(res.status).toBe(404);
  });

  it("renames an owned report and scopes the update to the owner", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([
      { id: "report-1", title: "New title", updated_at: "2026-07-08T00:00:00Z" },
    ]);

    const res = await PATCH(patchRequest({ title: "  New title  " }), params);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.report).toMatchObject({ id: "report-1", title: "New title" });

    // Ownership scoping: the interpolated values include both id and user id.
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain("report-1");
    expect(values).toContain("user-1");
    expect(values).toContain("New title"); // trimmed
  });
});

describe("DELETE /api/saved-reports/[id]", () => {
  it("returns 401 when signed out", async () => {
    getCurrentUserIdMock.mockResolvedValue(null);

    const res = await DELETE(deleteRequest(), params);

    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the report belongs to another user", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([]);

    const res = await DELETE(deleteRequest(), params);

    expect(res.status).toBe(404);
  });

  it("deletes an owned report", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValue([{ id: "report-1" }]);

    const res = await DELETE(deleteRequest(), params);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({ deleted: true });

    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain("report-1");
    expect(values).toContain("user-1");
  });
});
