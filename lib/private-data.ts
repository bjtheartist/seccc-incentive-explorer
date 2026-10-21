import "server-only";

import path from "node:path";
import { readFile } from "node:fs/promises";

import manifest from "@/data/private-manifest.json";

/**
 * The single read path for data/private/*.json.
 *
 * BACKGROUND. Those files are committed, gated, and server-only (see
 * data/private/README.md — never public/). They used to be read straight off
 * disk with `readFileSync(path.join(process.cwd(), "data/private/<name>.json"))`
 * and declared in next.config.ts's `outputFileTracingIncludes`, which meant Next
 * copied ~48MB of JSON into the serverless function bundle of every route that
 * touched them, on every deployment. That is what took Vercel Functions Storage
 * for this project to 20GB.
 *
 * next.config.ts now EXCLUDES `./data/private/**` from tracing instead, and this
 * module resolves the same bytes two ways:
 *
 *   1. LOCAL FILE, when data/private/<filename> is on disk. That is dev, the
 *      test suite, CI, and any script — the files are in the repo, so nothing
 *      about local behaviour changes and no network call happens.
 *   2. PRIVATE VERCEL BLOB, when it is not. scripts/sync-private-data.mjs
 *      uploads each file to a content-addressed pathname and commits
 *      data/private-manifest.json naming it; the deployed function reads the
 *      blob by that pathname.
 *
 * A miss on BOTH is reported, never thrown, so every caller's "the export has
 * not been generated yet" fallback keeps working unchanged.
 *
 * `readPrivateText` keeps MISSING and UNREADABLE apart, because
 * lib/community-investment.ts's four-way failure taxonomy depends on the
 * difference ("this has not been generated yet" is a very different thing to
 * tell a reader than "we could not read it"). `loadPrivateJson` is the simple
 * null-or-data wrapper the other four loaders want.
 *
 * The path in (1) is assembled from a parameter (`path.join(cwd, "data",
 * "private", filename)`), not a static string literal, so there is no literal
 * for tracing to follow back into the bundle even if the exclude were dropped.
 */

type ManifestEntry = { pathname: string; sha256: string; bytes: number };

const MANIFEST_FILES = (manifest as { files: Record<string, ManifestEntry> }).files;

export type PrivateReadResult =
  | { ok: true; text: string; source: "local" | "blob" }
  /** Neither on disk nor resolvable from the blob store — the "not generated yet" state. */
  | { ok: false; reason: "missing" }
  /** Present but the read failed (permissions, a truncated stream, a store error). */
  | { ok: false; reason: "unreadable"; detail: string };

/**
 * Per-filename promise cache. Keyed by filename, so a warm function instance
 * reads each file exactly once — the same once-per-process behaviour the module
 * caches in the five loaders used to provide, minus the risk of two concurrent
 * requests both paying for a 42MB download.
 *
 * The promise is cached even when it settles to a failure: a missing export
 * stays missing for the life of the process, exactly as before.
 */
const cache = new Map<string, Promise<PrivateReadResult>>();

/** Warn once per filename, so a missing export cannot flood the logs. */
const warned = new Set<string>();

function warnOnce(filename: string, message: string): void {
  if (warned.has(filename)) return;
  warned.add(filename);
  console.warn(`[private-data] ${filename}: ${message}`);
}

type LocalRead =
  | { kind: "ok"; text: string }
  | { kind: "absent" }
  | { kind: "error"; detail: string };

async function readLocal(filename: string): Promise<LocalRead> {
  // Assembled from segments + a parameter on purpose — see the module comment.
  const filePath = path.join(process.cwd(), "data", "private", filename);
  try {
    return { kind: "ok", text: await readFile(filePath, "utf8") };
  } catch (err) {
    // ENOENT is the ordinary "not on disk here, try the blob" case; anything
    // else is a real read failure that the caller may want to name.
    if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") return { kind: "absent" };
    return { kind: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

async function readBlob(filename: string): Promise<string | null> {
  const entry = MANIFEST_FILES[filename];
  if (!entry) {
    warnOnce(filename, "not on disk and not named in data/private-manifest.json");
    return null;
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    warnOnce(
      filename,
      "not on disk and BLOB_READ_WRITE_TOKEN is unset — the dataset will read as unavailable",
    );
    return null;
  }

  try {
    const { get } = await import("@vercel/blob");
    const result = await get(entry.pathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      warnOnce(filename, `blob ${entry.pathname} returned no body`);
      return null;
    }
    return await new Response(result.stream).text();
  } catch (err) {
    warnOnce(filename, `blob read of ${entry.pathname} failed: ${String(err)}`);
    return null;
  }
}

async function readUncached(filename: string): Promise<PrivateReadResult> {
  const local = await readLocal(filename);
  if (local.kind === "ok") return { ok: true, text: local.text, source: "local" };

  const blob = await readBlob(filename);
  if (blob !== null) return { ok: true, text: blob, source: "blob" };

  if (local.kind === "error") {
    warnOnce(filename, `local read failed and the blob did not answer: ${local.detail}`);
    return { ok: false, reason: "unreadable", detail: local.detail };
  }
  return { ok: false, reason: "missing" };
}

/**
 * Read one file out of data/private as text — from disk when it is there, from
 * the private blob store when it is not. Never throws. Memoized per filename.
 */
export function readPrivateText(filename: string): Promise<PrivateReadResult> {
  const hit = cache.get(filename);
  if (hit) return hit;
  const pending = readUncached(filename);
  cache.set(filename, pending);
  return pending;
}

/**
 * Read + parse one file out of data/private. Returns `null` (never throws) when
 * the file cannot be resolved or is not valid JSON — the same answer the old
 * `existsSync` guard + try/catch gave every caller.
 */
export async function loadPrivateJson<T>(filename: string): Promise<T | null> {
  const result = await readPrivateText(filename);
  if (!result.ok) return null;
  try {
    return JSON.parse(result.text) as T;
  } catch (err) {
    warnOnce(filename, `JSON parse failed: ${String(err)}`);
    return null;
  }
}

/** Test-only: drop the memoized reads so a test can re-read after mutating disk. */
export function __resetPrivateDataCacheForTests(): void {
  cache.clear();
  warned.clear();
}
