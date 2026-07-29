import { describe, expect, it } from "vitest";
import {
  assertIllinoisBusinessInterruptionGrantIntegrity,
  extractIllinoisBusinessInterruptionGrantsVersion,
  ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS,
  ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS,
  ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_PDF_URL,
  type IllinoisBusinessInterruptionGrantTextItem,
  layoutIllinoisBusinessInterruptionGrantTextItemPages,
  normalizeIllinoisBusinessInterruptionGrantCity,
  normalizeIllinoisBusinessInterruptionGrantCounty,
  normalizeIllinoisBusinessInterruptionGrantZip,
  parseIllinoisBusinessInterruptionGrantPages,
  parseIllinoisBusinessInterruptionGrantTextItemPages,
  parseIllinoisBusinessInterruptionGrantUsdAmount,
  serializeIllinoisBusinessInterruptionGrantCsv,
  summarizeIllinoisBusinessInterruptionGrants,
} from "../illinois-business-interruption-grants";

function item(
  str: string,
  x: number,
  y: number
): IllinoisBusinessInterruptionGrantTextItem {
  return { str, x, y };
}

function representativeTextItems(): IllinoisBusinessInterruptionGrantTextItem[] {
  return [
    item("Business Interruption Grant (BIG) Awardees", 52, 762),
    item("April 9, 2021", 522, 762),
    item("Business Name", 52, 730),
    item("Doing Business As", 171, 730),
    item("City", 287, 730),
    item("County", 342, 730),
    item("Zip", 390, 730),
    item("Grant Size", 443, 730),
    item("Round 1/2", 538, 730),
    item("Bunch Family Enterprises, Inc.", 52, 720),
    item("Zoup", 171, 720),
    item("Quincy", 287, 720),
    item("Adams", 342, 720),
    item("62301", 390, 720),
    item("$20,000", 443, 720),
    item("Round 1", 538, 720),
    item("Bunch Family Enterprises Inc", 52, 710),
    item("Zoup", 171, 710),
    item("Quincy", 287, 710),
    item("Adams", 342, 710),
    item("62301", 390, 710),
    item("$5,000", 443, 710),
    item("Round 2", 538, 710),
    item("Greater Belvidere Area Chamber of", 52, 700),
    item("Commerce", 52, 690),
    item("Greater Belvidere Area Chamber of Commerce", 171, 690),
    item("Belvidere", 287, 690),
    item("Boone", 342, 690),
    item("61008", 390, 690),
    item("$5,000", 443, 690),
    item("Round 2", 538, 690),
    item(
      "Common Ground Research Networks Common Ground Research NetworksUninc Champaign County",
      52,
      680
    ),
    item("Champaign", 342, 680),
    item("61820", 390, 680),
    item("$115,000", 443, 680),
    item("Round 2", 538, 680),
    item("page 1 of 1", 520, 20),
  ];
}

describe("Illinois Business Interruption Grant ingestion", () => {
  it("parses strict source dollars and normalizes ZIP and county variants", () => {
    expect(parseIllinoisBusinessInterruptionGrantUsdAmount("$150,000")).toBe(
      150_000
    );
    expect(parseIllinoisBusinessInterruptionGrantUsdAmount("$ 5,000")).toBe(
      5_000
    );
    expect(parseIllinoisBusinessInterruptionGrantUsdAmount("$10,000.00")).toBe(
      10_000
    );
    expect(parseIllinoisBusinessInterruptionGrantUsdAmount("10,000")).toBeNull();
    expect(
      parseIllinoisBusinessInterruptionGrantUsdAmount("$10,000.50")
    ).toBeNull();
    expect(normalizeIllinoisBusinessInterruptionGrantZip("60617")).toBe("60617");
    expect(normalizeIllinoisBusinessInterruptionGrantZip("60617-1234")).toBeNull();
    expect(normalizeIllinoisBusinessInterruptionGrantCounty("Dewitt")).toBe(
      "De Witt"
    );
    expect(normalizeIllinoisBusinessInterruptionGrantCounty("Lasalle")).toBe(
      "La Salle"
    );
    expect(normalizeIllinoisBusinessInterruptionGrantCounty("Saint Clair")).toBe(
      "St. Clair"
    );
    expect(normalizeIllinoisBusinessInterruptionGrantCity("  East   St Louis ")).toBe(
      "East St Louis"
    );
  });

  it("extracts the official dated source version", () => {
    expect(
      extractIllinoisBusinessInterruptionGrantsVersion([
        "Business Interruption Grant (BIG) Awardees\tApril 9, 2021",
      ])
    ).toBe("2021-04-09");
  });

  it("uses the seven source columns, reconstructs wraps, and preserves rounds", () => {
    const result = parseIllinoisBusinessInterruptionGrantTextItemPages([
      representativeTextItems(),
    ]);

    expect(result.issues).toEqual([]);
    expect(result.sourceVersion).toBe("2021-04-09");
    expect(result.records).toEqual([
      {
        sourceRowNumber: 1,
        legalBusinessName: "Bunch Family Enterprises, Inc.",
        dba: "Zoup",
        city: "Quincy",
        county: "Adams",
        zip: "62301",
        grantAmountUsd: 20_000,
        round: "Round 1",
        sourceUrl: ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_PDF_URL,
        sourceVersion: "2021-04-09",
        ...ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS,
      },
      {
        sourceRowNumber: 2,
        legalBusinessName: "Bunch Family Enterprises Inc",
        dba: "Zoup",
        city: "Quincy",
        county: "Adams",
        zip: "62301",
        grantAmountUsd: 5_000,
        round: "Round 2",
        sourceUrl: ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_PDF_URL,
        sourceVersion: "2021-04-09",
        ...ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS,
      },
      {
        sourceRowNumber: 3,
        legalBusinessName: "Greater Belvidere Area Chamber of Commerce",
        dba: "Greater Belvidere Area Chamber of Commerce",
        city: "Belvidere",
        county: "Boone",
        zip: "61008",
        grantAmountUsd: 5_000,
        round: "Round 2",
        sourceUrl: ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_PDF_URL,
        sourceVersion: "2021-04-09",
        ...ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS,
      },
      {
        sourceRowNumber: 4,
        legalBusinessName: "Common Ground Research Networks",
        dba: "Common Ground Research Networks",
        city: "Uninc Champaign County",
        county: "Champaign",
        zip: "61820",
        grantAmountUsd: 115_000,
        round: "Round 2",
        sourceUrl: ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_PDF_URL,
        sourceVersion: "2021-04-09",
        ...ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS,
      },
    ]);
    expect(summarizeIllinoisBusinessInterruptionGrants(result)).toEqual({
      pageCount: 1,
      rowCount: 4,
      totalGrantUsd: 145_000,
      minimumGrantUsd: 5_000,
      maximumGrantUsd: 115_000,
      round1RowCount: 1,
      round1TotalGrantUsd: 20_000,
      round2RowCount: 3,
      round2TotalGrantUsd: 125_000,
    });
  });

  it("produces seven stable extracted cells for each visual line", () => {
    const [page] = layoutIllinoisBusinessInterruptionGrantTextItemPages([
      representativeTextItems(),
    ]);
    expect(page.split("\n").every((line) => line.split("\t").length === 7)).toBe(
      true
    );
    expect(page).toContain(
      "Bunch Family Enterprises, Inc.\tZoup\tQuincy\tAdams\t62301\t$20,000\tRound 1"
    );
  });

  it("recovers exact multiword legal/DBA collisions without splitting a person name", () => {
    const page = [
      "Business Interruption Grant (BIG) Awardees\t\t\t\t\t\tApril 9, 2021",
      "Business Name\tDoing Business As\tCity\tCounty\tZip\tGrant Size\tRound 1/2",
      "Gem City Gymnastics & Tumbling, LLC Gem City Gymnastics & Tumbling, LLC\t\tQuincy\tAdams\t62301\t$20,000\tRound 1",
      "Ahmad Ahmad\t\tChicago\tCook\t60601\t$5,000\tRound 2",
    ].join("\n");
    const result = parseIllinoisBusinessInterruptionGrantPages([page]);

    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({
      legalBusinessName: "Gem City Gymnastics & Tumbling, LLC",
      dba: "Gem City Gymnastics & Tumbling, LLC",
    });
    expect(result.records[1]).toMatchObject({
      legalBusinessName: "Ahmad Ahmad",
      dba: "",
    });
  });

  it("reports malformed and incomplete rows rather than dropping them", () => {
    const page = [
      "Business Interruption Grant (BIG) Awardees\t\t\t\t\t\tApril 9, 2021",
      "Business Name\tDoing Business As\tCity\tCounty\tZip\tGrant Size\tRound 1/2",
      "BROKEN AWARD\t\tChicago\tCook\t60617\tfive thousand\tRound 2",
      "UNFINISHED BUSINESS\tDBA\tChicago\tCook\t60617\t$5,000\t",
    ].join("\n");
    const result = parseIllinoisBusinessInterruptionGrantPages([page]);

    expect(result.records).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "incomplete_row",
      "malformed_row",
    ]);
    expect(() =>
      assertIllinoisBusinessInterruptionGrantIntegrity(result, {
        pageCount: 1,
        rowCount: 0,
        totalGrantUsd: 0,
      })
    ).toThrow(/2 parser issue\(s\)/);
  });

  it("enforces exact independently verified full-source totals", () => {
    const result = parseIllinoisBusinessInterruptionGrantTextItemPages([
      representativeTextItems(),
    ]);
    expect(
      assertIllinoisBusinessInterruptionGrantIntegrity(result, {
        pageCount: 1,
        rowCount: 4,
        totalGrantUsd: 145_000,
        minimumGrantUsd: 5_000,
        maximumGrantUsd: 115_000,
        round1RowCount: 1,
        round1TotalGrantUsd: 20_000,
        round2RowCount: 3,
        round2TotalGrantUsd: 125_000,
        sourceVersion: "2021-04-09",
      })
    ).toEqual(summarizeIllinoisBusinessInterruptionGrants(result));
    expect(() =>
      assertIllinoisBusinessInterruptionGrantIntegrity(result)
    ).toThrow(/expected pages 135, parsed 1/);
    expect(
      ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS
    ).toEqual({
      pageCount: 135,
      rowCount: 8_998,
      totalGrantUsd: 276_275_000,
      minimumGrantUsd: 5_000,
      maximumGrantUsd: 150_000,
      round1RowCount: 2_802,
      round1TotalGrantUsd: 48_600_000,
      round2RowCount: 6_196,
      round2TotalGrantUsd: 227_675_000,
      sourceVersion: "2021-04-09",
    });
  });

  it("serializes deterministic historical labels without prohibited fields", () => {
    const result = parseIllinoisBusinessInterruptionGrantTextItemPages([
      representativeTextItems(),
    ]);
    const first = serializeIllinoisBusinessInterruptionGrantCsv(result.records);
    const second = serializeIllinoisBusinessInterruptionGrantCsv(result.records);

    expect(first).toBe(second);
    expect(first.split("\n")[0]).toBe(
      "source_row_number,legal_business_name,dba,city,county,zip,grant_amount_usd,round,source_url,source_version,program_name,relief_era,assistance_type,program_status,record_note"
    );
    expect(first).toContain(",CARES Act (2020),grant,historical_closed,");
    expect(first).not.toMatch(
      /score|rank|potential|available|remaining|street_address/i
    );
  });

  it("requires a dated header unless an explicit version is supplied", () => {
    const page = [
      "Business Interruption Grant (BIG) Awardees\t\t\t\t\t\t",
      "Business Name\tDoing Business As\tCity\tCounty\tZip\tGrant Size\tRound 1/2",
    ].join("\n");
    expect(() =>
      parseIllinoisBusinessInterruptionGrantPages([page])
    ).toThrow(/source version is missing or invalid/);
    expect(
      parseIllinoisBusinessInterruptionGrantPages([page], {
        sourceVersion: "2021-04-09",
      }).sourceVersion
    ).toBe("2021-04-09");
  });
});
