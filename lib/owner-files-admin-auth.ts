import { createHash, createHmac, timingSafeEqual } from "crypto";
import { hasValidAnalyticsAdminSession, isAnalyticsAdminConfigured } from "./analytics-admin-auth";

/**
 * Shared-password gate for /admin/owner-files, cloned from
 * lib/analytics-admin-auth.ts with its own env var and cookie name.
 *
 * An Owner File is a named-entity dossier (owner name, mailing address,
 * IL SOS lookup fields) — more sensitive than the unlisted-but-open
 * /corridors/[zip] page, so it gets its own gate rather than reusing the
 * analytics one. This is an explicit MVP stopgap (plan Phase 3 replaces it
 * with real per-corridor-manager accounts); `verifier_name` is required on
 * every write in the meantime so actions stay attributable even though the
 * gate itself is a shared password.
 *
 * Single sign-on: a valid ANALYTICS admin session also satisfies this gate
 * (owner cross-accepts the session they already have open from
 * /admin/analytics, so there's only one password wall in practice). This is
 * one direction only — an Owner Files session does NOT unlock analytics;
 * lib/analytics-admin-auth.ts is intentionally untouched, both to keep its
 * own behavior unchanged and to avoid a circular import between the two
 * auth modules. See hasValidOwnerFilesAdminSession and
 * isOwnerFilesAdminConfigured below.
 */

export const OWNER_FILES_ADMIN_COOKIE = "cie_owner_files_admin";
export const OWNER_FILES_ADMIN_SESSION_MAX_AGE = 60 * 60 * 8;

function configuredPassword() {
  return process.env.OWNER_FILES_ADMIN_PASSWORD || "";
}

function sessionSecret() {
  return (
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.OWNER_FILES_ADMIN_PASSWORD ||
    ""
  );
}

/** Whether the Owner Files gate's own password/secret pair is set — independent of the analytics fallback. */
function isOwnFilesGateConfigured() {
  return Boolean(configuredPassword() && sessionSecret());
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftHash = Buffer.from(sha256(left));
  const rightHash = Buffer.from(sha256(right));
  return leftHash.length === rightHash.length && timingSafeEqual(leftHash, rightHash);
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

/**
 * True when either this gate's own password/secret is set, or the analytics
 * admin gate is configured (whose session cross-unlocks Owner Files below).
 * Keeps this gate from claiming "not configured" in a deployment where only
 * ANALYTICS_ADMIN_PASSWORD is set but an analytics session would in fact be
 * admitted here.
 */
export function isOwnerFilesAdminConfigured() {
  return isOwnFilesGateConfigured() || isAnalyticsAdminConfigured();
}

export function verifyOwnerFilesAdminPassword(password: string) {
  const expected = configuredPassword();
  return Boolean(expected && password && safeEqual(password, expected));
}

export function createOwnerFilesAdminSession() {
  const passwordFingerprint = sha256(configuredPassword()).slice(0, 24);
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${issuedAt}.${passwordFingerprint}`;
  return `${payload}.${sign(payload)}`;
}

/** Validates only the Owner Files gate's own cookie — no analytics fallback. */
function hasValidOwnFilesCookie(cookieValue: string | undefined | null) {
  if (!cookieValue || !isOwnFilesGateConfigured()) return false;

  const parts = cookieValue.split(".");
  if (parts.length !== 3) return false;

  const [issuedAtRaw, passwordFingerprint, signature] = parts;
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now || now - issuedAt > OWNER_FILES_ADMIN_SESSION_MAX_AGE) {
    return false;
  }

  if (passwordFingerprint !== sha256(configuredPassword()).slice(0, 24)) {
    return false;
  }

  return safeEqual(signature, sign(`${issuedAtRaw}.${passwordFingerprint}`));
}

/**
 * True when either the Owner Files cookie is a valid Owner Files admin
 * session, OR the analytics cookie is a valid analytics admin session
 * (single sign-on — see module doc). `analyticsCookieValue` is optional so
 * existing single-argument callers keep working unchanged; pass it whenever
 * the caller also has access to the analytics cookie (e.g. from a request's
 * cookie store) so a signed-in analytics admin never hits this gate twice.
 */
export function hasValidOwnerFilesAdminSession(
  cookieValue: string | undefined | null,
  analyticsCookieValue?: string | undefined | null
) {
  if (hasValidOwnFilesCookie(cookieValue)) return true;
  return hasValidAnalyticsAdminSession(analyticsCookieValue);
}
