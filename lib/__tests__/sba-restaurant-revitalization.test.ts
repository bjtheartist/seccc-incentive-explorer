import { describe, expect, it } from "vitest";
import {
  assertSbaRestaurantRevitalizationIntegrity,
  parseSbaRestaurantRevitalizationCsv,
  parseSbaRrfUsdAmount,
  SBA_RRF_CLASSIFICATION,
  SBA_RRF_EXPECTED_SOURCE_HEADERS,
  SBA_RRF_FULL_SOURCE_EXPECTATIONS,
  SBA_RRF_SOURCE_VERSION,
  serializeSbaRestaurantRevitalizationCsv,
  summarizeSbaRestaurantRevitalization,
} from "../sba-restaurant-revitalization";

const BASE_SOURCE_ROW: Record<string, string> = {
  LoanNumber: "1036429110",
  ApprovalDate: "06/17/2021",
  BusinessName: "KB V LLC",
  BusinessAddress: "852 W Fulton Market St",
  BusinessCity: "Chicago",
  BusinessState: "IL",
  BusinessZip: "60607",
  GrantAmount: "819728.2",
  FranchiseName: "",
  RuralUrbanIndicator: "U",
  HubzoneIndicator: "N",
  CD: "IL-07",
  grant_purp_cons_outdoor_seating: "Y",
  grant_purpose_covered_supplier: "Y",
  grant_purpose_debt: "Y",
  grant_purpose_food: "Y",
  grant_purpose_maintenance_indoor: "Y",
  grant_purpose_operations: "Y",
  grant_purpose_payroll: "Y",
  grant_purpose_rent: "Y",
  grant_purpose_supplies: "Y",
  grant_purpose_utility: "Y",
  LegalOrganizationType: "Limited Liability Company (LLC)",
  LMIIndicator: "N",
  SocioeconmicIndicator: "N",
  VeteranIndicator: "N",
  WomenOwnedIndicator: "N",
  RestaurantType: "Restaurant",
};

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function sourceRow(
  overrides: Record<string, string> = {},
  headers: readonly string[] = SBA_RRF_EXPECTED_SOURCE_HEADERS,
): string {
  const row = { ...BASE_SOURCE_ROW, ...overrides };
  return headers.map((header) => csvEscape(row[header] ?? "")).join(",");
}

function sourceCsv(
  rows: Array<Record<string, string>>,
  headers: readonly string[] = SBA_RRF_EXPECTED_SOURCE_HEADERS,
  newline = "\n",
): string {
  return `${headers.join(",")}${newline}${rows
    .map((row) => sourceRow(row, headers))
    .join(newline)}${newline}`;
}

describe("SBA Restaurant Revitalization Fund ingestion", () => {
  it("parses quoted commas, escaped quotes, embedded newlines, BOM, and DBA fields", () => {
    const headers = [
      ...SBA_RRF_EXPECTED_SOURCE_HEADERS,
      "Legal Business Name",
      "DBA or Trade Name",
    ];
    const csv = `\uFEFF${sourceCsv(
      [
        {
          BusinessName: 'Source "Business", LLC',
          BusinessAddress: "852 W Fulton Market St\r\nSuite 2",
          FranchiseName: "Franchise, Inc.",
          RestaurantType: "Restaurant, Bar",
          "Legal Business Name": 'Legal "Restaurant", LLC',
          "DBA or Trade Name": 'The "Great", Table',
        },
      ],
      headers,
      "\r\n",
    )}`;

    const result = parseSbaRestaurantRevitalizationCsv(csv);

    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      legalBusinessName: 'Legal "Restaurant", LLC',
      sourceBusinessName: 'Source "Business", LLC',
      dbaTradeName: 'The "Great", Table',
      franchiseName: "Franchise, Inc.",
      publishedStreetAddress: "852 W Fulton Market St\nSuite 2",
      restaurantType: "Restaurant, Bar",
      locationPrecision: "published_street_address_ungeocoded",
      approvalDate: "2021-06-17",
      sourceApprovalDate: "06/17/2021",
      grantAmountUsd: 819_728.2,
    });
  });

  it("filters only explicit Chicago, Illinois rows without inferring from a ZIP", () => {
    const result = parseSbaRestaurantRevitalizationCsv(
      sourceCsv([
        { LoanNumber: "1001" },
        {
          LoanNumber: "1002",
          BusinessCity: " chicago ",
          BusinessState: "Illinois",
        },
        {
          LoanNumber: "1003",
          BusinessCity: "Chicago Heights",
          BusinessState: "IL",
        },
        {
          LoanNumber: "1004",
          BusinessCity: "Springfield",
          BusinessState: "IL",
          BusinessZip: "60617",
        },
        {
          LoanNumber: "1005",
          BusinessCity: "Chicago",
          BusinessState: "IN",
        },
      ]),
    );

    expect(result.issues).toEqual([]);
    expect(result.records.map((record) => record.sbaLoanNumber)).toEqual([
      "1001",
      "1002",
    ]);
    expect(result.excludedRowCount).toBe(3);
    expect(result.records.every((record) => record.locationPrecision.endsWith("ungeocoded"))).toBe(
      true,
    );
  });

  it("preserves missing location detail without manufacturing a map point", () => {
    const result = parseSbaRestaurantRevitalizationCsv(
      sourceCsv([
        {
          BusinessAddress: "",
          BusinessZip: "60617",
        },
      ]),
    );

    expect(result.records[0]).toMatchObject({
      publishedStreetAddress: null,
      publishedZip: "60617",
      locationPrecision: "published_zip_ungeocoded",
    });
    expect(result.issues).toMatchObject([
      {
        severity: "warning",
        code: "missing_published_address",
      },
    ]);
    expect(() =>
      assertSbaRestaurantRevitalizationIntegrity(result, {
        sourceRowCount: 1,
        chicagoRecordCount: 1,
        sourceGrantTotalUsd: 819_728.2,
        chicagoGrantTotalUsd: 819_728.2,
      }),
    ).toThrow(/1 parser warning/);
  });

  it("reports malformed CSV and column-width drift instead of silently publishing", () => {
    const valid = sourceCsv([{}]).trimEnd();
    const widthMismatch = `${valid},unexpected\n`;
    const widthResult =
      parseSbaRestaurantRevitalizationCsv(widthMismatch);

    expect(widthResult.issues.map((item) => item.code)).toContain(
      "column_count_mismatch",
    );
    expect(() =>
      assertSbaRestaurantRevitalizationIntegrity(widthResult, {
        sourceRowCount: 1,
        chicagoRecordCount: 1,
        sourceGrantTotalUsd: 819_728.2,
        chicagoGrantTotalUsd: 819_728.2,
      }),
    ).toThrow(/parser error/);

    const headers = SBA_RRF_EXPECTED_SOURCE_HEADERS;
    const valuesWithoutFinalField = headers
      .slice(0, -1)
      .map((header) => csvEscape(BASE_SOURCE_ROW[header] ?? ""))
      .join(",");
    const malformed = `${headers.join(",")}\n${valuesWithoutFinalField},"Unclosed`;
    const malformedResult =
      parseSbaRestaurantRevitalizationCsv(malformed);

    expect(malformedResult.issues.map((item) => item.code)).toContain(
      "malformed_csv",
    );
  });

  it("fails fast when a required SBA source field disappears", () => {
    const headers = SBA_RRF_EXPECTED_SOURCE_HEADERS.filter(
      (header) => header !== "GrantAmount",
    );
    expect(() => parseSbaRestaurantRevitalizationCsv(sourceCsv([{}], headers))).toThrow(
      /missing required header: GrantAmount/,
    );
  });

  it("parses USD exactly and rejects malformed grouping or excess precision", () => {
    expect(parseSbaRrfUsdAmount("$1,234.50")).toBe(1_234.5);
    expect(parseSbaRrfUsdAmount("819728.2")).toBe(819_728.2);
    expect(parseSbaRrfUsdAmount("0")).toBe(0);
    expect(parseSbaRrfUsdAmount("12,34.50")).toBeNull();
    expect(parseSbaRrfUsdAmount("10.999")).toBeNull();
    expect(parseSbaRrfUsdAmount("-1")).toBeNull();
  });

  it("reports duplicate identifiers and does not import a duplicate Chicago award", () => {
    const result = parseSbaRestaurantRevitalizationCsv(
      sourceCsv([
        { LoanNumber: "duplicate", BusinessCity: "New York", BusinessState: "NY" },
        { LoanNumber: "duplicate", BusinessCity: "Chicago", BusinessState: "IL" },
      ]),
    );

    expect(result.issues.map((item) => item.code)).toContain(
      "duplicate_loan_number",
    );
    expect(result.records).toHaveLength(0);
    expect(result.skippedChicagoRowCount).toBe(1);
  });

  it("sorts and serializes deterministically with historical ARPA labels", () => {
    const first = parseSbaRestaurantRevitalizationCsv(
      sourceCsv([
        { LoanNumber: "2002", BusinessName: "Second LLC" },
        { LoanNumber: "2001", BusinessName: "First LLC" },
      ]),
    );
    const second = parseSbaRestaurantRevitalizationCsv(
      sourceCsv([
        { LoanNumber: "2001", BusinessName: "First LLC" },
        { LoanNumber: "2002", BusinessName: "Second LLC" },
      ]),
    );
    const firstCsv = serializeSbaRestaurantRevitalizationCsv(first.records);
    const secondCsv = serializeSbaRestaurantRevitalizationCsv(second.records);
    const header = firstCsv.split("\n")[0];

    expect(firstCsv).toBe(secondCsv);
    expect(first.records.map((record) => record.sbaLoanNumber)).toEqual([
      "2001",
      "2002",
    ]);
    expect(firstCsv).toContain("American Rescue Plan Act of 2021");
    expect(firstCsv).toContain("closed_historical_award");
    expect(firstCsv).toContain("historical_disbursed_grant");
    expect(firstCsv).toContain("not_active");
    expect(header).not.toMatch(/latitude|longitude|centroid|geocode/i);
    expect(SBA_RRF_CLASSIFICATION).toMatchObject({
      assistanceType: "grant",
      programState: "closed_historical_award",
      opportunityStatus: "not_active",
      amountContext: "historical_disbursed_grant",
    });
  });

  it("summarizes and enforces source and Chicago integrity independently", () => {
    const result = parseSbaRestaurantRevitalizationCsv(
      sourceCsv([
        { LoanNumber: "3001", GrantAmount: "100.01" },
        {
          LoanNumber: "3002",
          BusinessCity: "New York",
          BusinessState: "NY",
          GrantAmount: "200.02",
        },
      ]),
      { sourceVersion: "test-release" },
    );

    expect(summarizeSbaRestaurantRevitalization(result)).toEqual({
      sourceRowCount: 2,
      chicagoRecordCount: 1,
      excludedRowCount: 1,
      skippedChicagoRowCount: 0,
      sourceGrantTotalUsd: 300.03,
      chicagoGrantTotalUsd: 100.01,
      issueCount: 0,
      errorCount: 0,
      warningCount: 0,
    });
    expect(
      assertSbaRestaurantRevitalizationIntegrity(result, {
        sourceVersion: "test-release",
        sourceRowCount: 2,
        chicagoRecordCount: 1,
        sourceGrantTotalUsd: 300.03,
        chicagoGrantTotalUsd: 100.01,
      }),
    ).toMatchObject({
      sourceRowCount: 2,
      chicagoRecordCount: 1,
    });
    expect(() => assertSbaRestaurantRevitalizationIntegrity(result)).toThrow(
      /expected source version 2024-10-21, parsed test-release/,
    );
  });

  it("pins the verified official full-source baseline", () => {
    expect(SBA_RRF_FULL_SOURCE_EXPECTATIONS).toEqual({
      sourceVersion: SBA_RRF_SOURCE_VERSION,
      sourceRowCount: 100_828,
      chicagoRecordCount: 1_523,
      sourceGrantTotalUsd: 28_613_037_362.99,
      chicagoGrantTotalUsd: 734_658_575.69,
      warningCount: 1,
    });
  });
});
