#!/usr/bin/env npx tsx
/**
 * Import SBA Restaurant Revitalization Fund awards for explicit Chicago,
 * Illinois records. Output rows are historical ARPA grants, not active
 * incentive opportunities or estimates of potential funding.
 *
 * Usage:
 *   npx tsx scripts/import-sba-restaurant-revitalization.ts \
 *     --input=/private/tmp/rrf_foia.csv
 *
 *   npx tsx scripts/import-sba-restaurant-revitalization.ts
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
import {
  assertSbaRestaurantRevitalizationIntegrity,
  parseSbaRestaurantRevitalizationCsv,
  parseSbaRrfUsdAmount,
  SBA_RRF_CLASSIFICATION,
  SBA_RRF_CSV_URL,
  SBA_RRF_DATASET_URL,
  SBA_RRF_FULL_SOURCE_EXPECTATIONS,
  SBA_RRF_LEGACY_CSV_URL,
  SBA_RRF_SOURCE_VERSION,
  serializeSbaRestaurantRevitalizationCsv,
  summarizeSbaRestaurantRevitalization,
} from "../lib/sba-restaurant-revitalization";

const DEFAULT_OUTPUT_PATH =
  "data/curated/investment-inputs/sba_restaurant_revitalization_chicago.csv";
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;

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

function parseExpectedInteger(name: string, fallback: number): number {
  const raw = optionValue(name);
  if (raw == null) return fallback;
  const parsed = Number(raw.replace(/,/g, ""));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer.`);
  }
  return parsed;
}

function parseExpectedUsd(name: string, fallback: number): number {
  const raw = optionValue(name);
  if (raw == null) return fallback;
  const parsed = parseSbaRrfUsdAmount(raw);
  if (parsed == null) {
    throw new Error(`--${name} must be a non-negative USD amount.`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(
    `
Import historical SBA Restaurant Revitalization Fund awards for Chicago.

Options:
  --input=<path>                    Read a local CSV. A positional path also works.
  --url=<url>                       Download a CSV when no local input is supplied.
  --source-url=<url>                Dataset provenance URL written to every row.
  --source-download-url=<url>       Download provenance for a local input.
  --source-version=<version>        Source release/version label.
  --output=<path>                   CSV destination (default: ${DEFAULT_OUTPUT_PATH}).
  --expected-source-rows=<number>   Full-source row expectation (default: ${SBA_RRF_FULL_SOURCE_EXPECTATIONS.sourceRowCount}).
  --expected-chicago-rows=<number>  Chicago row expectation (default: ${SBA_RRF_FULL_SOURCE_EXPECTATIONS.chicagoRecordCount}).
  --expected-source-total=<dollars> Full-source historical grant total.
  --expected-chicago-total=<dollars> Chicago historical grant total.
  --expected-warnings=<number>       Known source-quality warnings (default: ${SBA_RRF_FULL_SOURCE_EXPECTATIONS.warningCount}).
  --help                            Show this help.

Current SBA CSV:
  ${SBA_RRF_CSV_URL}

SBA's former CKAN download URL is retained in code for provenance but currently
returns an error page:
  ${SBA_RRF_LEGACY_CSV_URL}

Publication stops on malformed CSV, schema drift, row issues, or integrity
mismatch. The output contains no coordinates, geocoding, eligibility claim,
active opportunity, or estimate of potential funding.
`.trim(),
  );
}

function validateAndDecodeCsv(
  buffer: Buffer,
  inputLabel: string,
  contentType?: string | null,
): { csv: string; encoding: "utf-8" | "windows-1252" } {
  if (buffer.length === 0) {
    throw new Error(`${inputLabel} returned an empty response.`);
  }
  if (buffer.length > MAX_SOURCE_BYTES) {
    throw new Error(
      `${inputLabel} exceeds the ${MAX_SOURCE_BYTES.toLocaleString("en-US")} byte safety limit.`,
    );
  }

  const normalizedContentType = contentType?.toLowerCase() ?? "";
  if (
    normalizedContentType.includes("text/html") ||
    normalizedContentType.includes("application/xhtml")
  ) {
    throw new Error(
      `${inputLabel} returned HTML instead of the SBA RRF CSV.`,
    );
  }

  let text: string;
  let encoding: "utf-8" | "windows-1252" = "utf-8";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder("windows-1252", { fatal: true }).decode(buffer);
    encoding = "windows-1252";
  }

  const prefix = text.replace(/^\uFEFF/, "").trimStart().slice(0, 200);
  if (/^<(?:!doctype|html|head|body)\b/i.test(prefix)) {
    throw new Error(
      `${inputLabel} returned an HTML document instead of the SBA RRF CSV.`,
    );
  }
  if (!/Loan\s*Number/i.test(text.slice(0, 2_000))) {
    throw new Error(
      `${inputLabel} does not contain the expected SBA RRF LoanNumber header.`,
    );
  }
  return { csv: text, encoding };
}

async function loadCsv(): Promise<{
  csv: string;
  inputLabel: string;
  sourceUrl: string;
  sourceDownloadUrl: string;
  encoding: "utf-8" | "windows-1252";
}> {
  const localInput = optionValue("input") ?? positionalInput();
  const requestedUrl = optionValue("url");
  const sourceUrl = optionValue("source-url") ?? SBA_RRF_DATASET_URL;

  if (localInput) {
    const inputPath = resolve(process.cwd(), localInput);
    if (!existsSync(inputPath)) {
      throw new Error(`Local CSV not found: ${inputPath}`);
    }
    const buffer = readFileSync(inputPath);
    const decoded = validateAndDecodeCsv(buffer, inputPath);
    return {
      csv: decoded.csv,
      inputLabel: inputPath,
      sourceUrl,
      sourceDownloadUrl:
        optionValue("source-download-url") ?? requestedUrl ?? SBA_RRF_CSV_URL,
      encoding: decoded.encoding,
    };
  }

  const downloadUrl = requestedUrl ?? SBA_RRF_CSV_URL;
  const response = await fetch(downloadUrl, {
    headers: {
      Accept: "text/csv,text/plain;q=0.9,*/*;q=0.1",
      "User-Agent": "Chicago Incentive Explorer source importer",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download SBA RRF CSV (${response.status} ${response.statusText}) from ${downloadUrl}.`,
    );
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_SOURCE_BYTES
  ) {
    throw new Error(
      `${downloadUrl} declares a response larger than the ${MAX_SOURCE_BYTES.toLocaleString("en-US")} byte safety limit.`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const decoded = validateAndDecodeCsv(
    buffer,
    downloadUrl,
    response.headers.get("content-type"),
  );
  return {
    csv: decoded.csv,
    inputLabel: response.url || downloadUrl,
    sourceUrl,
    sourceDownloadUrl: response.url || downloadUrl,
    encoding: decoded.encoding,
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
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    printHelp();
    return;
  }

  const sourceVersion =
    optionValue("source-version") ?? SBA_RRF_SOURCE_VERSION;
  const {
    csv,
    inputLabel,
    sourceUrl,
    sourceDownloadUrl,
    encoding,
  } = await loadCsv();
  const result = parseSbaRestaurantRevitalizationCsv(csv, {
    sourceUrl,
    sourceDownloadUrl,
    sourceVersion,
  });
  const summary = summarizeSbaRestaurantRevitalization(result);

  console.log(`Source: ${inputLabel}`);
  console.log(`Source version: ${sourceVersion}`);
  console.log(`Decoded source encoding: ${encoding}`);
  console.log(
    `Parsed ${summary.sourceRowCount.toLocaleString("en-US")} source rows; retained ${summary.chicagoRecordCount.toLocaleString("en-US")} explicit Chicago, Illinois awards.`,
  );
  console.log(
    `Historical disbursements: ${formatUsd(summary.chicagoGrantTotalUsd)} across retained Chicago records.`,
  );
  console.log(
    `Classification: ${SBA_RRF_CLASSIFICATION.fundingLaw}; ${SBA_RRF_CLASSIFICATION.programState}; ${SBA_RRF_CLASSIFICATION.amountContext}.`,
  );

  if (result.issues.length > 0) {
    for (const item of result.issues.slice(0, 50)) {
      console.error(
        `  source row ${item.sourceRow}, line ${item.sourceLine} [${item.severity}/${item.code}]${item.field ? ` ${item.field}` : ""}: ${item.message}`,
      );
    }
    if (result.issues.length > 50) {
      console.error(
        `  ...and ${result.issues.length - 50} more parser issue(s).`,
      );
    }
  }

  assertSbaRestaurantRevitalizationIntegrity(result, {
    sourceVersion,
    sourceRowCount: parseExpectedInteger(
      "expected-source-rows",
      SBA_RRF_FULL_SOURCE_EXPECTATIONS.sourceRowCount,
    ),
    chicagoRecordCount: parseExpectedInteger(
      "expected-chicago-rows",
      SBA_RRF_FULL_SOURCE_EXPECTATIONS.chicagoRecordCount,
    ),
    sourceGrantTotalUsd: parseExpectedUsd(
      "expected-source-total",
      SBA_RRF_FULL_SOURCE_EXPECTATIONS.sourceGrantTotalUsd,
    ),
    chicagoGrantTotalUsd: parseExpectedUsd(
      "expected-chicago-total",
      SBA_RRF_FULL_SOURCE_EXPECTATIONS.chicagoGrantTotalUsd,
    ),
    warningCount: parseExpectedInteger(
      "expected-warnings",
      SBA_RRF_FULL_SOURCE_EXPECTATIONS.warningCount,
    ),
  });

  const outputPath = resolve(
    process.cwd(),
    optionValue("output") ?? DEFAULT_OUTPUT_PATH,
  );
  const status = writeIfChanged(
    outputPath,
    serializeSbaRestaurantRevitalizationCsv(result.records),
  );
  console.log(
    status === "unchanged"
      ? `Verified unchanged: ${outputPath}`
      : `Wrote: ${outputPath}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
