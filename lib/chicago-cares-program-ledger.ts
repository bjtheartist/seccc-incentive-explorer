export const CHICAGO_CONTRACTS_DATASET_ID = "rsxa-ify5";
export const CHICAGO_MID_YEAR_GRANTS_DATASET_ID = "iyu8-jkf8";

export const CHICAGO_CONTRACTS_SOURCE_URL =
  `https://data.cityofchicago.org/d/${CHICAGO_CONTRACTS_DATASET_ID}`;
export const CHICAGO_MID_YEAR_GRANTS_SOURCE_URL =
  `https://data.cityofchicago.org/d/${CHICAGO_MID_YEAR_GRANTS_DATASET_ID}`;

export const CHICAGO_CONTRACTS_API_URL =
  `https://data.cityofchicago.org/resource/${CHICAGO_CONTRACTS_DATASET_ID}.json`;
export const CHICAGO_MID_YEAR_GRANTS_API_URL =
  `https://data.cityofchicago.org/resource/${CHICAGO_MID_YEAR_GRANTS_DATASET_ID}.json`;

export const CHICAGO_SMALL_BUSINESS_RESILIENCY_SOURCE_URL =
  "https://chicagocitytreasurer.com/catalyst-fund/";
export const CHICAGO_MICROBUSINESS_RECOVERY_SOURCE_URL =
  "https://chiul.org/2020/04/29/apply-for-the-city-of-chicagos-microbusiness-recovery-grant-program-by-may-4/";

export const CHICAGO_CARES_SOURCE_ROW_LIMIT = 5_000;

export const CHICAGO_CARES_CONTRACT_QUERIES = {
  togetherNow: {
    where: "upper(purchase_order_description) like '%TOGETHER NOW%'",
    order: "purchase_order_contract_number,revision_number",
  },
  chicagoHospitalityGrant: {
    where: "specification_number='1215482'",
    order: "purchase_order_contract_number,revision_number",
  },
  performanceVenueRelief: {
    where: "purchase_order_contract_number='144242'",
    order: "purchase_order_contract_number,revision_number",
  },
  covidSmallBusinessSupport: {
    where: "specification_number='1231590'",
    order: "purchase_order_contract_number,revision_number",
  },
} as const;

export const CHICAGO_CDBG_CV_QUERY = {
  where: "grant_project_code in('CARES20CD','CARES20DB')",
  order:
    "grant_project_code,department_code,parent_cost_center_code,record_id",
} as const;

export type ChicagoCaresContractQueryKey =
  keyof typeof CHICAGO_CARES_CONTRACT_QUERIES;

export type ChicagoCaresRecordKind =
  | "program"
  | "program_administrator"
  | "program_accounting";

export type ChicagoCaresAssistanceType =
  | "loan"
  | "grant"
  | "grant_administration"
  | "business_support_administration"
  | "federal_grant_accounting";

export interface ChicagoCaresProgramLedgerRecord {
  recordId: string;
  programId: string;
  programName: string;
  recordKind: ChicagoCaresRecordKind;
  assistanceType: ChicagoCaresAssistanceType;
  fundingClassification: string;
  programStatus: "closed_historical";
  administratorName: string | null;
  administeringDepartment: string | null;
  historicalAuthorizedUsd: number | null;
  historicalBudgetedUsd: number | null;
  historicalEncumberedUsd: number | null;
  historicalExpendedUsd: number | null;
  financialStageNote: string;
  recordGranularity:
    | "program_level"
    | "administrator_level"
    | "accounting_level";
  geographicScope: "citywide_context" | "eligible_community_areas_context";
  isBusinessRecipient: false;
  isMappableBusinessLocation: false;
  isActiveIncentiveDollars: false;
  addressUsePolicy:
    | "no_recipient_address_available"
    | "administrator_address_excluded";
  financialAggregationPolicy: "never_sum_across_records";
  sourceAuthority: string;
  sourceDatasetId: string | null;
  sourceRecordIds: string[];
  sourceUrl: string;
  sourceQueryUrl: string | null;
  sourceAsOf: string | null;
  sourceDatasetUpdatedAt: string | null;
  specificationNumber: string | null;
  contractNumbers: string[];
  sourceRevisionCount: number;
  latestRevisionNumber: number | null;
  grantProjectCode: string | null;
  fundCode: string | null;
  parentCostCenterCode: string | null;
  alnCode: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface ChicagoCaresProgramLedgerSourceInput {
  contractRows: Record<ChicagoCaresContractQueryKey, readonly unknown[]>;
  contractDatasetUpdatedAt: unknown;
  cdbgCvRows: readonly unknown[];
  grantsDatasetUpdatedAt: unknown;
}

export interface ChicagoCaresProgramLedgerDiagnostics {
  programRecordCount: number;
  contractSourceRowCount: number;
  administratorRecordCount: number;
  duplicateContractRowsIgnored: number;
  duplicatePoMirrorsCollapsed: number;
  accountingSourceRowCount: number;
  accountingRecordCount: number;
  totalRecordCount: number;
}

export interface ChicagoCaresProgramLedgerResult {
  records: ChicagoCaresProgramLedgerRecord[];
  diagnostics: ChicagoCaresProgramLedgerDiagnostics;
}

interface ContractProgramDefinition {
  key: ChicagoCaresContractQueryKey;
  programId: string;
  programName: string;
  assistanceType:
    | "grant_administration"
    | "business_support_administration";
  fundingClassification: string;
  administeringDepartment: string;
}

interface ParsedContractRow {
  contractNumber: string;
  revisionNumber: number;
  specificationNumber: string;
  purchaseOrderDescription: string;
  department: string | null;
  vendorName: string;
  vendorId: string;
  awardAmountUsd: number;
  approvalDate: string | null;
  startDate: string | null;
  endDate: string | null;
  hasContractPdf: boolean;
  administratorAddressWasPresent: boolean;
  fingerprint: string;
}

interface CanonicalContract {
  contractNumbers: string[];
  specificationNumber: string;
  vendorName: string;
  vendorId: string;
  department: string | null;
  historicalAuthorizedUsd: number;
  approvalDate: string | null;
  startDate: string | null;
  endDate: string | null;
  sourceRevisionCount: number;
  latestRevisionNumber: number;
  hasContractPdf: boolean;
  administratorAddressWasPresent: boolean;
}

const CONTRACT_PROGRAMS: readonly ContractProgramDefinition[] = [
  {
    key: "togetherNow",
    programId: "chicago-together-now",
    programName: "Together Now",
    assistanceType: "grant_administration",
    fundingClassification: "cares_era_mixed_or_unspecified",
    administeringDepartment:
      "Department of Business Affairs and Consumer Protection",
  },
  {
    key: "chicagoHospitalityGrant",
    programId: "chicago-hospitality-grant",
    programName: "Chicago Hospitality Grant",
    assistanceType: "grant_administration",
    fundingClassification: "cares_act",
    administeringDepartment:
      "Department of Business Affairs and Consumer Protection",
  },
  {
    key: "performanceVenueRelief",
    programId: "chicago-performance-venue-relief",
    programName: "Performance Venue Relief Program",
    assistanceType: "grant_administration",
    fundingClassification: "cares_era_city_program",
    administeringDepartment: "Department of Cultural Affairs",
  },
  {
    key: "covidSmallBusinessSupport",
    programId: "chicago-covid-small-business-support",
    programName: "COVID-19 Small Business Support",
    assistanceType: "business_support_administration",
    fundingClassification: "federal_covid_relief_unspecified",
    administeringDepartment:
      "Department of Business Affairs and Consumer Protection",
  },
] as const;

const PROGRAM_RECORD_NOTE =
  "Closed historical program context. Administrator contracts are represented separately and must not be summed into a program total.";
const CONTRACT_RECORD_NOTE =
  "Original City contract authorization from revision 0. Contract revisions and duplicate PO mirrors were not summed. This is an administrator contract, not a business-recipient award.";
const ACCOUNTING_RECORD_NOTE =
  "City grant-accounting record. Budget, encumbrances, and expenditures are separate historical stages, not business-recipient awards. The relief opportunity is closed even if administrative accounting remained open.";

/**
 * Source-literal vendor cleanups on two POs. Later revisions retain the same
 * PO/specification and organization but publish cleaned names and new vendor
 * IDs. Keeping these exact corrections explicit prevents a broad fuzzy
 * identity rule from merging unrelated administrators.
 */
const DOCUMENTED_VENDOR_IDENTITY_CORRECTIONS = new Set([
  [
    "171971",
    "91490615T",
    "LAKEVIEW EAST CHAM OF COMMERCE|CLEANED-UP",
    "85240642X",
    "LAKEVIEW EAST CHAMBER OF COMMERCE",
  ].join("|"),
  [
    "176218",
    "15055418E",
    "GREATER S.W. DEVELOPMENT CORP.",
    "105473950T",
    "GREATER SOUTHWEST DEV CORP",
  ].join("|"),
]);

export class ChicagoCaresProgramLedgerParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChicagoCaresProgramLedgerParseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRow(
  value: unknown,
  source: string,
  rowNumber: number,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ChicagoCaresProgramLedgerParseError(
      `${source} row ${rowNumber} must be a JSON object`,
    );
  }
  return value;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || null;
}

function requireText(
  value: unknown,
  field: string,
  source: string,
  rowNumber: number,
): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new ChicagoCaresProgramLedgerParseError(
      `${source} row ${rowNumber} field ${field} is missing`,
    );
  }
  return normalized;
}

function requireDigits(
  value: unknown,
  field: string,
  source: string,
  rowNumber: number,
): string {
  const normalized = requireText(value, field, source, rowNumber);
  if (!/^\d+$/.test(normalized)) {
    throw new ChicagoCaresProgramLedgerParseError(
      `${source} row ${rowNumber} field ${field} must contain only digits`,
    );
  }
  return normalized;
}

function parseRevisionNumber(
  value: unknown,
  source: string,
  rowNumber: number,
): number {
  const normalized = requireDigits(
    value,
    "revision_number",
    source,
    rowNumber,
  );
  const revision = Number(normalized);
  if (!Number.isSafeInteger(revision)) {
    throw new ChicagoCaresProgramLedgerParseError(
      `${source} row ${rowNumber} revision_number exceeds safe integer precision`,
    );
  }
  return revision;
}

function parseCurrency(
  value: unknown,
  field: string,
  source: string,
  rowNumber: number,
  options: { nullable?: boolean; signed?: boolean } = {},
): number | null {
  if (value == null || value === "") {
    if (options.nullable) return null;
    throw new ChicagoCaresProgramLedgerParseError(
      `${source} row ${rowNumber} field ${field} is missing`,
    );
  }

  const normalized =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  const pattern = options.signed
    ? /^-?\d+(?:\.\d{1,2})?$/
    : /^\d+(?:\.\d{1,2})?$/;
  if (!pattern.test(normalized)) {
    throw new ChicagoCaresProgramLedgerParseError(
      `${source} row ${rowNumber} field ${field} has malformed currency ${JSON.stringify(value)}`,
    );
  }

  const sign = normalized.startsWith("-") ? -1 : 1;
  const unsigned = normalized.replace(/^-/, "");
  const [dollars, fraction = ""] = unsigned.split(".");
  const cents = Number(`${dollars}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(cents)) {
    throw new ChicagoCaresProgramLedgerParseError(
      `${source} row ${rowNumber} field ${field} exceeds safe currency precision`,
    );
  }
  return (sign * cents) / 100;
}

function normalizeDate(
  value: unknown,
  field: string,
  source: string,
  rowNumber: number,
  nullable = false,
): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    if (nullable) return null;
    throw new ChicagoCaresProgramLedgerParseError(
      `${source} row ${rowNumber} field ${field} is missing`,
    );
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new ChicagoCaresProgramLedgerParseError(
      `${source} row ${rowNumber} field ${field} is malformed`,
    );
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

export function normalizeChicagoCaresDatasetTimestamp(
  value: unknown,
  datasetId: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ChicagoCaresProgramLedgerParseError(
      `${datasetId} dataset timestamp is missing`,
    );
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ChicagoCaresProgramLedgerParseError(
      `${datasetId} dataset timestamp is malformed`,
    );
  }
  return new Date(parsed).toISOString();
}

function buildSocrataQueryUrl(
  apiUrl: string,
  query: { where: string; order: string },
): string {
  const url = new URL(apiUrl);
  url.searchParams.set("$where", query.where);
  url.searchParams.set("$order", query.order);
  url.searchParams.set("$limit", String(CHICAGO_CARES_SOURCE_ROW_LIMIT));
  return url.toString();
}

export function getChicagoCaresContractQueryUrl(
  key: ChicagoCaresContractQueryKey,
): string {
  return buildSocrataQueryUrl(
    CHICAGO_CONTRACTS_API_URL,
    CHICAGO_CARES_CONTRACT_QUERIES[key],
  );
}

export function getChicagoCdbgCvQueryUrl(): string {
  return buildSocrataQueryUrl(
    CHICAGO_MID_YEAR_GRANTS_API_URL,
    CHICAGO_CDBG_CV_QUERY,
  );
}

function validateContractSelector(
  row: ParsedContractRow,
  definition: ContractProgramDefinition,
  source: string,
  rowNumber: number,
): void {
  const matches =
    definition.key === "togetherNow"
      ? row.purchaseOrderDescription.toUpperCase().includes("TOGETHER NOW")
      : definition.key === "chicagoHospitalityGrant"
        ? row.specificationNumber === "1215482"
        : definition.key === "performanceVenueRelief"
          ? row.contractNumber === "144242"
          : row.specificationNumber === "1231590";
  if (!matches) {
    throw new ChicagoCaresProgramLedgerParseError(
      `${source} row ${rowNumber} does not match its bounded source query`,
    );
  }
}

function parseContractRow(
  value: unknown,
  definition: ContractProgramDefinition,
  rowNumber: number,
): ParsedContractRow {
  const source = `${CHICAGO_CONTRACTS_DATASET_ID}/${definition.key}`;
  const row = requireRow(value, source, rowNumber);
  const contractNumber = requireDigits(
    row.purchase_order_contract_number,
    "purchase_order_contract_number",
    source,
    rowNumber,
  );
  const revisionNumber = parseRevisionNumber(row.revision_number, source, rowNumber);
  const specificationNumber = requireDigits(
    row.specification_number,
    "specification_number",
    source,
    rowNumber,
  );
  const purchaseOrderDescription = requireText(
    row.purchase_order_description,
    "purchase_order_description",
    source,
    rowNumber,
  );
  const vendorName = requireText(
    row.vendor_name,
    "vendor_name",
    source,
    rowNumber,
  );
  const vendorId = requireText(row.vendor_id, "vendor_id", source, rowNumber);
  const awardAmountUsd = parseCurrency(
    row.award_amount,
    "award_amount",
    source,
    rowNumber,
    { signed: true },
  );
  if (awardAmountUsd === null) {
    throw new ChicagoCaresProgramLedgerParseError(
      `${source} row ${rowNumber} award_amount is missing`,
    );
  }

  const contractPdf =
    isRecord(row.contract_pdf) && typeof row.contract_pdf.url === "string"
      ? row.contract_pdf.url.trim()
      : "";
  const parsed: ParsedContractRow = {
    contractNumber,
    revisionNumber,
    specificationNumber,
    purchaseOrderDescription,
    department: normalizeText(row.department),
    vendorName,
    vendorId,
    awardAmountUsd,
    approvalDate: normalizeDate(
      row.approval_date,
      "approval_date",
      source,
      rowNumber,
      true,
    ),
    startDate: normalizeDate(
      row.start_date,
      "start_date",
      source,
      rowNumber,
      true,
    ),
    endDate: normalizeDate(
      row.end_date,
      "end_date",
      source,
      rowNumber,
      true,
    ),
    hasContractPdf: Boolean(contractPdf),
    administratorAddressWasPresent: Boolean(
      normalizeText(row.address_1) ||
        normalizeText(row.address_2) ||
        normalizeText(row.city) ||
        normalizeText(row.state) ||
        normalizeText(row.zip),
    ),
    fingerprint: "",
  };
  validateContractSelector(parsed, definition, source, rowNumber);
  parsed.fingerprint = JSON.stringify({
    contractNumber: parsed.contractNumber,
    revisionNumber: parsed.revisionNumber,
    specificationNumber: parsed.specificationNumber,
    purchaseOrderDescription: parsed.purchaseOrderDescription,
    department: parsed.department,
    vendorName: parsed.vendorName,
    vendorId: parsed.vendorId,
    awardAmountUsd: parsed.awardAmountUsd,
    approvalDate: parsed.approvalDate,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    hasContractPdf: parsed.hasContractPdf,
  });
  return parsed;
}

function canonicalizeContracts(
  rows: readonly unknown[],
  definition: ContractProgramDefinition,
): {
  contracts: CanonicalContract[];
  duplicateRowsIgnored: number;
  duplicatePoMirrorsCollapsed: number;
} {
  if (rows.length === 0) {
    throw new ChicagoCaresProgramLedgerParseError(
      `${CHICAGO_CONTRACTS_DATASET_ID}/${definition.key} returned no rows`,
    );
  }

  const byPo = new Map<string, Map<number, ParsedContractRow>>();
  let duplicateRowsIgnored = 0;
  rows.forEach((value, index) => {
    const parsed = parseContractRow(value, definition, index + 1);
    const revisions = byPo.get(parsed.contractNumber) ?? new Map();
    const prior = revisions.get(parsed.revisionNumber);
    if (prior) {
      if (prior.fingerprint !== parsed.fingerprint) {
        throw new ChicagoCaresProgramLedgerParseError(
          `${CHICAGO_CONTRACTS_DATASET_ID}/${definition.key} has conflicting duplicate PO ${parsed.contractNumber} revision ${parsed.revisionNumber}`,
        );
      }
      duplicateRowsIgnored++;
      return;
    }
    revisions.set(parsed.revisionNumber, parsed);
    byPo.set(parsed.contractNumber, revisions);
  });

  const candidates = [...byPo.entries()].map(([contractNumber, revisions]) => {
    const base = revisions.get(0);
    if (!base) {
      throw new ChicagoCaresProgramLedgerParseError(
        `${CHICAGO_CONTRACTS_DATASET_ID}/${definition.key} PO ${contractNumber} is missing revision 0`,
      );
    }
    if (base.awardAmountUsd < 0) {
      throw new ChicagoCaresProgramLedgerParseError(
        `${CHICAGO_CONTRACTS_DATASET_ID}/${definition.key} PO ${contractNumber} revision 0 has a negative award_amount`,
      );
    }
    for (const revision of revisions.values()) {
      if (revision.specificationNumber !== base.specificationNumber) {
        throw new ChicagoCaresProgramLedgerParseError(
          `${CHICAGO_CONTRACTS_DATASET_ID}/${definition.key} PO ${contractNumber} changes specification across revisions`,
        );
      }
      const isSameNameVendorIdCorrection =
        revision.vendorId !== base.vendorId &&
        revision.vendorName.toUpperCase() === base.vendorName.toUpperCase();
      const isDocumentedIdentityCorrection =
        DOCUMENTED_VENDOR_IDENTITY_CORRECTIONS.has(
          [
            contractNumber,
            base.vendorId,
            base.vendorName.toUpperCase(),
            revision.vendorId,
            revision.vendorName.toUpperCase(),
          ].join("|"),
        );
      if (
        revision.vendorId !== base.vendorId &&
        !isSameNameVendorIdCorrection &&
        !isDocumentedIdentityCorrection
      ) {
        throw new ChicagoCaresProgramLedgerParseError(
          `${CHICAGO_CONTRACTS_DATASET_ID}/${definition.key} PO ${contractNumber} changes administrator across revisions`,
        );
      }
    }
    const ordered = [...revisions.values()].sort(
      (a, b) => a.revisionNumber - b.revisionNumber,
    );
    const latest = ordered.at(-1) ?? base;
    const useLatestVendorIdentity =
      latest.vendorId !== base.vendorId &&
      DOCUMENTED_VENDOR_IDENTITY_CORRECTIONS.has(
        [
          contractNumber,
          base.vendorId,
          base.vendorName.toUpperCase(),
          latest.vendorId,
          latest.vendorName.toUpperCase(),
        ].join("|"),
      );
    return {
      contractNumbers: [contractNumber],
      specificationNumber: base.specificationNumber,
      vendorName: useLatestVendorIdentity ? latest.vendorName : base.vendorName,
      vendorId: useLatestVendorIdentity ? latest.vendorId : base.vendorId,
      department: latest.department ?? base.department,
      historicalAuthorizedUsd: base.awardAmountUsd,
      approvalDate: base.approvalDate,
      startDate: latest.startDate ?? base.startDate,
      endDate: latest.endDate ?? base.endDate,
      sourceRevisionCount: ordered.length,
      latestRevisionNumber: latest.revisionNumber,
      hasContractPdf: ordered.some((row) => row.hasContractPdf),
      administratorAddressWasPresent: ordered.some(
        (row) => row.administratorAddressWasPresent,
      ),
    } satisfies CanonicalContract;
  });

  const mirrorGroups = new Map<string, CanonicalContract[]>();
  for (const contract of candidates) {
    const key = [
      contract.specificationNumber,
      contract.vendorId,
      contract.historicalAuthorizedUsd.toFixed(2),
    ].join("|");
    const group = mirrorGroups.get(key) ?? [];
    group.push(contract);
    mirrorGroups.set(key, group);
  }

  let duplicatePoMirrorsCollapsed = 0;
  const contracts: CanonicalContract[] = [];
  for (const group of mirrorGroups.values()) {
    const rich = group.filter(
      (contract) =>
        contract.startDate !== null ||
        contract.endDate !== null ||
        contract.hasContractPdf,
    );
    const sparse = group.filter((contract) => !rich.includes(contract));
    if (group.length > 1 && rich.length === 1 && sparse.length > 0) {
      const primary = rich[0];
      contracts.push({
        ...primary,
        contractNumbers: group
          .flatMap((contract) => contract.contractNumbers)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        sourceRevisionCount: group.reduce(
          (sum, contract) => sum + contract.sourceRevisionCount,
          0,
        ),
        latestRevisionNumber: Math.max(
          ...group.map((contract) => contract.latestRevisionNumber),
        ),
        administratorAddressWasPresent: group.some(
          (contract) => contract.administratorAddressWasPresent,
        ),
      });
      duplicatePoMirrorsCollapsed += sparse.length;
    } else {
      contracts.push(...group);
    }
  }

  return {
    contracts: contracts.sort((a, b) =>
      a.contractNumbers[0].localeCompare(b.contractNumbers[0], undefined, {
        numeric: true,
      }),
    ),
    duplicateRowsIgnored,
    duplicatePoMirrorsCollapsed,
  };
}

function baseRecord(
  overrides: Partial<ChicagoCaresProgramLedgerRecord>,
): ChicagoCaresProgramLedgerRecord {
  return {
    recordId: "",
    programId: "",
    programName: "",
    recordKind: "program",
    assistanceType: "grant",
    fundingClassification: "cares_era_city_program",
    programStatus: "closed_historical",
    administratorName: null,
    administeringDepartment: null,
    historicalAuthorizedUsd: null,
    historicalBudgetedUsd: null,
    historicalEncumberedUsd: null,
    historicalExpendedUsd: null,
    financialStageNote: "",
    recordGranularity: "program_level",
    geographicScope: "citywide_context",
    isBusinessRecipient: false,
    isMappableBusinessLocation: false,
    isActiveIncentiveDollars: false,
    addressUsePolicy: "no_recipient_address_available",
    financialAggregationPolicy: "never_sum_across_records",
    sourceAuthority: "",
    sourceDatasetId: null,
    sourceRecordIds: [],
    sourceUrl: "",
    sourceQueryUrl: null,
    sourceAsOf: null,
    sourceDatasetUpdatedAt: null,
    specificationNumber: null,
    contractNumbers: [],
    sourceRevisionCount: 0,
    latestRevisionNumber: null,
    grantProjectCode: null,
    fundCode: null,
    parentCostCenterCode: null,
    alnCode: null,
    periodStart: null,
    periodEnd: null,
    ...overrides,
  };
}

function staticProgramRecords(): ChicagoCaresProgramLedgerRecord[] {
  return [
    baseRecord({
      recordId: "chicago-small-business-resiliency-fund:program",
      programId: "chicago-small-business-resiliency-fund",
      programName: "Chicago Small Business Resiliency Fund",
      assistanceType: "loan",
      fundingClassification: "cares_era_public_private",
      administeringDepartment: "Chicago City Treasurer",
      historicalAuthorizedUsd: 50_000_000,
      financialStageNote:
        "The Treasurer describes an investment of up to $50 million. This is an announced historical program ceiling, not a recipient disbursement total.",
      sourceAuthority: "Chicago City Treasurer",
      sourceRecordIds: ["catalyst-fund"],
      sourceUrl: CHICAGO_SMALL_BUSINESS_RESILIENCY_SOURCE_URL,
    }),
    baseRecord({
      recordId: "chicago-microbusiness-recovery-grant:program",
      programId: "chicago-microbusiness-recovery-grant",
      programName: "Chicago Microbusiness Recovery Grant Program",
      assistanceType: "grant",
      fundingClassification: "cares_era_city_program",
      administeringDepartment:
        "Department of Business Affairs and Consumer Protection",
      historicalAuthorizedUsd: 5_000_000,
      financialStageNote:
        "The official grant administrator described a $5 million program and grants of $5,000. This is an announced historical program amount, not a recipient roster or payment total.",
      geographicScope: "eligible_community_areas_context",
      sourceAuthority: "Chicago Urban League, official grant administrator",
      sourceRecordIds: ["microbusiness-recovery-grant-2020-04-29"],
      sourceUrl: CHICAGO_MICROBUSINESS_RECOVERY_SOURCE_URL,
      sourceAsOf: "2020-04-29",
    }),
  ];
}

function buildContractRecords(
  definition: ContractProgramDefinition,
  rows: readonly unknown[],
  datasetUpdatedAt: string,
): {
  records: ChicagoCaresProgramLedgerRecord[];
  duplicateRowsIgnored: number;
  duplicatePoMirrorsCollapsed: number;
} {
  const queryUrl = getChicagoCaresContractQueryUrl(definition.key);
  const canonical = canonicalizeContracts(rows, definition);
  const programRecord = baseRecord({
    recordId: `${definition.programId}:program`,
    programId: definition.programId,
    programName: definition.programName,
    recordKind: "program",
    assistanceType:
      definition.assistanceType === "business_support_administration"
        ? "business_support_administration"
        : "grant",
    fundingClassification: definition.fundingClassification,
    administeringDepartment: definition.administeringDepartment,
    financialStageNote: PROGRAM_RECORD_NOTE,
    sourceAuthority: "City of Chicago Data Portal",
    sourceDatasetId: CHICAGO_CONTRACTS_DATASET_ID,
    sourceRecordIds: [definition.key],
    sourceUrl: CHICAGO_CONTRACTS_SOURCE_URL,
    sourceQueryUrl: queryUrl,
    sourceDatasetUpdatedAt: datasetUpdatedAt,
  });

  const administratorRecords = canonical.contracts.map((contract) => {
    const canonicalContract = contract.contractNumbers[0];
    return baseRecord({
      recordId: `${definition.programId}:administrator:${canonicalContract}`,
      programId: definition.programId,
      programName: definition.programName,
      recordKind: "program_administrator",
      assistanceType: definition.assistanceType,
      fundingClassification: definition.fundingClassification,
      administratorName: contract.vendorName,
      administeringDepartment:
        contract.department ?? definition.administeringDepartment,
      historicalAuthorizedUsd: contract.historicalAuthorizedUsd,
      financialStageNote: CONTRACT_RECORD_NOTE,
      recordGranularity: "administrator_level",
      addressUsePolicy: "administrator_address_excluded",
      sourceAuthority: "City of Chicago Data Portal",
      sourceDatasetId: CHICAGO_CONTRACTS_DATASET_ID,
      sourceRecordIds: contract.contractNumbers.map(
        (contractNumber) => `po:${contractNumber}`,
      ),
      sourceUrl: CHICAGO_CONTRACTS_SOURCE_URL,
      sourceQueryUrl: queryUrl,
      sourceAsOf: contract.approvalDate,
      sourceDatasetUpdatedAt: datasetUpdatedAt,
      specificationNumber: contract.specificationNumber,
      contractNumbers: contract.contractNumbers,
      sourceRevisionCount: contract.sourceRevisionCount,
      latestRevisionNumber: contract.latestRevisionNumber,
      periodStart: contract.startDate,
      periodEnd: contract.endDate,
    });
  });

  return {
    records: [programRecord, ...administratorRecords],
    duplicateRowsIgnored: canonical.duplicateRowsIgnored,
    duplicatePoMirrorsCollapsed: canonical.duplicatePoMirrorsCollapsed,
  };
}

function parseCdbgCvAccountingRows(
  rows: readonly unknown[],
  datasetUpdatedAt: string,
): ChicagoCaresProgramLedgerRecord[] {
  if (rows.length === 0) {
    throw new ChicagoCaresProgramLedgerParseError(
      `${CHICAGO_MID_YEAR_GRANTS_DATASET_ID}/cdbg-cv returned no rows`,
    );
  }

  const recordIds = new Set<string>();
  return rows.map((value, index) => {
    const rowNumber = index + 1;
    const source = `${CHICAGO_MID_YEAR_GRANTS_DATASET_ID}/cdbg-cv`;
    const row = requireRow(value, source, rowNumber);
    const sourceRecordId = requireText(
      row.record_id,
      "record_id",
      source,
      rowNumber,
    );
    if (recordIds.has(sourceRecordId)) {
      throw new ChicagoCaresProgramLedgerParseError(
        `${source} contains duplicate record_id ${sourceRecordId}`,
      );
    }
    recordIds.add(sourceRecordId);

    const grantProjectCode = requireText(
      row.grant_project_code,
      "grant_project_code",
      source,
      rowNumber,
    );
    if (!["CARES20CD", "CARES20DB"].includes(grantProjectCode)) {
      throw new ChicagoCaresProgramLedgerParseError(
        `${source} row ${rowNumber} is outside the bounded CDBG-CV query`,
      );
    }

    const budget = parseCurrency(
      row.budget,
      "budget",
      source,
      rowNumber,
    );
    const encumbered = parseCurrency(
      row.encumbrances,
      "encumbrances",
      source,
      rowNumber,
      { nullable: true },
    );
    const expended = parseCurrency(
      row.expended_project_to_date,
      "expended_project_to_date",
      source,
      rowNumber,
      { nullable: true },
    );
    const sourceAsOf = normalizeDate(
      row.data_extract_as_of_date,
      "data_extract_as_of_date",
      source,
      rowNumber,
    );
    if (budget === null || sourceAsOf === null) {
      throw new ChicagoCaresProgramLedgerParseError(
        `${source} row ${rowNumber} is missing required accounting fields`,
      );
    }

    return baseRecord({
      recordId: `chicago-cdbg-cv:accounting:${sourceRecordId}`,
      programId: "chicago-cdbg-cv",
      programName:
        "Community Development Block Grant Coronavirus (CDBG-CV)",
      recordKind: "program_accounting",
      assistanceType: "federal_grant_accounting",
      fundingClassification: "cdbg_cv_cares_act",
      administeringDepartment: requireText(
        row.department_description,
        "department_description",
        source,
        rowNumber,
      ),
      historicalBudgetedUsd: budget,
      historicalEncumberedUsd: encumbered,
      historicalExpendedUsd: expended,
      financialStageNote: ACCOUNTING_RECORD_NOTE,
      recordGranularity: "accounting_level",
      sourceAuthority: "City of Chicago Office of Budget and Management",
      sourceDatasetId: CHICAGO_MID_YEAR_GRANTS_DATASET_ID,
      sourceRecordIds: [sourceRecordId],
      sourceUrl: CHICAGO_MID_YEAR_GRANTS_SOURCE_URL,
      sourceQueryUrl: getChicagoCdbgCvQueryUrl(),
      sourceAsOf,
      sourceDatasetUpdatedAt: datasetUpdatedAt,
      grantProjectCode,
      fundCode: requireText(row.fund_code, "fund_code", source, rowNumber),
      parentCostCenterCode: requireText(
        row.parent_cost_center_code,
        "parent_cost_center_code",
        source,
        rowNumber,
      ),
      alnCode: requireText(row.aln_code, "aln_code", source, rowNumber),
      periodStart: normalizeDate(
        row.grant_start_date,
        "grant_start_date",
        source,
        rowNumber,
      ),
      periodEnd: normalizeDate(
        row.grant_end_date,
        "grant_end_date",
        source,
        rowNumber,
        true,
      ),
    });
  });
}

function cdbgCvProgramRecord(
  datasetUpdatedAt: string,
): ChicagoCaresProgramLedgerRecord {
  return baseRecord({
    recordId: "chicago-cdbg-cv:program",
    programId: "chicago-cdbg-cv",
    programName: "Community Development Block Grant Coronavirus (CDBG-CV)",
    recordKind: "program",
    assistanceType: "federal_grant_accounting",
    fundingClassification: "cdbg_cv_cares_act",
    financialStageNote:
      "Closed historical relief context. Department and cost-center accounting records are represented separately and must not be summed with recipient awards.",
    sourceAuthority: "City of Chicago Office of Budget and Management",
    sourceDatasetId: CHICAGO_MID_YEAR_GRANTS_DATASET_ID,
    sourceRecordIds: ["CARES20CD", "CARES20DB"],
    sourceUrl: CHICAGO_MID_YEAR_GRANTS_SOURCE_URL,
    sourceQueryUrl: getChicagoCdbgCvQueryUrl(),
    sourceDatasetUpdatedAt: datasetUpdatedAt,
  });
}

function sortRecords(
  records: readonly ChicagoCaresProgramLedgerRecord[],
): ChicagoCaresProgramLedgerRecord[] {
  const kindOrder: Record<ChicagoCaresRecordKind, number> = {
    program: 0,
    program_administrator: 1,
    program_accounting: 2,
  };
  return [...records].sort(
    (a, b) =>
      a.programId.localeCompare(b.programId) ||
      kindOrder[a.recordKind] - kindOrder[b.recordKind] ||
      a.recordId.localeCompare(b.recordId, undefined, { numeric: true }),
  );
}

export function buildChicagoCaresProgramLedger(
  input: ChicagoCaresProgramLedgerSourceInput,
): ChicagoCaresProgramLedgerResult {
  if (!isRecord(input.contractRows) || !Array.isArray(input.cdbgCvRows)) {
    throw new ChicagoCaresProgramLedgerParseError(
      "Chicago CARES ledger input requires contractRows and cdbgCvRows",
    );
  }
  for (const definition of CONTRACT_PROGRAMS) {
    if (!Array.isArray(input.contractRows[definition.key])) {
      throw new ChicagoCaresProgramLedgerParseError(
        `Chicago CARES ledger input is missing contractRows.${definition.key}`,
      );
    }
  }

  const contractDatasetUpdatedAt = normalizeChicagoCaresDatasetTimestamp(
    input.contractDatasetUpdatedAt,
    CHICAGO_CONTRACTS_DATASET_ID,
  );
  const grantsDatasetUpdatedAt = normalizeChicagoCaresDatasetTimestamp(
    input.grantsDatasetUpdatedAt,
    CHICAGO_MID_YEAR_GRANTS_DATASET_ID,
  );

  const records = staticProgramRecords();
  let contractSourceRowCount = 0;
  let duplicateContractRowsIgnored = 0;
  let duplicatePoMirrorsCollapsed = 0;
  for (const definition of CONTRACT_PROGRAMS) {
    const sourceRows = input.contractRows[definition.key];
    contractSourceRowCount += sourceRows.length;
    const built = buildContractRecords(
      definition,
      sourceRows,
      contractDatasetUpdatedAt,
    );
    records.push(...built.records);
    duplicateContractRowsIgnored += built.duplicateRowsIgnored;
    duplicatePoMirrorsCollapsed += built.duplicatePoMirrorsCollapsed;
  }

  const accountingRecords = parseCdbgCvAccountingRows(
    input.cdbgCvRows,
    grantsDatasetUpdatedAt,
  );
  records.push(cdbgCvProgramRecord(grantsDatasetUpdatedAt), ...accountingRecords);
  const sorted = sortRecords(records);
  const recordIds = new Set<string>();
  for (const record of sorted) {
    if (recordIds.has(record.recordId)) {
      throw new ChicagoCaresProgramLedgerParseError(
        `normalized ledger contains duplicate recordId ${record.recordId}`,
      );
    }
    recordIds.add(record.recordId);
  }

  return {
    records: sorted,
    diagnostics: {
      programRecordCount: sorted.filter(
        (record) => record.recordKind === "program",
      ).length,
      contractSourceRowCount,
      administratorRecordCount: sorted.filter(
        (record) => record.recordKind === "program_administrator",
      ).length,
      duplicateContractRowsIgnored,
      duplicatePoMirrorsCollapsed,
      accountingSourceRowCount: input.cdbgCvRows.length,
      accountingRecordCount: accountingRecords.length,
      totalRecordCount: sorted.length,
    },
  };
}
