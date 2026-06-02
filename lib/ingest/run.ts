import { requireSQL } from "@/lib/db";
import type { FetchOpts, IngestResult, SourceAdapter } from "./types";

/**
 * Generic ingest runner: fetch → normalize (drop nulls) → upsert.
 * Records errors without aborting so a run can partially succeed.
 */
export async function runIngest<TRaw, TRow>(
  adapter: SourceAdapter<TRaw, TRow>,
  opts: FetchOpts
): Promise<IngestResult> {
  const sql = requireSQL();
  const result: IngestResult = {
    sourceKey: adapter.sourceKey,
    fetched: 0,
    written: 0,
    skipped: 0,
    errors: [],
  };

  let raw: TRaw[] = [];
  try {
    raw = await adapter.fetch(opts);
  } catch (err) {
    result.errors.push(`fetch: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }
  result.fetched = raw.length;

  const rows: TRow[] = [];
  for (const r of raw) {
    const row = adapter.normalize(r);
    if (row === null) result.skipped++;
    else rows.push(row);
  }

  try {
    result.written = await adapter.upsert(sql, rows);
  } catch (err) {
    result.errors.push(`upsert: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}
