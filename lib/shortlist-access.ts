import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SHORTLIST_ACCESS_COOKIE = "cie_shortlist_access";
export const SHORTLIST_ACCESS_MAX_AGE = 60 * 60 * 24 * 180;
export const SHORTLIST_ACCESS_SOURCE = "site-shortlist-gate-2026";

const cleanText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .transform((value) => value.replace(/\s+/g, " "));

export const ShortlistAccessSignupSchema = z.object({
  name: cleanText(2, 120),
  title: cleanText(2, 160),
  email: z
    .string()
    .trim()
    .min(1, "Enter an email address.")
    .max(254)
    .email("Enter a valid email address.")
    .transform((value) => value.toLowerCase()),
  website: z.string().max(200).optional().default(""),
});

export type ShortlistAccessSignupInput = z.infer<typeof ShortlistAccessSignupSchema>;

export interface ShortlistAccessCsvRow {
  name: string;
  title: string;
  email: string;
  signedUpAt: string;
}

function csvCell(value: string): string {
  const flattened = value.replace(/[\r\n]+/g, " ").trim();
  const formulaSafe = /^[=+\-@]/.test(flattened) ? `'${flattened}` : flattened;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}

export function shortlistAccessSignupsToCsv(rows: ShortlistAccessCsvRow[]): string {
  const lines = [
    ["Name", "Title", "Email Address", "Signed Up At"],
    ...rows.map((row) => [row.name, row.title, row.email, row.signedUpAt]),
  ];
  return lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function accessSecret(): string | null {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || null;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function isShortlistAccessConfigured(): boolean {
  return Boolean(accessSecret());
}

export function createShortlistAccessSession(now = Date.now()): string {
  const secret = accessSecret();
  if (!secret) throw new Error("Shortlist access is not configured");
  const payload = Math.floor(now / 1000).toString(36);
  return `${payload}.${signature(payload, secret)}`;
}

export function hasValidShortlistAccessSession(
  cookieValue: string | undefined | null,
  now = Date.now(),
): boolean {
  const secret = accessSecret();
  if (!secret || !cookieValue) return false;

  const [payload, provided, extra] = cookieValue.split(".");
  if (!payload || !provided || extra) return false;

  const issuedAtSeconds = Number.parseInt(payload, 36);
  if (!Number.isFinite(issuedAtSeconds)) return false;
  const ageSeconds = Math.floor(now / 1000) - issuedAtSeconds;
  if (ageSeconds < 0 || ageSeconds > SHORTLIST_ACCESS_MAX_AGE) return false;

  const expected = signature(payload, secret);
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}
