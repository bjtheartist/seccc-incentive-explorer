import { describe, expect, it } from "vitest";
import {
  assertIllinoisHospitalityEmergencyGrantIntegrity,
  ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION,
  ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_FULL_SOURCE_EXPECTATIONS,
  ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_OFFICIAL_HEADLINE,
  ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_PDF_URL,
  type IllinoisHospitalityEmergencyGrantTextItem,
  layoutIllinoisHospitalityEmergencyGrantTextItemPages,
  parseIllinoisHospitalityEmergencyGrantPages,
  parseIllinoisHospitalityEmergencyGrantTextItemPages,
  parseIllinoisHospitalityEmergencyGrantUsdAmount,
  serializeIllinoisHospitalityEmergencyGrantCsv,
  summarizeIllinoisHospitalityEmergencyGrants,
} from "../illinois-hospitality-emergency-grants";

function item(
  str: string,
  x: number,
  y: number,
): IllinoisHospitalityEmergencyGrantTextItem {
  return { str, x, y };
}

function pageOneFixture(): IllinoisHospitalityEmergencyGrantTextItem[] {
  return [
    item("Business Name", 40.92, 740.88),
    item("DBA", 244.8, 740.88),
    item("City", 366.36, 740.88),
    item("County", 439.44, 740.88),
    item("Grant", 492, 740.88),
    item("4 T's Inc dba The Corner Pub", 40.92, 729.96),
    item("The Corner Pub", 244.8, 729.96),
    item("Valmeyer", 366.36, 729.96),
    item("Monroe", 439.44, 729.96),
    item("$", 491.88, 729.96),
    item("10,000", 521.76, 729.96),
    item("Hess\u00e2\u20ac\u2122s Whiskey River", 40.92, 719.04),
    item("Hess's Whiskey Bar", 244.8, 719.04),
    item("Savanna", 366.36, 719.04),
    item("Carroll", 439.44, 719.04),
    item("$", 491.88, 719.04),
    item("10,000", 521.76, 719.04),
  ];
}

function pageTwoFixture(): IllinoisHospitalityEmergencyGrantTextItem[] {
  return [
    item("Lotus of Illinois, Inc., DBA: Subway", 40.92, 740.88),
    item("Subway", 244.8, 740.88),
    item("Romeoville", 366.36, 740.88),
    item("Will", 439.44, 740.88),
    item("$", 491.88, 740.88),
    item("25,000", 521.76, 740.88),
    item("Longbridge Golf Course, Inc.", 40.92, 729.96),
    item("Springfield", 366.36, 729.96),
    item("Sangamon", 439.44, 729.96),
    item("$", 491.88, 729.96),
    item("25,000", 521.76, 729.96),
  ];
}

describe("Illinois Hospitality Emergency Grant ingestion", () => {
  it("parses only exact source-published historical dollar values", () => {
    expect(parseIllinoisHospitalityEmergencyGrantUsdAmount("$ 25,000")).toBe(
      25_000,
    );
    expect(parseIllinoisHospitalityEmergencyGrantUsdAmount("$10,000.00")).toBe(
      10_000,
    );
    expect(parseIllinoisHospitalityEmergencyGrantUsdAmount("25,000")).toBeNull();
    expect(
      parseIllinoisHospitalityEmergencyGrantUsdAmount("$10,000.50"),
    ).toBeNull();
    expect(parseIllinoisHospitalityEmergencyGrantUsdAmount(-1)).toBeNull();
  });

  it("uses PDF columns to preserve names, DBAs, and municipality precision", () => {
    const result = parseIllinoisHospitalityEmergencyGrantTextItemPages([
      pageOneFixture(),
      pageTwoFixture(),
    ]);

    expect(result.issues).toEqual([]);
    expect(result.pageRowCounts).toEqual([2, 2]);
    expect(result.records).toEqual([
      {
        legalBusinessName: "4 T's Inc dba The Corner Pub",
        dba: "The Corner Pub",
        publishedMunicipality: "Valmeyer",
        county: "Monroe",
        historicalGrantAmountUsd: 10_000,
        sourceUrl: ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_PDF_URL,
        sourceVersion: "2020-04-27",
        ...ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION,
      },
      {
        legalBusinessName: "Hess\u2019s Whiskey River",
        dba: "Hess's Whiskey Bar",
        publishedMunicipality: "Savanna",
        county: "Carroll",
        historicalGrantAmountUsd: 10_000,
        sourceUrl: ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_PDF_URL,
        sourceVersion: "2020-04-27",
        ...ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION,
      },
      {
        legalBusinessName: "Lotus of Illinois, Inc., DBA: Subway",
        dba: "Subway",
        publishedMunicipality: "Romeoville",
        county: "Will",
        historicalGrantAmountUsd: 25_000,
        sourceUrl: ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_PDF_URL,
        sourceVersion: "2020-04-27",
        ...ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION,
      },
      {
        legalBusinessName: "Longbridge Golf Course, Inc.",
        dba: "",
        publishedMunicipality: "Springfield",
        county: "Sangamon",
        historicalGrantAmountUsd: 25_000,
        sourceUrl: ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_PDF_URL,
        sourceVersion: "2020-04-27",
        ...ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION,
      },
    ]);
    expect(
      result.records.every(
        (record) =>
          !("zip" in record) &&
          !("street" in record) &&
          record.sourcePrecision === "municipality",
      ),
    ).toBe(true);
  });

  it("keeps page-boundary rows separate instead of joining extracted text", () => {
    const pages = layoutIllinoisHospitalityEmergencyGrantTextItemPages([
      pageOneFixture(),
      pageTwoFixture(),
    ]);

    expect(pages).toHaveLength(2);
    expect(pages[0].split("\n").at(-1)).toContain("Hess\u2019s Whiskey River");
    expect(pages[1].split("\n")[0]).toContain(
      "Lotus of Illinois, Inc., DBA: Subway",
    );
    expect(pages.join("\n")).not.toContain("10,000Lotus");
  });

  it("reconstructs wrapped business names and DBAs within a page", () => {
    const page = [
      "Business Name\tDBA\tCity\tCounty\tGrant",
      "A VERY LONG BUSINESS\tA DBA WITH\t\t\t",
      "NAME LLC\tMANY WORDS\tChicago\tCook\t$ 50,000",
    ].join("\n");
    const result = parseIllinoisHospitalityEmergencyGrantPages([page]);

    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({
      legalBusinessName: "A VERY LONG BUSINESS NAME LLC",
      dba: "A DBA WITH MANY WORDS",
      publishedMunicipality: "Chicago",
      county: "Cook",
      historicalGrantAmountUsd: 50_000,
    });
  });

  it("fails closed on incomplete page-end rows and never borrows the next page", () => {
    const result = parseIllinoisHospitalityEmergencyGrantPages([
      [
        "Business Name\tDBA\tCity\tCounty\tGrant",
        "UNFINISHED BUSINESS\tUNFINISHED DBA\t\t\t",
      ].join("\n"),
      "NEXT BUSINESS\tNEXT DBA\tChicago\tCook\t$ 10,000",
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].legalBusinessName).toBe("NEXT BUSINESS");
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "incomplete_row",
      "empty_page",
    ]);
    expect(() =>
      assertIllinoisHospitalityEmergencyGrantIntegrity(result, {
        pageCount: 2,
        rowCount: 1,
        totalGrantUsd: 10_000,
      }),
    ).toThrow(/2 parser issue\(s\)/);
  });

  it("checks canonical source totals, page shape, distribution, and boundaries", () => {
    expect(
      ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_FULL_SOURCE_EXPECTATIONS,
    ).toEqual({
      pageCount: 12,
      rowCount: 699,
      totalGrantUsd: 13_995_000,
      minimumGrantUsd: 10_000,
      maximumGrantUsd: 50_000,
      pageRowCounts: [61, 62, 62, 62, 62, 62, 62, 62, 62, 62, 62, 18],
      awardAmountCounts: {
        10_000: 307,
        25_000: 347,
        50_000: 45,
      },
      countyCount: 69,
      firstRecordKey: "1659 INC|Caminos de Michoacan|Chicago|Cook|25000",
      lastRecordKey:
        "Longbridge Golf Course, Inc.||Springfield|Sangamon|25000",
      sourceVersion: "2020-04-27",
    });
    expect(
      ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_OFFICIAL_HEADLINE,
    ).toMatchObject({
      asOf: "2020-04-27",
      approvedBusinessCount: 699,
      fundedUsd: 13_995_000,
    });

    const result = parseIllinoisHospitalityEmergencyGrantTextItemPages([
      pageOneFixture(),
      pageTwoFixture(),
    ]);
    expect(
      assertIllinoisHospitalityEmergencyGrantIntegrity(result, {
        pageCount: 2,
        rowCount: 4,
        totalGrantUsd: 70_000,
        minimumGrantUsd: 10_000,
        maximumGrantUsd: 25_000,
        pageRowCounts: [2, 2],
        awardAmountCounts: { 10_000: 2, 25_000: 2 },
        countyCount: 4,
        firstRecordKey:
          "4 T's Inc dba The Corner Pub|The Corner Pub|Valmeyer|Monroe|10000",
        lastRecordKey:
          "Longbridge Golf Course, Inc.||Springfield|Sangamon|25000",
        sourceVersion: "2020-04-27",
      }),
    ).toEqual({
      pageCount: 2,
      rowCount: 4,
      totalGrantUsd: 70_000,
      minimumGrantUsd: 10_000,
      maximumGrantUsd: 25_000,
      pageRowCounts: [2, 2],
      awardAmountCounts: { 10_000: 2, 25_000: 2 },
      countyCount: 4,
      firstRecordKey:
        "4 T's Inc dba The Corner Pub|The Corner Pub|Valmeyer|Monroe|10000",
      lastRecordKey:
        "Longbridge Golf Course, Inc.||Springfield|Sangamon|25000",
    });
    expect(() =>
      assertIllinoisHospitalityEmergencyGrantIntegrity(result),
    ).toThrow(/expected pages 12, parsed 2/);
  });

  it("serializes stable historical-only labels without scoring or address guesses", () => {
    const result = parseIllinoisHospitalityEmergencyGrantTextItemPages([
      pageOneFixture(),
      pageTwoFixture(),
    ]);
    const first = serializeIllinoisHospitalityEmergencyGrantCsv(result.records);
    const second = serializeIllinoisHospitalityEmergencyGrantCsv(result.records);

    expect(first).toBe(second);
    const header = first.split("\n")[0];
    expect(header).toBe(
      "legal_business_name,dba,published_municipality,county,historical_grant_amount_usd,source_url,source_version,source_status,source_precision,program_name,assistance_type,award_status,program_status,record_note",
    );
    expect(first).toContain(
      ",2020-04-27,official_confirmed_awardee_list,municipality,",
    );
    expect(first).toContain(",grant,historical_award,closed,");
    expect(header).not.toMatch(
      /\b(score|ranking|ranked|potential|available|street|zip)\b/,
    );
    expect(first).toContain("not an active opportunity");
    expect(first).toContain("no street address or ZIP is inferred");
    expect(summarizeIllinoisHospitalityEmergencyGrants(result)).toMatchObject({
      rowCount: 4,
      totalGrantUsd: 70_000,
    });
  });
});
