import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Partner share sessions for the Investment & Impact analysis.
 *
 * A staff member mints a share link from the access dashboard. Opening the
 * link swaps the one-time token for this signed, httpOnly cookie, which names
 * the link it came from and when it lapses. The gate verifies the signature
 * here and then asks storage whether that link is still live, so a revoked
 * link stops working on the next protected request even though the cookie is
 * still in the partner's browser.
 */

export const INVESTMENT_SHARE_COOKIE = "cie_investment_share";
/** Ceiling on a single browser session; the link's own expiry may be sooner. */
export const INVESTMENT_SHARE_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export type InvestmentShareAccessMode = "partner";

export interface InvestmentShareSession {
  linkId: string;
  expiresAt: number;
}

function sessionSecret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

function sign(value: string): string {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isInvestmentShareConfigured(): boolean {
  return Boolean(sessionSecret());
}

/** Seconds until `expiresAt`, capped at the session ceiling. */
export function investmentShareCookieMaxAge(expiresAt: Date, now = new Date()): number {
  const remaining = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  return Math.max(0, Math.min(remaining, INVESTMENT_SHARE_SESSION_MAX_AGE));
}

export function createInvestmentShareSession(linkId: string, expiresAt: Date, now = new Date()): string {
  if (!isInvestmentShareConfigured()) {
    throw new Error("Investment share sessions are not configured");
  }
  const expiresAtSeconds = Math.floor(
    Math.min(expiresAt.getTime(), now.getTime() + INVESTMENT_SHARE_SESSION_MAX_AGE * 1000) / 1000,
  );
  const payload = `${linkId}.${expiresAtSeconds}`;
  return `${payload}.${sign(payload)}`;
}

export function parseInvestmentShareSession(
  cookieValue: string | undefined | null,
  now = new Date(),
): InvestmentShareSession | null {
  if (!cookieValue || !isInvestmentShareConfigured()) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return null;
  const [linkId, expiresAtRaw, signature] = parts;
  if (!/^\d+$/.test(linkId) || !/^\d+$/.test(expiresAtRaw)) return null;
  const expiresAt = Number(expiresAtRaw);
  if (expiresAt <= Math.floor(now.getTime() / 1000)) return null;
  if (!safeEqual(signature, sign(`${linkId}.${expiresAtRaw}`))) return null;
  return { linkId, expiresAt };
}
