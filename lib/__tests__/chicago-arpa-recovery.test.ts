import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHICAGO_ARPA_GRANTS_SUMMARY_DATASET_ID,
  CHICAGO_ARPA_PROGRAM_DETAILS_DATASET_ID,
  ChicagoArpaRecoveryParseError,
  buildChicagoArpaRecoveryLedger,
} from "../chicago-arpa-recovery";
import {
  importChicagoArpaRecovery,
  parseChicagoArpaRecoveryCliArgs,
  parseChicagoArpaRecoveryFixture,
  serializeChicagoArpaRecoveryCsv,
} from "../../scripts/import-chicago-arpa-recovery";

const PROGRAM_DETAILS = [
  {
    program_name: "Metadata-only Program",
    cost_center: "B200",
    department_acronym: "DPD",
    department: "Department of Planning and Development",
    policy_pillar: "Housing & Homelessness Supports",
  },
  {
    program_name: "Program, One",
    cost_center: "A100",
    department_acronym: "BACP",
    department: "Department of Business Affairs and Consumer Protection",
    policy_pillar: "Youth & Economy",
  },
  {
    program_name: "Program Three",
    cost_center: "C300",
    department_acronym: "DFSS",
    department: "Department of Family and Support Services",
    policy_pillar: "Community Safety",
  },
] as const;

const GRANTS_SUMMARY = [
  {
    cost_center: "C300",
    amount_allocated: "25.50",
    amount_obligated: "20.00",
    amount_expended: "10.25",
  },
  {
    cost_center: "A100",
    amount_allocated: "1000000.00",
    amount_obligated: "750000.50",
    amount_expended: "500000.25",
  },
] as const;

const SOURCE_INPUT = {
  programDetails: PROGRAM_DETAILS,
  grantsSummary: GRANTS_SUMMARY,
  programDetailsAsOf: "2026-04-30T12:00:00Z",
  grantsSummaryAsOf: "2026-04-30T11:58:00Z",
} as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("buildChicagoArpaRecoveryLedger", () => {
  it("preserves every program detail and left-joins nullable historical financials", () => {
    const result = buildChicagoArpaRecoveryLedger(SOURCE_INPUT);

    expect(result.records.map((record) => record.costCenter)).toEqual([
      "A100",
      "B200",
      "C300",
    ]);
    expect(result.records[0]).toMatchObject({
      programName: "Program, One",
      administeringDepartment:
        "Department of Business Affairs and Consumer Protection",
      policyPillar: "Youth & Economy",
      historicalAmountAllocatedUsd: 1_000_000,
      historicalAmountObligatedUsd: 750_000.5,
      historicalAmountExpendedUsd: 500_000.25,
      recordGranularity: "program_level",
      geographicScope: "citywide_context",
      financialContext: "historical_cumulative_program_financials",
      isRecipientLevelAward: false,
      isActiveIncentiveDollars: false,
      programDetailsAsOf: "2026-04-30T12:00:00.000Z",
      grantsSummaryAsOf: "2026-04-30T11:58:00.000Z",
    });
    expect(result.records[1]).toMatchObject({
      historicalAmountAllocatedUsd: null,
      historicalAmountObligatedUsd: null,
      historicalAmountExpendedUsd: null,
    });
    expect(result.diagnostics).toEqual({
      programDetailCount: 3,
      financialSummaryCount: 2,
      joinedFinancialCount: 2,
      metadataOnlyCount: 1,
      metadataOnlyCostCenters: ["B200"],
    });
  });

  it("fails closed on duplicate keys in either source", () => {
    expect(() =>
      buildChicagoArpaRecoveryLedger({
        ...SOURCE_INPUT,
        programDetails: [...PROGRAM_DETAILS, PROGRAM_DETAILS[0]],
      }),
    ).toThrow(/program details contains duplicate cost_center B200/i);

    expect(() =>
      buildChicagoArpaRecoveryLedger({
        ...SOURCE_INPUT,
        grantsSummary: [...GRANTS_SUMMARY, GRANTS_SUMMARY[0]],
      }),
    ).toThrow(/grants summary contains duplicate cost_center C300/i);
  });

  it("fails closed when a financial summary has no program metadata", () => {
    expect(() =>
      buildChicagoArpaRecoveryLedger({
        ...SOURCE_INPUT,
        grantsSummary: [
          ...GRANTS_SUMMARY,
          {
            cost_center: "ORPHAN1",
            amount_allocated: "1.00",
            amount_obligated: "1.00",
            amount_expended: "1.00",
          },
        ],
      }),
    ).toThrow(/missing from program details: ORPHAN1/i);
  });

  it.each(["$100.00", "1,000.00", "1.234", "-1.00", "NaN"])(
    "fails closed on malformed historical amount %s",
    (amount) => {
      expect(() =>
        buildChicagoArpaRecoveryLedger({
          ...SOURCE_INPUT,
          grantsSummary: [
            {
              ...GRANTS_SUMMARY[0],
              amount_allocated: amount,
            },
          ],
        }),
      ).toThrow(ChicagoArpaRecoveryParseError);
    },
  );
});

describe("Chicago ARPA CSV importer", () => {
  it("serializes a deterministic schema with explicit non-incentive classification", () => {
    const records = buildChicagoArpaRecoveryLedger(SOURCE_INPUT).records;
    const first = serializeChicagoArpaRecoveryCsv(records);
    const second = serializeChicagoArpaRecoveryCsv([...records].reverse());

    expect(first).toBe(second);
    expect(first.split("\n")[0]).toBe(
      "cost_center,program_name,administering_department,department_acronym,policy_pillar,historical_amount_allocated_usd,historical_amount_obligated_usd,historical_amount_expended_usd,record_granularity,geographic_scope,financial_context,is_recipient_level_award,is_active_incentive_dollars,program_details_source_url,grants_summary_source_url,program_details_as_of,grants_summary_as_of",
    );
    expect(first).toContain('"Program, One"');
    expect(first).toContain(
      "Housing & Homelessness Supports,,,,program_level,citywide_context,historical_cumulative_program_financials,false,false",
    );
    expect(first.indexOf("A100")).toBeLessThan(first.indexOf("B200"));
  });

  it("supports a local fixture and writes the curated CSV atomically", async () => {
    const directory = mkdtempSync(join(tmpdir(), "chicago-arpa-recovery-"));
    temporaryDirectories.push(directory);
    const fixturePath = join(directory, "fixture.json");
    const outputPath = join(directory, "curated.csv");
    writeFileSync(
      fixturePath,
      JSON.stringify({
        programDetails: {
          datasetId: CHICAGO_ARPA_PROGRAM_DETAILS_DATASET_ID,
          asOf: SOURCE_INPUT.programDetailsAsOf,
          rows: PROGRAM_DETAILS,
        },
        grantsSummary: {
          datasetId: CHICAGO_ARPA_GRANTS_SUMMARY_DATASET_ID,
          asOf: SOURCE_INPUT.grantsSummaryAsOf,
          rows: GRANTS_SUMMARY,
        },
      }),
    );

    const options = parseChicagoArpaRecoveryCliArgs([
      "--input",
      fixturePath,
      "--output",
      outputPath,
    ]);
    const first = await importChicagoArpaRecovery(options);
    const second = await importChicagoArpaRecovery(options);

    expect(first.outputAction).toBe("created");
    expect(second.outputAction).toBe("unchanged");
    expect(readFileSync(outputPath, "utf8")).toBe(
      serializeChicagoArpaRecoveryCsv(first.records),
    );
    expect(readdirSync(directory).sort()).toEqual([
      "curated.csv",
      "fixture.json",
    ]);
  });

  it("rejects a local fixture with an unexpected Socrata dataset contract", () => {
    expect(() =>
      parseChicagoArpaRecoveryFixture({
        programDetails: {
          datasetId: "wrong-id",
          asOf: SOURCE_INPUT.programDetailsAsOf,
          rows: PROGRAM_DETAILS,
        },
        grantsSummary: {
          datasetId: CHICAGO_ARPA_GRANTS_SUMMARY_DATASET_ID,
          asOf: SOURCE_INPUT.grantsSummaryAsOf,
          rows: GRANTS_SUMMARY,
        },
      }),
    ).toThrow(/datasetId must be m9g9-cj96/i);
  });
});
