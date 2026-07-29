/**
 * Pure taxonomy and lineage contract for historical pandemic-recovery
 * investment. It is designed to be nested into CommunityInvestmentRecord later.
 *
 * Assistance type, record grain, location precision, and funding lineage stay
 * independent. Reported historical amounts are allowed; scoring and claims
 * about funding a current project are not.
 */

export const RECOVERY_RELIEF_ERAS = [
  "cares_2020",
  "arpa_2021_plus",
  "other_pandemic",
] as const;
export type RecoveryReliefEra = (typeof RECOVERY_RELIEF_ERAS)[number];

export const RECOVERY_ASSISTANCE_TYPES = [
  "grant",
  "loan",
  "forgivable_loan",
  "advance",
  "credit_support",
  "public_allocation",
] as const;
export type RecoveryAssistanceType = (typeof RECOVERY_ASSISTANCE_TYPES)[number];

export const RECOVERY_GOVERNMENT_LEVELS = [
  "federal",
  "state",
  "county",
  "municipal",
] as const;
export type RecoveryGovernmentLevel = (typeof RECOVERY_GOVERNMENT_LEVELS)[number];

/** Record grain, not the recipient's industry or legal form. */
export const RECOVERY_RECIPIENT_SCOPES = [
  "named_recipient",
  "government_recipient",
  "program_level",
  "aggregate",
] as const;
export type RecoveryRecipientScope = (typeof RECOVERY_RECIPIENT_SCOPES)[number];

/** Precision published by the source, before geocoding. */
export const RECOVERY_LOCATION_PRECISIONS = [
  "coordinates",
  "street_address",
  "postal_code",
  "community_area",
  "municipality",
  "county",
  "statewide",
  "unsited",
] as const;
export type RecoveryLocationPrecision = (typeof RECOVERY_LOCATION_PRECISIONS)[number];

export const RECOVERY_LINEAGE_NODE_ROLES = [
  "root_law",
  "root_fund",
  "administering_agency",
  "administering_program",
  "intermediary",
  "recipient",
] as const;
export type RecoveryLineageNodeRole = (typeof RECOVERY_LINEAGE_NODE_ROLES)[number];

export interface RecoveryLineageNode {
  role: RecoveryLineageNodeRole;
  name: string;
  /** Null for nongovernmental intermediaries and final recipients. */
  governmentLevel: RecoveryGovernmentLevel | null;
}

export const RECOVERY_INVESTMENT_SOURCE_IDS = [
  "illinois-b2b",
  "sba-rrf",
  "cook-source-2023",
  "chicago-arpa-program",
] as const;
export type RecoveryInvestmentSourceId =
  (typeof RECOVERY_INVESTMENT_SOURCE_IDS)[number];

export interface RecoveryInvestmentSourceMetadata {
  id: RecoveryInvestmentSourceId;
  label: string;
  programName: string;
  reliefEra: RecoveryReliefEra;
  assistanceType: RecoveryAssistanceType;
  governmentLevel: RecoveryGovernmentLevel;
  recipientScope: RecoveryRecipientScope;
  locationPrecision: RecoveryLocationPrecision;
  canonicalSourceUrl: string;
  /** Source lineage stops at the program; importers append final recipients. */
  lineage: readonly RecoveryLineageNode[];
}

const ARPA_LAW_NODE = {
  role: "root_law",
  name: "American Rescue Plan Act of 2021",
  governmentLevel: "federal",
} as const satisfies RecoveryLineageNode;

export const RECOVERY_INVESTMENT_SOURCE_METADATA = {
  "illinois-b2b": {
    id: "illinois-b2b",
    label: "Illinois Back to Business grant awardees",
    programName: "Back to Business Grant Program",
    reliefEra: "arpa_2021_plus",
    assistanceType: "grant",
    governmentLevel: "state",
    recipientScope: "named_recipient",
    locationPrecision: "postal_code",
    canonicalSourceUrl:
      "https://dceo.illinois.gov/content/dam/soi/en/web/dceo/smallbizassistance/documents/b2bawards.pdf",
    lineage: [
      ARPA_LAW_NODE,
      {
        role: "root_fund",
        name: "Coronavirus State Fiscal Recovery Fund",
        governmentLevel: "federal",
      },
      {
        role: "administering_agency",
        name: "Illinois Department of Commerce and Economic Opportunity",
        governmentLevel: "state",
      },
      {
        role: "administering_program",
        name: "Back to Business Grant Program",
        governmentLevel: "state",
      },
    ],
  },
  "sba-rrf": {
    id: "sba-rrf",
    label: "SBA Restaurant Revitalization Fund disbursed grants",
    programName: "Restaurant Revitalization Fund",
    reliefEra: "arpa_2021_plus",
    assistanceType: "grant",
    governmentLevel: "federal",
    recipientScope: "named_recipient",
    locationPrecision: "street_address",
    canonicalSourceUrl: "https://data.sba.gov/dataset/rrf-foia",
    lineage: [
      ARPA_LAW_NODE,
      {
        role: "root_fund",
        name: "Restaurant Revitalization Fund",
        governmentLevel: "federal",
      },
      {
        role: "administering_agency",
        name: "U.S. Small Business Administration",
        governmentLevel: "federal",
      },
      {
        role: "administering_program",
        name: "Restaurant Revitalization Fund",
        governmentLevel: "federal",
      },
    ],
  },
  "cook-source-2023": {
    id: "cook-source-2023",
    label: "Cook County 2023 Source Grant awardees",
    programName: "2023 Source Grant",
    reliefEra: "arpa_2021_plus",
    assistanceType: "grant",
    governmentLevel: "county",
    recipientScope: "named_recipient",
    locationPrecision: "postal_code",
    canonicalSourceUrl:
      "https://cookcountysmallbiz.org/wp-content/uploads/2024/11/2023-Source-Grant-Awardee-List-a.o-11.20.24_.pdf",
    lineage: [
      ARPA_LAW_NODE,
      {
        role: "root_fund",
        name: "Coronavirus State and Local Fiscal Recovery Funds",
        governmentLevel: "federal",
      },
      {
        role: "administering_agency",
        name: "Cook County Bureau of Economic Development",
        governmentLevel: "county",
      },
      {
        role: "administering_program",
        name: "2023 Source Grant",
        governmentLevel: "county",
      },
    ],
  },
  "chicago-arpa-program": {
    id: "chicago-arpa-program",
    label: "Chicago ARPA Road to Recovery program reporting",
    programName: "ARPA Road to Recovery",
    reliefEra: "arpa_2021_plus",
    assistanceType: "public_allocation",
    governmentLevel: "municipal",
    recipientScope: "program_level",
    locationPrecision: "municipality",
    canonicalSourceUrl:
      "https://data.cityofchicago.org/Administration-Finance/ARPA-Road-to-Recovery-Program-Details/m9g9-cj96",
    lineage: [
      ARPA_LAW_NODE,
      {
        role: "root_fund",
        name: "Coronavirus State and Local Fiscal Recovery Funds",
        governmentLevel: "federal",
      },
      {
        role: "administering_agency",
        name: "City of Chicago",
        governmentLevel: "municipal",
      },
      {
        role: "administering_program",
        name: "ARPA Road to Recovery",
        governmentLevel: "municipal",
      },
    ],
  },
} as const satisfies Readonly<
  Record<RecoveryInvestmentSourceId, RecoveryInvestmentSourceMetadata>
>;

/** The assistance type travels with the value to prevent money-type coercion. */
export interface RecoveryHistoricalAmount {
  value: number;
  currency: "USD";
  assistanceType: RecoveryAssistanceType;
}

/** A record-level extension suitable for nesting into CommunityInvestmentRecord. */
export interface RecoveryInvestmentRecord {
  id: string;
  sourceId: RecoveryInvestmentSourceId;
  programName: string;
  reliefEra: RecoveryReliefEra;
  assistanceType: RecoveryAssistanceType;
  governmentLevel: RecoveryGovernmentLevel;
  recipientScope: RecoveryRecipientScope;
  recipientName: string | null;
  locationPrecision: RecoveryLocationPrecision;
  /** A past source-reported transaction/allocation, never a project estimate. */
  historicalAmount: RecoveryHistoricalAmount | null;
  lineage: readonly RecoveryLineageNode[];
}

export const RECOVERY_VALIDATION_ISSUE_CODES = [
  "forbidden_scoring_field",
  "forbidden_funds_claim",
  "invalid_field",
  "source_classification_mismatch",
  "assistance_amount_mismatch",
  "recipient_scope_mismatch",
  "lineage_invalid",
  "lineage_missing_root",
  "lineage_missing_program",
  "location_precision_missing",
] as const;
export type RecoveryValidationIssueCode =
  (typeof RECOVERY_VALIDATION_ISSUE_CODES)[number];

export interface RecoveryValidationIssue {
  code: RecoveryValidationIssueCode;
  path: string;
  message: string;
}

const FORBIDDEN_SCORING_KEY_RE =
  /score|scoring|rank|ranking|confidence|probability/i;
const FORBIDDEN_FUNDS_CLAIM_RE = /potential|available|remaining|unspent/i;
const PROSE_FIELD_RE =
  /description|summary|headline|message|note|claim|copy|text|label/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnumValue<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function issue(
  code: RecoveryValidationIssueCode,
  path: string,
  message: string,
): RecoveryValidationIssue {
  return { code, path, message };
}

/**
 * Scan JSON-like values for score fields, prospective-funds keys, and those
 * claims in prose fields. Identity values are intentionally not scanned.
 */
export function findRecoveryPolicyViolations(
  value: unknown,
): RecoveryValidationIssue[] {
  const issues: RecoveryValidationIssue[] = [];
  const seen = new WeakSet<object>();

  const walk = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      if (seen.has(current)) return;
      seen.add(current);
      current.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!isRecord(current) || seen.has(current)) return;
    seen.add(current);

    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_SCORING_KEY_RE.test(key)) {
        issues.push(
          issue(
            "forbidden_scoring_field",
            childPath,
            "Recovery records must not carry scoring or ranking fields.",
          ),
        );
      }
      if (FORBIDDEN_FUNDS_CLAIM_RE.test(key)) {
        issues.push(
          issue(
            "forbidden_funds_claim",
            childPath,
            "Recovery records must not represent prospective funding claims.",
          ),
        );
      }
      if (
        typeof child === "string" &&
        PROSE_FIELD_RE.test(key) &&
        FORBIDDEN_FUNDS_CLAIM_RE.test(child)
      ) {
        issues.push(
          issue(
            "forbidden_funds_claim",
            childPath,
            "Reader-facing recovery copy must describe historical facts only.",
          ),
        );
      }
      walk(child, childPath);
    }
  };

  walk(value, "");
  return issues;
}

function validateLineageShape(
  value: unknown,
  path = "lineage",
): RecoveryValidationIssue[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [
      issue("lineage_invalid", path, "Lineage must be a non-empty array."),
      issue("lineage_missing_root", path, "Lineage must begin with a root law or fund."),
      issue(
        "lineage_missing_program",
        path,
        "Lineage must include an administering program.",
      ),
    ];
  }

  const issues: RecoveryValidationIssue[] = [];
  let firstRole: RecoveryLineageNodeRole | null = null;
  let hasProgram = false;

  value.forEach((node, index) => {
    const nodePath = `${path}[${index}]`;
    if (!isRecord(node)) {
      issues.push(issue("lineage_invalid", nodePath, "Lineage node must be an object."));
      return;
    }
    if (!isEnumValue(RECOVERY_LINEAGE_NODE_ROLES, node.role)) {
      issues.push(
        issue("lineage_invalid", `${nodePath}.role`, "Lineage role is not recognized."),
      );
    } else {
      if (index === 0) firstRole = node.role;
      hasProgram ||= node.role === "administering_program";
    }
    if (typeof node.name !== "string" || node.name.trim() === "") {
      issues.push(issue("lineage_invalid", `${nodePath}.name`, "Node name is required."));
    }
    if (
      node.governmentLevel !== null &&
      !isEnumValue(RECOVERY_GOVERNMENT_LEVELS, node.governmentLevel)
    ) {
      issues.push(
        issue(
          "lineage_invalid",
          `${nodePath}.governmentLevel`,
          "Government level must be explicit or null.",
        ),
      );
    }
  });

  if (firstRole !== "root_law" && firstRole !== "root_fund") {
    issues.push(
      issue("lineage_missing_root", path, "Lineage must begin with a root law or fund."),
    );
  }
  if (!hasProgram) {
    issues.push(
      issue(
        "lineage_missing_program",
        path,
        "Lineage must include an administering program.",
      ),
    );
  }
  return issues;
}

export function validateRecoveryLineage(value: unknown): RecoveryValidationIssue[] {
  return [...findRecoveryPolicyViolations(value), ...validateLineageShape(value)];
}

function validateEnumField(
  object: Record<string, unknown>,
  key: string,
  values: readonly string[],
  message: string,
  code: RecoveryValidationIssueCode = "invalid_field",
): RecoveryValidationIssue[] {
  return isEnumValue(values, object[key])
    ? []
    : [issue(code, key, message)];
}

function validateScopeAndAssistance(
  scope: unknown,
  assistanceType: unknown,
): RecoveryValidationIssue[] {
  if (
    !isEnumValue(RECOVERY_RECIPIENT_SCOPES, scope) ||
    !isEnumValue(RECOVERY_ASSISTANCE_TYPES, assistanceType)
  ) {
    return [];
  }
  const allocationScope =
    scope === "program_level" || scope === "government_recipient";
  return (assistanceType === "public_allocation") !== allocationScope
    ? [
        issue(
          "recipient_scope_mismatch",
          "recipientScope",
          "Public allocations and final-recipient assistance require different grains.",
        ),
      ]
    : [];
}

function hasProgramNode(lineage: unknown, programName: unknown): boolean {
  return (
    Array.isArray(lineage) &&
    typeof programName === "string" &&
    lineage.some(
      (node) =>
        isRecord(node) &&
        node.role === "administering_program" &&
        node.name === programName,
    )
  );
}

export function validateRecoveryInvestmentSourceMetadata(
  value: unknown,
): RecoveryValidationIssue[] {
  const issues = findRecoveryPolicyViolations(value);
  if (!isRecord(value)) {
    return [
      ...issues,
      issue("invalid_field", "", "Recovery source metadata must be an object."),
    ];
  }

  issues.push(
    ...validateEnumField(
      value,
      "id",
      RECOVERY_INVESTMENT_SOURCE_IDS,
      "Source id is not recognized.",
    ),
    ...validateEnumField(value, "reliefEra", RECOVERY_RELIEF_ERAS, "Era is not recognized."),
    ...validateEnumField(
      value,
      "assistanceType",
      RECOVERY_ASSISTANCE_TYPES,
      "Assistance type is not recognized.",
    ),
    ...validateEnumField(
      value,
      "governmentLevel",
      RECOVERY_GOVERNMENT_LEVELS,
      "Government level is not recognized.",
    ),
    ...validateEnumField(
      value,
      "recipientScope",
      RECOVERY_RECIPIENT_SCOPES,
      "Recipient scope is not recognized.",
    ),
    ...validateEnumField(
      value,
      "locationPrecision",
      RECOVERY_LOCATION_PRECISIONS,
      "Source location precision must be explicit.",
      "location_precision_missing",
    ),
    ...validateScopeAndAssistance(value.recipientScope, value.assistanceType),
    ...validateLineageShape(value.lineage),
  );

  for (const key of ["label", "programName"] as const) {
    if (typeof value[key] !== "string" || value[key].trim() === "") {
      issues.push(issue("invalid_field", key, `${key} is required.`));
    }
  }
  if (
    typeof value.canonicalSourceUrl !== "string" ||
    !/^https?:\/\//i.test(value.canonicalSourceUrl)
  ) {
    issues.push(
      issue("invalid_field", "canonicalSourceUrl", "Source URL must be http(s)."),
    );
  }
  if (!hasProgramNode(value.lineage, value.programName)) {
    issues.push(
      issue("lineage_invalid", "lineage", "Lineage must name the source program."),
    );
  }
  if (
    Array.isArray(value.lineage) &&
    value.lineage.some((node) => isRecord(node) && node.role === "recipient")
  ) {
    issues.push(
      issue(
        "lineage_invalid",
        "lineage",
        "Source metadata lineage must stop at the program.",
      ),
    );
  }
  return issues;
}

function validateHistoricalAmount(
  record: Record<string, unknown>,
): RecoveryValidationIssue[] {
  if (!("historicalAmount" in record)) {
    return [
      issue(
        "invalid_field",
        "historicalAmount",
        "Historical amount must be explicit, including when null.",
      ),
    ];
  }
  if (record.historicalAmount === null) return [];
  if (!isRecord(record.historicalAmount)) {
    return [
      issue(
        "invalid_field",
        "historicalAmount",
        "Historical amount must be an object or null.",
      ),
    ];
  }

  const amount = record.historicalAmount;
  const issues: RecoveryValidationIssue[] = [];
  if (
    typeof amount.value !== "number" ||
    !Number.isFinite(amount.value) ||
    amount.value < 0
  ) {
    issues.push(
      issue(
        "invalid_field",
        "historicalAmount.value",
        "Value must be a non-negative finite number.",
      ),
    );
  }
  if (amount.currency !== "USD") {
    issues.push(
      issue("invalid_field", "historicalAmount.currency", "Currency must be USD."),
    );
  }
  if (
    !isEnumValue(RECOVERY_ASSISTANCE_TYPES, amount.assistanceType) ||
    amount.assistanceType !== record.assistanceType
  ) {
    issues.push(
      issue(
        "assistance_amount_mismatch",
        "historicalAmount.assistanceType",
        "Amount meaning must match the record assistance type.",
      ),
    );
  }
  return issues;
}

function validateRecipientGrain(
  record: Record<string, unknown>,
): RecoveryValidationIssue[] {
  const issues: RecoveryValidationIssue[] = [];
  const recipientGrain =
    record.recipientScope === "named_recipient" ||
    record.recipientScope === "government_recipient";

  if (recipientGrain) {
    if (
      typeof record.recipientName !== "string" ||
      record.recipientName.trim() === ""
    ) {
      issues.push(
        issue(
          "recipient_scope_mismatch",
          "recipientName",
          "Recipient-grain records must name the recipient.",
        ),
      );
    }
    const lastNode = Array.isArray(record.lineage)
      ? record.lineage[record.lineage.length - 1]
      : null;
    if (
      !isRecord(lastNode) ||
      lastNode.role !== "recipient" ||
      lastNode.name !== record.recipientName
    ) {
      issues.push(
        issue(
          "recipient_scope_mismatch",
          "lineage",
          "Recipient-grain lineage must end with the named recipient.",
        ),
      );
    }
    return issues;
  }

  if (record.recipientScope === "program_level" || record.recipientScope === "aggregate") {
    if (record.recipientName !== null) {
      issues.push(
        issue(
          "recipient_scope_mismatch",
          "recipientName",
          "Program and aggregate records must not name a final recipient.",
        ),
      );
    }
    if (
      Array.isArray(record.lineage) &&
      record.lineage.some((node) => isRecord(node) && node.role === "recipient")
    ) {
      issues.push(
        issue(
          "recipient_scope_mismatch",
          "lineage",
          "Program and aggregate lineage must not contain a recipient.",
        ),
      );
    }
    if (record.recipientScope === "aggregate" && record.historicalAmount !== null) {
      issues.push(
        issue(
          "recipient_scope_mismatch",
          "historicalAmount",
          "Aggregate records must not combine historical amounts.",
        ),
      );
    }
  }
  return issues;
}

export function validateRecoveryInvestmentRecord(
  value: unknown,
): RecoveryValidationIssue[] {
  const issues = findRecoveryPolicyViolations(value);
  if (!isRecord(value)) {
    return [
      ...issues,
      issue("invalid_field", "", "Recovery investment record must be an object."),
    ];
  }

  if (typeof value.id !== "string" || value.id.trim() === "") {
    issues.push(issue("invalid_field", "id", "Record id is required."));
  }
  if (typeof value.programName !== "string" || value.programName.trim() === "") {
    issues.push(issue("invalid_field", "programName", "Program name is required."));
  }
  if (value.recipientName !== null && typeof value.recipientName !== "string") {
    issues.push(
      issue("invalid_field", "recipientName", "Recipient name must be a string or null."),
    );
  }

  issues.push(
    ...validateEnumField(
      value,
      "sourceId",
      RECOVERY_INVESTMENT_SOURCE_IDS,
      "Source id is not recognized.",
    ),
    ...validateEnumField(value, "reliefEra", RECOVERY_RELIEF_ERAS, "Era is not recognized."),
    ...validateEnumField(
      value,
      "assistanceType",
      RECOVERY_ASSISTANCE_TYPES,
      "Assistance type is not recognized.",
    ),
    ...validateEnumField(
      value,
      "governmentLevel",
      RECOVERY_GOVERNMENT_LEVELS,
      "Government level is not recognized.",
    ),
    ...validateEnumField(
      value,
      "recipientScope",
      RECOVERY_RECIPIENT_SCOPES,
      "Recipient scope is not recognized.",
    ),
    ...validateEnumField(
      value,
      "locationPrecision",
      RECOVERY_LOCATION_PRECISIONS,
      "Record location precision must be explicit, including when unsited.",
      "location_precision_missing",
    ),
    ...validateScopeAndAssistance(value.recipientScope, value.assistanceType),
    ...validateLineageShape(value.lineage),
    ...validateHistoricalAmount(value),
    ...validateRecipientGrain(value),
  );

  const sourceId = isEnumValue(RECOVERY_INVESTMENT_SOURCE_IDS, value.sourceId)
    ? value.sourceId
    : null;
  if (sourceId !== null) {
    const source = RECOVERY_INVESTMENT_SOURCE_METADATA[sourceId];
    const fields = [
      "programName",
      "reliefEra",
      "assistanceType",
      "governmentLevel",
      "recipientScope",
      "locationPrecision",
    ] as const;
    for (const field of fields) {
      if (value[field] !== source[field]) {
        issues.push(
          issue(
            "source_classification_mismatch",
            field,
            `Classification must match source ${sourceId}.`,
          ),
        );
      }
    }

    if (Array.isArray(value.lineage)) {
      const sourceRoots = new Set(
        source.lineage
          .filter((node) => node.role === "root_law" || node.role === "root_fund")
          .map((node) => `${node.role}:${node.name}`),
      );
      const hasSourceRoot = value.lineage.some(
        (node) =>
          isRecord(node) &&
          (node.role === "root_law" || node.role === "root_fund") &&
          typeof node.name === "string" &&
          sourceRoots.has(`${node.role}:${node.name}`),
      );
      if (!hasSourceRoot) {
        issues.push(
          issue(
            "source_classification_mismatch",
            "lineage",
            "Lineage must retain the source law or fund.",
          ),
        );
      }
    }
  }

  if (!hasProgramNode(value.lineage, value.programName)) {
    issues.push(
      issue("lineage_invalid", "lineage", "Lineage must name its program."),
    );
  }
  return issues;
}

export function assertValidRecoveryInvestmentRecord(
  value: unknown,
): asserts value is RecoveryInvestmentRecord {
  const issues = validateRecoveryInvestmentRecord(value);
  if (issues.length > 0) {
    throw new Error(
      `Invalid recovery investment record: ${issues
        .map((entry) => `${entry.path || "<root>"} [${entry.code}]`)
        .join(", ")}`,
    );
  }
}
