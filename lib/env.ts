import { z } from "zod";

/**
 * lib/env.ts — the ONE description of the environment this app branches on.
 *
 * R2 finding 7. Roughly forty environment variables were read directly off
 * `process.env` at ~250 call sites, each site inventing its own contract
 * inline: `=== "true"` here, a truthiness check there, `Number(...)` somewhere
 * else with no guard against `NaN`. Nothing documented which variables exist,
 * which ones change behavior, or what a valid value looks like — so a typo
 * (`DOCUMENTS_ENABLED=1`, `CONCIERGE_DAILY_BUDGET=ten`) did not fail. It
 * silently selected the OFF branch, or produced `NaN`, and the feature just
 * quietly did not work in production with nothing in the logs.
 *
 * What this module is:
 * - A documented inventory of every variable the running app branches on.
 * - A zod schema that rejects malformed VALUES.
 * - A first-import validation pass, server-side only.
 *
 * What it is deliberately NOT:
 * - Not a requirement that anything be set. Every field is optional, because
 *   this app's whole architecture is graceful degradation — no DATABASE_URL
 *   means static files, no Redis means no caching, no RESEND_API_KEY means
 *   email returns 503. Absence is a supported configuration, not an error.
 * - Not a replacement for the existing call sites. Those are unchanged; this
 *   validates and documents, so a bad value is reported at boot instead of
 *   silently swallowed at the branch.
 *
 * Failure policy, by environment:
 * - development: THROW. A malformed value is a local misconfiguration and the
 *   fastest possible feedback is the point.
 * - production: log loudly and CONTINUE. A running deploy must not be taken
 *   down by a bad value in one variable that most requests never read — the
 *   individual call sites already degrade gracefully. The log line names every
 *   offending variable so it is findable.
 * - test: log only, so a suite that stubs an odd value cannot cascade.
 */

/**
 * A flag compared against the exact string "true" somewhere in the codebase.
 *
 * The comparison is `=== "true"`, so "1", "yes", "TRUE" and "on" all read as
 * OFF. That is a real trap — this is the schema that names it. Anything other
 * than "true"/"false" is rejected rather than silently treated as off.
 */
const booleanFlag = z
  .enum(["true", "false"], {
    message: 'must be exactly "true" or "false" — the code compares against the string "true", so "1"/"yes"/"TRUE" read as OFF',
  })
  .optional();

/** A positive number. Rejects the empty string and anything producing NaN. */
const positiveNumber = z
  .string()
  .refine((value) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0, {
    message: "must be a positive number",
  })
  .optional();

const nonEmpty = z.string().min(1, "must not be empty when set").optional();

const url = z.string().url("must be an absolute URL (including the scheme)").optional();

const email = z
  .string()
  .refine((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) || /<[^@\s]+@[^@\s]+>/.test(value), {
    message: 'must be an email address, or a "Name <address@host>" sender string',
  })
  .optional();

export const EnvSchema = z.object({
  // ── Data + storage ──────────────────────────────────────────────────────
  /** Neon Postgres connection string. Absent = the app serves static files. */
  DATABASE_URL: nonEmpty,
  /** Alternate Postgres URL some hosts inject; read as a DATABASE_URL fallback. */
  POSTGRES_URL: nonEmpty,
  /** Upstash Redis REST endpoint. Absent (with its token) = caching skipped. */
  UPSTASH_REDIS_REST_URL: url,
  /** Upstash Redis REST token. Both this and the URL are required to cache. */
  UPSTASH_REDIS_REST_TOKEN: nonEmpty,
  /** Vercel KV aliases for the two above; either pair works. */
  KV_REST_API_URL: url,
  KV_REST_API_TOKEN: nonEmpty,
  /** Vercel Blob token. Absent = document upload/download is unavailable. */
  BLOB_READ_WRITE_TOKEN: nonEmpty,

  // ── Upstream data sources ───────────────────────────────────────────────
  /** Socrata app token — raises the City data portal rate limit ~10x. */
  SOCRATA_APP_TOKEN: nonEmpty,
  SOCRATA_KEY_ID: nonEmpty,
  SOCRATA_KEY_SECRET: nonEmpty,
  /** Census API key for ACS lookups. */
  CENSUS_API_KEY: nonEmpty,
  /** Mapbox GL token. Public by design (NEXT_PUBLIC_); the map needs it. */
  NEXT_PUBLIC_MAPBOX_TOKEN: nonEmpty,

  // ── Auth ────────────────────────────────────────────────────────────────
  /** NextAuth signing secret. Both spellings are read; either works. */
  AUTH_SECRET: nonEmpty,
  NEXTAUTH_SECRET: nonEmpty,
  /** Canonical app URL for OAuth callbacks. A wrong value breaks sign-in. */
  NEXTAUTH_URL: url,
  NEXT_PUBLIC_SITE_URL: url,
  GOOGLE_CLIENT_ID: nonEmpty,
  GOOGLE_CLIENT_SECRET: nonEmpty,

  // ── Admin gates ─────────────────────────────────────────────────────────
  /** Password for /admin/analytics. Absent = the dashboard is unconfigured. */
  ANALYTICS_ADMIN_PASSWORD: nonEmpty,
  /** Token for direct /api/admin/analytics access. */
  ANALYTICS_ADMIN_TOKEN: nonEmpty,
  /** Password for /admin/owner-files and the Investment analysis gate. */
  OWNER_FILES_ADMIN_PASSWORD: nonEmpty,
  ADMIN_SECRET: nonEmpty,
  /**
   * Shared secret Vercel Cron sends as `Authorization: Bearer <CRON_SECRET>`.
   * Absent, the cron routes must FAIL CLOSED — see the note on
   * app/api/cron/watchlist-digest/route.ts, which used to fail open outside
   * production.
   */
  CRON_SECRET: nonEmpty,

  // ── Email ───────────────────────────────────────────────────────────────
  /** Resend API key. Absent = every email path returns 503. */
  RESEND_API_KEY: nonEmpty,
  /** Sender for report emails. Falls back to a hardcoded default. */
  REPORT_EMAIL_FROM: email,
  /** Sender for auth/magic-link emails. */
  AUTH_EMAIL_FROM: email,
  /** Inbox that receives "incentive help requested" notifications. */
  INCENTIVE_HELP_INBOX: email,
  /** Master switch for POST /api/email-report. Off = 503. */
  REPORT_EMAILS_ENABLED: booleanFlag,
  /** Non-production only: short-circuit delivery and report success. */
  REPORT_EMAIL_DRY_RUN: booleanFlag,
  PASSWORD_RESET_EMAILS_ENABLED: booleanFlag,
  PUBLIC_INVESTMENT_ACCESS_EMAILS_ENABLED: booleanFlag,

  // ── Feature flags ───────────────────────────────────────────────────────
  /**
   * Opt the parcel route into the `parcels` table. Production intentionally
   * keeps that table EMPTY, so this stays off there — see
   * app/api/parcel/route.ts's dbParcel().
   */
  PARCEL_DB_LOOKUPS_ENABLED: booleanFlag,
  DOCUMENTS_ENABLED: booleanFlag,
  DOCUMENTS_EXTRACT_ENABLED: booleanFlag,
  DOCUMENTS_EXTRACT_MODEL: nonEmpty,
  CONCIERGE_ENABLED: booleanFlag,
  CONCIERGE_MODEL: nonEmpty,
  /** Daily spend ceiling in dollars for the concierge. NaN would disable it. */
  CONCIERGE_DAILY_BUDGET: positiveNumber,
  /** Days of concierge transcript retention. */
  CONCIERGE_RETENTION_DAYS: positiveNumber,
  /** AI Gateway key backing the concierge and document extraction. */
  AI_GATEWAY_API_KEY: nonEmpty,

  // ── Ingest / data-quality escape hatches ────────────────────────────────
  /**
   * Override the implausible-snapshot guard on a vacancy/CCLBA sync. These
   * exist to let a human force through a source the guard rejected; leaving
   * one on hides a genuinely broken upstream, which is why they are typed.
   */
  ALLOW_IMPLAUSIBLE_VACANCY_SOURCE_SNAPSHOT: booleanFlag,
  ALLOW_IMPLAUSIBLE_CCLBA_SOURCE_SNAPSHOT: booleanFlag,
  /** Metres used to link vacancy records into owner clusters. */
  VACANCY_CLUSTER_LINK_METERS: positiveNumber,
  /** JSON blob describing the SBIF rollout, read by the watchlist digest. */
  SBIF_ROLLOUT_JSON: nonEmpty,
});

export type Env = z.infer<typeof EnvSchema>;

export interface EnvIssue {
  variable: string;
  message: string;
}

/**
 * Validate an environment. Pure and exported so it can be tested directly
 * without mutating the real `process.env`.
 */
export function validateEnv(source: Record<string, string | undefined> = process.env): EnvIssue[] {
  // Only hand zod the keys that are actually PRESENT and non-empty. An unset
  // variable and a variable set to "" are both "not configured" here, and
  // neither is an error — every field is optional by design.
  const present: Record<string, string> = {};
  for (const key of Object.keys(EnvSchema.shape)) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") present[key] = value;
  }

  const parsed = EnvSchema.safeParse(present);
  if (parsed.success) return [];

  return parsed.error.issues.map((issue) => ({
    variable: String(issue.path[0] ?? "(unknown)"),
    message: issue.message,
  }));
}

/** Human-readable report for a set of issues. */
export function formatEnvIssues(issues: EnvIssue[]): string {
  return (
    `[env] ${issues.length} environment variable(s) are set to a value this app cannot use.\n` +
    `Each one is being IGNORED or silently read as "off" at its call site:\n` +
    issues.map((issue) => `  - ${issue.variable}: ${issue.message}`).join("\n")
  );
}

let _checked = false;

/**
 * Run the check once per process. Called at module import below; exported so
 * tests can drive it deliberately.
 */
export function assertEnvOnce(source: Record<string, string | undefined> = process.env): EnvIssue[] {
  if (_checked) return [];
  _checked = true;
  return reportEnvIssues(validateEnv(source));
}

export function reportEnvIssues(issues: EnvIssue[]): EnvIssue[] {
  if (issues.length === 0) return issues;
  const report = formatEnvIssues(issues);

  if (process.env.NODE_ENV === "development") {
    // Fastest possible local feedback; nothing is deployed from here.
    throw new Error(report);
  }
  console.error(report);
  return issues;
}

/** Test-only: re-arm the one-shot check. */
export function __resetEnvCheckForTests(): void {
  _checked = false;
}

// Server-side only. This module is importable from client code for its types,
// and a browser bundle has neither the variables nor any business validating
// them — `typeof window` is the same guard the rest of the codebase uses.
if (typeof window === "undefined") {
  assertEnvOnce();
}
