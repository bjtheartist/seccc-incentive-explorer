export const CHICAGO_ARPA_PROGRAM_DETAILS_DATASET_ID = "m9g9-cj96";
export const CHICAGO_ARPA_GRANTS_SUMMARY_DATASET_ID = "9yp3-9pdz";

export const CHICAGO_ARPA_PROGRAM_DETAILS_SOURCE_URL =
  "https://data.cityofchicago.org/Administration-Finance/ARPA-Road-to-Recovery-Program-Details/m9g9-cj96";
export const CHICAGO_ARPA_GRANTS_SUMMARY_SOURCE_URL =
  "https://data.cityofchicago.org/Administration-Finance/ARPA-Road-to-Recovery-Grants-Summary-Report/9yp3-9pdz";

export const CHICAGO_ARPA_PROGRAM_DETAILS_API_URL =
  `https://data.cityofchicago.org/resource/${CHICAGO_ARPA_PROGRAM_DETAILS_DATASET_ID}.json`;
export const CHICAGO_ARPA_GRANTS_SUMMARY_API_URL =
  `https://data.cityofchicago.org/resource/${CHICAGO_ARPA_GRANTS_SUMMARY_DATASET_ID}.json`;

export const CHICAGO_ARPA_RECOVERY_CLASSIFICATION = {
  recordGranularity: "program_level",
  geographicScope: "citywide_context",
  financialContext: "historical_cumulative_program_financials",
  isRecipientLevelAward: false,
  isActiveIncentiveDollars: false,
} as const;

export interface ChicagoArpaRecoveryRecord {
  costCenter: string;
  programName: string;
  administeringDepartment: string;
  departmentAcronym: string;
  policyPillar: string;
  historicalAmountAllocatedUsd: number | null;
  historicalAmountObligatedUsd: number | null;
  historicalAmountExpendedUsd: number | null;
  recordGranularity: typeof CHICAGO_ARPA_RECOVERY_CLASSIFICATION.recordGranularity;
  geographicScope: typeof CHICAGO_ARPA_RECOVERY_CLASSIFICATION.geographicScope;
  financialContext: typeof CHICAGO_ARPA_RECOVERY_CLASSIFICATION.financialContext;
  isRecipientLevelAward: false;
  isActiveIncentiveDollars: false;
  programDetailsSourceUrl: string;
  grantsSummarySourceUrl: string;
  programDetailsAsOf: string;
  grantsSummaryAsOf: string;
}

export interface ChicagoArpaRecoveryDiagnostics {
  programDetailCount: number;
  financialSummaryCount: number;
  joinedFinancialCount: number;
  metadataOnlyCount: number;
  metadataOnlyCostCenters: string[];
}

export interface ChicagoArpaRecoveryResult {
  records: ChicagoArpaRecoveryRecord[];
  diagnostics: ChicagoArpaRecoveryDiagnostics;
}

/**
 * The verified shape and dollar totals of the committed ledger, pinned so a
 * silent upstream shift fails the import instead of publishing.
 *
 * Cook Source, Illinois B2B, and SBA RRF all pin exact published figures and
 * fail closed; ARPA validated STRUCTURE only (dataset ids, required fields,
 * duplicate/orphan cost centers, currency format), so a changed row count or
 * dollar total on the next Socrata pull would have passed unnoticed. This closes
 * that gap.
 *
 * Recomputed from data/curated/investment-inputs/chicago_arpa_road_to_recovery_programs.csv:
 * 77 programs, of which 67 join a Grants Summary financial row and 10 are
 * metadata-only (present in Program Details with no summary row, kept in the
 * ledger with null financial fields).
 *
 * NOTE: allocated and obligated are equal here because the City's Grants Summary
 * reports them at the same stage — an upstream characteristic, not a copy in
 * this code (the two fields are read independently). They remain SEPARATE fields
 * and are never summed; expended is genuinely distinct.
 */
export const CHICAGO_ARPA_FULL_SOURCE_EXPECTATIONS = {
  programCount: 77,
  financialRowCount: 67,
  metadataOnlyCount: 10,
  historicalAllocatedTotalUsd: 1_886_591_388,
  historicalObligatedTotalUsd: 1_886_591_388,
  historicalExpendedTotalUsd: 1_851_247_214.66,
} as const;

export type ChicagoArpaRecoveryExpectations = Partial<
  typeof CHICAGO_ARPA_FULL_SOURCE_EXPECTATIONS
>;

export class ChicagoArpaRecoveryIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChicagoArpaRecoveryIntegrityError";
  }
}

/** Sum one historical money field across the ledger, ignoring null rows. */
function sumHistoricalField(
  records: readonly ChicagoArpaRecoveryRecord[],
  field:
    | "historicalAmountAllocatedUsd"
    | "historicalAmountObligatedUsd"
    | "historicalAmountExpendedUsd",
): number {
  // Accumulate in integer cents so a 67-term float sum reproduces exactly.
  const cents = records.reduce((sum, record) => {
    const value = record[field];
    return value == null ? sum : sum + Math.round(value * 100);
  }, 0);
  return cents / 100;
}

/**
 * Fail the import when the committed ledger drifts from its verified baseline.
 * Each money field is checked against ITS OWN total — the three stages are never
 * combined into a headline.
 */
export function assertChicagoArpaRecoveryIntegrity(
  result: ChicagoArpaRecoveryResult,
  expectations: ChicagoArpaRecoveryExpectations = CHICAGO_ARPA_FULL_SOURCE_EXPECTATIONS,
): void {
  const problems: string[] = [];
  const check = (label: string, actual: number, expected: number | undefined) => {
    if (expected != null && actual !== expected) {
      problems.push(
        `expected ${label} ${expected.toLocaleString("en-US")}, got ${actual.toLocaleString("en-US")}`,
      );
    }
  };

  check("program count", result.records.length, expectations.programCount);
  check(
    "financial row count",
    result.diagnostics.joinedFinancialCount,
    expectations.financialRowCount,
  );
  check(
    "metadata-only count",
    result.diagnostics.metadataOnlyCount,
    expectations.metadataOnlyCount,
  );
  check(
    "allocated total",
    sumHistoricalField(result.records, "historicalAmountAllocatedUsd"),
    expectations.historicalAllocatedTotalUsd,
  );
  check(
    "obligated total",
    sumHistoricalField(result.records, "historicalAmountObligatedUsd"),
    expectations.historicalObligatedTotalUsd,
  );
  check(
    "expended total",
    sumHistoricalField(result.records, "historicalAmountExpendedUsd"),
    expectations.historicalExpendedTotalUsd,
  );

  if (problems.length > 0) {
    throw new ChicagoArpaRecoveryIntegrityError(
      `Chicago ARPA Road to Recovery integrity check failed: ${problems.join("; ")}.`,
    );
  }
}

export interface ChicagoArpaRecoverySourceInput {
  programDetails: readonly unknown[];
  grantsSummary: readonly unknown[];
  programDetailsAsOf: unknown;
  grantsSummaryAsOf: unknown;
}

interface ParsedProgramDetail {
  costCenter: string;
  programName: string;
  departmentAcronym: string;
  administeringDepartment: string;
  policyPillar: string;
}

interface ParsedFinancialSummary {
  costCenter: string;
  amountAllocated: number;
  amountObligated: number;
  amountExpended: number;
}

export class ChicagoArpaRecoveryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChicagoArpaRecoveryParseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRowObject(
  value: unknown,
  dataset: string,
  rowNumber: number,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ChicagoArpaRecoveryParseError(
      `${dataset} row ${rowNumber} must be a JSON object`,
    );
  }
  return value;
}

function requireText(
  value: unknown,
  field: string,
  dataset: string,
  rowNumber: number,
): string {
  if (typeof value !== "string") {
    throw new ChicagoArpaRecoveryParseError(
      `${dataset} row ${rowNumber} field ${field} must be text`,
    );
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new ChicagoArpaRecoveryParseError(
      `${dataset} row ${rowNumber} field ${field} is missing`,
    );
  }
  return normalized;
}

function requireCostCenter(
  value: unknown,
  dataset: string,
  rowNumber: number,
): string {
  const costCenter = requireText(value, "cost_center", dataset, rowNumber);
  if (!/^[A-Za-z0-9]+$/.test(costCenter)) {
    throw new ChicagoArpaRecoveryParseError(
      `${dataset} row ${rowNumber} has malformed cost_center ${JSON.stringify(costCenter)}`,
    );
  }
  return costCenter;
}

export function parseChicagoArpaHistoricalAmount(
  value: unknown,
  field: string,
  rowNumber: number,
): number {
  let normalized: string;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new ChicagoArpaRecoveryParseError(
        `grants summary row ${rowNumber} field ${field} is not a non-negative number`,
      );
    }
    normalized = value.toString();
  } else if (typeof value === "string") {
    normalized = value.trim();
  } else {
    throw new ChicagoArpaRecoveryParseError(
      `grants summary row ${rowNumber} field ${field} must be a number`,
    );
  }

  const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    throw new ChicagoArpaRecoveryParseError(
      `grants summary row ${rowNumber} field ${field} has malformed number ${JSON.stringify(value)}`,
    );
  }

  const centsText = `${match[1]}${(match[2] ?? "").padEnd(2, "0")}`;
  const cents = Number(centsText);
  if (!Number.isSafeInteger(cents)) {
    throw new ChicagoArpaRecoveryParseError(
      `grants summary row ${rowNumber} field ${field} exceeds safe currency precision`,
    );
  }
  return cents / 100;
}

export function normalizeChicagoArpaAsOf(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ChicagoArpaRecoveryParseError(`${label} as-of timestamp is missing`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ChicagoArpaRecoveryParseError(
      `${label} as-of timestamp is malformed: ${JSON.stringify(value)}`,
    );
  }
  return new Date(parsed).toISOString();
}

function parseProgramDetails(rows: readonly unknown[]): ParsedProgramDetail[] {
  return rows.map((value, index) => {
    const rowNumber = index + 1;
    const row = requireRowObject(value, "program details", rowNumber);
    return {
      costCenter: requireCostCenter(row.cost_center, "program details", rowNumber),
      programName: requireText(
        row.program_name,
        "program_name",
        "program details",
        rowNumber,
      ),
      departmentAcronym: requireText(
        row.department_acronym,
        "department_acronym",
        "program details",
        rowNumber,
      ),
      administeringDepartment: requireText(
        row.department,
        "department",
        "program details",
        rowNumber,
      ),
      policyPillar: requireText(
        row.policy_pillar,
        "policy_pillar",
        "program details",
        rowNumber,
      ),
    };
  });
}

function parseFinancialSummaries(rows: readonly unknown[]): ParsedFinancialSummary[] {
  return rows.map((value, index) => {
    const rowNumber = index + 1;
    const row = requireRowObject(value, "grants summary", rowNumber);
    return {
      costCenter: requireCostCenter(row.cost_center, "grants summary", rowNumber),
      amountAllocated: parseChicagoArpaHistoricalAmount(
        row.amount_allocated,
        "amount_allocated",
        rowNumber,
      ),
      amountObligated: parseChicagoArpaHistoricalAmount(
        row.amount_obligated,
        "amount_obligated",
        rowNumber,
      ),
      amountExpended: parseChicagoArpaHistoricalAmount(
        row.amount_expended,
        "amount_expended",
        rowNumber,
      ),
    };
  });
}

function uniqueIndex<T extends { costCenter: string }>(
  rows: readonly T[],
  dataset: string,
): Map<string, T> {
  const index = new Map<string, T>();
  for (const row of rows) {
    if (index.has(row.costCenter)) {
      throw new ChicagoArpaRecoveryParseError(
        `${dataset} contains duplicate cost_center ${row.costCenter}`,
      );
    }
    index.set(row.costCenter, row);
  }
  return index;
}

export function buildChicagoArpaRecoveryLedger(
  input: ChicagoArpaRecoverySourceInput,
): ChicagoArpaRecoveryResult {
  if (!Array.isArray(input.programDetails) || !Array.isArray(input.grantsSummary)) {
    throw new ChicagoArpaRecoveryParseError(
      "Chicago ARPA source contract requires programDetails and grantsSummary arrays",
    );
  }

  const programDetailsAsOf = normalizeChicagoArpaAsOf(
    input.programDetailsAsOf,
    "program details",
  );
  const grantsSummaryAsOf = normalizeChicagoArpaAsOf(
    input.grantsSummaryAsOf,
    "grants summary",
  );
  const programDetails = parseProgramDetails(input.programDetails);
  const financialSummaries = parseFinancialSummaries(input.grantsSummary);
  const detailByCostCenter = uniqueIndex(programDetails, "program details");
  const summaryByCostCenter = uniqueIndex(financialSummaries, "grants summary");

  const orphanSummaryCostCenters = financialSummaries
    .filter((summary) => !detailByCostCenter.has(summary.costCenter))
    .map((summary) => summary.costCenter)
    .sort();
  if (orphanSummaryCostCenters.length > 0) {
    throw new ChicagoArpaRecoveryParseError(
      `grants summary contains cost_center values missing from program details: ${orphanSummaryCostCenters.join(", ")}`,
    );
  }

  const records = [...programDetails]
    .sort((a, b) => a.costCenter.localeCompare(b.costCenter))
    .map((detail): ChicagoArpaRecoveryRecord => {
      const financial = summaryByCostCenter.get(detail.costCenter);
      return {
        costCenter: detail.costCenter,
        programName: detail.programName,
        administeringDepartment: detail.administeringDepartment,
        departmentAcronym: detail.departmentAcronym,
        policyPillar: detail.policyPillar,
        historicalAmountAllocatedUsd: financial?.amountAllocated ?? null,
        historicalAmountObligatedUsd: financial?.amountObligated ?? null,
        historicalAmountExpendedUsd: financial?.amountExpended ?? null,
        ...CHICAGO_ARPA_RECOVERY_CLASSIFICATION,
        programDetailsSourceUrl: CHICAGO_ARPA_PROGRAM_DETAILS_SOURCE_URL,
        grantsSummarySourceUrl: CHICAGO_ARPA_GRANTS_SUMMARY_SOURCE_URL,
        programDetailsAsOf,
        grantsSummaryAsOf,
      };
    });

  const metadataOnlyCostCenters = records
    .filter((record) => record.historicalAmountAllocatedUsd === null)
    .map((record) => record.costCenter);

  return {
    records,
    diagnostics: {
      programDetailCount: programDetails.length,
      financialSummaryCount: financialSummaries.length,
      joinedFinancialCount: financialSummaries.length,
      metadataOnlyCount: metadataOnlyCostCenters.length,
      metadataOnlyCostCenters,
    },
  };
}
