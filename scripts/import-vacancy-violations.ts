#!/usr/bin/env npx tsx
/** Build a reviewable, additive import; never writes to a database itself.
 * Run: npx tsx scripts/import-vacancy-violations.ts
 * Verify the generated SQL on a disposable Neon branch before production use.
 * This is an operator-reviewed addition, not a recurring membership sync.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildVacancyViolationImport,
  buildVacancyViolationInsertSql,
  fetchVacancyViolationRecords,
} from "../lib/vacancy-violation-signals";

async function main() {
  const reference = new Date();
  const rows = await fetchVacancyViolationRecords(reference);
  const report = buildVacancyViolationImport(rows, reference);
  const directory = join(process.cwd(), "output/vacancy-violations");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "source.json"), JSON.stringify(rows, null, 2));
  writeFileSync(join(directory, "import.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(directory, "import.sql"), buildVacancyViolationInsertSql(report.signals));
  const { signals, ...counts } = report;
  console.log(JSON.stringify({ ...counts, eligibleSignals: signals.length, directory }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Vacancy violation import failed");
  process.exitCode = 1;
});
