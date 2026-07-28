import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { OWNER_FILES_ADMIN_COOKIE } from "@/lib/owner-files-admin-auth";
import { POST } from "./route";

function formReq(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return new NextRequest("http://localhost/api/admin/investment/login", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/admin/investment/login", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks an unauthenticated submit — wrong password redirects with an error and no cookie", async () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "correct-password");
    vi.stubEnv("AUTH_SECRET", "session-secret");

    const res = await POST(formReq({ password: "wrong-password" }));
    expect(res.status).toBe(303);
    const location = res.headers.get("location") || "";
    expect(location).toContain("/investment");
    expect(location).toContain("error=1");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("sets the shared Owner Files session cookie and redirects to the given /investment path on success", async () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "correct-password");
    vi.stubEnv("AUTH_SECRET", "session-secret");

    const res = await POST(
      formReq({ password: "correct-password", redirectTo: "/investment/South%20Shore" }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/investment/South%20Shore");
    const cookie = res.headers.get("set-cookie") || "";
    expect(cookie).toContain(OWNER_FILES_ADMIN_COOKIE);
  });

  it("falls back to /investment for an off-site redirectTo", async () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "correct-password");
    vi.stubEnv("AUTH_SECRET", "session-secret");

    const res = await POST(
      formReq({ password: "correct-password", redirectTo: "https://evil.example.com/steal" }),
    );
    const location = res.headers.get("location") || "";
    expect(location).not.toContain("evil.example.com");
    expect(location).toContain("/investment");
  });

  it("falls back to /investment for a redirectTo outside the /investment tree", async () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "correct-password");
    vi.stubEnv("AUTH_SECRET", "session-secret");

    const res = await POST(formReq({ password: "correct-password", redirectTo: "/admin/analytics" }));
    const location = res.headers.get("location") || "";
    expect(location).toContain("/investment");
    expect(location).not.toContain("/admin/analytics");
  });
});
