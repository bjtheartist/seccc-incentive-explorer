/**
 * Deduplicate the COMMITTED per-ZIP vacancy directory files in place, and keep
 * `editions[zip].directoryCount` in the main export in step with them.
 *
 * Why this exists as its own script rather than a re-export: the repeat rows are
 * already on disk in public/data/vacancy-directory/{zip}.json, and collapsing
 * them is a PURE transform of those committed files — the same
 * `dedupeDirectoryRows` the export pipeline now runs before writing
 * (lib/vacancy-index.ts). Running the full `vacancy:index:export` instead would
 * need a live Neon branch and would rewrite every other figure in the export at
 * the same time, which is not what this fix is. Re-running the real export later
 * produces the same deduplicated rows because both paths call the same function.
 *
 *   npx tsx scripts/dedupe-vacancy-directory.ts          # write
 *   npx tsx scripts/dedupe-vacancy-directory.ts --check  # report only, exit 1 if dirty
 *
 * Integrity checks, all fatal:
 *   - every remaining row keeps a non-empty address
 *   - the surviving rows are exactly the first occurrence of each key, in the
 *     file's existing order (no reordering, no field rewriting)
 *   - the deduped set contains no repeat key
 *   - rows.length === the edition's directoryCount after the sync
 *   - the serialized file still carries no owner-identifying substring
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PILOT_ZIPS } from "../lib/pilot-zips";
import {
  dedupeDirectoryRows,
  directoryRowKey,
  type VacancyDirectoryFile,
  type VacancyIndexExport,
} from "../lib/vacancy-index";

const DIRECTORY_DIR = join(process.cwd(), "public", "data", "vacancy-directory");
const EXPORT_PATH = join(process.cwd(), "public", "data", "vacancy-index.json");

/** Same rail the export asserts before writing a public artifact. */
const FORBIDDEN_SUBSTRINGS = [
  "ownerName",
  "owner_name",
  "ownerMailingAddress",
  "owner_mailing_address",
  "taxpayer",
];

function fail(message: string): never {
  console.error(`\nFAILED: ${message}\n`);
  process.exit(1);
}

/**
 * Re-serialize matching the file already on disk. The committed artifacts are
 * minified with no trailing newline while the export writes them indented, so
 * picking one unconditionally would bury a few hundred dropped rows
 * inside a whole-file reformat diff. Style is read off the original text, never assumed.
 */
function serializeLike(original: string, value: unknown): string {
  const indented = original.startsWith("{\n");
  const trailingNewline = original.endsWith("\n");
  return JSON.stringify(value, null, indented ? 2 : undefined) + (trailingNewline ? "\n" : "");
}

function main() {
  const checkOnly = process.argv.includes("--check");

  if (!existsSync(EXPORT_PATH)) fail(`main export not found at ${EXPORT_PATH}`);
  const exportRaw = readFileSync(EXPORT_PATH, "utf8");
  const mainExport = JSON.parse(exportRaw) as VacancyIndexExport;

  let totalRemoved = 0;
  let filesChanged = 0;
  const countUpdates: { zip: string; from: number; to: number }[] = [];

  for (const entry of PILOT_ZIPS) {
    const zip = entry.zip;
    const filePath = join(DIRECTORY_DIR, `${zip}.json`);
    if (!existsSync(filePath)) {
      console.log(`  ${zip}: no directory file — skipped`);
      continue;
    }
    const fileRaw = readFileSync(filePath, "utf8");
    const file = JSON.parse(fileRaw) as VacancyDirectoryFile;
    const before = file.rows.length;
    const { rows, duplicateRowsRemoved } = dedupeDirectoryRows(file.rows);

    // ── Integrity: the transform only DROPS repeats. ──
    if (rows.length + duplicateRowsRemoved !== before) {
      fail(`${zip}: ${rows.length} kept + ${duplicateRowsRemoved} removed != ${before} input rows`);
    }
    const keys = new Set<string>();
    for (const row of rows) {
      if (typeof row.address !== "string" || row.address.trim().length === 0) {
        fail(`${zip}: a surviving row has no usable address`);
      }
      const key = directoryRowKey(row);
      if (keys.has(key)) fail(`${zip}: repeat key survived deduplication (${key})`);
      keys.add(key);
    }
    // Order and field values are untouched: the kept rows must be a subsequence
    // of the original array, matched by reference.
    let cursor = 0;
    for (const row of rows) {
      while (cursor < file.rows.length && file.rows[cursor] !== row) cursor += 1;
      if (cursor >= file.rows.length) fail(`${zip}: deduplication reordered or rewrote a row`);
      cursor += 1;
    }

    const existingRemoved = file.duplicateRowsRemoved ?? 0;
    const next: VacancyDirectoryFile = {
      ...file,
      rows,
      duplicateRowsRemoved: existingRemoved + duplicateRowsRemoved,
    };
    const serialized = serializeLike(fileRaw, next);
    const leaked = FORBIDDEN_SUBSTRINGS.filter((needle) => serialized.includes(needle));
    if (leaked.length > 0) fail(`${zip}: anonymization violation — ${leaked.join(", ")}`);

    const edition = mainExport.editions[zip];
    const countChanged = edition != null && edition.directoryCount !== rows.length;
    const fileChanged = duplicateRowsRemoved > 0 || file.duplicateRowsRemoved === undefined;

    console.log(
      `  ${zip} ${file.neighborhood}: ${before} rows -> ${rows.length}` +
        `${duplicateRowsRemoved > 0 ? ` (${duplicateRowsRemoved} repeats collapsed)` : " (no repeats)"}`,
    );

    if (fileChanged || countChanged) filesChanged += 1;
    totalRemoved += duplicateRowsRemoved;

    if (countChanged && edition) {
      countUpdates.push({ zip, from: edition.directoryCount, to: rows.length });
    }

    if (!checkOnly) {
      writeFileSync(filePath, serialized);
      if (edition) edition.directoryCount = rows.length;
      // The headline that names the directory must not fall out of step either.
      if (edition && edition.directoryCount !== rows.length) {
        fail(`${zip}: directoryCount ${edition.directoryCount} != rows ${rows.length}`);
      }
    }
  }

  for (const u of countUpdates) {
    console.log(`  ${u.zip}: directoryCount ${u.from} -> ${u.to}`);
  }

  if (checkOnly) {
    console.log(
      `\n${totalRemoved} repeat rows across ${filesChanged} file(s) — ${
        totalRemoved === 0 && countUpdates.length === 0 ? "clean" : "DIRTY"
      }`,
    );
    process.exit(totalRemoved === 0 && countUpdates.length === 0 ? 0 : 1);
  }

  if (countUpdates.length > 0) {
    writeFileSync(EXPORT_PATH, serializeLike(exportRaw, mainExport));
    console.log(`  rewrote ${EXPORT_PATH} with synced directoryCount values`);
  }

  console.log(`\nDone: ${totalRemoved} repeat rows collapsed across ${filesChanged} file(s).`);
}

main();
