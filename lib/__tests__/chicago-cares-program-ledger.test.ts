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
  CHICAGO_CARES_CONTRACT_QUERIES,
  CHICAGO_CDBG_CV_QUERY,
  CHICAGO_CONTRACTS_DATASET_ID,
  CHICAGO_MID_YEAR_GRANTS_DATASET_ID,
  ChicagoCaresProgramLedgerParseError,
  buildChicagoCaresProgramLedger,
  getChicagoCaresContractQueryUrl,
  getChicagoCdbgCvQueryUrl,
  type ChicagoCaresContractQueryKey,
  type ChicagoCaresProgramLedgerSourceInput,
} from "../chicago-cares-program-ledger";
import {
  importChicagoCaresProgramLedger,
  parseChicagoCaresProgramLedgerCliArgs,
  parseChicagoCaresProgramLedgerFixture,
  serializeChicagoCaresProgramLedgerCsv,
} from "../../scripts/import-chicago-cares-program-ledger";

function contractRow(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    purchase_order_description: "Together Now Fund",
    purchase_order_contract_number: "100100",
    revision_number: "0",
    specification_number: "1208522",
    contract_type: "DELEGATE AGENCY",
    start_date: "2020-06-15T00:00:00.000",
    end_date: "2020-12-31T00:00:00.000",
    approval_date: "2020-08-05T00:00:00.000",
    department: "DEPT OF BUSINESS AFFAIRS & CONSUMER PROTECTION",
    vendor_name: "EXAMPLE ADMINISTRATOR",
    vendor_id: "ADMIN-1",
    address_1: "135 N KEDZIE AVE",
    city: "CHICAGO",
    state: "IL",
    zip: "60602",
    award_amount: "1000.00",
    contract_pdf: { url: "https://example.test/contract.pdf" },
    ...overrides,
  };
}

const TOGETHER_NOW_ROWS = [
  contractRow({}),
  contractRow({
    revision_number: "1",
    award_amount: "-100.00",
    end_date: "2021-01-31T00:00:00.000",
    contract_pdf: undefined,
  }),
  contractRow({
    revision_number: "1",
    award_amount: "-100.00",
    end_date: "2021-01-31T00:00:00.000",
    contract_pdf: undefined,
  }),
] as const;

const HOSPITALITY_ROWS = [
  contractRow({
    purchase_order_description: "Small Business - Hospitality Grant",
    purchase_order_contract_number: "144296",
    specification_number: "1215482",
    vendor_name: "ACCION CHICAGO",
    vendor_id: "105461691V",
    award_amount: "10000000",
  }),
  contractRow({
    purchase_order_description: "BACP-CRF-HSP:",
    purchase_order_contract_number: "144296",
    revision_number: "2",
    specification_number: "1215482",
    vendor_name: "ACCION CHICAGO",
    vendor_id: "105461691V",
    award_amount: "0",
    contract_pdf: undefined,
  }),
  contractRow({
    purchase_order_description: "Small Business - Hospitality Grant",
    purchase_order_contract_number: "144588",
    specification_number: "1215482",
    vendor_name: "ACCION CHICAGO",
    vendor_id: "105461691V",
    award_amount: "10000000",
    start_date: undefined,
    end_date: undefined,
    contract_pdf: undefined,
  }),
] as const;

const PERFORMANCE_ROWS = [
  contractRow({
    purchase_order_description:
      "Grant Agreement, Performing Arts Venue Relief Program, Accion Chicago",
    purchase_order_contract_number: "144242",
    specification_number: "1215374",
    department: "DEPARTMENT OF CULTURAL AFFAIRS",
    vendor_name: "ACCION CHICAGO",
    vendor_id: "105461691V",
    award_amount: "1184000",
  }),
] as const;

const COVID_SUPPORT_ROWS = [
  contractRow({
    purchase_order_description: "BACP-FED-SBS",
    purchase_order_contract_number: "171932",
    specification_number: "1231590",
    vendor_name: "ROGERS PARK BUSINESS ALLIANCE",
    vendor_id: "95196348A",
    award_amount: "45956",
  }),
  contractRow({
    purchase_order_description: "BACP-FED-SBS",
    purchase_order_contract_number: "171932",
    revision_number: "2",
    specification_number: "1231590",
    vendor_name: "ROGERS PARK BUSINESS ALLIANCE",
    vendor_id: "95196348A-CORRECTED",
    award_amount: "-400.30",
    contract_pdf: undefined,
  }),
] as const;

const CDBG_CV_ROWS = [
  {
    data_extract_as_of_date: "2026-05-31T00:00:00.000",
    department_code: "D70",
    department_description:
      "Department of Business Affairs and Consumer Protection",
    fund_code: "F033C",
    parent_cost_center_code: "P702005",
    grant_project_code: "CARES20DB",
    grant_project_description:
      "COMMUNITY DEVELOPMENT BLOCK GRANT CORONAVIRUS (CDBG-CV)",
    grant_start_date: "2020-03-01T00:00:00.000",
    grant_end_date: "2026-07-31T00:00:00.000",
    grant_agency: "US DEPT OF HUD",
    aln_code: "14.218",
    budget: "2000000.00",
    encumbrances: "267069.50",
    expended_project_to_date: "1732930.50",
    funds_available_project_to_date: "0.00",
    record_id: "F033C-CARES20DB-P702005-2020",
  },
  {
    data_extract_as_of_date: "2026-05-31T00:00:00.000",
    department_code: "D54",
    department_description: "Department of Planning and Development",
    fund_code: "F005C",
    parent_cost_center_code: "P542005",
    grant_project_code: "CARES20CD",
    grant_project_description:
      "COMMUNITY DEVELOPMENT BLOCK GRANT CORONAVIRUS (CDBG-CV)",
    grant_start_date: "2020-03-01T00:00:00.000",
    grant_end_date: "2026-07-31T00:00:00.000",
    grant_agency: "US DEPARTMENT OF HUD",
    aln_code: "14.218",
    budget: "11000000.00",
    expended_project_to_date: "11000000.00",
    record_id: "F005C-CARES20CD-P542005-2020",
  },
] as const;

const SOURCE_INPUT: ChicagoCaresProgramLedgerSourceInput = {
  contractRows: {
    togetherNow: TOGETHER_NOW_ROWS,
    chicagoHospitalityGrant: HOSPITALITY_ROWS,
    performanceVenueRelief: PERFORMANCE_ROWS,
    covidSmallBusinessSupport: COVID_SUPPORT_ROWS,
  },
  contractDatasetUpdatedAt: "2026-07-28T12:00:00Z",
  cdbgCvRows: CDBG_CV_ROWS,
  grantsDatasetUpdatedAt: "2026-07-08T12:00:00Z",
};

function fixtureDocument(
  input: ChicagoCaresProgramLedgerSourceInput = SOURCE_INPUT,
): Record<string, unknown> {
  const queries = Object.fromEntries(
    (
      Object.keys(
        CHICAGO_CARES_CONTRACT_QUERIES,
      ) as ChicagoCaresContractQueryKey[]
    ).map((key) => [
      key,
      {
        ...CHICAGO_CARES_CONTRACT_QUERIES[key],
        rows: input.contractRows[key],
      },
    ]),
  );
  return {
    contracts: {
      datasetId: CHICAGO_CONTRACTS_DATASET_ID,
      asOf: input.contractDatasetUpdatedAt,
      queries,
    },
    cdbgCvAccounting: {
      datasetId: CHICAGO_MID_YEAR_GRANTS_DATASET_ID,
      asOf: input.grantsDatasetUpdatedAt,
      ...CHICAGO_CDBG_CV_QUERY,
      rows: input.cdbgCvRows,
    },
  };
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("buildChicagoCaresProgramLedger", () => {
  it("normalizes closed program, administrator, and accounting records without recipients or map points", () => {
    const result = buildChicagoCaresProgramLedger(SOURCE_INPUT);

    expect(result.diagnostics).toEqual({
      programRecordCount: 7,
      contractSourceRowCount: 9,
      administratorRecordCount: 4,
      duplicateContractRowsIgnored: 1,
      duplicatePoMirrorsCollapsed: 1,
      accountingSourceRowCount: 2,
      accountingRecordCount: 2,
      totalRecordCount: 13,
    });
    expect(
      result.records.every(
        (record) =>
          record.programStatus === "closed_historical" &&
          record.isBusinessRecipient === false &&
          record.isMappableBusinessLocation === false &&
          record.isActiveIncentiveDollars === false &&
          record.financialAggregationPolicy === "never_sum_across_records",
      ),
    ).toBe(true);
    expect(JSON.stringify(result.records)).not.toContain("135 N KEDZIE");
    expect(
      result.records.some((record) => record.recordKind === "program_accounting"),
    ).toBe(true);
  });

  it("keeps financial stages separate and never sums revisions or duplicate PO mirrors", () => {
    const records = buildChicagoCaresProgramLedger(SOURCE_INPUT).records;
    const togetherNow = records.find(
      (record) =>
        record.recordId === "chicago-together-now:administrator:100100",
    );
    const hospitality = records.find(
      (record) =>
        record.recordId ===
        "chicago-hospitality-grant:administrator:144296",
    );
    const accounting = records.find(
      (record) =>
        record.recordId ===
        "chicago-cdbg-cv:accounting:F033C-CARES20DB-P702005-2020",
    );

    expect(togetherNow).toMatchObject({
      historicalAuthorizedUsd: 1_000,
      historicalBudgetedUsd: null,
      sourceRevisionCount: 2,
      latestRevisionNumber: 1,
      addressUsePolicy: "administrator_address_excluded",
    });
    expect(hospitality).toMatchObject({
      historicalAuthorizedUsd: 10_000_000,
      contractNumbers: ["144296", "144588"],
      sourceRevisionCount: 3,
      latestRevisionNumber: 2,
    });
    expect(accounting).toMatchObject({
      historicalAuthorizedUsd: null,
      historicalBudgetedUsd: 2_000_000,
      historicalEncumberedUsd: 267_069.5,
      historicalExpendedUsd: 1_732_930.5,
    });
  });

  it("keeps announced program ceilings distinct from recipient distributions", () => {
    const records = buildChicagoCaresProgramLedger(SOURCE_INPUT).records;
    expect(
      records.find(
        (record) =>
          record.recordId ===
          "chicago-small-business-resiliency-fund:program",
      ),
    ).toMatchObject({
      recordKind: "program",
      assistanceType: "loan",
      historicalAuthorizedUsd: 50_000_000,
      administratorName: null,
    });
    expect(
      records.find(
        (record) =>
          record.recordId ===
          "chicago-microbusiness-recovery-grant:program",
      ),
    ).toMatchObject({
      geographicScope: "eligible_community_areas_context",
      historicalAuthorizedUsd: 5_000_000,
      sourceAsOf: "2020-04-29",
    });
  });

  it("fails closed on conflicting duplicate revisions and missing revision zero", () => {
    expect(() =>
      buildChicagoCaresProgramLedger({
        ...SOURCE_INPUT,
        contractRows: {
          ...SOURCE_INPUT.contractRows,
          togetherNow: [
            TOGETHER_NOW_ROWS[0],
            contractRow({ award_amount: "2000.00" }),
          ],
        },
      }),
    ).toThrow(/conflicting duplicate PO 100100 revision 0/i);

    expect(() =>
      buildChicagoCaresProgramLedger({
        ...SOURCE_INPUT,
        contractRows: {
          ...SOURCE_INPUT.contractRows,
          togetherNow: [
            contractRow({
              revision_number: "1",
              award_amount: "0",
            }),
          ],
        },
      }),
    ).toThrow(/missing revision 0/i);
  });

  it("applies only the two source-literal vendor cleanups", () => {
    const cleanupRows = [
      contractRow({
        purchase_order_description: "BACP-FED-SBS",
        purchase_order_contract_number: "171971",
        specification_number: "1231590",
        vendor_name: "LAKEVIEW EAST CHAM OF COMMERCE|CLEANED-UP",
        vendor_id: "91490615T",
        award_amount: "50000",
      }),
      contractRow({
        purchase_order_description: "BACP-FED-SBS",
        purchase_order_contract_number: "171971",
        revision_number: "1",
        specification_number: "1231590",
        vendor_name: "LAKEVIEW EAST CHAMBER OF COMMERCE",
        vendor_id: "85240642X",
        award_amount: "0",
        contract_pdf: undefined,
      }),
      contractRow({
        purchase_order_description: "BACP-FED-SBS",
        purchase_order_contract_number: "176218",
        specification_number: "1231590",
        vendor_name: "GREATER S.W. DEVELOPMENT CORP.",
        vendor_id: "15055418E",
        award_amount: "50352",
      }),
      contractRow({
        purchase_order_description: "BACP-FED-SBS",
        purchase_order_contract_number: "176218",
        revision_number: "1",
        specification_number: "1231590",
        vendor_name: "GREATER SOUTHWEST DEV CORP",
        vendor_id: "105473950T",
        award_amount: "-17373.70",
        contract_pdf: undefined,
      }),
    ];
    const records = buildChicagoCaresProgramLedger({
      ...SOURCE_INPUT,
      contractRows: {
        ...SOURCE_INPUT.contractRows,
        covidSmallBusinessSupport: [
          ...SOURCE_INPUT.contractRows.covidSmallBusinessSupport,
          ...cleanupRows,
        ],
      },
    }).records;

    expect(
      records.find(
        (record) =>
          record.recordId ===
          "chicago-covid-small-business-support:administrator:171971",
      ),
    ).toMatchObject({
      administratorName: "LAKEVIEW EAST CHAMBER OF COMMERCE",
      historicalAuthorizedUsd: 50_000,
      sourceRevisionCount: 2,
      latestRevisionNumber: 1,
    });
    expect(
      records.find(
        (record) =>
          record.recordId ===
          "chicago-covid-small-business-support:administrator:176218",
      ),
    ).toMatchObject({
      administratorName: "GREATER SOUTHWEST DEV CORP",
      historicalAuthorizedUsd: 50_352,
      sourceRevisionCount: 2,
      latestRevisionNumber: 1,
    });
  });

  it("fails closed on duplicate accounting IDs, malformed money, and rows outside the CDBG-CV query", () => {
    expect(() =>
      buildChicagoCaresProgramLedger({
        ...SOURCE_INPUT,
        cdbgCvRows: [CDBG_CV_ROWS[0], CDBG_CV_ROWS[0]],
      }),
    ).toThrow(/duplicate record_id/i);

    expect(() =>
      buildChicagoCaresProgramLedger({
        ...SOURCE_INPUT,
        cdbgCvRows: [{ ...CDBG_CV_ROWS[0], budget: "$2,000,000" }],
      }),
    ).toThrow(ChicagoCaresProgramLedgerParseError);

    expect(() =>
      buildChicagoCaresProgramLedger({
        ...SOURCE_INPUT,
        cdbgCvRows: [
          { ...CDBG_CV_ROWS[0], grant_project_code: "NOT-CARES" },
        ],
      }),
    ).toThrow(/outside the bounded CDBG-CV query/i);
  });
});

describe("Chicago CARES program ledger importer", () => {
  it("uses exact bounded official Socrata query URLs", () => {
    const togetherNow = new URL(
      getChicagoCaresContractQueryUrl("togetherNow"),
    );
    const cdbgCv = new URL(getChicagoCdbgCvQueryUrl());

    expect(togetherNow.origin + togetherNow.pathname).toBe(
      "https://data.cityofchicago.org/resource/rsxa-ify5.json",
    );
    expect(togetherNow.searchParams.get("$where")).toBe(
      CHICAGO_CARES_CONTRACT_QUERIES.togetherNow.where,
    );
    expect(togetherNow.searchParams.get("$limit")).toBe("5000");
    expect(cdbgCv.searchParams.get("$where")).toBe(
      CHICAGO_CDBG_CV_QUERY.where,
    );
  });

  it("serializes a deterministic CSV with no administrator address or recipient fields", () => {
    const records = buildChicagoCaresProgramLedger(SOURCE_INPUT).records;
    const first = serializeChicagoCaresProgramLedgerCsv(records);
    const second = serializeChicagoCaresProgramLedgerCsv([...records].reverse());
    const header = first.split("\n")[0];

    expect(first).toBe(second);
    expect(header).toContain(
      "historical_authorized_usd,historical_budgeted_usd,historical_encumbered_usd,historical_expended_usd",
    );
    expect(header).not.toMatch(/recipient_name|address_1|funds_available/i);
    expect(first).not.toContain("135 N KEDZIE");
    expect(first).toContain(
      "closed_historical,ACCION CHICAGO,DEPT OF BUSINESS AFFAIRS & CONSUMER PROTECTION,10000000.00",
    );
  });

  it("parses a fixture and writes the curated CSV atomically", async () => {
    const directory = mkdtempSync(join(tmpdir(), "chicago-cares-ledger-"));
    temporaryDirectories.push(directory);
    const fixturePath = join(directory, "fixture.json");
    const outputPath = join(directory, "curated.csv");
    writeFileSync(fixturePath, JSON.stringify(fixtureDocument()));

    const options = parseChicagoCaresProgramLedgerCliArgs([
      "--input",
      fixturePath,
      "--output",
      outputPath,
    ]);
    const first = await importChicagoCaresProgramLedger(options);
    const second = await importChicagoCaresProgramLedger(options);

    expect(first.outputAction).toBe("created");
    expect(second.outputAction).toBe("unchanged");
    expect(readFileSync(outputPath, "utf8")).toBe(
      serializeChicagoCaresProgramLedgerCsv(first.records),
    );
    expect(readdirSync(directory).sort()).toEqual([
      "curated.csv",
      "fixture.json",
    ]);
  });

  it("rejects fixture dataset and query drift", () => {
    const wrongDataset = fixtureDocument();
    (wrongDataset.contracts as Record<string, unknown>).datasetId = "wrong-id";
    expect(() =>
      parseChicagoCaresProgramLedgerFixture(wrongDataset),
    ).toThrow(/datasetId must be rsxa-ify5/i);

    const wrongQuery = fixtureDocument();
    const contracts = wrongQuery.contracts as {
      queries: Record<string, Record<string, unknown>>;
    };
    contracts.queries.togetherNow.where = "1=1";
    expect(() =>
      parseChicagoCaresProgramLedgerFixture(wrongQuery),
    ).toThrow(/bounded query contract/i);
  });
});
