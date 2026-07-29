#!/usr/bin/env npx tsx
/**
 * Import Illinois DCEO's official Back to Business recipient PDF into a
 * curated CSV. These are historical ARPA-funded grants, not active incentive
 * opportunities or promises of future funding.
 *
 * Usage:
 *   npx tsx scripts/import-illinois-back-to-business.ts \
 *     --input=/private/tmp/illinois-b2b-awards.pdf
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
  assertIllinoisBackToBusinessIntegrity,
  ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS,
  ILLINOIS_BACK_TO_BUSINESS_LABELS,
  ILLINOIS_BACK_TO_BUSINESS_OFFICIAL_PROGRAM_HEADLINE,
  ILLINOIS_BACK_TO_BUSINESS_PDF_URL,
  layoutIllinoisBackToBusinessTextItemPages,
  parseIllinoisBackToBusinessPages,
  serializeIllinoisBackToBusinessCsv,
  summarizeIllinoisBackToBusiness,
} from "../lib/illinois-back-to-business";

const DEFAULT_OUTPUT_PATH =
  "data/curated/investment-inputs/illinois_back_to_business_awards.csv";

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
Import Illinois Back to Business historical ARPA grant awards.

Options:
  --input=<path>             Read a local PDF. A positional path also works.
  --url=<url>                Download the PDF when no local input is supplied.
  --source-url=<url>         Provenance URL written to every CSV row.
  --source-version=<date>    Override the date parsed from the PDF header.
  --output=<path>            CSV destination (default: ${DEFAULT_OUTPUT_PATH}).
  --expected-pages=<number>  Integrity expectation (default: ${ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS.pageCount}).
  --expected-rows=<number>   Integrity expectation (default: ${ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS.rowCount}).
  --expected-total=<dollars> Integrity expectation (default: ${ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS.totalAwardUsd}).
  --expected-min=<dollars>   Minimum award expectation (default: ${ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS.minimumAwardUsd}).
  --expected-max=<dollars>   Maximum award expectation (default: ${ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS.maximumAwardUsd}).
  --expected-version=<date>  Source version expectation (default: ${ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS.sourceVersion}).
  --help                     Show this help.

The output preserves published business, DBA, county, city, ZIP, and award
values. It does not infer street addresses, current eligibility, or available
funding. Publication stops on any layout, parser, or integrity mismatch.
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
    ILLINOIS_BACK_TO_BUSINESS_PDF_URL;

  if (localInput) {
    const inputPath = resolve(process.cwd(), localInput);
    if (!existsSync(inputPath)) {
      throw new Error(`Local PDF not found: ${inputPath}`);
    }
    const buffer = readFileSync(inputPath);
    assertPdf(buffer, inputPath);
    return { buffer, sourceUrl, inputLabel: inputPath };
  }

  const downloadUrl = requestedUrl ?? ILLINOIS_BACK_TO_BUSINESS_PDF_URL;
  const response = await fetch(downloadUrl, {
    headers: {
      "User-Agent": "Chicago Incentive Explorer source importer",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download Illinois B2B source PDF (${response.status} ${response.statusText}).`
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
  const pages = layoutIllinoisBackToBusinessTextItemPages(extraction.items);
  const result = parseIllinoisBackToBusinessPages(pages, {
    sourceUrl,
    sourceVersion: optionValue("source-version") ?? undefined,
  });
  const summary = summarizeIllinoisBackToBusiness(result);

  console.log(`Source: ${inputLabel}`);
  console.log(`Version: ${result.sourceVersion}`);
  console.log(
    `Parsed: ${summary.pageCount.toLocaleString("en-US")} pages, ${summary.rowCount.toLocaleString("en-US")} rows, $${summary.totalAwardUsd.toLocaleString("en-US")}`
  );
  console.log(
    `Classification: ${ILLINOIS_BACK_TO_BUSINESS_LABELS.awardStatus}; ${ILLINOIS_BACK_TO_BUSINESS_LABELS.assistanceType}; ${ILLINOIS_BACK_TO_BUSINESS_LABELS.fundingSource}`
  );

  if (
    summary.rowCount !==
      ILLINOIS_BACK_TO_BUSINESS_OFFICIAL_PROGRAM_HEADLINE.rowCount ||
    summary.totalAwardUsd !==
      ILLINOIS_BACK_TO_BUSINESS_OFFICIAL_PROGRAM_HEADLINE.totalAwardUsd
  ) {
    console.warn(
      `Source reconciliation: DCEO reports ${ILLINOIS_BACK_TO_BUSINESS_OFFICIAL_PROGRAM_HEADLINE.rowCount.toLocaleString("en-US")} recipients and a rounded $${ILLINOIS_BACK_TO_BUSINESS_OFFICIAL_PROGRAM_HEADLINE.totalAwardUsd.toLocaleString("en-US")} program total; the dated recipient PDF contains ${summary.rowCount.toLocaleString("en-US")} rows totaling $${summary.totalAwardUsd.toLocaleString("en-US")}. Preserving the PDF values.`
    );
    console.warn(
      `Program context: ${ILLINOIS_BACK_TO_BUSINESS_OFFICIAL_PROGRAM_HEADLINE.sourceUrl}`
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

  assertIllinoisBackToBusinessIntegrity(result, {
    pageCount: parseExpectedInteger(
      "expected-pages",
      ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS.pageCount
    ),
    rowCount: parseExpectedInteger(
      "expected-rows",
      ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS.rowCount
    ),
    totalAwardUsd: parseExpectedInteger(
      "expected-total",
      ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS.totalAwardUsd
    ),
    minimumAwardUsd: parseExpectedInteger(
      "expected-min",
      ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS.minimumAwardUsd
    ),
    maximumAwardUsd: parseExpectedInteger(
      "expected-max",
      ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS.maximumAwardUsd
    ),
    sourceVersion:
      optionValue("expected-version") ??
      ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS.sourceVersion,
  });

  const outputPath = resolve(
    process.cwd(),
    optionValue("output") ?? DEFAULT_OUTPUT_PATH
  );
  const status = writeIfChanged(
    outputPath,
    serializeIllinoisBackToBusinessCsv(result.records)
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
