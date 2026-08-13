#!/usr/bin/env npx tsx
/**
 * Export the internal program catalog (data/programs-internal.json,
 * server-only) into the sanitized public projection consumers will migrate
 * onto in PR2: public/data/programs-public.json — an array of
 * PublicProgramView (lib/program-public.ts) inside a versioned envelope.
 *
 * No database, no network — pure file-to-file transform, safe to run
 * anywhere including CI.
 *
 *   npx tsx scripts/export-public-programs.ts          # write the artifact
 *   npx tsx scripts/export-public-programs.ts --check  # regen + diff; exits
 *                                                        non-zero on drift
 *                                                        (ignores generatedAt,
 *                                                        the only field that
 *                                                        legitimately changes
 *                                                        between runs)
 *
 * lib/__tests__/program-public.test.ts runs the same check() logic in-
 * process (importing buildPublicProgramsEnvelope directly) so `npx vitest
 * run` catches drift without needing this script — this file exists for
 * the npm script / a real CI step, per build-spec.md 1.2.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Program } from "../lib/types";
import { buildPublicProgramsEnvelope, catalogRevisionFromRaw } from "../lib/program-public";

const INTERNAL_CATALOG_PATH = join(process.cwd(), "data", "programs-internal.json");
const PUBLIC_ARTIFACT_PATH = join(process.cwd(), "public", "data", "programs-public.json");

function readInternalCatalog(): { raw: string; records: Program[] } {
  const raw = readFileSync(INTERNAL_CATALOG_PATH, "utf8");
  const records = JSON.parse(raw) as Program[];
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(
      `Refusing to export: ${INTERNAL_CATALOG_PATH} parsed to an empty or non-array catalog.`
    );
  }
  return { raw, records };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const { raw, records } = readInternalCatalog();
  const catalogRevision = catalogRevisionFromRaw(raw);
  const generatedAt = new Date().toISOString();
  const envelope = buildPublicProgramsEnvelope(records, catalogRevision, generatedAt);

  if (checkOnly) {
    const committedRaw = readFileSync(PUBLIC_ARTIFACT_PATH, "utf8");
    const committed = JSON.parse(committedRaw) as typeof envelope;
    const catalogRevisionMatches = committed.catalogRevision === envelope.catalogRevision;
    const programsMatch =
      JSON.stringify(committed.programs) === JSON.stringify(envelope.programs);

    if (!catalogRevisionMatches || !programsMatch) {
      console.error(
        "public/data/programs-public.json is stale relative to data/programs-internal.json.\n" +
          "Regenerate with `npx tsx scripts/export-public-programs.ts` and commit the result."
      );
      process.exit(1);
    }
    console.log(
      `public/data/programs-public.json matches data/programs-internal.json ` +
        `(catalogRevision ${catalogRevision.slice(0, 12)}...) — clean.`
    );
    return;
  }

  writeFileSync(PUBLIC_ARTIFACT_PATH, JSON.stringify(envelope, null, 2) + "\n", "utf8");
  console.log(
    `Wrote ${envelope.programs.length} programs to ${PUBLIC_ARTIFACT_PATH} ` +
      `(catalogRevision ${catalogRevision.slice(0, 12)}...).`
  );
}

main();
