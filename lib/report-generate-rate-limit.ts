import "server-only";

import { createHash } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { getSQL } from "./db";

type SqlClient = NeonQueryFunction<false, false>;

/**
 * DB-backed rate limiting for POST /api/report/generate (R2 finding 2).
 *
 * The route was completely unlimited. It is the most expensive endpoint in the
 * app — it runs the whole report engine against the full internal catalog on
 * every call — and anyone could drive it in a loop with no account, no key and
 * no ceiling.
 *
 * Deliberately built on the same shape as `reserveReportEmailDelivery` in
 * lib/report-email-delivery.ts (hashed client identifier, one row per attempt,
 * a rolling window counted in SQL, `Retry-After` in seconds) so there is one
 * rate-limiting pattern in this codebase rather than two.
 *
 * ── The one deliberate difference: this FAILS OPEN ──
 *
 * /api/email-report answers 503 when its storage is unreachable, which is
 * right: it cannot send an email without a database to record the send in, so
 * refusing is honest. Report generation needs no database at all — the route's
 * own header notes it reads the static catalog directly — so treating a
 * database outage as a reason to stop generating reports would convert a
 * degraded dependency into a total outage of the app's core feature. That
 * trade is worse than the abuse the limiter prevents.
 *
 * So: when storage is absent or failing, requests are ALLOWED and the failure
 * is logged. The limiter is a brake on abuse, not a gate on correctness, and
 * it says so rather than pretending to a guarantee it does not offer.
 */

let storageReady: Promise<void> | null = null;

/**
 * Requests permitted per client per rolling hour.
 *
 * A real session is bounded: the /report page generates on load and again for
 * refine, compare and quick-refine, so a heavy visitor might reach a few dozen
 * across an hour. 120 clears that comfortably — including several people
 * behind one office NAT — while still capping a scripted caller at 120 engine
 * runs an hour instead of as many as it can open sockets for.
 */
export const REPORT_GENERATE_HOURLY_LIMIT = 120;

/** Rolling window, in seconds. Also the Retry-After we hand back. */
export const REPORT_GENERATE_WINDOW_SECONDS = 3600;

export type ReportGenerateRateDecision =
  | { allowed: true; degraded: boolean }
  | { allowed: false; retryAfterSeconds: number };

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Identify the caller. Same derivation as
 * `reportEmailClientIdentifier` — forwarded IP first, then the real-IP header,
 * then a user-agent-derived bucket so a request with neither still lands
 * somewhere stable rather than sharing one global counter.
 */
export function reportGenerateClientIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || headers.get("x-real-ip");
  if (address) return address;
  return `unknown:${(headers.get("user-agent") || "no-user-agent").slice(0, 180)}`;
}

async function migrate(sql: SqlClient): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS report_generate_requests (
      id BIGSERIAL PRIMARY KEY,
      client_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS report_generate_requests_created_at_idx
    ON report_generate_requests (created_at DESC)
  `;
  // Nothing here is worth keeping past the window it is counted in.
  await sql`
    DELETE FROM report_generate_requests
    WHERE created_at < NOW() - INTERVAL '1 day'
  `;
}

export async function ensureReportGenerateStorage(sql: SqlClient): Promise<void> {
  if (!storageReady) {
    storageReady = migrate(sql).catch((error) => {
      storageReady = null;
      throw error;
    });
  }
  return storageReady;
}

/** Test-only: forget the one-shot migration promise. */
export function __resetReportGenerateStorageForTests(): void {
  storageReady = null;
}

/**
 * Count this client's requests in the current window and record this one.
 *
 * `degraded: true` on an allowed decision means the limiter could not consult
 * storage and let the request through unchecked — surfaced so a caller can log
 * or expose it rather than believing a limit was enforced when it was not.
 */
export async function reserveReportGeneration(
  clientIdentifier: string,
): Promise<ReportGenerateRateDecision> {
  const sql = getSQL();
  if (!sql) return { allowed: true, degraded: true };

  try {
    await ensureReportGenerateStorage(sql);

    const clientHash = hashIdentifier(clientIdentifier);
    const rows = await sql`
      SELECT COUNT(*)::int AS request_count
      FROM report_generate_requests
      WHERE client_hash = ${clientHash}
        AND created_at >= NOW() - INTERVAL '1 hour'
    `;
    const count = Number(rows[0]?.request_count || 0);

    if (count >= REPORT_GENERATE_HOURLY_LIMIT) {
      return { allowed: false, retryAfterSeconds: REPORT_GENERATE_WINDOW_SECONDS };
    }

    await sql`
      INSERT INTO report_generate_requests (client_hash)
      VALUES (${clientHash})
    `;
    return { allowed: true, degraded: false };
  } catch (error) {
    // Fail open — see the module header. A report is still generated; the
    // brake is simply off for this request, and that is recorded.
    console.error("[report/generate] rate-limit storage unavailable, allowing request:", error);
    return { allowed: true, degraded: true };
  }
}
