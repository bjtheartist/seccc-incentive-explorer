#!/usr/bin/env npx tsx
/**
 * scripts/archive-zoning-snapshot.ts — Permit History Exhibit, "Archive"
 * (rides with PR 1 per the master spec).
 *
 * S3 of the exhibit states an honest limit: "District boundaries in effect
 * at each permit's issue date are not yet reconstructable from this tool."
 * This script is the FIRST step toward that becoming untrue over time — it
 * does not reconstruct history itself, it starts DATING what the app has
 * already seen so a future PR can.
 *
 * ── What it archives, and why THIS source ──
 *
 * It reads `data/curated/zoning/zoning-map-snapshot.json` — the citywide
 * zoning-boundary snapshot the EXISTING `.github/workflows/zoning-source-
 * refresh.yml` workflow already fetches daily via `npm run
 * data:sync:zoning` (scripts/sync-zoning-sources.ts). Reusing that file
 * means this script makes ZERO new City API calls; it only dates and
 * hashes what the app already pulled. (This is an attribute/geometry
 * FINGERPRINT snapshot, not a full-geometry GeoJSON export — the codebase's
 * only full-geometry zoning pull, lib/zoning-snapshot.ts /
 * scripts/fetch-zoning-snapshot.ts, is deliberately clipped to nine pilot
 * ZIPs and is not a citywide source. Archiving the citywide fingerprint
 * file is the honest choice available today; do not backfill what we
 * don't have.)
 *
 * ── The size judgment call (spec: "judge by actual file size") ──
 *
 * Verified live in this repo on 2026-08-25: the current snapshot is
 * ~8.98 MB, over the spec's 5 MB threshold. Two more reasons beyond the
 * literal threshold argue against ever inlining it whole into this
 * archive: (1) it changes daily whenever the City edits a polygon, so a
 * "full" mode here would commit an ~9 MB blob to git history on every
 * change, and (2) `data/curated/zoning/zoning-map-snapshot.json` ITSELF is
 * already the full, git-tracked, dated-by-commit snapshot — archiving it
 * again duplicates data already sitting in version control. So this script
 * runs in **hash_manifest** mode at today's size: it writes a small dated
 * manifest (sha256, size, feature count, and the day's added/removed/
 * changed counts already computed by the existing sync's delta file) to
 * `data/archive/zoning/{date}.manifest.json`, and records the entry in
 * `data/archive/zoning/index.json`. The full content for any given date
 * remains recoverable from that date's commit to
 * `data/curated/zoning/zoning-map-snapshot.json` and from that CI run's
 * own artifacts — never duplicated here. Below the 5 MB threshold (should
 * a future source be smaller, or a differently-scoped snapshot replace
 * this one) the script switches to **full** mode automatically and writes
 * `data/archive/zoning/{date}.geojson.gz`.
 *
 * `lib/permit-exhibit.ts`'s S3 boundary context reads ONLY
 * `index.json`'s vintage range (earliest/latest dated snapshot) to state
 * what archive coverage exists — it never reads a manifest or full
 * snapshot file directly, and a missing/unreadable index degrades to an
 * honest null range rather than failing the exhibit build.
 *
 * No database access. No destructive operation — this script only reads
 * already-committed local files and writes new ones under
 * data/archive/zoning/.
 *
 * Usage: npx tsx scripts/archive-zoning-snapshot.ts
 * Wired into: .github/workflows/zoning-source-refresh.yml (runs only when
 * that workflow's own change-detection step found a real source change).
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const REPO_ROOT = process.cwd();
const CURATED_SNAPSHOT_PATH = path.join(
  REPO_ROOT,
  "data",
  "curated",
  "zoning",
  "zoning-map-snapshot.json",
);
const CURATED_DELTA_PATH = path.join(
  REPO_ROOT,
  "data",
  "curated",
  "zoning",
  "zoning-map-latest-delta.json",
);
const ARCHIVE_DIR = path.join(REPO_ROOT, "data", "archive", "zoning");
const ARCHIVE_INDEX_PATH = path.join(ARCHIVE_DIR, "index.json");

/** Spec's explicit rule: above this, archive a dated hash + diff summary
 *  only, never the full content. */
export const FULL_ARCHIVE_SIZE_THRESHOLD_BYTES = 5 * 1024 * 1024;

export type ArchiveSnapshotMode = "full" | "hash_manifest";

export interface ArchiveIndexChangeCounts {
  added: number;
  removed: number;
  attributesChanged: number;
  geometryChanged: number;
}

export interface ArchiveIndexEntry {
  date: string;
  vintage: string | null;
  mode: ArchiveSnapshotMode;
  sha256: string;
  sizeBytes: number;
  featureCount: number | null;
  changeCounts: ArchiveIndexChangeCounts | null;
  /** Repo-relative path to the manifest/full-archive file, or null when
   *  neither was written (a duplicate-content run — see `main()`). */
  archivePath: string | null;
  note: string;
}

export interface ArchiveIndex {
  schemaVersion: 1;
  snapshots: ArchiveIndexEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadIndex(): Promise<ArchiveIndex> {
  const parsed = await readJson(ARCHIVE_INDEX_PATH);
  if (isRecord(parsed) && Array.isArray(parsed.snapshots)) {
    return { schemaVersion: 1, snapshots: parsed.snapshots as ArchiveIndexEntry[] };
  }
  return { schemaVersion: 1, snapshots: [] };
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function main() {
  let raw: string;
  try {
    raw = await readFile(CURATED_SNAPSHOT_PATH, "utf8");
  } catch (err) {
    console.error(
      `[archive-zoning-snapshot] could not read ${CURATED_SNAPSHOT_PATH}. Run "npm run data:sync:zoning" first. (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    process.exit(1);
    return;
  }

  const sizeBytes = Buffer.byteLength(raw, "utf8");
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const parsed: unknown = JSON.parse(raw);

  const vintage =
    isRecord(parsed) &&
    isRecord(parsed.source) &&
    typeof parsed.source.sourceUpdatedThrough === "string"
      ? parsed.source.sourceUpdatedThrough
      : null;
  const featureCount =
    isRecord(parsed) && typeof parsed.featureCount === "number" ? parsed.featureCount : null;

  const delta = await readJson(CURATED_DELTA_PATH);
  const changeCounts: ArchiveIndexChangeCounts | null =
    isRecord(delta) && isRecord(delta.counts)
      ? {
          added: Number(delta.counts.added) || 0,
          removed: Number(delta.counts.removed) || 0,
          attributesChanged: Number(delta.counts.attributesChanged) || 0,
          geometryChanged: Number(delta.counts.geometryChanged) || 0,
        }
      : null;

  const date = new Date().toISOString().slice(0, 10);
  await mkdir(ARCHIVE_DIR, { recursive: true });

  const index = await loadIndex();
  if (index.snapshots.some((entry) => entry.sha256 === sha256)) {
    console.log(
      `[archive-zoning-snapshot] content unchanged since the last archived snapshot ` +
        `(sha256 ${sha256.slice(0, 12)}…) — nothing to archive.`,
    );
    return;
  }

  let mode: ArchiveSnapshotMode;
  let archivePath: string | null;
  let note: string;

  if (sizeBytes <= FULL_ARCHIVE_SIZE_THRESHOLD_BYTES) {
    mode = "full";
    const fileName = `${date}.geojson.gz`;
    await writeFile(path.join(ARCHIVE_DIR, fileName), gzipSync(Buffer.from(raw, "utf8")));
    archivePath = path.posix.join("data", "archive", "zoning", fileName);
    note = `Full snapshot archived (${megabytes(sizeBytes)}, at or under the ${megabytes(
      FULL_ARCHIVE_SIZE_THRESHOLD_BYTES,
    )} threshold).`;
  } else {
    mode = "hash_manifest";
    const fileName = `${date}.manifest.json`;
    const manifest = {
      date,
      vintage,
      sourceUrl: isRecord(parsed) && isRecord(parsed.source) ? (parsed.source.url ?? null) : null,
      sha256,
      sizeBytes,
      featureCount,
      changeCounts,
    };
    await writeFile(path.join(ARCHIVE_DIR, fileName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    archivePath = path.posix.join("data", "archive", "zoning", fileName);
    note =
      `Full snapshot is ${megabytes(sizeBytes)}, over the ${megabytes(
        FULL_ARCHIVE_SIZE_THRESHOLD_BYTES,
      )} inline-archive threshold — stored as a dated hash + diff-summary manifest only. ` +
      "The full content for this date lives in the zoning-source-refresh workflow's committed " +
      "data/curated/zoning/zoning-map-snapshot.json at this commit, and in that CI run's own artifacts; " +
      "it is not duplicated into this archive.";
  }

  index.snapshots.push({
    date,
    vintage,
    mode,
    sha256,
    sizeBytes,
    featureCount,
    changeCounts,
    archivePath,
    note,
  });
  index.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  await writeFile(ARCHIVE_INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  console.log(
    `[archive-zoning-snapshot] ${mode === "full" ? "archived full snapshot" : "archived hash manifest"} ` +
      `for ${date} (vintage ${vintage ?? "unknown"}, ${megabytes(sizeBytes)}, ${featureCount ?? "?"} features).`,
  );
}

main().catch((err) => {
  console.error("[archive-zoning-snapshot] failed:", err);
  process.exit(1);
});
