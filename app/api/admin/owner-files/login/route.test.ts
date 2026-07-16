import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { OWNER_FILES_ADMIN_COOKIE } from "@/lib/owner-files-admin-auth";
import { POST } from "./route";

function formReq(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return new NextRequest("http://localhost/api/admin/owner-files/login", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/admin/owner-files/login", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects back with an error when the password does not match", async () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "correct-password");
    vi.stubEnv("AUTH_SECRET", "session-secret");

    const res = await POST(formReq({ password: "wrong-password" }));
    expect(res.status).toBe(303);
    const location = res.headers.get("location");
    expect(location).toContain("/admin/owner-files");
    expect(location).toContain("error=1");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("sets a session cookie and redirects to the given redirectTo on success", async () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "correct-password");
    vi.stubEnv("AUTH_SECRET", "session-secret");

    const res = await POST(
      formReq({ password: "correct-password", redirectTo: "/admin/owner-files/60617" })
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/admin/owner-files/60617");
    const cookie = res.headers.get("set-cookie") || "";
    expect(cookie).toContain(OWNER_FILES_ADMIN_COOKIE);
  });

  it("falls back to /admin/owner-files for an off-site redirectTo", async () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "correct-password");
    vi.stubEnv("AUTH_SECRET", "session-secret");

    const res = await POST(
      formReq({ password: "correct-password", redirectTo: "https://evil.example.com/steal" })
    );
    const location = res.headers.get("location") || "";
    expect(location).not.toContain("evil.example.com");
    expect(location).toContain("/admin/owner-files");
  });
});
