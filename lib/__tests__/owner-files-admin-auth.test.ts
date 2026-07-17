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

  // Single sign-on: a valid analytics admin session cross-accepts into the
  // Owner Files gate (one direction only — see the module doc in
  // ../owner-files-admin-auth.ts). These tests exercise the real
  // lib/analytics-admin-auth.ts helpers, not a mock, so they prove the
  // actual signature/expiry round trip, not just that the two functions are
  // wired together.
  describe("single sign-on with the analytics admin gate", () => {
    it("is configured when only the analytics gate has a password set", async () => {
      vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "");
      vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "analytics-password");
      vi.stubEnv("ANALYTICS_ADMIN_TOKEN", "");
      vi.stubEnv("AUTH_SECRET", "shared-secret");
      vi.stubEnv("NEXTAUTH_SECRET", "");

      expect(isOwnerFilesAdminConfigured()).toBe(true);
    });

    it("accepts a valid analytics admin session as a substitute for its own cookie", async () => {
      vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "");
      vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "analytics-password");
      vi.stubEnv("ANALYTICS_ADMIN_TOKEN", "");
      vi.stubEnv("AUTH_SECRET", "shared-secret");
      vi.stubEnv("NEXTAUTH_SECRET", "");

      const { createAnalyticsAdminSession } = await import("../analytics-admin-auth");
      const analyticsSession = createAnalyticsAdminSession();

      // No owner-files cookie at all — only the analytics cookie.
      expect(hasValidOwnerFilesAdminSession(undefined, analyticsSession)).toBe(true);
      expect(hasValidOwnerFilesAdminSession(null, analyticsSession)).toBe(true);
    });

    it("rejects a tampered analytics session even when the gate is configured via analytics", async () => {
      vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "");
      vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "analytics-password");
      vi.stubEnv("ANALYTICS_ADMIN_TOKEN", "");
      vi.stubEnv("AUTH_SECRET", "shared-secret");
      vi.stubEnv("NEXTAUTH_SECRET", "");

      const { createAnalyticsAdminSession } = await import("../analytics-admin-auth");
      const tampered = `${createAnalyticsAdminSession()}tampered`;
      expect(hasValidOwnerFilesAdminSession(undefined, tampered)).toBe(false);
    });

    it("returns false when neither the owner-files nor the analytics cookie is valid", () => {
      vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "owner-password");
      vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "analytics-password");
      vi.stubEnv("ANALYTICS_ADMIN_TOKEN", "");
      vi.stubEnv("AUTH_SECRET", "shared-secret");
      vi.stubEnv("NEXTAUTH_SECRET", "");

      expect(hasValidOwnerFilesAdminSession("bad-owner-session", "bad-analytics-session")).toBe(false);
      expect(hasValidOwnerFilesAdminSession(undefined, undefined)).toBe(false);
      expect(hasValidOwnerFilesAdminSession(null, null)).toBe(false);
    });

    it("still accepts its own valid cookie when no analytics cookie is present or valid", () => {
      vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "owner-password");
      vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "");
      vi.stubEnv("ANALYTICS_ADMIN_TOKEN", "");
      vi.stubEnv("AUTH_SECRET", "shared-secret");
      vi.stubEnv("NEXTAUTH_SECRET", "");

      const ownSession = createOwnerFilesAdminSession();
      expect(hasValidOwnerFilesAdminSession(ownSession)).toBe(true);
      expect(hasValidOwnerFilesAdminSession(ownSession, "not-a-real-analytics-session")).toBe(true);
      expect(hasValidOwnerFilesAdminSession(ownSession, undefined)).toBe(true);
    });
  });
});
