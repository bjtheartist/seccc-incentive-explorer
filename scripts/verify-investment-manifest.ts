/**
 * Read-only CI gate for data/curated/investment-inputs/manifest.json
 * (`npm run data:manifest:verify`). Writes NOTHING — it is the counterpart to
 * scripts/generate-investment-manifest.ts, which writes.
 *
 * The 2026-09-02 monthly refresh shipped a stale manifest: the inputs were
 * rewritten and the manifest was not regenerated between the refresh and the
 * export (fixed by PR #260). That failure was only visible when the EXPORTER
 * ran. This gate makes the same drift visible on every PR and every push to
 * main without running a 27k-record export, by failing loudly on:
 *
 *   (a) a committed contentHash that no longer matches the file's bytes on disk,
 *   (b) a manifest-declared file that is missing from the input directory,
 *   (c) a file the exporter reads that is not declared in the manifest at all.
 *
 * Nothing here re-implements the hashing or the input list: (a) runs the
 * exporter's own verifyManifestInputBytes() against the real bytes, and the
 * declared set comes from the committed manifest, which is generated from
 * AUTHORED_SOURCES in scripts/lib/investment-manifest.ts.
 *
 * (c) is a STATIC read of scripts/export-community-investment.ts — deliberately
 * not a run of it. The exporter reads inputs three ways: a hard-coded literal
 * (`readCsv("tif_projects.csv")`), a manifest id (`manifestFile("nof-small")`),
 * and a manifest entry (`readCsv(entry.file)` in the foundation loop). The
 * last two are manifest-derived and therefore declared by construction; only
 * the hard-coded literals can name a file the manifest has never heard of, so
 * those literals — plus the ids passed to manifestFile() — are what this gate
 * reconciles against the declared set. The runtime guarantee is unchanged and
 * still enforced where the bytes are actually consumed
 * (verifyManifestInputBytes / assertNoOrphanedManifestSources on every export,
 * and scripts/__tests__/export-community-investment-manifest-coverage.test.ts
 * against a real end-to-end run).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INPUT_DIR,
  loadManifest,
  verifyManifestInputBytes,
  type InvestmentManifest,
} from "./lib/investment-manifest";

export const EXPORTER_PATH = join(process.cwd(), "scripts", "export-community-investment.ts");

export type ManifestProblemKind = "hash-mismatch" | "missing-file" | "undeclared-input";

export interface ManifestProblem {
  kind: ManifestProblemKind;
  /** The input filename (or `manifest id "x"` for an unresolvable id). */
  subject: string;
  message: string;
}

/**
 * Every input filename the exporter reads through a HARD-CODED string literal
 * — `verifiedRead("geocode-cache.json")`, `readCsv("tif_projects.csv")`,
 * `readTsv("ellen_nof_awardees.tsv")`. Reads whose argument is an expression
 * (`manifestFile("nof-small")`, `entry.file`) are deliberately not matched
 * here: those resolve THROUGH the manifest, so they cannot name an undeclared
 * file. Matching only the three read wrappers — never bare string literals —
 * keeps filenames mentioned in comments (the quarantined DO_NOT_EXPORT files,
 * for instance) out of the result.
 */
export function exporterLiteralInputFiles(exporterSource: string): string[] {
  const files = new Set<string>();
  const re = /\b(?:verifiedRead|readCsv|readTsv)\(\s*(["'])([^"']+)\1\s*\)/g;
  for (const m of exporterSource.matchAll(re)) files.add(m[2]);
  return [...files].sort();
}

/** Every manifest id the exporter resolves a filename from via manifestFile(). */
export function exporterManifestIds(exporterSource: string): string[] {
  const ids = new Set<string>();
  const re = /\bmanifestFile\(\s*(["'])([^"']+)\1\s*\)/g;
  for (const m of exporterSource.matchAll(re)) ids.add(m[2]);
  return [...ids].sort();
}

export interface VerifyManifestInput {
  manifest: InvestmentManifest;
  inputDir: string;
  /** The text of scripts/export-community-investment.ts. */
  exporterSource: string;
}

/**
 * The whole gate as a pure function over (manifest, input dir, exporter
 * source), so every failure mode is exercisable against a temp input dir.
 * Returns one problem per offending file — an empty array means clean.
 */
export function collectManifestProblems({
  manifest,
  inputDir,
  exporterSource,
}: VerifyManifestInput): ManifestProblem[] {
  const problems: ManifestProblem[] = [];

  for (const source of manifest.sources) {
    const abs = join(inputDir, source.file);
    if (!existsSync(abs)) {
      // An EMPTY contentHash is the manifest's own way of declaring "this file
      // does not exist in this checkout" (buildManifest hashes a missing file
      // to ""). refresh-attempt.json is exactly that: a failure-only artifact,
      // absent when every source is healthy. Manifest and disk agree — not drift.
      if (source.contentHash === "") continue;
      problems.push({
        kind: "missing-file",
        subject: source.file,
        message:
          `${source.file} — declared in manifest.json (id "${source.id}", contentHash ` +
          `${source.contentHash.slice(0, 12)}…) but MISSING from ${inputDir}. Restore the file, or ` +
          `remove its entry from AUTHORED_SOURCES in scripts/lib/investment-manifest.ts and re-run ` +
          `\`npm run data:manifest:generate\`.`,
      });
      continue;
    }
    try {
      // The exporter's own read-time check, against the real bytes — one
      // implementation of the hashing, not a second one that can drift.
      verifyManifestInputBytes(manifest, source.file, readFileSync(abs));
    } catch (err) {
      problems.push({
        kind: "hash-mismatch",
        subject: source.file,
        message: `${source.file} — ${(err as Error).message}`,
      });
    }
  }

  const declaredFiles = new Set(manifest.sources.map((s) => s.file));
  for (const file of exporterLiteralInputFiles(exporterSource)) {
    if (declaredFiles.has(file)) continue;
    problems.push({
      kind: "undeclared-input",
      subject: file,
      message:
        `${file} — read by scripts/export-community-investment.ts but NOT declared in ` +
        `manifest.json${existsSync(join(inputDir, file)) ? ` (the file is present in ${inputDir})` : ""}. ` +
        `Add it to AUTHORED_SOURCES in scripts/lib/investment-manifest.ts and re-run ` +
        `\`npm run data:manifest:generate\`; an exporter read of an undeclared file is refused at runtime.`,
    });
  }

  const declaredIds = new Set(manifest.sources.map((s) => s.id));
  for (const id of exporterManifestIds(exporterSource)) {
    if (declaredIds.has(id)) continue;
    problems.push({
      kind: "undeclared-input",
      subject: `manifest id "${id}"`,
      message:
        `manifest id "${id}" — scripts/export-community-investment.ts resolves an input filename from ` +
        `this id, but no manifest source declares it. Add it to AUTHORED_SOURCES in ` +
        `scripts/lib/investment-manifest.ts and re-run \`npm run data:manifest:generate\`.`,
    });
  }

  return problems;
}

function main() {
  const manifest = loadManifest();
  const exporterSource = readFileSync(EXPORTER_PATH, "utf8");
  const problems = collectManifestProblems({ manifest, inputDir: INPUT_DIR, exporterSource });

  if (problems.length > 0) {
    console.error(
      `The committed investment input manifest is STALE — ${problems.length} problem(s) ` +
        `in data/curated/investment-inputs/manifest.json:\n`,
    );
    for (const p of problems) console.error(`  [${p.kind}] ${p.message}`);
    console.error(
      `\nA stale manifest blocks the exporter (verifyManifestInputBytes throws on the mismatched ` +
        `bytes) and must never sit on main. Fix the underlying file, then commit the regenerated ` +
        `manifest.json alongside it.`,
    );
    process.exit(1);
  }

  const declared = manifest.sources.length;
  const literalReads = exporterLiteralInputFiles(exporterSource).length;
  console.log(
    `investment manifest verified: ${declared} declared source(s) hashed clean against ${INPUT_DIR}; ` +
      `${literalReads} exporter read target(s) all declared.`,
  );
}

// Only run the gate when this file is the entry point — the exported helpers
// above are imported directly by scripts/__tests__/investment-manifest-verify-gate.test.ts.
const isDirectRun = process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
