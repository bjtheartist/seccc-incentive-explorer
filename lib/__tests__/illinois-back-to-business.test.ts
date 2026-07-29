import { describe, expect, it } from "vitest";
import {
  assertIllinoisBackToBusinessIntegrity,
  extractIllinoisBackToBusinessVersion,
  ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS,
  ILLINOIS_BACK_TO_BUSINESS_LABELS,
  ILLINOIS_BACK_TO_BUSINESS_OFFICIAL_PROGRAM_HEADLINE,
  ILLINOIS_BACK_TO_BUSINESS_PDF_URL,
  type IllinoisBackToBusinessTextItem,
  layoutIllinoisBackToBusinessTextItemPages,
  normalizeIllinoisBackToBusinessZip,
  parseIllinoisBackToBusinessPages,
  parseIllinoisBackToBusinessTextItemPages,
  parseIllinoisBackToBusinessUsdAmount,
  serializeIllinoisBackToBusinessCsv,
  summarizeIllinoisBackToBusiness,
} from "../illinois-back-to-business";

function item(
  str: string,
  x: number,
  y: number
): IllinoisBackToBusinessTextItem {
  return { str, x, y };
}

function representativeTextItems(): IllinoisBackToBusinessTextItem[] {
  return [
    item("Back to Business Grant Awardees", 52.44, 762.48),
    item("July 26, 2022", 522.49, 762.48),
    item("Business Name", 52.44, 730.2),
    item("Doing Business As", 202.2, 730.2),
    item("County", 351.96, 730.08),
    item("City", 403.8, 730.08),
    item("Zip Code", 470.28, 730.08),
    item("Award Amount", 507, 730.08),
    item("CHAMPAIGN COUNTY CONVENTION & VISITORS", 52.44, 720.72),
    item("BUREAU", 52.44, 711.24),
    item("VISIT CHAMPAIGN COUNTY", 202.2, 711.24),
    item("Champaign", 351.96, 711.12),
    item("CHAMPAIGN", 403.8, 711.12),
    item("61820", 486.12, 711.12),
    item("$5,000", 539.88, 711.12),
    item("THE REAL ESTATE BOOK OF CHAMPAIGN-URBANA-", 202.2, 701.76),
    item("HAMMERHEAD RECORDS INC.", 52.44, 692.28),
    item("SAVOY, IL", 202.2, 692.28),
    item("Champaign", 351.96, 692.16),
    item("CHAMPAIGN", 403.8, 692.16),
    item("61820", 486.12, 692.16),
    item("$10,000", 536.28, 692.16),
    item("FOR HOME & HER, LLC", 52.44, 682.8),
    item("Adams", 351.96, 682.68),
    item("QUINCY", 403.8, 682.68),
    item("62301", 486.12, 682.68),
    item("$5,000", 539.88, 682.68),
    item(
      "INSTITUTE OF NATURAL HEALTH AND EDUCATION INSTITUTE OF NATURAL HEALTH AND EDUCATION Kankakee",
      52.44,
      673.32
    ),
    item("BRADLEY", 403.8, 673.2),
    item("60915", 486.12, 673.2),
    item("$5,000", 539.88, 673.2),
    item("AGAPEVIBES ENTERTAINMENT LLC", 52.44, 663.84),
    item(
      "AGAPEVIBES ENTERTAINMENT AND SUPPER CLUB Cook",
      202.2,
      663.84
    ),
    item("CHICAGO", 403.8, 663.72),
    item("60649", 486.12, 663.72),
    item("$15,000", 536.28, 663.72),
    item("page 1 of 1", 517, 20),
  ];
}

describe("Illinois Back to Business ingestion", () => {
  it("parses strict official dollar and ZIP values without inventing precision", () => {
    expect(parseIllinoisBackToBusinessUsdAmount("$80,000")).toBe(80_000);
    expect(parseIllinoisBackToBusinessUsdAmount("$ 5,000")).toBe(5_000);
    expect(parseIllinoisBackToBusinessUsdAmount("$10,000.00")).toBe(10_000);
    expect(parseIllinoisBackToBusinessUsdAmount("10,000")).toBeNull();
    expect(parseIllinoisBackToBusinessUsdAmount("$10,000.50")).toBeNull();
    expect(normalizeIllinoisBackToBusinessZip("60617")).toBe("60617");
    expect(normalizeIllinoisBackToBusinessZip("0617")).toBeNull();
    expect(normalizeIllinoisBackToBusinessZip("60617-1234")).toBeNull();
  });

  it("extracts the dated source version from the official document heading", () => {
    expect(
      extractIllinoisBackToBusinessVersion([
        "Back to Business Grant Awardees\t\t\t\t\tJuly 26, 2022",
      ])
    ).toBe("2022-07-26");
  });

  it("uses PDF columns to reconstruct wrapped legal names and DBAs", () => {
    const result = parseIllinoisBackToBusinessTextItemPages([
      representativeTextItems(),
    ]);

    expect(result.issues).toEqual([]);
    expect(result.sourceVersion).toBe("2022-07-26");
    expect(result.records).toEqual([
      {
        legalBusinessName: "CHAMPAIGN COUNTY CONVENTION & VISITORS BUREAU",
        dba: "VISIT CHAMPAIGN COUNTY",
        county: "Champaign",
        city: "CHAMPAIGN",
        zip: "61820",
        awardAmountUsd: 5_000,
        sourceUrl: ILLINOIS_BACK_TO_BUSINESS_PDF_URL,
        sourceVersion: "2022-07-26",
        ...ILLINOIS_BACK_TO_BUSINESS_LABELS,
      },
      {
        legalBusinessName: "HAMMERHEAD RECORDS INC.",
        dba: "THE REAL ESTATE BOOK OF CHAMPAIGN-URBANA- SAVOY, IL",
        county: "Champaign",
        city: "CHAMPAIGN",
        zip: "61820",
        awardAmountUsd: 10_000,
        sourceUrl: ILLINOIS_BACK_TO_BUSINESS_PDF_URL,
        sourceVersion: "2022-07-26",
        ...ILLINOIS_BACK_TO_BUSINESS_LABELS,
      },
      {
        legalBusinessName: "FOR HOME & HER, LLC",
        dba: "",
        county: "Adams",
        city: "QUINCY",
        zip: "62301",
        awardAmountUsd: 5_000,
        sourceUrl: ILLINOIS_BACK_TO_BUSINESS_PDF_URL,
        sourceVersion: "2022-07-26",
        ...ILLINOIS_BACK_TO_BUSINESS_LABELS,
      },
      {
        legalBusinessName: "INSTITUTE OF NATURAL HEALTH AND EDUCATION",
        dba: "INSTITUTE OF NATURAL HEALTH AND EDUCATION",
        county: "Kankakee",
        city: "BRADLEY",
        zip: "60915",
        awardAmountUsd: 5_000,
        sourceUrl: ILLINOIS_BACK_TO_BUSINESS_PDF_URL,
        sourceVersion: "2022-07-26",
        ...ILLINOIS_BACK_TO_BUSINESS_LABELS,
      },
      {
        legalBusinessName: "AGAPEVIBES ENTERTAINMENT LLC",
        dba: "AGAPEVIBES ENTERTAINMENT AND SUPPER CLUB",
        county: "Cook",
        city: "CHICAGO",
        zip: "60649",
        awardAmountUsd: 15_000,
        sourceUrl: ILLINOIS_BACK_TO_BUSINESS_PDF_URL,
        sourceVersion: "2022-07-26",
        ...ILLINOIS_BACK_TO_BUSINESS_LABELS,
      },
    ]);
    expect(summarizeIllinoisBackToBusiness(result)).toEqual({
      pageCount: 1,
      rowCount: 5,
      totalAwardUsd: 40_000,
      minimumAwardUsd: 5_000,
      maximumAwardUsd: 15_000,
    });
  });

  it("produces six stable extracted columns for every visual line", () => {
    const [page] = layoutIllinoisBackToBusinessTextItemPages([
      representativeTextItems(),
    ]);
    const lines = page.split("\n");

    expect(lines.every((line) => line.split("\t").length === 6)).toBe(true);
    expect(page).toContain(
      "CHAMPAIGN COUNTY CONVENTION & VISITORS\t\t\t\t\t"
    );
    expect(page).toContain(
      "BUREAU\tVISIT CHAMPAIGN COUNTY\tChampaign\tCHAMPAIGN\t61820\t$5,000"
    );
  });

  it("reports malformed and incomplete rows instead of silently dropping them", () => {
    const page = [
      "Back to Business Grant Awardees\t\t\t\t\tJuly 26, 2022",
      "Business Name\tDoing Business As\tCounty\tCity\tZip Code\tAward Amount",
      "BROKEN AWARD\t\tCook\tCHICAGO\t60617\tfive thousand",
      "UNFINISHED BUSINESS\tUNFINISHED DBA\t\t\t\t",
      "\t\t\t\t\tpage 1 of 1",
    ].join("\n");
    const result = parseIllinoisBackToBusinessPages([page]);

    expect(result.records).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "malformed_row",
      "incomplete_row",
    ]);
    expect(() =>
      assertIllinoisBackToBusinessIntegrity(result, {
        pageCount: 1,
        rowCount: 0,
        totalAwardUsd: 0,
      })
    ).toThrow(/2 parser issue\(s\)/);
  });

  it("enforces exact full-source integrity independently of rounded headlines", () => {
    const result = parseIllinoisBackToBusinessTextItemPages([
      representativeTextItems(),
    ]);

    expect(
      assertIllinoisBackToBusinessIntegrity(result, {
        pageCount: 1,
        rowCount: 5,
        totalAwardUsd: 40_000,
        minimumAwardUsd: 5_000,
        maximumAwardUsd: 15_000,
        sourceVersion: "2022-07-26",
      })
    ).toEqual({
      pageCount: 1,
      rowCount: 5,
      totalAwardUsd: 40_000,
      minimumAwardUsd: 5_000,
      maximumAwardUsd: 15_000,
    });
    expect(() => assertIllinoisBackToBusinessIntegrity(result)).toThrow(
      /expected pages 99, parsed 1; expected rows 6,687, parsed 5; expected total award \$249,510,000, parsed \$40,000/
    );
    expect(ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS).toEqual({
      pageCount: 99,
      rowCount: 6_687,
      totalAwardUsd: 249_510_000,
      minimumAwardUsd: 5_000,
      maximumAwardUsd: 250_000,
      sourceVersion: "2022-07-26",
    });
    expect(ILLINOIS_BACK_TO_BUSINESS_OFFICIAL_PROGRAM_HEADLINE).toMatchObject({
      rowCount: 6_687,
      totalAwardUsd: 250_000_000,
    });
  });

  it("serializes deterministic historical ARPA labels without address guesses", () => {
    const result = parseIllinoisBackToBusinessTextItemPages([
      representativeTextItems(),
    ]);
    const first = serializeIllinoisBackToBusinessCsv(result.records);
    const second = serializeIllinoisBackToBusinessCsv(result.records);

    expect(first).toBe(second);
    expect(first.split("\n")[0]).toBe(
      "legal_business_name,dba,county,city,zip,award_amount_usd,source_url,source_version,program_name,funding_source,assistance_type,award_status,record_note"
    );
    expect(first).toContain("American Rescue Plan Act (ARPA)");
    expect(first).toContain(",grant,historical_award,");
    expect(first).toContain(
      "not an active opportunity or a promise of future funding"
    );
    expect(first).not.toMatch(/street_address|eligibility_score/i);
  });

  it("requires a dated source header unless an explicit version is supplied", () => {
    const page = [
      "Back to Business Grant Awardees\t\t\t\t\t",
      "Business Name\tDoing Business As\tCounty\tCity\tZip Code\tAward Amount",
    ].join("\n");

    expect(() => parseIllinoisBackToBusinessPages([page])).toThrow(
      /source version is missing or invalid/
    );
    expect(
      parseIllinoisBackToBusinessPages([page], {
        sourceVersion: "2022-07-26",
      }).sourceVersion
    ).toBe("2022-07-26");
  });
});
