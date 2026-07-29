import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCookCountyCaresProgramLedgerIntegrity,
  COOK_COUNTY_CARES_EXPECTATIONS,
  COOK_COUNTY_CARES_IMPACT_RELEASE_URL,
  COOK_COUNTY_CARES_IMPACT_REPORT_URL,
  COOK_COUNTY_CARES_RECOVERY_FUND_ELIGIBILITY_URL,
  COOK_COUNTY_CARES_SMALL_BUSINESS_GRANT_ELIGIBILITY_URL,
  CookCountyCaresProgramLedgerIntegrityError,
  CookCountyCaresProgramLedgerParseError,
  parseCookCountyCaresProgramLedgerPages,
  serializeCookCountyCaresProgramLedgerCsv,
  summarizeCookCountyCaresProgramLedger,
  type CookCountyCaresProgramLedgerRecord,
} from "../cook-county-cares-program-ledger";
import {
  parseCookCountyCaresProgramLedgerCliArgs,
  writeCookCountyCaresProgramLedgerIfChanged,
} from "../../scripts/import-cook-county-cares-program-ledger";

function officialReportFixture(): string[] {
  const pages = Array.from(
    { length: COOK_COUNTY_CARES_EXPECTATIONS.pageCount },
    (_, index) => `Official report page ${index + 1}`,
  );
  pages[3] = `
    Cook County Community Recovery Initiative
    initially funded by $82 million from the federal Coronavirus Aid, Relief,
    and Economic Security (CARES) Act. The funding was revised to $77 million,
    after $5 million was reallocated. We provided services to suburban Cook
    County residents and small businesses upended by COVID-19.
  `;
  pages[7] = `
    Cook County Community Recovery Program
    emergency, zero-interest loans to small businesses and gig workers in
    suburban Cook County. 410 RECEIVED UP TO $20,000 LOANS $7.6M DISTRIBUTED.
    148 RECEIVED LOANS $1.4M DISTRIBUTED.
    Small Business Forgivable Loans. Gig Worker Forgivable Loans.
  `;
  pages[9] = `
    Small Business Assistance Program
    organizations reviewed and scored applications to verify eligibility.
    1,690 SUBURBAN BUSINESSES RECEIVED.
    $16.9M DISTRIBUTED IN SMALL BUSINESS GRANTS.
  `;
  return pages;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("parseCookCountyCaresProgramLedgerPages", () => {
  it("creates one non-additive umbrella row and three historical child outcomes", () => {
    const result = parseCookCountyCaresProgramLedgerPages(
      officialReportFixture(),
    );

    expect(result.records).toHaveLength(4);
    expect(result.records.map((record) => record.recordId)).toEqual([
      "cook-county-community-recovery-initiative-2020",
      "cook-county-cares-small-business-grants-2020",
      "cook-county-cares-small-business-forgivable-loans-2020",
      "cook-county-cares-gig-worker-forgivable-loans-2020",
    ]);
    expect(result.records[0]).toMatchObject({
      recordKind: "umbrella_program_context",
      recipientCount: null,
      historicalPortfolioAmountUsd: 77_000_000,
      historicalDirectRecipientAmountUsd: null,
      sourceReportedAmountLabel: "$77 million",
      sourcePage: 4,
      sourceContextUrl: COOK_COUNTY_CARES_IMPACT_RELEASE_URL,
    });
    expect(result.records[1]).toMatchObject({
      recipientCount: 1_690,
      historicalPortfolioAmountUsd: null,
      historicalDirectRecipientAmountUsd: 16_900_000,
      sourceReportedAmountLabel: "$16.9M",
      sourcePage: 10,
      eligibilitySourceUrl:
        COOK_COUNTY_CARES_SMALL_BUSINESS_GRANT_ELIGIBILITY_URL,
    });
    expect(result.records[2]).toMatchObject({
      recipientCount: 410,
      historicalDirectRecipientAmountUsd: 7_600_000,
      sourceReportedAmountLabel: "$7.6M",
      sourcePage: 8,
      eligibilitySourceUrl:
        COOK_COUNTY_CARES_RECOVERY_FUND_ELIGIBILITY_URL,
    });
    expect(result.records[3]).toMatchObject({
      recipientCount: 148,
      historicalDirectRecipientAmountUsd: 1_400_000,
      sourceReportedAmountLabel: "$1.4M",
      sourcePage: 8,
    });
  });

  it("encodes the Chicago exclusion and never creates mappable recipient data", () => {
    const { records } = parseCookCountyCaresProgramLedgerPages(
      officialReportFixture(),
    );

    for (const record of records) {
      expect(record).toMatchObject({
        geographicEligibility: "suburban_cook_county_only",
        cityOfChicagoAwardEligible: false,
        mappable: false,
        isRecipientLevelRecord: false,
        hasRecipientRecords: false,
        hasCoordinates: false,
        isActiveIncentive: false,
        amountRollupPolicy: "never_sum_with_related_records",
      });
      expect(Object.keys(record)).not.toContain("recipientName");
      expect(Object.keys(record)).not.toContain("latitude");
      expect(Object.keys(record)).not.toContain("longitude");
    }
  });

  it("fails closed when source values or suburban eligibility language drift", () => {
    const wrongCount = officialReportFixture();
    wrongCount[9] = wrongCount[9].replace("1,690", "1,691");
    const missingScope = officialReportFixture();
    missingScope[7] = missingScope[7].replace(
      "suburban Cook County",
      "Cook County",
    );

    expect(() =>
      assertCookCountyCaresProgramLedgerIntegrity(
        parseCookCountyCaresProgramLedgerPages(wrongCount),
      ),
    ).toThrow(/recipient count does not match source/i);
    expect(() =>
      parseCookCountyCaresProgramLedgerPages(missingScope),
    ).toThrow(CookCountyCaresProgramLedgerParseError);
  });
});

describe("Cook County CARES ledger integrity", () => {
  it("returns separated portfolio context and child outcomes without a combined total", () => {
    const result = parseCookCountyCaresProgramLedgerPages(
      officialReportFixture(),
    );
    const summary = assertCookCountyCaresProgramLedgerIntegrity(result);

    expect(summary).toEqual({
      pageCount: 24,
      recordCount: 4,
      historicalPortfolioAmountUsd: 77_000_000,
      childProgramOutcomes: [
        {
          recordId: "cook-county-cares-small-business-grants-2020",
          recipientCount: 1_690,
          historicalDirectRecipientAmountUsd: 16_900_000,
        },
        {
          recordId:
            "cook-county-cares-small-business-forgivable-loans-2020",
          recipientCount: 410,
          historicalDirectRecipientAmountUsd: 7_600_000,
        },
        {
          recordId: "cook-county-cares-gig-worker-forgivable-loans-2020",
          recipientCount: 148,
          historicalDirectRecipientAmountUsd: 1_400_000,
        },
      ],
    });
    expect(Object.keys(summary)).not.toContain("totalAmountUsd");
  });

  it("rejects map eligibility, repeated umbrella amounts, and public score fields", () => {
    const result = parseCookCountyCaresProgramLedgerPages(
      officialReportFixture(),
    );
    const unsafeMapRecord = {
      ...result.records[1],
      mappable: true,
      cityOfChicagoAwardEligible: true,
    } as unknown as CookCountyCaresProgramLedgerRecord;
    const repeatedUmbrellaAmount = {
      ...result.records[1],
      historicalPortfolioAmountUsd: 77_000_000,
    };
    const scoreRecord = {
      ...result.records[1],
      equityScore: 99,
    } as unknown as CookCountyCaresProgramLedgerRecord;

    expect(() =>
      assertCookCountyCaresProgramLedgerIntegrity({
        ...result,
        records: [result.records[0], unsafeMapRecord, ...result.records.slice(2)],
      }),
    ).toThrow(CookCountyCaresProgramLedgerIntegrityError);
    expect(() =>
      assertCookCountyCaresProgramLedgerIntegrity({
        ...result,
        records: [
          result.records[0],
          repeatedUmbrellaAmount,
          ...result.records.slice(2),
        ],
      }),
    ).toThrow(/must not repeat the umbrella amount/i);
    expect(() =>
      assertCookCountyCaresProgramLedgerIntegrity({
        ...result,
        records: [result.records[0], scoreRecord, ...result.records.slice(2)],
      }),
    ).toThrow(/banned public field/i);
  });

  it("does not expose report prose about application scoring", () => {
    const result = parseCookCountyCaresProgramLedgerPages(
      officialReportFixture(),
    );
    const csv = serializeCookCountyCaresProgramLedgerCsv(result.records);

    expect(csv.toLowerCase()).not.toContain("score");
    expect(csv.toLowerCase()).not.toContain("rank");
    expect(csv.toLowerCase()).not.toContain("confidence");
    expect(csv.toLowerCase()).not.toContain("probability");
  });
});

describe("Cook County CARES CSV importer", () => {
  it("serializes deterministically with exact official source URLs", () => {
    const result = parseCookCountyCaresProgramLedgerPages(
      officialReportFixture(),
    );
    const first = serializeCookCountyCaresProgramLedgerCsv(result.records);
    const second = serializeCookCountyCaresProgramLedgerCsv([
      ...result.records,
    ].reverse());

    expect(first).toBe(second);
    expect(first.split("\n")[0]).toBe(
      "record_order,record_id,parent_record_id,record_kind,program_name,assistance_type,recipient_category,recipient_count,historical_portfolio_amount_usd,historical_direct_recipient_amount_usd,source_reported_amount_label,amount_rollup_policy,relief_era,funding_source,program_status,geographic_eligibility,city_of_chicago_award_eligible,city_of_chicago_exclusion_reason,mappable,is_recipient_level_record,has_recipient_records,has_coordinates,is_active_incentive,source_report_url,source_context_url,eligibility_source_url,source_version,source_page,record_note",
    );
    expect(first).toContain(COOK_COUNTY_CARES_IMPACT_REPORT_URL);
    expect(first).toContain(
      COOK_COUNTY_CARES_SMALL_BUSINESS_GRANT_ELIGIBILITY_URL,
    );
    expect(first).toContain(
      COOK_COUNTY_CARES_RECOVERY_FUND_ELIGIBILITY_URL,
    );
  });

  it("writes atomically and remains unchanged on a deterministic second pass", () => {
    const directory = mkdtempSync(join(tmpdir(), "cook-county-cares-ledger-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "curated.csv");
    const result = parseCookCountyCaresProgramLedgerPages(
      officialReportFixture(),
    );
    const csv = serializeCookCountyCaresProgramLedgerCsv(result.records);

    expect(
      writeCookCountyCaresProgramLedgerIfChanged(outputPath, csv),
    ).toBe("created");
    expect(
      writeCookCountyCaresProgramLedgerIfChanged(outputPath, csv),
    ).toBe("unchanged");
    expect(readFileSync(outputPath, "utf8")).toBe(csv);
    expect(readdirSync(directory)).toEqual(["curated.csv"]);
  });

  it("parses local-input CLI options without changing official provenance", () => {
    const options = parseCookCountyCaresProgramLedgerCliArgs([
      "--input",
      "/private/tmp/report.pdf",
      "--output",
      "/private/tmp/output.csv",
      "--expected-pages",
      "24",
    ]);

    expect(options).toMatchObject({
      input: "/private/tmp/report.pdf",
      output: "/private/tmp/output.csv",
      url: COOK_COUNTY_CARES_IMPACT_REPORT_URL,
      expectedPages: 24,
    });
  });

  it("requires the official full-report page count by default", () => {
    const result = parseCookCountyCaresProgramLedgerPages(
      officialReportFixture().slice(0, 12),
    );

    expect(() =>
      assertCookCountyCaresProgramLedgerIntegrity(result),
    ).toThrow(/expected 24 pages, parsed 12/i);
    expect(summarizeCookCountyCaresProgramLedger(result).recordCount).toBe(4);
  });
});
