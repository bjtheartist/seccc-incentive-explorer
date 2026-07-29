#!/usr/bin/env npx tsx
/**
 * Import Chicago's ARPA Road to Recovery program ledger.
 *
 * The output is citywide, program-level historical context. It is not a list
 * of recipient awards and does not represent active incentive dollars.
 *
 * Usage:
 *   npx tsx scripts/import-chicago-arpa-recovery.ts
 *   npx tsx scripts/import-chicago-arpa-recovery.ts --input /path/to/fixture.json
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHICAGO_ARPA_GRANTS_SUMMARY_API_URL,
  CHICAGO_ARPA_GRANTS_SUMMARY_DATASET_ID,
  CHICAGO_ARPA_PROGRAM_DETAILS_API_URL,
  CHICAGO_ARPA_PROGRAM_DETAILS_DATASET_ID,
  assertChicagoArpaRecoveryIntegrity,
  buildChicagoArpaRecoveryLedger,
  type ChicagoArpaRecoveryRecord,
  type ChicagoArpaRecoveryResult,
  type ChicagoArpaRecoverySourceInput,
} from "../lib/chicago-arpa-recovery";

const PROGRAM_DETAILS_METADATA_URL =
  `https://data.cityofchicago.org/api/views/${CHICAGO_ARPA_PROGRAM_DETAILS_DATASET_ID}`;
const GRANTS_SUMMARY_METADATA_URL =
  `https://data.cityofchicago.org/api/views/${CHICAGO_ARPA_GRANTS_SUMMARY_DATASET_ID}`;
const SOCRATA_PAGE_SIZE = 50_000;

export const DEFAULT_CHICAGO_ARPA_RECOVERY_OUTPUT = join(
  process.cwd(),
  "data",
  "curated",
  "investment-inputs",
  "chicago_arpa_road_to_recovery_programs.csv",
);

export interface ChicagoArpaRecoveryCliOptions {
  input: string | null;
  output: string;
}

interface LocalFixtureDataset {
  datasetId: unknown;
  asOf: unknown;
  rows: unknown;
}

interface LocalFixtureDocument {
  programDetails: LocalFixtureDataset;
  grantsSummary: LocalFixtureDataset;
}

interface SocrataMetadata {
  id: unknown;
  rowsUpdatedAt: unknown;
  columns: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseChicagoArpaRecoveryCliArgs(
  args: string[],
): ChicagoArpaRecoveryCliOptions {
  let input: string | null = null;
  let output = DEFAULT_CHICAGO_ARPA_RECOVERY_OUTPUT;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--input") {
      input = valueAfter(args, index, arg);
      index++;
    } else if (arg === "--output") {
      output = valueAfter(args, index, arg);
      index++;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else if (input === null) {
      input = arg;
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }

  return {
    input: input === null ? null : resolve(input),
    output: resolve(output),
  };
}

function requireFixtureDataset(
  value: unknown,
  label: string,
  expectedDatasetId: string,
): LocalFixtureDataset {
  if (!isRecord(value)) {
    throw new Error(`Local fixture ${label} must be an object`);
  }
  if (value.datasetId !== expectedDatasetId) {
    throw new Error(
      `Local fixture ${label} datasetId must be ${expectedDatasetId}`,
    );
  }
  if (!Array.isArray(value.rows)) {
    throw new Error(`Local fixture ${label}.rows must be an array`);
  }
  return {
    datasetId: value.datasetId,
    asOf: value.asOf,
    rows: value.rows,
  };
}

export function parseChicagoArpaRecoveryFixture(
  value: unknown,
): ChicagoArpaRecoverySourceInput {
  if (!isRecord(value)) {
    throw new Error("Local fixture must be a JSON object");
  }
  const fixture = value as unknown as LocalFixtureDocument;
  const programDetails = requireFixtureDataset(
    fixture.programDetails,
    "programDetails",
    CHICAGO_ARPA_PROGRAM_DETAILS_DATASET_ID,
  );
  const grantsSummary = requireFixtureDataset(
    fixture.grantsSummary,
    "grantsSummary",
    CHICAGO_ARPA_GRANTS_SUMMARY_DATASET_ID,
  );

  return {
    programDetails: programDetails.rows as unknown[],
    grantsSummary: grantsSummary.rows as unknown[],
    programDetailsAsOf: programDetails.asOf,
    grantsSummaryAsOf: grantsSummary.asOf,
  };
}

export function readChicagoArpaRecoveryFixture(
  path: string,
): ChicagoArpaRecoverySourceInput {
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Chicago ARPA fixture not found: ${resolvedPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Chicago ARPA fixture is not valid JSON: ${message}`);
  }
  return parseChicagoArpaRecoveryFixture(parsed);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Chicago-Incentive-Explorer-ARPA-Importer/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Socrata request failed (${response.status} ${response.statusText}): ${url}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    throw new Error(`Socrata returned non-JSON content for ${url}: ${contentType}`);
  }
  return response.json();
}

async function fetchSocrataRows(apiUrl: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  let offset = 0;

  while (true) {
    const url = new URL(apiUrl);
    url.searchParams.set("$limit", String(SOCRATA_PAGE_SIZE));
    url.searchParams.set("$offset", String(offset));
    url.searchParams.set("$order", "cost_center");
    const page = await fetchJson(url.toString());
    if (!Array.isArray(page)) {
      throw new Error(`Socrata rows endpoint did not return an array: ${apiUrl}`);
    }
    rows.push(...page);
    if (page.length < SOCRATA_PAGE_SIZE) break;
    offset += page.length;
  }

  return rows;
}

function requireSocrataAsOf(
  value: unknown,
  datasetId: string,
): string {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      `Socrata metadata for ${datasetId} has malformed rowsUpdatedAt`,
    );
  }
  return new Date(value * 1_000).toISOString();
}

function validateSocrataMetadata(
  value: unknown,
  expectedDatasetId: string,
  expectedFields: readonly string[],
): string {
  if (!isRecord(value)) {
    throw new Error(`Socrata metadata for ${expectedDatasetId} must be an object`);
  }
  const metadata = value as unknown as SocrataMetadata;
  if (metadata.id !== expectedDatasetId) {
    throw new Error(
      `Unexpected Socrata dataset contract: expected ${expectedDatasetId}, received ${String(metadata.id)}`,
    );
  }
  if (!Array.isArray(metadata.columns)) {
    throw new Error(`Socrata metadata for ${expectedDatasetId} is missing columns`);
  }

  const actualFields = new Set(
    metadata.columns.flatMap((column) =>
      isRecord(column) && typeof column.fieldName === "string"
        ? [column.fieldName]
        : [],
    ),
  );
  const missingFields = expectedFields.filter((field) => !actualFields.has(field));
  if (missingFields.length > 0) {
    throw new Error(
      `Unexpected Socrata dataset contract for ${expectedDatasetId}; missing fields: ${missingFields.join(", ")}`,
    );
  }

  return requireSocrataAsOf(metadata.rowsUpdatedAt, expectedDatasetId);
}

async function fetchChicagoArpaRecoverySources(): Promise<ChicagoArpaRecoverySourceInput> {
  const [
    programDetails,
    grantsSummary,
    programDetailsMetadata,
    grantsSummaryMetadata,
  ] = await Promise.all([
    fetchSocrataRows(CHICAGO_ARPA_PROGRAM_DETAILS_API_URL),
    fetchSocrataRows(CHICAGO_ARPA_GRANTS_SUMMARY_API_URL),
    fetchJson(PROGRAM_DETAILS_METADATA_URL),
    fetchJson(GRANTS_SUMMARY_METADATA_URL),
  ]);

  const programDetailsAsOf = validateSocrataMetadata(
    programDetailsMetadata,
    CHICAGO_ARPA_PROGRAM_DETAILS_DATASET_ID,
    [
      "program_name",
      "cost_center",
      "department_acronym",
      "department",
      "policy_pillar",
    ],
  );
  const grantsSummaryAsOf = validateSocrataMetadata(
    grantsSummaryMetadata,
    CHICAGO_ARPA_GRANTS_SUMMARY_DATASET_ID,
    [
      "cost_center",
      "amount_allocated",
      "amount_obligated",
      "amount_expended",
    ],
  );

  return {
    programDetails,
    grantsSummary,
    programDetailsAsOf,
    grantsSummaryAsOf,
  };
}

function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function historicalAmountCell(value: number | null): string {
  return value === null ? "" : value.toFixed(2);
}

export function serializeChicagoArpaRecoveryCsv(
  records: readonly ChicagoArpaRecoveryRecord[],
): string {
  const header = [
    "cost_center",
    "program_name",
    "administering_department",
    "department_acronym",
    "policy_pillar",
    "historical_amount_allocated_usd",
    "historical_amount_obligated_usd",
    "historical_amount_expended_usd",
    "record_granularity",
    "geographic_scope",
    "financial_context",
    "is_recipient_level_award",
    "is_active_incentive_dollars",
    "program_details_source_url",
    "grants_summary_source_url",
    "program_details_as_of",
    "grants_summary_as_of",
  ];

  const rows = [...records]
    .sort((a, b) => a.costCenter.localeCompare(b.costCenter))
    .map((record) =>
      [
        record.costCenter,
        record.programName,
        record.administeringDepartment,
        record.departmentAcronym,
        record.policyPillar,
        historicalAmountCell(record.historicalAmountAllocatedUsd),
        historicalAmountCell(record.historicalAmountObligatedUsd),
        historicalAmountCell(record.historicalAmountExpendedUsd),
        record.recordGranularity,
        record.geographicScope,
        record.financialContext,
        String(record.isRecipientLevelAward),
        String(record.isActiveIncentiveDollars),
        record.programDetailsSourceUrl,
        record.grantsSummarySourceUrl,
        record.programDetailsAsOf,
        record.grantsSummaryAsOf,
      ]
        .map(csvCell)
        .join(","),
    );

  return [header.join(","), ...rows].join("\n") + "\n";
}

export type AtomicWriteAction = "created" | "updated" | "unchanged";

export function writeFileAtomicallyIfChanged(
  path: string,
  contents: string,
): AtomicWriteAction {
  const resolvedPath = resolve(path);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  if (
    existsSync(resolvedPath) &&
    readFileSync(resolvedPath, "utf8") === contents
  ) {
    return "unchanged";
  }

  const action: AtomicWriteAction = existsSync(resolvedPath) ? "updated" : "created";
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

export async function importChicagoArpaRecovery(
  options: ChicagoArpaRecoveryCliOptions,
): Promise<ChicagoArpaRecoveryResult & { outputAction: AtomicWriteAction }> {
  const sourceInput = options.input
    ? readChicagoArpaRecoveryFixture(options.input)
    : await fetchChicagoArpaRecoverySources();
  const result = buildChicagoArpaRecoveryLedger(sourceInput);
  // Pin the full Socrata pull to its verified baseline BEFORE writing, so an
  // upstream row-count or dollar shift fails the import instead of silently
  // republishing. Skipped for a local --input fixture, which is deliberately a
  // small slice and would never match the full-source counts.
  if (options.input == null) {
    assertChicagoArpaRecoveryIntegrity(result);
  }
  const outputAction = writeFileAtomicallyIfChanged(
    options.output,
    serializeChicagoArpaRecoveryCsv(result.records),
  );
  return { ...result, outputAction };
}

const isDirectRun =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const options = parseChicagoArpaRecoveryCliArgs(process.argv.slice(2));
  importChicagoArpaRecovery(options)
    .then((result) => {
      console.log(
        JSON.stringify(
          {
            output: options.output,
            outputAction: result.outputAction,
            ...result.diagnostics,
          },
          null,
          2,
        ),
      );
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    });
}
