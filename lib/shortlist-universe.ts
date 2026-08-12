import "server-only";

/**
 * Server-only loader for the Site Shortlist canonical universe files
 * (data/exports/shortlist-universe/<zip>.json + manifest.json) — the
 * complete, deduped, zoning-resolved data foundation PR1 ships. PR2 wires
 * the engine that consumes this; this loader exists now so the bundling
 * contract (next.config.ts outputFileTracingIncludes) can be proven in a
 * production build before any consumer exists.
 *
 * Contract (per the gpt5.6 matchmaker consult, Q1):
 *   - Files live OUTSIDE public/ (data/exports/, server-only-imported) —
 *     public/ is publicly downloadable and would leak the address-level
 *     universe.
 *   - Every file carries a strict versioned envelope, validated at
 *     runtime (zod) — a malformed or stale file must never render as an
 *     empty/wrong result.
 *   - Every per-ZIP file's `buildId` must match the shared manifest's
 *     `buildId` — a mismatch (a half-regenerated universe, or a manifest
 *     from a different run) fails closed rather than mixing snapshots.
 *
 * Fail-closed: every failure mode returns a typed `{ ok: false, reason }`
 * result rather than throwing or silently returning an empty universe.
 * Callers render an explicit "temporarily unavailable" state on `!ok`,
 * never a false "zero sites match" — the exact false-zero this overhaul
 * exists to fix.
 *
 * The envelope schema/types/validateEnvelopeCounts live in the sibling
 * lib/shortlist-universe-schema.ts (no "server-only", no fs) so
 * scripts/export-shortlist-universe.ts — a plain Node/tsx script, not run
 * through Next's bundler — can validate against the exact same schema
 * without hitting "server-only"'s unconditional throw. Re-exported here so
 * existing imports of `lib/shortlist-universe` keep working unchanged.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ShortlistUniverseFileSchema,
  ShortlistUniverseManifestSchema,
  type ShortlistUniverseFile,
  type ShortlistUniverseManifest,
} from "./shortlist-universe-schema";

export {
  RANKING_INPUTS_VERSION,
  SHORTLIST_UNIVERSE_SCHEMA_VERSION,
  ShortlistUniverseFileSchema,
  ShortlistUniverseManifestSchema,
  ShortlistUniverseRowSchema,
  validateEnvelopeCounts,
  type ShortlistUniverseFile,
  type ShortlistUniverseManifest,
  type ShortlistUniverseRow,
} from "./shortlist-universe-schema";

const DATA_DIR = path.join(process.cwd(), "data", "exports", "shortlist-universe");

// Test-only override so unit tests can point the loader at an isolated
// temp directory instead of the real (production) data/exports path —
// never mutated outside __setShortlistUniverseDataDirForTests.
let dataDirOverride: string | null = null;

function resolvedDataDir(): string {
  return dataDirOverride ?? DATA_DIR;
}

// ── Fail-closed load result ─────────────────────────────────────────────────

export type ShortlistUniverseLoadFailureReason =
  | "manifest_missing"
  | "manifest_invalid_schema"
  | "manifest_zip_missing"
  | "file_missing"
  | "file_invalid_json"
  | "file_invalid_schema"
  | "zip_mismatch"
  | "build_id_mismatch";

export type ShortlistUniverseLoadResult =
  | { ok: true; data: ShortlistUniverseFile }
  | { ok: false; reason: ShortlistUniverseLoadFailureReason; detail?: string };

// Module-level caches, read once per process. `undefined` = not attempted;
// `null` = attempted and unavailable (a legitimate pre-export-run state).
let manifestCache: ShortlistUniverseManifest | null | undefined = undefined;
const fileCache = new Map<string, ShortlistUniverseLoadResult>();

/** Load and validate the shared manifest. Returns `null` on any failure
 * (missing file, bad JSON, schema violation) — never throws. */
export function loadShortlistUniverseManifest(): ShortlistUniverseManifest | null {
  if (manifestCache !== undefined) return manifestCache;

  const manifestPath = path.join(resolvedDataDir(), "manifest.json");
  try {
    if (!existsSync(manifestPath)) {
      manifestCache = null;
      return manifestCache;
    }
    const raw = readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const result = ShortlistUniverseManifestSchema.safeParse(parsed);
    manifestCache = result.success ? result.data : null;
  } catch {
    manifestCache = null;
  }
  return manifestCache;
}

/**
 * Load ONE ZIP's universe file, validated against the schema and asserted
 * to match the manifest's buildId. Fail-closed on every mismatch — a
 * caller that only checks `.ok` and renders "temporarily unavailable" on
 * `false` can never accidentally render a stale, half-regenerated, or
 * wrong-ZIP universe as if it were a genuine (possibly empty) result.
 */
export function loadShortlistUniverse(zip: string): ShortlistUniverseLoadResult {
  const cached = fileCache.get(zip);
  if (cached) return cached;

  const result = loadShortlistUniverseUncached(zip);
  fileCache.set(zip, result);
  return result;
}

function loadShortlistUniverseUncached(zip: string): ShortlistUniverseLoadResult {
  const manifest = loadShortlistUniverseManifest();
  if (!manifest) return { ok: false, reason: "manifest_missing" };
  if (!manifest.files[zip]) return { ok: false, reason: "manifest_zip_missing", detail: zip };

  const filePath = path.join(resolvedDataDir(), `${zip}.json`);
  if (!existsSync(filePath)) return { ok: false, reason: "file_missing", detail: filePath };

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    return { ok: false, reason: "file_missing", detail: err instanceof Error ? err.message : String(err) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: "file_invalid_json", detail: err instanceof Error ? err.message : String(err) };
  }

  const validated = ShortlistUniverseFileSchema.safeParse(parsed);
  if (!validated.success) {
    return { ok: false, reason: "file_invalid_schema", detail: validated.error.message };
  }

  const data = validated.data;
  if (data.zip !== zip) {
    return { ok: false, reason: "zip_mismatch", detail: `file zip "${data.zip}" !== requested "${zip}"` };
  }
  if (data.buildId !== manifest.buildId) {
    return {
      ok: false,
      reason: "build_id_mismatch",
      detail: `file buildId "${data.buildId}" !== manifest buildId "${manifest.buildId}"`,
    };
  }

  return { ok: true, data };
}

/** Test-only: reset both module caches so tests can re-read files after
 * mutating fixtures (mirrors lib/owner-cluster-geo.ts's reset convention). */
export function __resetShortlistUniverseCacheForTests(): void {
  manifestCache = undefined;
  fileCache.clear();
}

/** Test-only: point the loader at an isolated directory (e.g. an
 * mkdtempSync temp dir) instead of the real data/exports/shortlist-universe
 * path, so fail-closed tests can write malformed fixtures without ever
 * touching the real (committed, production) universe files. Pass `null` to
 * restore the real path. Always call `__resetShortlistUniverseCacheForTests`
 * after switching so stale cached reads from the previous directory don't
 * leak across tests. */
export function __setShortlistUniverseDataDirForTests(dir: string | null): void {
  dataDirOverride = dir;
}
