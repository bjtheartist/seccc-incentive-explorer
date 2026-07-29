#!/usr/bin/env npx tsx
/**
 * Import Illinois DCEO's official Business Interruption Grant awardee PDF.
 * BIG is a closed historical relief program, not an active opportunity.
 *
 * Usage:
 *   npx tsx scripts/import-illinois-business-interruption-grants.ts \
 *     --input=/private/tmp/illinois-big-awards.pdf
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
import { extractTextItems } from "unpdf";
import {
  assertIllinoisBusinessInterruptionGrantIntegrity,
  ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS,
  ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS,
  ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_PDF_URL,
  layoutIllinoisBusinessInterruptionGrantTextItemPages,
  parseIllinoisBusinessInterruptionGrantPages,
  serializeIllinoisBusinessInterruptionGrantCsv,
  summarizeIllinoisBusinessInterruptionGrants,
} from "../lib/illinois-business-interruption-grants";

const DEFAULT_OUTPUT_PATH =
  "data/curated/investment-inputs/illinois_business_interruption_grants.csv";

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
Import Illinois Business Interruption Grant historical awards.

Options:
  --input=<path>                     Read a local PDF.
  --url=<url>                        Download the PDF when no input is supplied.
  --source-url=<url>                 Provenance URL written to every CSV row.
  --source-version=<date>            Override the date parsed from the header.
  --output=<path>                    CSV destination.
  --expected-pages=<number>          Exact page expectation.
  --expected-rows=<number>           Exact source-row expectation.
  --expected-total=<dollars>         Exact historical grant total.
  --expected-min=<dollars>           Exact minimum historical grant.
  --expected-max=<dollars>           Exact maximum historical grant.
  --expected-round-1-rows=<number>   Exact Round 1 row count.
  --expected-round-1-total=<dollars> Exact Round 1 historical total.
  --expected-round-2-rows=<number>   Exact Round 2 row count.
  --expected-round-2-total=<dollars> Exact Round 2 historical total.
  --expected-version=<date>          Exact source version.
  --help                             Show this help.

The importer preserves every published source row, including repeated
businesses across rounds. It does not infer current eligibility or funding.
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
    optionValue("source-url") ??
    requestedUrl ??
    ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_PDF_URL;

  if (localInput) {
    const inputPath = resolve(process.cwd(), localInput);
    if (!existsSync(inputPath)) {
      throw new Error(`Local PDF not found: ${inputPath}`);
    }
    const buffer = readFileSync(inputPath);
    assertPdf(buffer, inputPath);
    return { buffer, sourceUrl, inputLabel: inputPath };
  }

  const downloadUrl =
    requestedUrl ?? ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_PDF_URL;
  const response = await fetch(downloadUrl, {
    headers: {
      "User-Agent": "Chicago Incentive Explorer source importer",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download Illinois BIG source PDF (${response.status} ${response.statusText}).`
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
  const extraction = await extractTextItems(new Uint8Array(buffer));
  const pages = layoutIllinoisBusinessInterruptionGrantTextItemPages(
    extraction.items
  );
  const result = parseIllinoisBusinessInterruptionGrantPages(pages, {
    sourceUrl,
    sourceVersion: optionValue("source-version") ?? undefined,
  });
  const summary = summarizeIllinoisBusinessInterruptionGrants(result);

  console.log(`Source: ${inputLabel}`);
  console.log(`Version: ${result.sourceVersion}`);
  console.log(
    `Parsed: ${summary.pageCount.toLocaleString("en-US")} pages, ${summary.rowCount.toLocaleString("en-US")} rows, $${summary.totalGrantUsd.toLocaleString("en-US")}`
  );
  console.log(
    `Rounds: ${summary.round1RowCount.toLocaleString("en-US")} Round 1 rows ($${summary.round1TotalGrantUsd.toLocaleString("en-US")}); ${summary.round2RowCount.toLocaleString("en-US")} Round 2 rows ($${summary.round2TotalGrantUsd.toLocaleString("en-US")})`
  );
  console.log(
    `Classification: ${ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS.programStatus}; ${ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS.reliefEra}`
  );

  if (result.issues.length > 0) {
    for (const issue of result.issues.slice(0, 30)) {
      console.error(
        `  page ${issue.page}, line ${issue.line} [${issue.code}]: ${issue.text}`
      );
    }
    if (result.issues.length > 30) {
      console.error(`  ...and ${result.issues.length - 30} more parser issue(s).`);
    }
  }

  assertIllinoisBusinessInterruptionGrantIntegrity(result, {
    pageCount: parseExpectedInteger(
      "expected-pages",
      ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS.pageCount
    ),
    rowCount: parseExpectedInteger(
      "expected-rows",
      ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS.rowCount
    ),
    totalGrantUsd: parseExpectedInteger(
      "expected-total",
      ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS.totalGrantUsd
    ),
    minimumGrantUsd: parseExpectedInteger(
      "expected-min",
      ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS.minimumGrantUsd
    ),
    maximumGrantUsd: parseExpectedInteger(
      "expected-max",
      ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS.maximumGrantUsd
    ),
    round1RowCount: parseExpectedInteger(
      "expected-round-1-rows",
      ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS.round1RowCount
    ),
    round1TotalGrantUsd: parseExpectedInteger(
      "expected-round-1-total",
      ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS
        .round1TotalGrantUsd
    ),
    round2RowCount: parseExpectedInteger(
      "expected-round-2-rows",
      ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS.round2RowCount
    ),
    round2TotalGrantUsd: parseExpectedInteger(
      "expected-round-2-total",
      ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS
        .round2TotalGrantUsd
    ),
    sourceVersion:
      optionValue("expected-version") ??
      ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS.sourceVersion,
  });

  const outputPath = resolve(
    process.cwd(),
    optionValue("output") ?? DEFAULT_OUTPUT_PATH
  );
  const status = writeIfChanged(
    outputPath,
    serializeIllinoisBusinessInterruptionGrantCsv(result.records)
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
