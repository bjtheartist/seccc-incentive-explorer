import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EnvSchema,
  __resetEnvCheckForTests,
  assertEnvOnce,
  formatEnvIssues,
  reportEnvIssues,
  validateEnv,
} from "../env";

/**
 * R2 finding 7 — lib/env.ts.
 *
 * ~40 environment variables were read straight off `process.env` at ~250 call
 * sites, each inventing its own contract inline. Nothing documented which
 * variables existed or what a valid value looked like, so a typo did not fail:
 * `DOCUMENTS_ENABLED=1` silently selected the OFF branch (the code compares
 * `=== "true"`), and `CONCIERGE_DAILY_BUDGET=ten` produced NaN. The feature
 * just quietly did not work in production, with nothing in the logs.
 */

afterEach(() => {
  __resetEnvCheckForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("absence is never an error", () => {
  it("accepts a completely empty environment — every field is optional by design", () => {
    expect(validateEnv({})).toEqual([]);
  });

  it("treats an empty-string value as unset, not as malformed", () => {
    expect(validateEnv({ DATABASE_URL: "", CONCIERGE_DAILY_BUDGET: "   " })).toEqual([]);
  });

  it("ignores variables it does not describe", () => {
    expect(validateEnv({ SOMETHING_ELSE_ENTIRELY: "???" })).toEqual([]);
  });

  it("accepts a realistic fully-configured environment", () => {
    expect(
      validateEnv({
        DATABASE_URL: "postgres://user:pw@host/db",
        UPSTASH_REDIS_REST_URL: "https://redis.example.com",
        UPSTASH_REDIS_REST_TOKEN: "tok",
        RESEND_API_KEY: "re_abc",
        REPORT_EMAILS_ENABLED: "true",
        REPORT_EMAIL_FROM: "Chicago Incentive Explorer <reports@example.com>",
        INCENTIVE_HELP_INBOX: "help@example.com",
        CRON_SECRET: "s3cret",
        CONCIERGE_DAILY_BUDGET: "25",
        NEXTAUTH_URL: "https://chicagoincentiveexplorer.com",
      }),
    ).toEqual([]);
  });
});

describe("malformed values are caught", () => {
  /**
   * The trap this schema exists to name: the codebase compares flags against
   * the exact string "true", so every one of these reads as OFF.
   */
  it.each(["1", "yes", "TRUE", "on", "enabled"])(
    "rejects the boolean flag value %s, which silently reads as OFF",
    (value) => {
      const issues = validateEnv({ DOCUMENTS_ENABLED: value });
      expect(issues).toHaveLength(1);
      expect(issues[0].variable).toBe("DOCUMENTS_ENABLED");
      expect(issues[0].message).toContain('"true"');
    },
  );

  it.each(["true", "false"])("accepts the boolean flag value %s", (value) => {
    expect(validateEnv({ DOCUMENTS_ENABLED: value })).toEqual([]);
  });

  it("rejects a non-numeric budget that would have become NaN", () => {
    const issues = validateEnv({ CONCIERGE_DAILY_BUDGET: "ten" });
    expect(issues).toHaveLength(1);
    expect(issues[0].variable).toBe("CONCIERGE_DAILY_BUDGET");
  });

  it("rejects a zero or negative numeric setting", () => {
    expect(validateEnv({ CONCIERGE_RETENTION_DAYS: "0" })).toHaveLength(1);
    expect(validateEnv({ VACANCY_CLUSTER_LINK_METERS: "-5" })).toHaveLength(1);
  });

  it("rejects a NEXTAUTH_URL missing its scheme — a wrong value breaks sign-in silently", () => {
    const issues = validateEnv({ NEXTAUTH_URL: "chicagoincentiveexplorer.com" });
    expect(issues).toHaveLength(1);
    expect(issues[0].variable).toBe("NEXTAUTH_URL");
  });

  it("rejects a malformed sender address but accepts the Name <addr> form", () => {
    expect(validateEnv({ REPORT_EMAIL_FROM: "not an address" })).toHaveLength(1);
    expect(validateEnv({ REPORT_EMAIL_FROM: "Reports <reports@example.com>" })).toEqual([]);
    expect(validateEnv({ REPORT_EMAIL_FROM: "reports@example.com" })).toEqual([]);
  });

  it("reports EVERY offending variable, not just the first", () => {
    const issues = validateEnv({
      DOCUMENTS_ENABLED: "1",
      CONCIERGE_DAILY_BUDGET: "lots",
      NEXTAUTH_URL: "nope",
    });
    expect(issues.map((i) => i.variable).sort()).toEqual([
      "CONCIERGE_DAILY_BUDGET",
      "DOCUMENTS_ENABLED",
      "NEXTAUTH_URL",
    ]);
  });
});

describe("the inventory covers what the app branches on", () => {
  const keys = Object.keys(EnvSchema.shape);

  it.each([
    "DATABASE_URL",
    "CRON_SECRET",
    "RESEND_API_KEY",
    "UPSTASH_REDIS_REST_URL",
    "PARCEL_DB_LOOKUPS_ENABLED",
    "REPORT_EMAILS_ENABLED",
    "OWNER_FILES_ADMIN_PASSWORD",
    "ANALYTICS_ADMIN_PASSWORD",
    "AUTH_SECRET",
    "BLOB_READ_WRITE_TOKEN",
    "CONCIERGE_ENABLED",
    "DOCUMENTS_ENABLED",
  ])("documents %s", (key) => {
    expect(keys).toContain(key);
  });
});

describe("failure policy by environment", () => {
  it("logs loudly and CONTINUES in production rather than taking a deploy down", () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() =>
      reportEnvIssues([{ variable: "DOCUMENTS_ENABLED", message: "bad" }]),
    ).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("DOCUMENTS_ENABLED");
  });

  it("THROWS in development, where fast feedback is the point", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => reportEnvIssues([{ variable: "DOCUMENTS_ENABLED", message: "bad" }])).toThrow(
      /DOCUMENTS_ENABLED/,
    );
  });

  it("says nothing at all when there is nothing wrong", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(reportEnvIssues([])).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });

  it("runs at most once per process", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    __resetEnvCheckForTests();
    assertEnvOnce({ DOCUMENTS_ENABLED: "1" });
    assertEnvOnce({ DOCUMENTS_ENABLED: "1" });
    assertEnvOnce({ DOCUMENTS_ENABLED: "1" });
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("names each offending variable in the report so it is findable in a log", () => {
    const report = formatEnvIssues([
      { variable: "CRON_SECRET", message: "must not be empty when set" },
    ]);
    expect(report).toContain("[env]");
    expect(report).toContain("CRON_SECRET");
    expect(report).toContain("must not be empty when set");
  });
});
