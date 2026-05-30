/**
 * Business-activity derived metrics.
 *
 * Pure, unit-testable helpers over business-license rows: license age,
 * active/closed status, address-level tenure, and opening/closure detection.
 * No DB or network — see `scripts/` for any SQL-backed equivalents.
 */

import type { AddressTenure, ActivityEvent, BusinessLicense } from "@/lib/types/business";

/** Upstream statuses that mean a license is no longer in good standing. */
const CLOSED_STATUSES = new Set(["AAC", "REV"]);

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Parse an ISO-ish date string to epoch ms, or null if unparseable. */
function toMs(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  return Number.isFinite(t) ? t : null;
}

/**
 * Years since `startDate` (whole years, floored). Returns null for missing or
 * unparseable input. `now` is injectable for deterministic tests.
 */
export function licenseAgeYears(
  startDate: string | null | undefined,
  now: Date = new Date()
): number | null {
  const start = toMs(startDate);
  if (start == null) return null;
  const years = (now.getTime() - start) / MS_PER_YEAR;
  return years < 0 ? 0 : Math.floor(years);
}

/**
 * Whether a license is currently active: expiration date in the future
 * (or absent). `now` is injectable for tests.
 */
export function isActive(
  expiration: string | null | undefined,
  now: Date = new Date()
): boolean {
  const exp = toMs(expiration);
  if (exp == null) return true;
  return exp >= now.getTime();
}

/** Normalize an address for grouping (trim + collapse whitespace + upper). */
function addressKey(address: string | null | undefined): string | null {
  if (!address) return null;
  const key = address.trim().replace(/\s+/g, " ").toUpperCase();
  return key.length > 0 ? key : null;
}

/**
 * Earliest license_start_date per address (address-level tenure). Licenses
 * with no address or no parseable start date are ignored.
 */
export function addressTenure(
  licenses: BusinessLicense[],
  now: Date = new Date()
): AddressTenure[] {
  const groups = new Map<
    string,
    { earliest: number; latestExp: number | null; count: number }
  >();

  for (const lic of licenses) {
    const key = addressKey(lic.address);
    const start = toMs(lic.licenseStartDate);
    if (key == null || start == null) continue;

    const exp = toMs(lic.expirationDate);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { earliest: start, latestExp: exp, count: 1 });
    } else {
      g.earliest = Math.min(g.earliest, start);
      if (exp != null) g.latestExp = g.latestExp == null ? exp : Math.max(g.latestExp, exp);
      g.count += 1;
    }
  }

  const out: AddressTenure[] = [];
  for (const [address, g] of groups) {
    out.push({
      address,
      earliestStart: new Date(g.earliest).toISOString().slice(0, 10),
      latestExpiration:
        g.latestExp == null ? null : new Date(g.latestExp).toISOString().slice(0, 10),
      licenseCount: g.count,
      tenureYears: Math.max(0, Math.floor((now.getTime() - g.earliest) / MS_PER_YEAR)),
    });
  }
  out.sort((a, b) => a.earliestStart.localeCompare(b.earliestStart));
  return out;
}

/** Whether a license counts as a closure (cancelled/revoked or expired). */
export function isClosure(
  lic: Pick<BusinessLicense, "licenseStatus" | "expirationDate">,
  now: Date = new Date()
): boolean {
  if (lic.licenseStatus && CLOSED_STATUSES.has(lic.licenseStatus)) return true;
  return !isActive(lic.expirationDate, now);
}

/**
 * Classify licenses into opening / closure events within a recent window
 * (default 365 days). Openings: started within the window. Closures:
 * cancelled/revoked, or expired within the window.
 */
export function detectActivity(
  licenses: BusinessLicense[],
  now: Date = new Date(),
  windowDays = 365
): ActivityEvent[] {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  const events: ActivityEvent[] = [];

  for (const lic of licenses) {
    const start = toMs(lic.licenseStartDate);
    if (start != null && start <= nowMs && nowMs - start <= windowMs) {
      events.push({
        kind: "opening",
        licenseId: lic.licenseId,
        address: lic.address,
        dbaName: lic.dbaName,
        date: lic.licenseStartDate,
      });
    }

    const cancelled = !!lic.licenseStatus && CLOSED_STATUSES.has(lic.licenseStatus);
    const exp = toMs(lic.expirationDate);
    const expiredInWindow = exp != null && exp <= nowMs && nowMs - exp <= windowMs;
    if (cancelled || expiredInWindow) {
      events.push({
        kind: "closure",
        licenseId: lic.licenseId,
        address: lic.address,
        dbaName: lic.dbaName,
        date: lic.expirationDate,
      });
    }
  }

  return events;
}
