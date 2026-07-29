#!/usr/bin/env npx tsx
/**
 * Import the official Illinois DCEO Hospitality Emergency Grant awardee PDF.
 * Output rows are historical 2020 awards from a closed program.
 *
 * Usage:
 *   npx tsx scripts/import-illinois-hospitality-emergency-grants.ts \
 *     --input=/private/tmp/illinois-hospitality-grant-awardees.pdf
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { extractTextItems } from "unpdf";
import {
  assertIllinoisHospitalityEmergencyGrantIntegrity,
  ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION,
  ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_FULL_SOURCE_EXPECTATIONS,
  ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_OFFICIAL_HEADLINE,
  ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_PDF_URL,
  layoutIllinoisHospitalityEmergencyGrantTextItemPages,
  parseIllinoisHospitalityEmergencyGrantPages,
  serializeIllinoisHospitalityEmergencyGrantCsv,
  summarizeIllinoisHospitalityEmergencyGrants,
} from "../lib/illinois-hospitality-emergency-grants";

const DEFAULT_OUTPUT_PATH =
  "data/curated/investment-inputs/illinois_hospitality_emergency_grant_awards.csv";
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

function optionValue(name: string): string | null {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  const inline = args.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 &&
    args[index + 1] &&
    !args[index + 1].startsWith("--")
    ? args[index + 1]
    : null;
}

function positionalInput(): string | null {
  return (
    process.argv
      .slice(2)
      .find(
        (argument) =>
          !argument.startsWith("--") && !/^https?:\/\//i.test(argument),
      ) ?? null
  );
}

function printHelp(): void {
  console.log(
    `
Import historical Illinois DCEO Hospitality Emergency Grant awards.

Options:
  --input=<path>       Read a local PDF. A positional path also works.
  --url=<url>          Download a PDF when no local input is supplied.
  --source-url=<url>   Provenance URL written to every CSV row.
  --output=<path>      CSV destination (default: ${DEFAULT_OUTPUT_PATH}).
  --help               Show this help.

Canonical source:
  ${ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_PDF_URL}

Publication stops on PDF, layout, parser, page-count, row-count, amount,
distribution, county-count, boundary-record, or source-version drift. Output
preserves only source-published business, DBA, municipality, county, and exact
historical grant amount. It does not infer a street address or ZIP, rank
recipients, describe active funding, or estimate prospective funding.
`.trim(),
  );
}

function validatePdf(
  buffer: Buffer,
  inputLabel: string,
  contentType?: string | null,
): void {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`${inputLabel} did not return a valid PDF.`);
  }
  if (buffer.length > MAX_SOURCE_BYTES) {
    throw new Error(
      `${inputLabel} exceeds the ${MAX_SOURCE_BYTES.toLocaleString("en-US")} byte safety limit.`,
    );
  }
  if (contentType?.toLowerCase().includes("text/html")) {
    throw new Error(`${inputLabel} returned HTML instead of the official PDF.`);
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
    ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_PDF_URL;

  if (localInput) {
    const inputPath = resolve(process.cwd(), localInput);
    if (!existsSync(inputPath)) {
      throw new Error(`Local PDF not found: ${inputPath}`);
    }
    const buffer = readFileSync(inputPath);
    validatePdf(buffer, inputPath);
    return { buffer, sourceUrl, inputLabel: inputPath };
  }

  const downloadUrl =
    requestedUrl ?? ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_PDF_URL;
  const response = await fetch(downloadUrl, {
    headers: {
      Accept: "application/pdf,*/*;q=0.1",
      "User-Agent": "Chicago Incentive Explorer source importer",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download Illinois Hospitality Emergency Grant PDF (${response.status} ${response.statusText}) from ${downloadUrl}.`,
    );
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
    throw new Error(
      `${downloadUrl} declares a response larger than the ${MAX_SOURCE_BYTES.toLocaleString("en-US")} byte safety limit.`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  validatePdf(buffer, downloadUrl, response.headers.get("content-type"));
  return {
    buffer,
    sourceUrl,
    inputLabel: response.url || downloadUrl,
  };
}

function writeIfChanged(
  outputPath: string,
  csv: string,
): "unchanged" | "written" {
  if (existsSync(outputPath) && readFileSync(outputPath, "utf-8") === csv) {
    return "unchanged";
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, csv, "utf-8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, outputPath);
  } finally {
    if (descriptor != null) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  return "written";
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US")}`;
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    printHelp();
    return;
  }

  const { buffer, sourceUrl, inputLabel } = await loadPdf();
  const extraction = await extractTextItems(new Uint8Array(buffer));
  const pages = layoutIllinoisHospitalityEmergencyGrantTextItemPages(
    extraction.items,
  );
  const result = parseIllinoisHospitalityEmergencyGrantPages(pages, {
    sourceUrl,
  });
  const summary = summarizeIllinoisHospitalityEmergencyGrants(result);

  console.log(`Source: ${inputLabel}`);
  console.log(`Version: ${result.sourceVersion}`);
  console.log(
    `Parsed: ${summary.pageCount.toLocaleString("en-US")} pages, ${summary.rowCount.toLocaleString("en-US")} rows, ${formatUsd(summary.totalGrantUsd)}`,
  );
  console.log(
    `Classification: ${ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION.awardStatus}; program ${ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION.programStatus}; precision ${ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION.sourcePrecision}`,
  );

  if (result.issues.length > 0) {
    result.issues.slice(0, 20).forEach((issue) => {
      console.error(
        `  page ${issue.page}, line ${issue.line} [${issue.code}]: ${issue.text}`,
      );
    });
    if (result.issues.length > 20) {
      console.error(`  ...and ${result.issues.length - 20} more parser issue(s).`);
    }
  }

  assertIllinoisHospitalityEmergencyGrantIntegrity(result);
  if (
    summary.rowCount !==
      ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_OFFICIAL_HEADLINE.approvedBusinessCount ||
    summary.totalGrantUsd !==
      ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_OFFICIAL_HEADLINE.fundedUsd
  ) {
    throw new Error(
      `Official program-page reconciliation failed for the ${ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_OFFICIAL_HEADLINE.asOf} snapshot.`,
    );
  }

  const outputPath = resolve(
    process.cwd(),
    optionValue("output") ?? DEFAULT_OUTPUT_PATH,
  );
  const status = writeIfChanged(
    outputPath,
    serializeIllinoisHospitalityEmergencyGrantCsv(result.records),
  );
  console.log(
    status === "unchanged"
      ? `Verified unchanged: ${outputPath}`
      : `Wrote: ${outputPath}`,
  );
  console.log(
    `Canonical integrity verified: ${ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_FULL_SOURCE_EXPECTATIONS.pageCount} pages; ${ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_FULL_SOURCE_EXPECTATIONS.rowCount} awardees; ${formatUsd(ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_FULL_SOURCE_EXPECTATIONS.totalGrantUsd)} historical grants.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
