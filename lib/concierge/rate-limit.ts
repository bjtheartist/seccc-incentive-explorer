/**
 * Stage-1 rate limiting for the Site Concierge.
 *
 * Uses Upstash Redis when configured, otherwise the existing Neon database, so
 * limits hold across serverless instances. In-memory remains the final fallback
 * for local development and store outages.
 *
 * Guest sessions still key off a clearable cookie, so the IP window remains a
 * second bound. Shared keys hash identifiers rather than storing raw IPs or
 * user ids. If both shared stores fail, the local fallback preserves a
 * best-effort ceiling.
 *
 * Fails CLOSED with a friendly message when a limit is exceeded.
 */
import { CONCIERGE_RATE_LIMITS } from "./config";
import { getRedisClient } from "@/lib/redis";
import { createHash } from "node:crypto";
import {
  incrementDatabaseCounter,
  type ConciergeCounterSQL,
} from "./shared-counter";

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

function hashedKey(scope: "ip" | "session", value: string, bucket: string) {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `concierge:rate:${scope}:${bucket}:${digest}`;
}

async function hitRedis(
  key: string,
  limit: number,
  ttlSeconds: number
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const redis = getRedisClient();
  if (!redis) throw new Error("Redis is not configured");
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, ttlSeconds);
  const remainingTtl = Math.max(1, Number(await redis.ttl(key)) || ttlSeconds);
  return {
    allowed: count <= limit,
    retryAfterSeconds: count <= limit ? 0 : remainingTtl,
  };
}

async function hitDatabase(
  sql: ConciergeCounterSQL,
  key: string,
  limit: number,
  resetAt: number,
  now: number
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const count = await incrementDatabaseCounter(sql, key, new Date(resetAt));
  return {
    allowed: count <= limit,
    retryAfterSeconds:
      count <= limit ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
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
export async function checkConciergeRateLimit(
  ip: string,
  sessionId: string,
  now: number = Date.now(),
  sql?: ConciergeCounterSQL | null
): Promise<RateLimitDecision> {
  const hourBucket = String(Math.floor(now / HOUR_MS));
  const dayBucket = new Date(now).toISOString().slice(0, 10);
  const ipKey = hashedKey("ip", ip || "unknown-ip", hourBucket);
  const sessionKey = hashedKey(
    "session",
    sessionId || "unknown-session",
    dayBucket
  );
  const hourResetAt = (Math.floor(now / HOUR_MS) + 1) * HOUR_MS;
  const dayResetAt = Date.parse(`${dayBucket}T00:00:00.000Z`) + DAY_MS;
  const redis = getRedisClient();
  if (redis) {
    try {
      const ipResult = await hitRedis(
        ipKey,
        CONCIERGE_RATE_LIMITS.perIpPerHour,
        Math.ceil(HOUR_MS / 1000) + 60
      );
      if (!ipResult.allowed) {
        return {
          allowed: false,
          scope: "ip",
          retryAfterSeconds: ipResult.retryAfterSeconds,
        };
      }

      const sessionResult = await hitRedis(
        sessionKey,
        CONCIERGE_RATE_LIMITS.perSessionPerDay,
        Math.ceil(DAY_MS / 1000) + 60
      );
      if (!sessionResult.allowed) {
        return {
          allowed: false,
          scope: "session",
          retryAfterSeconds: sessionResult.retryAfterSeconds,
        };
      }
      return { allowed: true, scope: null, retryAfterSeconds: 0 };
    } catch {
      // Redis outage: try the shared database below.
    }
  }

  if (sql) {
    try {
      const ipResult = await hitDatabase(
        sql,
        ipKey,
        CONCIERGE_RATE_LIMITS.perIpPerHour,
        hourResetAt,
        now
      );
      if (!ipResult.allowed) {
        return {
          allowed: false,
          scope: "ip",
          retryAfterSeconds: ipResult.retryAfterSeconds,
        };
      }
      const sessionResult = await hitDatabase(
        sql,
        sessionKey,
        CONCIERGE_RATE_LIMITS.perSessionPerDay,
        dayResetAt,
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
    } catch {
      // Missing migration or database outage: preserve a local ceiling below.
    }
  }

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

// ─── Repeated-429 backoff (Stage 3 abuse control) ─────────────────────
//
// A caller that keeps hammering after being throttled gets an escalating
// Retry-After. Purely additive to the base window decision: the base limit
// still governs whether a request is allowed; this only lengthens the
// cool-down advertised to a persistent offender.

interface BackoffEntry {
  strikes: number;
  updatedAt: number;
}

const backoffByKey = new Map<string, BackoffEntry>();
const BACKOFF_TTL_MS = DAY_MS;
const BACKOFF_STEP_SECONDS = 30;
const BACKOFF_MAX_SECONDS = 15 * 60;

/**
 * Record one throttled request for a caller and return the escalated
 * additional cool-down (seconds) to add on top of the base Retry-After.
 */
export function noteConciergeRejection(
  key: string,
  now: number = Date.now()
): number {
  const existing = backoffByKey.get(key);
  const strikes =
    existing && now - existing.updatedAt < BACKOFF_TTL_MS ? existing.strikes + 1 : 1;
  backoffByKey.set(key, { strikes, updatedAt: now });

  if (backoffByKey.size > MAX_TRACKED_KEYS) {
    for (const [k, v] of backoffByKey) {
      if (now - v.updatedAt >= BACKOFF_TTL_MS) backoffByKey.delete(k);
    }
  }
  return Math.min(BACKOFF_MAX_SECONDS, strikes * BACKOFF_STEP_SECONDS);
}

/** Clear the backoff strikes for a caller after a successful request. */
export function clearConciergeRejection(key: string) {
  backoffByKey.delete(key);
}

/** Test-only: reset the in-memory windows. */
export function __resetConciergeRateLimit() {
  ipBuckets.clear();
  sessionBuckets.clear();
  backoffByKey.clear();
}
