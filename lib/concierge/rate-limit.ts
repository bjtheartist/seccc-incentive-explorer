/**
 * Stage-1 rate limiting for the Site Concierge.
 *
 * DELIBERATELY SIMPLE: an in-memory, per-process (per serverless instance)
 * fixed-window counter plus a cookie-based session id. This is the "acceptable
 * for stage 1" approach called out in the design note.
 *
 * DOCUMENTED LIMITATIONS (carried into stage 2/3 hardening):
 *   - Counters live in a single instance's memory. Under multiple concurrent
 *     serverless instances the effective ceiling is roughly limit × instances,
 *     and a cold start resets counters. It is a courtesy throttle / abuse
 *     speed-bump, not an enforceable quota.
 *   - The session cap keys off a client cookie the visitor could clear.
 *   - IP is read from x-forwarded-for and can be spoofed absent a trusted proxy.
 *   - Stage 3 replaces this with a shared store (Upstash Redis is already a
 *     dependency) for cross-instance accuracy + real daily budgets.
 *
 * Fails CLOSED with a friendly message when a limit is exceeded.
 */
import { CONCIERGE_RATE_LIMITS } from "./config";

interface WindowCounter {
  count: number;
  resetAt: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const ipBuckets = new Map<string, WindowCounter>();
const sessionBuckets = new Map<string, WindowCounter>();

const MAX_TRACKED_KEYS = 5000;

function sweep(map: Map<string, WindowCounter>, now: number) {
  if (map.size <= MAX_TRACKED_KEYS) return;
  for (const [key, counter] of map) {
    if (counter.resetAt <= now) map.delete(key);
  }
}

/**
 * Increment and test a fixed-window counter. Returns whether the request is
 * allowed and, when not, how many seconds until the window resets.
 */
function hit(
  map: Map<string, WindowCounter>,
  key: string,
  limit: number,
  windowMs: number,
  now: number
): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
  const existing = map.get(key);
  if (!existing || existing.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    sweep(map, now);
    return { allowed: true, retryAfterSeconds: 0, remaining: limit - 1 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      remaining: 0,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: limit - existing.count,
  };
}

export interface RateLimitDecision {
  allowed: boolean;
  /** "ip" | "session" | null — which limit tripped (for logging/telemetry). */
  scope: "ip" | "session" | null;
  retryAfterSeconds: number;
}

/**
 * Count one concierge message against both the per-IP and per-session windows.
 * A single call increments both so the two ceilings stay consistent.
 */
export function checkConciergeRateLimit(
  ip: string,
  sessionId: string,
  now: number = Date.now()
): RateLimitDecision {
  const ipResult = hit(
    ipBuckets,
    ip || "unknown-ip",
    CONCIERGE_RATE_LIMITS.perIpPerHour,
    HOUR_MS,
    now
  );
  if (!ipResult.allowed) {
    return { allowed: false, scope: "ip", retryAfterSeconds: ipResult.retryAfterSeconds };
  }

  const sessionResult = hit(
    sessionBuckets,
    sessionId || "unknown-session",
    CONCIERGE_RATE_LIMITS.perSessionPerDay,
    DAY_MS,
    now
  );
  if (!sessionResult.allowed) {
    return {
      allowed: false,
      scope: "session",
      retryAfterSeconds: sessionResult.retryAfterSeconds,
    };
  }

  return { allowed: true, scope: null, retryAfterSeconds: 0 };
}

/** Test-only: reset the in-memory windows. */
export function __resetConciergeRateLimit() {
  ipBuckets.clear();
  sessionBuckets.clear();
}
