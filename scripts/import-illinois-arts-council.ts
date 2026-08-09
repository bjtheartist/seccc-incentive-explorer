#!/usr/bin/env npx tsx
/**
 * Import the Illinois Arts Council FY2026 Q1 grant table and retain only rows
 * whose source-published city is Chicago. The source provides no street address,
 * ZIP, coordinates, or official award id; none are inferred.
 */

import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  IAC_SOURCE_DATA_URL,
  IAC_SOURCE_EXPECTATIONS,
  parseIllinoisArtsCouncilSource,
  serializeIllinoisArtsCouncilAwards,
} from "../lib/illinois-arts-council";

const DEFAULT_OUTPUT =
  "data/curated/investment-inputs/illinois_arts_council_fy26_q1_chicago.csv";
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

function optionValue(name: string): string | null {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  const inline = args.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")
    ? args[index + 1]
    : null;
}

function validateText(
  buffer: Buffer,
  label: string,
  contentType?: string | null,
): string {
  if (buffer.length === 0 || buffer.length > MAX_SOURCE_BYTES) {
    throw new Error(`${label} returned an empty or oversized response.`);
  }
  const normalizedType = contentType?.toLowerCase() ?? "";
  if (
    normalizedType &&
    !normalizedType.includes("application/json") &&
    !normalizedType.includes("text/json")
  ) {
    throw new Error(`${label} returned ${contentType}, not JSON.`);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  if (/^\s*</.test(text)) {
    throw new Error(`${label} returned HTML instead of the grant table JSON.`);
  }
  return text;
}

async function loadSource(): Promise<string> {
  const input = optionValue("input");
  if (input) {
    const path = resolve(process.cwd(), input);
    return validateText(readFileSync(path), path);
  }

  const url = optionValue("url") ?? IAC_SOURCE_DATA_URL;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Illinois Arts Council download failed with HTTP ${response.status}.`);
  }
  return validateText(
    Buffer.from(await response.arrayBuffer()),
    url,
    response.headers.get("content-type"),
  );
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    console.log(`
Import Illinois Arts Council FY2026 Q1 Chicago awards.

Options:
  --input=<path>             Read a saved official JSON response.
  --url=<url>                Override the official data endpoint.
  --output=<path>            CSV destination (default: ${DEFAULT_OUTPUT}).
  --source-checked-at=YYYY-MM-DD
                             Source review date (default: today).

The importer fails on schema drift or any mismatch with the accepted official
source contract (${IAC_SOURCE_EXPECTATIONS.awardRows} statewide awards;
${IAC_SOURCE_EXPECTATIONS.chicagoRows} source-published Chicago rows). It never
creates addresses, coordinates, ZIP codes, eligibility claims, or current-funding
estimates.
`.trim());
    return;
  }

  const checkedAt =
    optionValue("source-checked-at") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) {
    throw new Error("--source-checked-at must use YYYY-MM-DD.");
  }

  const parsed = parseIllinoisArtsCouncilSource(await loadSource(), checkedAt);
  const outputPath = resolve(
    process.cwd(),
    optionValue("output") ?? DEFAULT_OUTPUT,
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp`;
  writeFileSync(
    tempPath,
    serializeIllinoisArtsCouncilAwards(parsed.chicagoAwards),
    "utf8",
  );
  renameSync(tempPath, outputPath);

  const chicagoDollars = parsed.chicagoAwards.reduce(
    (sum, award) => sum + award.grantAmount,
    0,
  );
  console.log(`Wrote ${outputPath}`);
  console.log(
    `  statewide=${parsed.awards.length} Chicago=${parsed.chicagoAwards.length} ` +
      `Chicago historical awards=$${chicagoDollars.toLocaleString("en-US")}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
