import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnalyticsAdminSession,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
  verifyAnalyticsAdminPassword,
} from "../analytics-admin-auth";

describe("analytics admin auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires admin credentials before issuing sessions", () => {
    vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "");
    vi.stubEnv("ANALYTICS_ADMIN_TOKEN", "");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");

    expect(isAnalyticsAdminConfigured()).toBe(false);
    expect(verifyAnalyticsAdminPassword("anything")).toBe(false);
    expect(hasValidAnalyticsAdminSession("bad-session")).toBe(false);
  });

  it("verifies the dashboard password and signed session cookie", () => {
    vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "local-password");
    vi.stubEnv("AUTH_SECRET", "session-secret");

    expect(isAnalyticsAdminConfigured()).toBe(true);
    expect(verifyAnalyticsAdminPassword("local-password")).toBe(true);
    expect(verifyAnalyticsAdminPassword("wrong-password")).toBe(false);

    const session = createAnalyticsAdminSession();
    expect(hasValidAnalyticsAdminSession(session)).toBe(true);
    expect(hasValidAnalyticsAdminSession(`${session}tampered`)).toBe(false);
  });

  it("invalidates sessions when the configured password changes", () => {
    vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "first-password");
    vi.stubEnv("AUTH_SECRET", "session-secret");
    const session = createAnalyticsAdminSession();

    vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "second-password");
    expect(hasValidAnalyticsAdminSession(session)).toBe(false);
  });
});
