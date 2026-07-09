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

import { DELETE, PATCH } from "./route";

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

beforeEach(() => {
  getCurrentUserIdMock.mockReset();
  sqlMock.mockReset();
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
