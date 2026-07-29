#!/usr/bin/env npx tsx
/**
 * Import Cook County's official 2020 Community Recovery Initiative impact
 * report as a program-level historical exclusion ledger.
 *
 * The generated rows are not recipient records, do not carry coordinates,
 * and are not eligible for the Chicago map. Portfolio and direct-recipient
 * amounts remain in separate columns and must never be rolled up together.
 *
 * Usage:
 *   npx tsx scripts/import-cook-county-cares-program-ledger.ts
 *   npx tsx scripts/import-cook-county-cares-program-ledger.ts \
 *     --input /private/tmp/cook-county-2020-community-recovery-impact-report.pdf
 */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractText } from "unpdf";
import {
  assertCookCountyCaresProgramLedgerIntegrity,
  COOK_COUNTY_CARES_EXPECTATIONS,
  COOK_COUNTY_CARES_IMPACT_REPORT_URL,
  COOK_COUNTY_CARES_SOURCE_VERSION,
  parseCookCountyCaresProgramLedgerPages,
  serializeCookCountyCaresProgramLedgerCsv,
  type CookCountyCaresProgramLedgerResult,
} from "../lib/cook-county-cares-program-ledger";

export const DEFAULT_COOK_COUNTY_CARES_PROGRAM_LEDGER_OUTPUT = resolve(
  process.cwd(),
  "data",
  "curated",
  "investment-inputs",
  "cook_county_cares_2020_programs.csv",
);

export interface CookCountyCaresProgramLedgerCliOptions {
  input: string | null;
  url: string;
  output: string;
  sourceVersion: string;
  expectedPages: number;
}

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

export function parseCookCountyCaresProgramLedgerCliArgs(
  args: string[],
): CookCountyCaresProgramLedgerCliOptions {
  let input: string | null = null;
  let url = COOK_COUNTY_CARES_IMPACT_REPORT_URL;
  let output = DEFAULT_COOK_COUNTY_CARES_PROGRAM_LEDGER_OUTPUT;
  let sourceVersion = COOK_COUNTY_CARES_SOURCE_VERSION;
  let expectedPages: number = COOK_COUNTY_CARES_EXPECTATIONS.pageCount;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--input") {
      input = resolve(valueAfter(args, index, arg));
      index++;
    } else if (arg === "--url") {
      url = valueAfter(args, index, arg);
      index++;
    } else if (arg === "--output") {
      output = resolve(valueAfter(args, index, arg));
      index++;
    } else if (arg === "--source-version") {
      sourceVersion = valueAfter(args, index, arg);
      index++;
    } else if (arg === "--expected-pages") {
      expectedPages = parseNonNegativeInteger(
        valueAfter(args, index, arg),
        arg,
      );
      index++;
    } else if (arg === "--help") {
      continue;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else if (input === null) {
      input = resolve(arg);
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }

  return { input, url, output, sourceVersion, expectedPages };
}

function printHelp(): void {
  console.log(`
Import the Cook County 2020 CARES program/exclusion ledger.

Options:
  --input <path>          Read a local copy of the official PDF.
  --url <url>             Download the official PDF when input is omitted.
  --output <path>         CSV destination.
  --source-version <date> Report publication date (default: ${COOK_COUNTY_CARES_SOURCE_VERSION}).
  --expected-pages <n>    Integrity expectation (default: ${COOK_COUNTY_CARES_EXPECTATIONS.pageCount}).
  --help                  Show this help.

The output preserves one umbrella funding context row and three historical
child-program outcomes. It never creates recipient rows, coordinates, Chicago
markers, or a combined financial total.
`.trim());
}

function assertPdf(buffer: Buffer, label: string): void {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`${label} is not a valid PDF.`);
  }
}

async function loadOfficialPdf(
  options: CookCountyCaresProgramLedgerCliOptions,
): Promise<{ buffer: Buffer; inputLabel: string }> {
  if (options.input) {
    if (!existsSync(options.input)) {
      throw new Error(`Local PDF not found: ${options.input}`);
    }
    const buffer = readFileSync(options.input);
    assertPdf(buffer, options.input);
    return { buffer, inputLabel: options.input };
  }

  const response = await fetch(options.url, {
    headers: {
      Accept: "application/pdf",
      "User-Agent":
        "Chicago-Incentive-Explorer-Cook-County-CARES-Importer/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Cook County report download failed (${response.status} ${response.statusText}): ${options.url}`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  assertPdf(buffer, options.url);
  return { buffer, inputLabel: options.url };
}

export type CookCountyCaresProgramLedgerWriteAction =
  | "created"
  | "updated"
  | "unchanged";

export function writeCookCountyCaresProgramLedgerIfChanged(
  path: string,
  contents: string,
): CookCountyCaresProgramLedgerWriteAction {
  const resolvedPath = resolve(path);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  if (
    existsSync(resolvedPath) &&
    readFileSync(resolvedPath, "utf8") === contents
  ) {
    return "unchanged";
  }

  const action: CookCountyCaresProgramLedgerWriteAction = existsSync(
    resolvedPath,
  )
    ? "updated"
    : "created";
  const temporaryPath = `${resolvedPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryPath, resolvedPath);
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
  return action;
}

export async function importCookCountyCaresProgramLedger(
  options: CookCountyCaresProgramLedgerCliOptions,
): Promise<
  CookCountyCaresProgramLedgerResult & {
    outputAction: CookCountyCaresProgramLedgerWriteAction;
  }
> {
  const { buffer, inputLabel } = await loadOfficialPdf(options);
  const extraction = await extractText(new Uint8Array(buffer), {
    mergePages: false,
  });
  const pages = Array.isArray(extraction.text)
    ? extraction.text
    : [String(extraction.text)];
  const result = parseCookCountyCaresProgramLedgerPages(pages, {
    sourceReportUrl: COOK_COUNTY_CARES_IMPACT_REPORT_URL,
    sourceVersion: options.sourceVersion,
  });
  const summary = assertCookCountyCaresProgramLedgerIntegrity(result, {
    pageCount: options.expectedPages,
    recordCount: COOK_COUNTY_CARES_EXPECTATIONS.recordCount,
    sourceVersion: options.sourceVersion,
  });
  const outputAction = writeCookCountyCaresProgramLedgerIfChanged(
    options.output,
    serializeCookCountyCaresProgramLedgerCsv(result.records),
  );

  console.log(`Source: ${inputLabel}`);
  console.log(`Official provenance: ${COOK_COUNTY_CARES_IMPACT_REPORT_URL}`);
  console.log(`Version: ${result.sourceVersion}`);
  console.log(
    `Parsed ${summary.pageCount} pages into ${summary.recordCount} program-level records.`,
  );
  console.log(
    `Umbrella context: $${summary.historicalPortfolioAmountUsd.toLocaleString(
      "en-US",
    )}; excluded from child-program rollups.`,
  );
  for (const child of summary.childProgramOutcomes) {
    console.log(
      `${child.recordId}: ${child.recipientCount.toLocaleString(
        "en-US",
      )} recipients; $${child.historicalDirectRecipientAmountUsd.toLocaleString(
        "en-US",
      )} source-reported historical distribution.`,
    );
  }
  console.log(`${outputAction}: ${options.output}`);

  return { ...result, outputAction };
}

const isDirectRun =
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  if (process.argv.includes("--help")) {
    printHelp();
  } else {
    const options = parseCookCountyCaresProgramLedgerCliArgs(
      process.argv.slice(2),
    );
    importCookCountyCaresProgramLedger(options).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    });
  }
}
