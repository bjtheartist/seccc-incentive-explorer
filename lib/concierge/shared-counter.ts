import type { NeonQueryFunction } from "@neondatabase/serverless";

export type ConciergeCounterSQL = NeonQueryFunction<false, false>;

/** Atomically increment a shared counter in Neon. */
export async function incrementDatabaseCounter(
  sql: ConciergeCounterSQL,
  counterKey: string,
  expiresAt: Date
): Promise<number> {
  const rows = await sql`
    INSERT INTO concierge_usage_counters (counter_key, count, expires_at)
    VALUES (${counterKey}, 1, ${expiresAt.toISOString()}::timestamptz)
    ON CONFLICT (counter_key) DO UPDATE
    SET
      count = concierge_usage_counters.count + 1,
      expires_at = GREATEST(
        concierge_usage_counters.expires_at,
        EXCLUDED.expires_at
      ),
      updated_at = NOW()
    RETURNING count
  `;
  return rows.length ? Number((rows[0] as { count: number }).count) : 1;
}
