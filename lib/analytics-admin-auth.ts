import { createHash, createHmac, timingSafeEqual } from "crypto";

export const ANALYTICS_ADMIN_COOKIE = "cie_analytics_admin";
export const ANALYTICS_ADMIN_SESSION_MAX_AGE = 60 * 60 * 8;

function configuredPassword() {
  return process.env.ANALYTICS_ADMIN_PASSWORD || process.env.ANALYTICS_ADMIN_TOKEN || "";
}

function sessionSecret() {
  return (
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.ANALYTICS_ADMIN_TOKEN ||
    process.env.ANALYTICS_ADMIN_PASSWORD ||
    ""
  );
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

export function isAnalyticsAdminConfigured() {
  return Boolean(configuredPassword() && sessionSecret());
}

export function verifyAnalyticsAdminPassword(password: string) {
  const expected = configuredPassword();
  return Boolean(expected && password && safeEqual(password, expected));
}

export function createAnalyticsAdminSession() {
  const passwordFingerprint = sha256(configuredPassword()).slice(0, 24);
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${issuedAt}.${passwordFingerprint}`;
  return `${payload}.${sign(payload)}`;
}

export function hasValidAnalyticsAdminSession(cookieValue: string | undefined | null) {
  if (!cookieValue || !isAnalyticsAdminConfigured()) return false;

  const parts = cookieValue.split(".");
  if (parts.length !== 3) return false;

  const [issuedAtRaw, passwordFingerprint, signature] = parts;
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now || now - issuedAt > ANALYTICS_ADMIN_SESSION_MAX_AGE) {
    return false;
  }

  if (passwordFingerprint !== sha256(configuredPassword()).slice(0, 24)) {
    return false;
  }

  return safeEqual(signature, sign(`${issuedAtRaw}.${passwordFingerprint}`));
}
