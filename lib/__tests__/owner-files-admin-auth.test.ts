import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOwnerFilesAdminSession,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
  verifyOwnerFilesAdminPassword,
} from "../owner-files-admin-auth";

describe("owner files admin auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires admin credentials before issuing sessions", () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");

    expect(isOwnerFilesAdminConfigured()).toBe(false);
    expect(verifyOwnerFilesAdminPassword("anything")).toBe(false);
    expect(hasValidOwnerFilesAdminSession("bad-session")).toBe(false);
  });

  it("verifies the dashboard password and signed session cookie", () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "local-password");
    vi.stubEnv("AUTH_SECRET", "session-secret");

    expect(isOwnerFilesAdminConfigured()).toBe(true);
    expect(verifyOwnerFilesAdminPassword("local-password")).toBe(true);
    expect(verifyOwnerFilesAdminPassword("wrong-password")).toBe(false);

    const session = createOwnerFilesAdminSession();
    expect(hasValidOwnerFilesAdminSession(session)).toBe(true);
    expect(hasValidOwnerFilesAdminSession(`${session}tampered`)).toBe(false);
  });

  it("invalidates sessions when the configured password changes", () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "first-password");
    vi.stubEnv("AUTH_SECRET", "session-secret");
    const session = createOwnerFilesAdminSession();

    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "second-password");
    expect(hasValidOwnerFilesAdminSession(session)).toBe(false);
  });

  it("uses a different cookie name than the analytics admin gate", async () => {
    const { ANALYTICS_ADMIN_COOKIE } = await import("../analytics-admin-auth");
    const { OWNER_FILES_ADMIN_COOKIE } = await import("../owner-files-admin-auth");
    expect(OWNER_FILES_ADMIN_COOKIE).not.toBe(ANALYTICS_ADMIN_COOKIE);
  });
});
