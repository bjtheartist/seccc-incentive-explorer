#!/usr/bin/env npx tsx
/**
 * Import a bounded Chicago CARES-era program ledger.
 *
 * The output contains closed historical program, program-administrator, and
 * grant-accounting records. It does not contain business-recipient records,
 * active incentive dollars, or mappable administrator addresses.
 *
 * Usage:
 *   npx tsx scripts/import-chicago-cares-program-ledger.ts
 *   npx tsx scripts/import-chicago-cares-program-ledger.ts --input fixture.json
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
  CHICAGO_CARES_CONTRACT_QUERIES,
  CHICAGO_CARES_SOURCE_ROW_LIMIT,
  CHICAGO_CONTRACTS_DATASET_ID,
  CHICAGO_MID_YEAR_GRANTS_DATASET_ID,
  CHICAGO_CDBG_CV_QUERY,
  buildChicagoCaresProgramLedger,
  getChicagoCaresContractQueryUrl,
  getChicagoCdbgCvQueryUrl,
  type ChicagoCaresContractQueryKey,
  type ChicagoCaresProgramLedgerRecord,
  type ChicagoCaresProgramLedgerResult,
  type ChicagoCaresProgramLedgerSourceInput,
} from "../lib/chicago-cares-program-ledger";

const CHICAGO_CONTRACTS_METADATA_URL =
  `https://data.cityofchicago.org/api/views/${CHICAGO_CONTRACTS_DATASET_ID}`;
const CHICAGO_MID_YEAR_GRANTS_METADATA_URL =
  `https://data.cityofchicago.org/api/views/${CHICAGO_MID_YEAR_GRANTS_DATASET_ID}`;

const CONTRACT_QUERY_KEYS = Object.keys(
  CHICAGO_CARES_CONTRACT_QUERIES,
) as ChicagoCaresContractQueryKey[];

const CONTRACT_REQUIRED_FIELDS = [
  "purchase_order_description",
  "purchase_order_contract_number",
  "revision_number",
  "specification_number",
  "contract_type",
  "approval_date",
  "department",
  "vendor_name",
  "vendor_id",
  "address_1",
  "city",
  "state",
  "zip",
  "award_amount",
] as const;

const GRANTS_REQUIRED_FIELDS = [
  "data_extract_as_of_date",
  "department_code",
  "department_description",
  "fund_code",
  "parent_cost_center_code",
  "grant_project_code",
  "grant_project_description",
  "grant_start_date",
  "grant_end_date",
  "grant_agency",
  "aln_code",
  "budget",
  "encumbrances",
  "expended_project_to_date",
  "record_id",
] as const;

export const DEFAULT_CHICAGO_CARES_PROGRAM_LEDGER_OUTPUT = join(
  process.cwd(),
  "data",
  "curated",
  "investment-inputs",
  "chicago_cares_program_ledger.csv",
);

export interface ChicagoCaresProgramLedgerCliOptions {
  input: string | null;
  output: string;
}

interface FixtureQuery {
  where: unknown;
  order: unknown;
  rows: unknown;
}

interface FixtureDataset {
  datasetId: unknown;
  asOf: unknown;
  queries?: unknown;
  where?: unknown;
  order?: unknown;
  rows?: unknown;
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

export function parseChicagoCaresProgramLedgerCliArgs(
  args: string[],
): ChicagoCaresProgramLedgerCliOptions {
  let input: string | null = null;
  let output = DEFAULT_CHICAGO_CARES_PROGRAM_LEDGER_OUTPUT;

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
  datasetId: string,
): FixtureDataset {
  if (!isRecord(value)) {
    throw new Error(`Local fixture ${label} must be an object`);
  }
  if (value.datasetId !== datasetId) {
    throw new Error(`Local fixture ${label} datasetId must be ${datasetId}`);
  }
  return value as unknown as FixtureDataset;
}

function requireFixtureQuery(
  value: unknown,
  key: ChicagoCaresContractQueryKey,
): readonly unknown[] {
  if (!isRecord(value)) {
    throw new Error(`Local fixture contracts.queries.${key} must be an object`);
  }
  const query = value as unknown as FixtureQuery;
  const expected = CHICAGO_CARES_CONTRACT_QUERIES[key];
  if (query.where !== expected.where || query.order !== expected.order) {
    throw new Error(
      `Local fixture contracts.queries.${key} does not match the bounded query contract`,
    );
  }
  if (!Array.isArray(query.rows)) {
    throw new Error(`Local fixture contracts.queries.${key}.rows must be an array`);
  }
  return query.rows;
}

export function parseChicagoCaresProgramLedgerFixture(
  value: unknown,
): ChicagoCaresProgramLedgerSourceInput {
  if (!isRecord(value)) {
    throw new Error("Local fixture must be a JSON object");
  }
  const contracts = requireFixtureDataset(
    value.contracts,
    "contracts",
    CHICAGO_CONTRACTS_DATASET_ID,
  );
  const cdbgCvAccounting = requireFixtureDataset(
    value.cdbgCvAccounting,
    "cdbgCvAccounting",
    CHICAGO_MID_YEAR_GRANTS_DATASET_ID,
  );
  if (!isRecord(contracts.queries)) {
    throw new Error("Local fixture contracts.queries must be an object");
  }
  const fixtureQueries = contracts.queries;
  if (
    cdbgCvAccounting.where !== CHICAGO_CDBG_CV_QUERY.where ||
    cdbgCvAccounting.order !== CHICAGO_CDBG_CV_QUERY.order
  ) {
    throw new Error(
      "Local fixture cdbgCvAccounting does not match the bounded query contract",
    );
  }
  if (!Array.isArray(cdbgCvAccounting.rows)) {
    throw new Error("Local fixture cdbgCvAccounting.rows must be an array");
  }

  const contractRows: Record<
    ChicagoCaresContractQueryKey,
    readonly unknown[]
  > = {
    togetherNow: requireFixtureQuery(
      fixtureQueries.togetherNow,
      "togetherNow",
    ),
    chicagoHospitalityGrant: requireFixtureQuery(
      fixtureQueries.chicagoHospitalityGrant,
      "chicagoHospitalityGrant",
    ),
    performanceVenueRelief: requireFixtureQuery(
      fixtureQueries.performanceVenueRelief,
      "performanceVenueRelief",
    ),
    covidSmallBusinessSupport: requireFixtureQuery(
      fixtureQueries.covidSmallBusinessSupport,
      "covidSmallBusinessSupport",
    ),
  };

  return {
    contractRows,
    contractDatasetUpdatedAt: contracts.asOf,
    cdbgCvRows: cdbgCvAccounting.rows,
    grantsDatasetUpdatedAt: cdbgCvAccounting.asOf,
  };
}

export function readChicagoCaresProgramLedgerFixture(
  path: string,
): ChicagoCaresProgramLedgerSourceInput {
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Chicago CARES ledger fixture not found: ${resolvedPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Chicago CARES ledger fixture is not valid JSON: ${message}`);
  }
  return parseChicagoCaresProgramLedgerFixture(parsed);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Chicago-Incentive-Explorer-CARES-Ledger-Importer/1.0",
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

async function fetchBoundedRows(url: string, label: string): Promise<unknown[]> {
  const value = await fetchJson(url);
  if (!Array.isArray(value)) {
    throw new Error(`${label} did not return a JSON array`);
  }
  if (value.length >= CHICAGO_CARES_SOURCE_ROW_LIMIT) {
    throw new Error(
      `${label} reached the ${CHICAGO_CARES_SOURCE_ROW_LIMIT}-row safety bound and may be truncated`,
    );
  }
  return value;
}

function requireMetadataTimestamp(value: unknown, datasetId: string): string {
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
  datasetId: string,
  requiredFields: readonly string[],
): string {
  if (!isRecord(value)) {
    throw new Error(`Socrata metadata for ${datasetId} must be an object`);
  }
  const metadata = value as unknown as SocrataMetadata;
  if (metadata.id !== datasetId) {
    throw new Error(
      `Unexpected Socrata dataset contract: expected ${datasetId}, received ${String(metadata.id)}`,
    );
  }
  if (!Array.isArray(metadata.columns)) {
    throw new Error(`Socrata metadata for ${datasetId} is missing columns`);
  }
  const fields = new Set(
    metadata.columns.flatMap((column) =>
      isRecord(column) && typeof column.fieldName === "string"
        ? [column.fieldName]
        : [],
    ),
  );
  const missing = requiredFields.filter((field) => !fields.has(field));
  if (missing.length > 0) {
    throw new Error(
      `Unexpected Socrata dataset contract for ${datasetId}; missing fields: ${missing.join(", ")}`,
    );
  }
  return requireMetadataTimestamp(metadata.rowsUpdatedAt, datasetId);
}

// Sol gate finding 7 (BLOCKER) — exported so scripts/refresh/refresh-live-sources.ts
// can build the CARES CSV content the SAME way every other refresh source
// does (fetch -> pure build -> serialize -> return a string), instead of the
// removed writeSelf() bypass that wrote before refreshOne() could measure and
// enforce the manifest's decreasePolicy.
export async function fetchChicagoCaresProgramLedgerSources(): Promise<ChicagoCaresProgramLedgerSourceInput> {
  const contractQueryRequests = CONTRACT_QUERY_KEYS.map(async (key) => {
    const rows = await fetchBoundedRows(
      getChicagoCaresContractQueryUrl(key),
      `${CHICAGO_CONTRACTS_DATASET_ID}/${key}`,
    );
    return [key, rows] as const;
  });
  const [
    contractQueryEntries,
    cdbgCvRows,
    contractMetadata,
    grantsMetadata,
  ] = await Promise.all([
    Promise.all(contractQueryRequests),
    fetchBoundedRows(
      getChicagoCdbgCvQueryUrl(),
      `${CHICAGO_MID_YEAR_GRANTS_DATASET_ID}/cdbg-cv`,
    ),
    fetchJson(CHICAGO_CONTRACTS_METADATA_URL),
    fetchJson(CHICAGO_MID_YEAR_GRANTS_METADATA_URL),
  ]);

  const contractDatasetUpdatedAt = validateSocrataMetadata(
    contractMetadata,
    CHICAGO_CONTRACTS_DATASET_ID,
    CONTRACT_REQUIRED_FIELDS,
  );
  const grantsDatasetUpdatedAt = validateSocrataMetadata(
    grantsMetadata,
    CHICAGO_MID_YEAR_GRANTS_DATASET_ID,
    GRANTS_REQUIRED_FIELDS,
  );

  const contractRows: Record<
    ChicagoCaresContractQueryKey,
    readonly unknown[]
  > = {
    togetherNow: [],
    chicagoHospitalityGrant: [],
    performanceVenueRelief: [],
    covidSmallBusinessSupport: [],
  };
  for (const [key, rows] of contractQueryEntries) {
    contractRows[key] = rows;
  }

  return {
    contractRows,
    contractDatasetUpdatedAt,
    cdbgCvRows,
    grantsDatasetUpdatedAt,
  };
}

function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function nullableCell(value: string | number | null): string {
  if (value === null) return "";
  return typeof value === "number" ? String(value) : value;
}

function currencyCell(value: number | null): string {
  return value === null ? "" : value.toFixed(2);
}

export function serializeChicagoCaresProgramLedgerCsv(
  records: readonly ChicagoCaresProgramLedgerRecord[],
): string {
  const header = [
    "record_id",
    "program_id",
    "program_name",
    "record_kind",
    "assistance_type",
    "funding_classification",
    "program_status",
    "administrator_name",
    "administering_department",
    "historical_authorized_usd",
    "historical_budgeted_usd",
    "historical_encumbered_usd",
    "historical_expended_usd",
    "financial_stage_note",
    "record_granularity",
    "geographic_scope",
    "is_business_recipient",
    "is_mappable_business_location",
    "is_active_incentive_dollars",
    "address_use_policy",
    "financial_aggregation_policy",
    "source_authority",
    "source_dataset_id",
    "source_record_ids",
    "source_url",
    "source_query_url",
    "source_as_of",
    "source_dataset_updated_at",
    "specification_number",
    "contract_numbers",
    "source_revision_count",
    "latest_revision_number",
    "grant_project_code",
    "fund_code",
    "parent_cost_center_code",
    "aln_code",
    "period_start",
    "period_end",
  ];

  const rows = [...records]
    .sort((a, b) => a.recordId.localeCompare(b.recordId, undefined, { numeric: true }))
    .map((record) =>
      [
        record.recordId,
        record.programId,
        record.programName,
        record.recordKind,
        record.assistanceType,
        record.fundingClassification,
        record.programStatus,
        nullableCell(record.administratorName),
        nullableCell(record.administeringDepartment),
        currencyCell(record.historicalAuthorizedUsd),
        currencyCell(record.historicalBudgetedUsd),
        currencyCell(record.historicalEncumberedUsd),
        currencyCell(record.historicalExpendedUsd),
        record.financialStageNote,
        record.recordGranularity,
        record.geographicScope,
        String(record.isBusinessRecipient),
        String(record.isMappableBusinessLocation),
        String(record.isActiveIncentiveDollars),
        record.addressUsePolicy,
        record.financialAggregationPolicy,
        record.sourceAuthority,
        nullableCell(record.sourceDatasetId),
        record.sourceRecordIds.join("|"),
        record.sourceUrl,
        nullableCell(record.sourceQueryUrl),
        nullableCell(record.sourceAsOf),
        nullableCell(record.sourceDatasetUpdatedAt),
        nullableCell(record.specificationNumber),
        record.contractNumbers.join("|"),
        String(record.sourceRevisionCount),
        nullableCell(record.latestRevisionNumber),
        nullableCell(record.grantProjectCode),
        nullableCell(record.fundCode),
        nullableCell(record.parentCostCenterCode),
        nullableCell(record.alnCode),
        nullableCell(record.periodStart),
        nullableCell(record.periodEnd),
      ]
        .map((value) => csvCell(value))
        .join(","),
    );

  return [header.join(","), ...rows].join("\n") + "\n";
}

export type ChicagoCaresAtomicWriteAction =
  | "created"
  | "updated"
  | "unchanged";

export function writeChicagoCaresFileAtomicallyIfChanged(
  path: string,
  contents: string,
): ChicagoCaresAtomicWriteAction {
  const resolvedPath = resolve(path);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  if (
    existsSync(resolvedPath) &&
    readFileSync(resolvedPath, "utf8") === contents
  ) {
    return "unchanged";
  }

  const action: ChicagoCaresAtomicWriteAction = existsSync(resolvedPath)
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

export async function importChicagoCaresProgramLedger(
  options: ChicagoCaresProgramLedgerCliOptions,
): Promise<
  ChicagoCaresProgramLedgerResult & {
    outputAction: ChicagoCaresAtomicWriteAction;
  }
> {
  const input = options.input
    ? readChicagoCaresProgramLedgerFixture(options.input)
    : await fetchChicagoCaresProgramLedgerSources();
  const result = buildChicagoCaresProgramLedger(input);
  const outputAction = writeChicagoCaresFileAtomicallyIfChanged(
    options.output,
    serializeChicagoCaresProgramLedgerCsv(result.records),
  );
  return { ...result, outputAction };
}

const isDirectRun =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const options = parseChicagoCaresProgramLedgerCliArgs(process.argv.slice(2));
  importChicagoCaresProgramLedger(options)
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
      const message =
        error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    });
}
