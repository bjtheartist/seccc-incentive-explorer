/**
 * Stage 3 GLOBAL daily model-turn budget for the Incentive Guide.
 *
 * A single per-day counter across ALL users/sessions — the last-resort valve on
 * total gateway spend (design note §6, task item 6). This is distinct from the
 * per-IP / per-session throttles in rate-limit.ts: those bound one caller, this
 * bounds the whole site's daily cost.
 *
 * Storage: Upstash Redis when configured, otherwise the existing Neon database.
 * Both make the counter accurate across serverless instances. In-memory is the
 * final local/outage fallback.
 *
 * DOCUMENTED LIMITATION: the final in-memory fallback is per-instance, so under
 * N concurrent instances its effective cap is roughly budget × N and cold
 * starts reset it. Upstash and Neon counters are exact across instances.
 *
 * Fails OPEN on a Redis error (never blocks a real user because the store
 * hiccuped) but fails CLOSED on an exact over-count.
 */
import { getRedisClient } from "@/lib/redis";
import { getConciergeDailyBudget } from "./config";
import {
  incrementDatabaseCounter,
  type ConciergeCounterSQL,
} from "./shared-counter";

/** UTC day key so the window is stable regardless of instance timezone. */
export function budgetDayKey(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD
}

const memCounters = new Map<string, number>();

export interface BudgetDecision {
  allowed: boolean;
  /** Total count AFTER this message (best-effort). */
  count: number;
  limit: number;
}

/**
 * Count one concierge message against the global daily budget and report whether
 * it is allowed. Increments first, then tests, so the very message that crosses
 * the line is the one rejected.
 */
export async function consumeDailyBudget(
  now: number = Date.now(),
  sql?: ConciergeCounterSQL | null
): Promise<BudgetDecision> {
  const limit = getConciergeDailyBudget();
  const day = budgetDayKey(now);
  const redis = getRedisClient();

  if (redis) {
    try {
      const key = `concierge:budget:${day}`;
      const count = await redis.incr(key);
      // Set a 2-day TTL on first write so keys self-expire.
      if (count === 1) {
        await redis.expire(key, 60 * 60 * 48);
      }
      return { allowed: count <= limit, count, limit };
    } catch {
      // Redis unavailable: try the shared database next.
    }
  }

  if (sql) {
    try {
      const expiresAt = new Date(
        Date.parse(`${day}T00:00:00.000Z`) + 2 * 24 * 60 * 60 * 1000
      );
      const count = await incrementDatabaseCounter(
        sql,
        `concierge:budget:${day}`,
        expiresAt
      );
      return { allowed: count <= limit, count, limit };
    } catch {
      // Missing migration or database outage: preserve a local ceiling below.
    }
  }

  const current = (memCounters.get(day) ?? 0) + 1;
  memCounters.set(day, current);
  // Keep the map from growing unbounded across days.
  if (memCounters.size > 7) {
    for (const key of memCounters.keys()) {
      if (key !== day) memCounters.delete(key);
    }
  }
  return { allowed: current <= limit, count: current, limit };
}

/** Test-only: reset the in-memory daily counters. */
export function __resetConciergeDailyBudget() {
  memCounters.clear();
}
