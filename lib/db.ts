import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Lazy Neon serverless Postgres client.
 * Only initializes when DATABASE_URL is set and first query is made.
 * This prevents build-time errors when the env var is not configured.
 */

let _sql: NeonQueryFunction<false, false> | null = null;

export function getSQL(): NeonQueryFunction<false, false> | null {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}

/**
 * Convenience: get the SQL client or throw.
 * Use in API routes that require database access.
 */
export function requireSQL(): NeonQueryFunction<false, false> {
  const sql = getSQL();
  if (!sql) throw new Error("DATABASE_URL not configured");
  return sql;
}
