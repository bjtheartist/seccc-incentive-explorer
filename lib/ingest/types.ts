import type { NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Shared ingestion contract.
 *
 * This is the coordination surface that every "source adapter" implements so
 * that ownership history, business licenses, permits/violations/311, etc. all
 * land in Postgres through the same pipeline (fetch → normalize → upsert).
 *
 * Read this file before writing a new adapter. The runner in `./run.ts` drives
 * the lifecycle; you only implement the four members of {@link SourceAdapter}.
 */

/** The live Neon SQL client (`requireSQL()` from `@/lib/db`). */
export type SQL = NeonQueryFunction<false, false>;

/** Options passed to an adapter's `fetch()`. Extend per-adapter as needed. */
export interface FetchOpts {
  /**
   * ZIP codes to scope the fetch to. The reference backfill restricts this to
   * the three SE-Chicago ZIPs (60617, 60619, 60649); production syncs may pass
   * a wider set. Adapters that cannot filter by ZIP server-side should fetch
   * broadly and filter in `normalize()` (returning `null` to drop).
   */
  zips: string[];
}

/**
 * Provenance written alongside every persisted row so downstream features can
 * trust, age out, and re-derive data.
 *
 * - `source`     — stable identifier of the upstream dataset (matches the
 *                  adapter's {@link SourceAdapter.sourceKey}).
 * - `fetched_at` — when the row was retrieved. Omit to let the column default
 *                  to `NOW()` at insert time.
 * - `raw_json`   — the untouched upstream record, so normalization can be
 *                  replayed without re-fetching. Persist as JSONB.
 */
export interface Provenance {
  source: string;
  fetched_at?: string;
  raw_json: unknown;
}

/**
 * Summary of a single ingest run, returned by the runner and suitable for
 * logging or surfacing in a sync script's output.
 *
 * - `sourceKey` — the adapter that produced this result.
 * - `fetched`   — raw records returned by `fetch()`.
 * - `written`   — rows actually persisted (the sum of adapter `upsert()`
 *                 return values; an upsert that updates an existing row still
 *                 counts as written).
 * - `skipped`   — raw records dropped by `normalize()` (returned `null`).
 * - `errors`    — human-readable error strings; a run can partially succeed.
 */
export interface IngestResult {
  sourceKey: string;
  fetched: number;
  written: number;
  skipped: number;
  errors: string[];
}

/**
 * A source adapter: the unit of work each domain agent implements.
 *
 * @typeParam TRaw - shape of a single raw upstream record (e.g. an ArcGIS
 *                   feature attribute bag or a Socrata row).
 * @typeParam TRow - shape of a normalized, DB-ready row. Should carry its own
 *                   {@link Provenance} so `upsert()` can persist it.
 *
 * Lifecycle (driven by `runIngest` in `./run.ts`):
 *   1. `fetch(opts)`        → `TRaw[]`
 *   2. `normalize(raw)`     → `TRow | null`  (called per record; `null` drops)
 *   3. `upsert(sql, rows)`  → number written
 *
 * Implementations MUST be idempotent: re-running an ingest over the same data
 * must not duplicate rows (use `ON CONFLICT` keyed on a stable identifier).
 * Adapters own their SQL — the runner never writes to the DB itself.
 */
export interface SourceAdapter<TRaw, TRow> {
  /**
   * Stable, unique key for this source (e.g. `"parcels"`,
   * `"ownership_history"`). Used as the provenance `source` value and in
   * {@link IngestResult}. Treat as an API: never rename once adapters/data
   * depend on it.
   */
  sourceKey: string;

  /**
   * Name of the primary table this adapter writes to. Documentary/coordination
   * value (lets the registry and tooling know the target without reading the
   * `upsert` body). An adapter may write to secondary tables inside `upsert()`
   * (e.g. parcels also append to `parcel_valuations`).
   */
  targetTable: string;

  /**
   * Retrieve raw records from the upstream source, scoped by `opts`.
   * Should be resilient (retry/timeout) but may throw on total failure — the
   * runner records the error and returns an empty-ish {@link IngestResult}.
   */
  fetch(opts: FetchOpts): Promise<TRaw[]>;

  /**
   * Convert one raw record into a DB-ready row, or return `null` to drop it
   * (out of bounds, missing key, junk coordinates, etc.). Pure and
   * side-effect-free so it can be unit-tested without a DB or network.
   */
  normalize(raw: TRaw): TRow | null;

  /**
   * Persist normalized rows. MUST use `ON CONFLICT` for idempotency. Returns
   * the number of rows written to the primary table. The runner passes the
   * shared SQL client so adapters never construct their own.
   */
  upsert(sql: SQL, rows: TRow[]): Promise<number>;
}
