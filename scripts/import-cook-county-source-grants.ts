#!/usr/bin/env npx tsx
/**
 * Import the public Cook County 2023 Source Grant awardee PDF into a private,
 * admin-facing curated CSV. These are historical award records, not active
 * incentive opportunities.
 *
 * Usage:
 *   npx tsx scripts/import-cook-county-source-grants.ts \
 *     --input=/private/tmp/cook-source-grants-2023.pdf
 *
 *   npx tsx scripts/import-cook-county-source-grants.ts \
 *     --url=https://example.org/source.pdf \
 *     --source-url=https://example.org/source.pdf
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { extractText } from "unpdf";
import {
  assertCookCountySourceGrantIntegrity,
  COOK_COUNTY_SOURCE_GRANTS_CLASSIFICATION,
  COOK_COUNTY_SOURCE_GRANTS_FULL_SOURCE_EXPECTATIONS,
  COOK_COUNTY_SOURCE_GRANTS_OFFICIAL_PROGRAM_HEADLINE,
  COOK_COUNTY_SOURCE_GRANTS_PDF_URL,
  parseCookCountySourceGrantPages,
  serializeCookCountySourceGrantsCsv,
  summarizeCookCountySourceGrants,
} from "../lib/cook-county-source-grants";

const DEFAULT_OUTPUT_PATH =
  "data/curated/investment-inputs/cook_county_source_grants_2023.csv";

function optionValue(name: string): string | null {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")
    ? args[index + 1]
    : null;
}

function positionalInput(): string | null {
  return (
    process.argv
      .slice(2)
      .find((arg) => !arg.startsWith("--") && !arg.startsWith("http")) ?? null
  );
}

function parseExpectedInteger(name: string, fallback: number): number {
  const raw = optionValue(name);
  if (raw == null) return fallback;
  const parsed = Number(raw.replace(/[$,]/g, ""));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer.`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(`
Import Cook County 2023 Source Grant historical award records.

Options:
  --input=<path>             Read a local PDF. A positional path also works.
  --url=<url>                Download the PDF when no local input is supplied.
  --source-url=<url>         Provenance URL written to every CSV row.
  --source-version=<date>    Override the version parsed from "List as of ...".
  --output=<path>            CSV destination (default: ${DEFAULT_OUTPUT_PATH}).
  --expected-pages=<number>  Integrity expectation (default: ${COOK_COUNTY_SOURCE_GRANTS_FULL_SOURCE_EXPECTATIONS.pageCount}).
  --expected-rows=<number>   Integrity expectation (default: ${COOK_COUNTY_SOURCE_GRANTS_FULL_SOURCE_EXPECTATIONS.rowCount}).
  --expected-total=<dollars> Integrity expectation (default: ${COOK_COUNTY_SOURCE_GRANTS_FULL_SOURCE_EXPECTATIONS.totalAwardUsd}).
  --help                     Show this help.

The output contains no street address, inferred location, eligibility, or
active-opportunity fields. Publication stops on parser or integrity mismatch.
`.trim());
}

function assertPdf(buffer: Buffer, label: string): void {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`${label} did not return a valid PDF.`);
  }
}

async function loadPdf(): Promise<{
  buffer: Buffer;
  sourceUrl: string;
  inputLabel: string;
}> {
  const localInput = optionValue("input") ?? positionalInput();
  const requestedUrl = optionValue("url");
  const sourceUrl =
    optionValue("source-url") ?? requestedUrl ?? COOK_COUNTY_SOURCE_GRANTS_PDF_URL;

  if (localInput) {
    const inputPath = resolve(process.cwd(), localInput);
    if (!existsSync(inputPath)) {
      throw new Error(`Local PDF not found: ${inputPath}`);
    }
    const buffer = readFileSync(inputPath);
    assertPdf(buffer, inputPath);
    return { buffer, sourceUrl, inputLabel: inputPath };
  }

  const downloadUrl = requestedUrl ?? COOK_COUNTY_SOURCE_GRANTS_PDF_URL;
  const response = await fetch(downloadUrl, {
    headers: {
      "User-Agent": "Chicago Incentive Explorer source importer",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download Cook County source PDF (${response.status} ${response.statusText}).`
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  assertPdf(buffer, downloadUrl);
  return { buffer, sourceUrl, inputLabel: downloadUrl };
}

function writeIfChanged(outputPath: string, csv: string): "unchanged" | "written" {
  if (existsSync(outputPath) && readFileSync(outputPath, "utf-8") === csv) {
    return "unchanged";
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  writeFileSync(temporaryPath, csv, "utf-8");
  try {
    renameSync(temporaryPath, outputPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  return "written";
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    printHelp();
    return;
  }

  const { buffer, sourceUrl, inputLabel } = await loadPdf();
  const extraction = await extractText(new Uint8Array(buffer), {
    mergePages: false,
  });
  const pages = Array.isArray(extraction.text)
    ? extraction.text
    : [String(extraction.text)];

  const result = parseCookCountySourceGrantPages(pages, {
    sourceUrl,
    sourceVersion: optionValue("source-version") ?? undefined,
  });
  const summary = summarizeCookCountySourceGrants(result);

  console.log(`Source: ${inputLabel}`);
  console.log(`Version: ${result.sourceVersion}`);
  console.log(
    `Parsed: ${summary.pageCount.toLocaleString("en-US")} pages, ${summary.rowCount.toLocaleString("en-US")} rows, $${summary.totalAwardUsd.toLocaleString("en-US")}`
  );
  console.log(
    `Classification: ${COOK_COUNTY_SOURCE_GRANTS_CLASSIFICATION.visibility}; ${COOK_COUNTY_SOURCE_GRANTS_CLASSIFICATION.programState}`
  );
  if (
    summary.rowCount !==
      COOK_COUNTY_SOURCE_GRANTS_OFFICIAL_PROGRAM_HEADLINE.rowCount ||
    summary.totalAwardUsd !==
      COOK_COUNTY_SOURCE_GRANTS_OFFICIAL_PROGRAM_HEADLINE.totalAwardUsd
  ) {
    console.warn(
      `Source discrepancy: the official program headline reports ${COOK_COUNTY_SOURCE_GRANTS_OFFICIAL_PROGRAM_HEADLINE.rowCount.toLocaleString("en-US")} businesses and $${COOK_COUNTY_SOURCE_GRANTS_OFFICIAL_PROGRAM_HEADLINE.totalAwardUsd.toLocaleString("en-US")}; the dated recipient PDF contains ${summary.rowCount.toLocaleString("en-US")} rows totaling $${summary.totalAwardUsd.toLocaleString("en-US")}. Preserving every PDF row.`
    );
    console.warn(
      `Program context: ${COOK_COUNTY_SOURCE_GRANTS_OFFICIAL_PROGRAM_HEADLINE.sourceUrl}`
    );
  }

  if (result.issues.length > 0) {
    for (const issue of result.issues.slice(0, 20)) {
      console.error(
        `  page ${issue.page}, line ${issue.line} [${issue.code}]: ${issue.text}`
      );
    }
    if (result.issues.length > 20) {
      console.error(`  ...and ${result.issues.length - 20} more parser issue(s).`);
    }
  }

  const expectations = {
    pageCount: parseExpectedInteger(
      "expected-pages",
      COOK_COUNTY_SOURCE_GRANTS_FULL_SOURCE_EXPECTATIONS.pageCount
    ),
    rowCount: parseExpectedInteger(
      "expected-rows",
      COOK_COUNTY_SOURCE_GRANTS_FULL_SOURCE_EXPECTATIONS.rowCount
    ),
    totalAwardUsd: parseExpectedInteger(
      "expected-total",
      COOK_COUNTY_SOURCE_GRANTS_FULL_SOURCE_EXPECTATIONS.totalAwardUsd
    ),
  };
  assertCookCountySourceGrantIntegrity(result, expectations);

  const outputPath = resolve(
    process.cwd(),
    optionValue("output") ?? DEFAULT_OUTPUT_PATH
  );
  const status = writeIfChanged(
    outputPath,
    serializeCookCountySourceGrantsCsv(result.records)
  );
  console.log(
    status === "unchanged"
      ? `Verified unchanged: ${outputPath}`
      : `Wrote: ${outputPath}`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
