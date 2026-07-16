import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { isConfiguredMock, hasSessionMock } = vi.hoisted(() => ({
  isConfiguredMock: vi.fn(),
  hasSessionMock: vi.fn(),
}));

vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "cie_owner_files_admin",
  isOwnerFilesAdminConfigured: isConfiguredMock,
  hasValidOwnerFilesAdminSession: hasSessionMock,
}));

import { GET } from "./route";

function req(cookie?: string) {
  const headers = cookie ? { cookie } : undefined;
  return new NextRequest("http://localhost/api/owner-file/session", { headers });
}

beforeEach(() => {
  isConfiguredMock.mockReset().mockReturnValue(true);
  hasSessionMock.mockReset().mockReturnValue(true);
});

describe("GET /api/owner-file/session", () => {
  it("returns 204 with no body when a valid admin session exists", async () => {
    const res = await GET(req("cie_owner_files_admin=valid"));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("returns 401 when the session cookie is missing/invalid", async () => {
    hasSessionMock.mockReturnValue(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });

  it("returns 401 (not 503) when the gate is not configured", async () => {
    isConfiguredMock.mockReturnValue(false);
    const res = await GET(req("cie_owner_files_admin=valid"));
    expect(res.status).toBe(401);
  });
});
