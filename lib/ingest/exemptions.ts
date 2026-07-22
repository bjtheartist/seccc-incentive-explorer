import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Database from "better-sqlite3";
import { batchPins, toDigitsOnlyPin } from "./pin-batch";
import type { FetchOpts, Provenance, SourceAdapter, SQL } from "./types";

/**
 * PTAXSIM exemption adapter — the EXEMPTION ANOMALY overlay's data source.
 *
 * PTAXSIM is the Cook County Assessor data team's public SQLite artifact
 * (github.com/ccao-data/ptaxsim). Its `pin` table holds one row per 14-digit
 * PIN per tax year (2006–2024) with the exemption EAV amounts for every
 * occupancy-premised homestead exemption. We take the LATEST tax year in the DB
 * (the exemption data lags — 2024 as of this pin), scoped to `opts.pins` (the
 * vacant-parcel footprint), and consolidate the veteran columns into one
 * `exe_vet`.
 *
 * ── Framing (governance) ──────────────────────────────────────────────────
 * An occupancy exemption still attached to a vacant parcel is a RECORD ANOMALY
 * warranting official review — a vacant lot cannot be a principal residence.
 * This adapter never asserts fraud, intent, death, or wrongdoing; it only
 * mirrors the Assessor's own published EAV amounts.
 *
 * ── This is an INGEST-ONLY module ─────────────────────────────────────────
 * `better-sqlite3` is a native dependency imported HERE ONLY. Nothing under
 * app/ or the runtime lib/ surface may import this file — it would drag the
 * native binary into the Next bundle. Only scripts/sync-exemptions.ts imports
 * it. The pure anomaly aggregation lives in lib/vacancy-index.ts (DB-free).
 *
 * ── Download → decompress → query, ONCE ───────────────────────────────────
 * The version-pinned .db.bz2 (hundreds of MB compressed) downloads to a cache
 * dir, decompresses via the system `bunzip2` (streaming), and is opened
 * read-only. A cached decompressed .db is reused (skip download). Overrides:
 *   • PTAXSIM_DB_PATH   — an already-decompressed .db to use verbatim (skips
 *                          download + decompress entirely).
 *   • PTAXSIM_CACHE_DIR — where the .db.bz2/.db live (default: os tmpdir).
 * Any download / decompress / open / query failure THROWS — the overlay must
 * degrade to "not yet available" upstream, never to a fabricated zero.
 */

const SOURCE_KEY = "ptaxsim_exemptions";

/** Version-pinned PTAXSIM release. Verified 2026-07-22 against the ptaxsim
 * README (raw, master) and data-raw/create_db.sql schema. Bump deliberately. */
export const PTAXSIM_VERSION = "2024.0.0";
export const PTAXSIM_DB_URL = `https://ccao-data-public-us-east-1.s3.amazonaws.com/ptaxsim/ptaxsim-${PTAXSIM_VERSION}.db.bz2`;

/** The PTAXSIM `pin`-table exemption columns we read (verified against
 * data-raw/create_db.sql). All are non-null integer EAV amounts. The six
 * veteran-related columns collapse into a single exe_vet at normalize time. */
const VET_COLUMNS = [
  "exe_vet_returning",
  "exe_vet_dis_lt50",
  "exe_vet_dis_50_69",
  "exe_vet_dis_ge70",
  "exe_vet_dis_100",
  "exe_wwii",
] as const;

const SELECT_COLUMNS = [
  "pin",
  "year",
  "exe_homeowner",
  "exe_senior",
  "exe_freeze",
  "exe_disabled",
  "exe_longtime_homeowner",
  ...VET_COLUMNS,
] as const;

/** One raw PTAXSIM `pin`-table row (the columns we SELECT). */
export interface RawExemptionRow {
  pin: string;
  year: number;
  exe_homeowner: number | null;
  exe_senior: number | null;
  exe_freeze: number | null;
  exe_disabled: number | null;
  exe_longtime_homeowner: number | null;
  exe_vet_returning: number | null;
  exe_vet_dis_lt50: number | null;
  exe_vet_dis_50_69: number | null;
  exe_vet_dis_ge70: number | null;
  exe_vet_dis_100: number | null;
  exe_wwii: number | null;
}

/** Normalized, DB-ready parcel_exemptions row (vet columns consolidated). */
export interface ExemptionRow {
  pin: string;
  taxYear: number;
  exeHomeowner: number;
  exeSenior: number;
  exeFreeze: number;
  exeDisabled: number;
  exeVet: number;
  exeLongtime: number;
  provenance: Provenance;
}

/** Sum the six veteran-related EAV columns into one exe_vet. Null-safe. */
export function consolidateVetExemption(raw: RawExemptionRow): number {
  return VET_COLUMNS.reduce((sum, col) => sum + num(raw[col]), 0);
}

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Cache dir for the PTAXSIM artifact (override with PTAXSIM_CACHE_DIR). */
function cacheDir(): string {
  return process.env.PTAXSIM_CACHE_DIR || join(tmpdir(), "ptaxsim-cache");
}

/**
 * Resolve a local, decompressed PTAXSIM .db path, downloading + decompressing
 * once if needed. Loud logging at each step; throws on any failure.
 */
async function ensureLocalDb(): Promise<string> {
  // Explicit override: use a pre-decompressed .db verbatim.
  const override = process.env.PTAXSIM_DB_PATH;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`PTAXSIM_DB_PATH is set to "${override}" but that file does not exist`);
    }
    console.log(`  [ptaxsim] using PTAXSIM_DB_PATH override: ${override}`);
    return override;
  }

  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  const bz2Path = join(dir, `ptaxsim-${PTAXSIM_VERSION}.db.bz2`);
  const dbPath = join(dir, `ptaxsim-${PTAXSIM_VERSION}.db`);

  if (existsSync(dbPath) && statSync(dbPath).size > 0) {
    console.log(`  [ptaxsim] reusing cached decompressed db: ${dbPath}`);
    return dbPath;
  }

  // Download the .bz2 if not already present.
  if (!existsSync(bz2Path) || statSync(bz2Path).size === 0) {
    console.log(`  [ptaxsim] downloading ${PTAXSIM_DB_URL}`);
    const res = await fetch(PTAXSIM_DB_URL, { signal: AbortSignal.timeout(30 * 60_000) });
    if (!res.ok || !res.body) {
      throw new Error(`PTAXSIM download failed: HTTP ${res.status} ${res.statusText}`);
    }
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(bz2Path));
    console.log(`  [ptaxsim] downloaded ${statSync(bz2Path).size.toLocaleString("en-US")} bytes to ${bz2Path}`);
  } else {
    console.log(`  [ptaxsim] reusing cached compressed db: ${bz2Path}`);
  }

  // Decompress via system bunzip2 (streaming, keep the .bz2 so a re-run can
  // skip the download). -k keep, -f force overwrite of a partial .db.
  console.log(`  [ptaxsim] decompressing to ${dbPath} (bunzip2)...`);
  const result = spawnSync("bunzip2", ["-k", "-f", bz2Path], { stdio: "inherit" });
  if (result.error) {
    throw new Error(
      `PTAXSIM decompress failed to launch bunzip2 (${result.error.message}). Install bzip2 or set PTAXSIM_DB_PATH to a pre-decompressed .db.`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`PTAXSIM decompress (bunzip2) exited with status ${result.status}`);
  }
  if (!existsSync(dbPath) || statSync(dbPath).size === 0) {
    throw new Error(`PTAXSIM decompress produced no usable db at ${dbPath}`);
  }
  console.log(`  [ptaxsim] decompressed ${statSync(dbPath).size.toLocaleString("en-US")} bytes`);
  return dbPath;
}

export const exemptionsAdapter: SourceAdapter<RawExemptionRow, ExemptionRow> = {
  sourceKey: SOURCE_KEY,
  targetTable: "parcel_exemptions",

  async fetch(opts: FetchOpts): Promise<RawExemptionRow[]> {
    const pins = (opts.pins ?? []).map(toDigitsOnlyPin).filter((p) => p.length > 0);
    if (pins.length === 0) {
      // PIN scoping is REQUIRED — an unscoped pull would ingest the whole county
      // and blow up the branch table. This is a programming error, so throw.
      throw new Error(
        "exemptionsAdapter.fetch requires opts.pins (the vacant-parcel footprint) — refusing an unscoped county-wide read",
      );
    }

    const dbPath = await ensureLocalDb();
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const maxYearRow = db.prepare("SELECT MAX(year) AS y FROM pin").get() as { y: number | null };
      const maxYear = maxYearRow?.y;
      if (maxYear == null) throw new Error("PTAXSIM pin table has no rows (MAX(year) is null)");
      console.log(`  [ptaxsim] querying exemptions for ${pins.length} pins at tax year ${maxYear}`);

      const cols = SELECT_COLUMNS.join(", ");
      const out: RawExemptionRow[] = [];
      // Batch under the SQLite bound-parameter ceiling (default 999; leave head-
      // room for the year param).
      for (const batch of batchPins(pins, 900)) {
        const placeholders = batch.map(() => "?").join(",");
        const stmt = db.prepare(
          `SELECT ${cols} FROM pin WHERE year = ? AND pin IN (${placeholders})`,
        );
        const rows = stmt.all(maxYear, ...batch) as RawExemptionRow[];
        out.push(...rows);
      }
      console.log(`  [ptaxsim] fetched ${out.length} exemption rows`);
      return out;
    } finally {
      db.close();
    }
  },

  normalize(raw: RawExemptionRow): ExemptionRow | null {
    const pin = toDigitsOnlyPin(raw.pin ?? "");
    if (pin.length !== 14) return null;
    const taxYear = Number(raw.year);
    if (!Number.isFinite(taxYear)) return null;
    return {
      pin,
      taxYear: Math.trunc(taxYear),
      exeHomeowner: num(raw.exe_homeowner),
      exeSenior: num(raw.exe_senior),
      exeFreeze: num(raw.exe_freeze),
      exeDisabled: num(raw.exe_disabled),
      exeVet: consolidateVetExemption(raw),
      exeLongtime: num(raw.exe_longtime_homeowner),
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  async upsert(sql: SQL, rows: ExemptionRow[]): Promise<number> {
    // Batched multi-row upsert via parallel arrays + unnest: ~300 round-trips
    // for a full county-scoped sync instead of one per row. A transient
    // connection failure retries once per batch, then THROWS — a partial
    // write must fail the sync loudly, never summarize into exit 0.
    const BATCH = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const pins = batch.map((r) => r.pin);
      const years = batch.map((r) => r.taxYear);
      const homeowner = batch.map((r) => r.exeHomeowner);
      const senior = batch.map((r) => r.exeSenior);
      const freeze = batch.map((r) => r.exeFreeze);
      const disabled = batch.map((r) => r.exeDisabled);
      const vet = batch.map((r) => r.exeVet);
      const longtime = batch.map((r) => r.exeLongtime);
      const source = batch.map((r) => r.provenance.source);
      const run = () => sql`
        INSERT INTO parcel_exemptions (
          pin, tax_year, exe_homeowner, exe_senior, exe_freeze,
          exe_disabled, exe_vet, exe_longtime, source, fetched_at
        )
        SELECT * FROM unnest(
          ${pins}::text[], ${years}::int[], ${homeowner}::numeric[], ${senior}::numeric[],
          ${freeze}::numeric[], ${disabled}::numeric[], ${vet}::numeric[], ${longtime}::numeric[],
          ${source}::text[]
        ) AS t(pin, tax_year, exe_homeowner, exe_senior, exe_freeze, exe_disabled, exe_vet, exe_longtime, source),
        LATERAL (SELECT NOW()) AS n(fetched_at)
        ON CONFLICT (pin, tax_year) DO UPDATE SET
          exe_homeowner = EXCLUDED.exe_homeowner,
          exe_senior = EXCLUDED.exe_senior,
          exe_freeze = EXCLUDED.exe_freeze,
          exe_disabled = EXCLUDED.exe_disabled,
          exe_vet = EXCLUDED.exe_vet,
          exe_longtime = EXCLUDED.exe_longtime,
          source = EXCLUDED.source,
          fetched_at = NOW()
      `;
      try {
        await run();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await run(); // second failure propagates — loud, not summarized
      }
      written += batch.length;
      if (written % 20000 < BATCH) console.log(`  exemptions upserted ${written}/${rows.length}`);
    }
    return written;
  },
};

/** Test-only: the SHA-1 of the pinned URL, so a unit test can pin the version
 * without a network call (guards against an accidental URL/version drift). */
export function ptaxsimUrlFingerprint(): string {
  return createHash("sha1").update(PTAXSIM_DB_URL).digest("hex");
}
