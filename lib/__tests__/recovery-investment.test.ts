import { describe, expect, it } from "vitest";
import {
  assertValidRecoveryInvestmentRecord,
  findRecoveryPolicyViolations,
  RECOVERY_ASSISTANCE_TYPES,
  RECOVERY_GOVERNMENT_LEVELS,
  RECOVERY_INVESTMENT_SOURCE_IDS,
  RECOVERY_INVESTMENT_SOURCE_METADATA,
  RECOVERY_LINEAGE_NODE_ROLES,
  RECOVERY_LOCATION_PRECISIONS,
  RECOVERY_RECIPIENT_SCOPES,
  RECOVERY_RELIEF_ERAS,
  validateRecoveryInvestmentRecord,
  validateRecoveryInvestmentSourceMetadata,
  validateRecoveryLineage,
  type RecoveryInvestmentRecord,
  type RecoveryInvestmentSourceId,
  type RecoveryValidationIssue,
} from "@/lib/recovery-investment";

function issueCodes(issues: readonly RecoveryValidationIssue[]) {
  return issues.map((entry) => entry.code);
}

function recordForSource(
  sourceId: RecoveryInvestmentSourceId,
): RecoveryInvestmentRecord {
  const source = RECOVERY_INVESTMENT_SOURCE_METADATA[sourceId];
  const recipientName =
    source.recipientScope === "named_recipient" ? "Example Recipient LLC" : null;
  const lineage =
    recipientName === null
      ? [...source.lineage]
      : [
          ...source.lineage,
          {
            role: "recipient" as const,
            name: recipientName,
            governmentLevel: null,
          },
        ];

  return {
    id: `${sourceId}:example`,
    sourceId,
    programName: source.programName,
    reliefEra: source.reliefEra,
    assistanceType: source.assistanceType,
    governmentLevel: source.governmentLevel,
    recipientScope: source.recipientScope,
    recipientName,
    locationPrecision: source.locationPrecision,
    historicalAmount:
      source.recipientScope === "named_recipient"
        ? {
            value: 25_000,
            currency: "USD",
            assistanceType: source.assistanceType,
          }
        : null,
    lineage,
  };
}

describe("recovery investment taxonomy", () => {
  it("defines exhaustive const-backed classification axes", () => {
    expect(RECOVERY_RELIEF_ERAS).toEqual([
      "cares_2020",
      "arpa_2021_plus",
      "other_pandemic",
    ]);
    expect(RECOVERY_ASSISTANCE_TYPES).toEqual([
      "grant",
      "loan",
      "forgivable_loan",
      "advance",
      "credit_support",
      "public_allocation",
    ]);
    expect(RECOVERY_GOVERNMENT_LEVELS).toEqual([
      "federal",
      "state",
      "county",
      "municipal",
    ]);
    expect(RECOVERY_RECIPIENT_SCOPES).toEqual([
      "named_recipient",
      "government_recipient",
      "program_level",
      "aggregate",
    ]);
    expect(RECOVERY_LOCATION_PRECISIONS).toEqual([
      "coordinates",
      "street_address",
      "postal_code",
      "community_area",
      "municipality",
      "county",
      "statewide",
      "unsited",
    ]);
    expect(RECOVERY_LINEAGE_NODE_ROLES).toEqual([
      "root_law",
      "root_fund",
      "administering_agency",
      "administering_program",
      "intermediary",
      "recipient",
    ]);
  });

  it("classifies the initial source families without conflating record grain", () => {
    expect(RECOVERY_INVESTMENT_SOURCE_IDS).toEqual([
      "illinois-big",
      "illinois-hospitality-emergency",
      "illinois-b2b",
      "sba-rrf",
      "cook-source-2023",
      "chicago-arpa-program",
    ]);
    expect(
      Object.fromEntries(
        RECOVERY_INVESTMENT_SOURCE_IDS.map((id) => {
          const source = RECOVERY_INVESTMENT_SOURCE_METADATA[id];
          return [
            id,
            {
              reliefEra: source.reliefEra,
              assistanceType: source.assistanceType,
              governmentLevel: source.governmentLevel,
              recipientScope: source.recipientScope,
              locationPrecision: source.locationPrecision,
            },
          ];
        }),
      ),
    ).toEqual({
      "illinois-big": {
        reliefEra: "cares_2020",
        assistanceType: "grant",
        governmentLevel: "state",
        recipientScope: "named_recipient",
        locationPrecision: "postal_code",
      },
      "illinois-hospitality-emergency": {
        reliefEra: "other_pandemic",
        assistanceType: "grant",
        governmentLevel: "state",
        recipientScope: "named_recipient",
        locationPrecision: "municipality",
      },
      "illinois-b2b": {
        reliefEra: "arpa_2021_plus",
        assistanceType: "grant",
        governmentLevel: "state",
        recipientScope: "named_recipient",
        locationPrecision: "postal_code",
      },
      "sba-rrf": {
        reliefEra: "arpa_2021_plus",
        assistanceType: "grant",
        governmentLevel: "federal",
        recipientScope: "named_recipient",
        locationPrecision: "street_address",
      },
      "cook-source-2023": {
        reliefEra: "arpa_2021_plus",
        assistanceType: "grant",
        governmentLevel: "county",
        recipientScope: "named_recipient",
        locationPrecision: "postal_code",
      },
      "chicago-arpa-program": {
        reliefEra: "arpa_2021_plus",
        assistanceType: "public_allocation",
        governmentLevel: "municipal",
        recipientScope: "program_level",
        locationPrecision: "municipality",
      },
    });
  });

  it("keeps every source definition valid and exhaustive", () => {
    expect(Object.keys(RECOVERY_INVESTMENT_SOURCE_METADATA).sort()).toEqual(
      [...RECOVERY_INVESTMENT_SOURCE_IDS].sort(),
    );
    for (const sourceId of RECOVERY_INVESTMENT_SOURCE_IDS) {
      expect(
        validateRecoveryInvestmentSourceMetadata(
          RECOVERY_INVESTMENT_SOURCE_METADATA[sourceId],
        ),
      ).toEqual([]);
    }
  });
});

describe("recovery investment policy rails", () => {
  it("rejects scoring fields and prospective-funds language", () => {
    const issues = findRecoveryPolicyViolations({
      eligibilityScore: 92,
      potentialAward: 50_000,
      publicSummary: "Funds available for a future project.",
      nested: { unspentBalance: 10_000 },
    });

    expect(issueCodes(issues)).toContain("forbidden_scoring_field");
    expect(issueCodes(issues).filter((code) => code === "forbidden_funds_claim"))
      .toHaveLength(3);
  });

  it("does not confuse a recipient identity with a forward-looking claim", () => {
    expect(
      findRecoveryPolicyViolations({
        recipientName: "Potential Energy Services LLC",
      }),
    ).toEqual([]);
  });

  it("requires a root law or fund and an administering program", () => {
    const withoutRoot = [
      {
        role: "administering_program",
        name: "Example Program",
        governmentLevel: "state",
      },
    ];
    const withoutProgram = [
      {
        role: "root_law",
        name: "Example Recovery Law",
        governmentLevel: "federal",
      },
    ];

    expect(issueCodes(validateRecoveryLineage(withoutRoot))).toContain(
      "lineage_missing_root",
    );
    expect(issueCodes(validateRecoveryLineage(withoutProgram))).toContain(
      "lineage_missing_program",
    );
  });
});

describe("recovery investment record validation", () => {
  it("accepts a source-aligned recipient award and program-level record", () => {
    const recipientAward = recordForSource("illinois-b2b");
    const programRecord = recordForSource("chicago-arpa-program");

    expect(validateRecoveryInvestmentRecord(recipientAward)).toEqual([]);
    expect(validateRecoveryInvestmentRecord(programRecord)).toEqual([]);
    expect(() => assertValidRecoveryInvestmentRecord(recipientAward)).not.toThrow();
  });

  it("keeps grants and loans distinct at both source and amount level", () => {
    const wrongSourceType = {
      ...recordForSource("illinois-b2b"),
      assistanceType: "loan" as const,
      historicalAmount: {
        value: 25_000,
        currency: "USD" as const,
        assistanceType: "loan" as const,
      },
    };
    const wrongAmountType = {
      ...recordForSource("illinois-b2b"),
      historicalAmount: {
        value: 25_000,
        currency: "USD" as const,
        assistanceType: "loan" as const,
      },
    };

    expect(issueCodes(validateRecoveryInvestmentRecord(wrongSourceType))).toContain(
      "source_classification_mismatch",
    );
    expect(issueCodes(validateRecoveryInvestmentRecord(wrongAmountType))).toContain(
      "assistance_amount_mismatch",
    );
  });

  it("prevents program-level data from masquerading as a recipient award", () => {
    const base = recordForSource("chicago-arpa-program");
    const masquerading = {
      ...base,
      recipientName: "Example Business LLC",
      lineage: [
        ...base.lineage,
        {
          role: "recipient" as const,
          name: "Example Business LLC",
          governmentLevel: null,
        },
      ],
    };

    expect(
      issueCodes(validateRecoveryInvestmentRecord(masquerading)),
    ).toContain("recipient_scope_mismatch");
  });

  it("requires explicit location precision even when a record is unsited", () => {
    const record = {
      ...recordForSource("cook-source-2023"),
    } as Record<string, unknown>;
    delete record.locationPrecision;

    expect(issueCodes(validateRecoveryInvestmentRecord(record))).toContain(
      "location_precision_missing",
    );
  });

  it("rejects missing lineage anchors and policy fields on otherwise valid records", () => {
    const base = recordForSource("sba-rrf");
    const withoutProgram = {
      ...base,
      lineage: base.lineage.filter(
        (node) => node.role !== "administering_program",
      ),
      matchScore: 0.9,
      displayNote: "Potential future funding",
    };

    const codes = issueCodes(validateRecoveryInvestmentRecord(withoutProgram));
    expect(codes).toContain("lineage_missing_program");
    expect(codes).toContain("forbidden_scoring_field");
    expect(codes).toContain("forbidden_funds_claim");
    expect(() => assertValidRecoveryInvestmentRecord(withoutProgram)).toThrow(
      /Invalid recovery investment record/,
    );
  });
});
