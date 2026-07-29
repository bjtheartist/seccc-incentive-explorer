import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertCookCountySourceGrantIntegrity,
  COOK_COUNTY_SOURCE_GRANTS_CLASSIFICATION,
  COOK_COUNTY_SOURCE_GRANTS_FULL_SOURCE_EXPECTATIONS,
  COOK_COUNTY_SOURCE_GRANTS_OFFICIAL_PROGRAM_HEADLINE,
  COOK_COUNTY_SOURCE_GRANTS_PDF_URL,
  extractCookCountySourceGrantVersion,
  normalizeZipCode,
  parseCookCountySourceGrantPages,
  parseUsdAmount,
  serializeCookCountySourceGrantsCsv,
  summarizeCookCountySourceGrants,
} from "../cook-county-source-grants";

function fixture(name: string): string {
  return readFileSync(
    new URL(`./fixtures/cook-county-source-grants/${name}`, import.meta.url),
    "utf-8"
  );
}

describe("Cook County Source Grant ingestion", () => {
  it("parses currency without losing source precision", () => {
    expect(parseUsdAmount("$ 20,000")).toBe(20_000);
    expect(parseUsdAmount("$10,000.00")).toBe(10_000);
    expect(parseUsdAmount("1,234.50")).toBe(1_234.5);
    expect(parseUsdAmount("$ twenty thousand")).toBeNull();
    expect(parseUsdAmount("20,00")).toBeNull();
  });

  it("normalizes ZIP codes as strings and preserves leading zeroes", () => {
    expect(normalizeZipCode("60608")).toBe("60608");
    expect(normalizeZipCode("1234")).toBe("01234");
    expect(normalizeZipCode(1234)).toBe("01234");
    expect(normalizeZipCode("1234-5678")).toBe("01234-5678");
    expect(normalizeZipCode("60608.0")).toBeNull();
  });

  it("extracts the source version from the official document header", () => {
    expect(
      extractCookCountySourceGrantVersion([
        "Cook County Small Business Source 2023 Source Grant List as of November 20, 2024",
      ])
    ).toBe("2024-11-20");
  });

  it("reconstructs wrapped names and municipalities while preserving punctuation", () => {
    const result = parseCookCountySourceGrantPages([
      fixture("wrapped-and-punctuation.txt"),
    ]);

    expect(result.issues).toEqual([]);
    expect(result.sourceVersion).toBe("2024-11-20");
    expect(result.records).toEqual([
      {
        awardeeName: "O'Brien & Sons, LLC",
        awardAmountUsd: 20_000,
        municipality: "Chicago",
        zip: "60608",
        sourceUrl: COOK_COUNTY_SOURCE_GRANTS_PDF_URL,
        sourceVersion: "2024-11-20",
      },
      {
        awardeeName: "American Institute For Consultation And Training Inc.",
        awardAmountUsd: 10_000,
        municipality: "Tinley Park",
        zip: "60477",
        sourceUrl: COOK_COUNTY_SOURCE_GRANTS_PDF_URL,
        sourceVersion: "2024-11-20",
      },
      {
        awardeeName: "Wiktor Construction & Development Inc",
        awardAmountUsd: 20_000,
        municipality: "LaGrange Highlands",
        zip: "60525",
        sourceUrl: COOK_COUNTY_SOURCE_GRANTS_PDF_URL,
        sourceVersion: "2024-11-20",
      },
    ]);
    expect(summarizeCookCountySourceGrants(result)).toEqual({
      pageCount: 1,
      rowCount: 3,
      totalAwardUsd: 50_000,
    });
  });

  it("reports malformed and incomplete rows instead of silently dropping them", () => {
    const result = parseCookCountySourceGrantPages([
      fixture("malformed-rows.txt"),
    ]);

    expect(result.records).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "malformed_row",
      "incomplete_row",
    ]);
    expect(() =>
      assertCookCountySourceGrantIntegrity(result, {
        pageCount: 1,
        rowCount: 0,
        totalAwardUsd: 0,
      })
    ).toThrow(/2 parser issue\(s\)/);
  });

  it("flags a wrapped AWARDEE NAME absorbed into the municipality, and fails the integrity gate", () => {
    // The uninstrumented partialRow path. Once a `$` line lands without a
    // trailing ZIP, later non-`$` lines were appended to the municipality with
    // no shape check — so an awardee-name continuation silently became part of
    // the place name and the awardee name was truncated.
    //
    // This is invisible to every other assertion: the row still PARSES, so the
    // row count, the dollar total, and the page count are all unchanged and
    // `issues` stayed empty. Only recording an issue closes it.
    const result = parseCookCountySourceGrantPages([
      [
        "Cook County Small Business Source 2023 Source Grant List as of November 20, 2024",
        "1",
        "Awardee Award Amount City Zip",
        "Precision Tools And Equipment Services, $ 10,000 Chicago",
        "Llc",
        "60632",
      ].join("\n"),
    ]);

    // The row parses, and the corruption is exactly as described: the name is
    // truncated and "Llc" has been absorbed into the municipality.
    expect(result.records).toHaveLength(1);
    expect(result.records[0].awardeeName).toBe("Precision Tools And Equipment Services,");
    expect(result.records[0].municipality).toBe("Chicago Llc");
    expect(result.records[0].awardAmountUsd).toBe(10_000);

    // …and it is no longer silent.
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "suspect_municipality_fragment",
    ]);
    expect(result.issues[0].text).toBe("Llc");

    // The row/dollar/page counts are all UNCHANGED by the corruption, which is
    // why the issue is the only thing that can stop the import publishing it.
    expect(() =>
      assertCookCountySourceGrantIntegrity(result, {
        pageCount: 1,
        rowCount: 1,
        totalAwardUsd: 10_000,
      })
    ).toThrow(/1 parser issue\(s\)/);
  });

  it("does not flag a legitimate multi-word municipality wrap", () => {
    // The wrap shape this PDF actually produces: "Wiktor Construction &
    // Development Inc $ 20,000 LaGrange" / "Highlands" / "60525". "Highlands"
    // is a real place-name fragment and must pass clean, or the guard would
    // fail the whole import on good data.
    const result = parseCookCountySourceGrantPages([
      fixture("wrapped-and-punctuation.txt"),
    ]);
    expect(result.issues).toEqual([]);
    const wiktor = result.records.find((record) =>
      record.awardeeName.startsWith("Wiktor")
    );
    expect(wiktor?.municipality).toBe("LaGrange Highlands");
  });

  it("enforces explicit row, page, and award-total expectations", () => {
    const result = parseCookCountySourceGrantPages([
      fixture("wrapped-and-punctuation.txt"),
    ]);

    expect(
      assertCookCountySourceGrantIntegrity(result, {
        pageCount: 1,
        rowCount: 3,
        totalAwardUsd: 50_000,
      })
    ).toEqual({
      pageCount: 1,
      rowCount: 3,
      totalAwardUsd: 50_000,
    });
    expect(() => assertCookCountySourceGrantIntegrity(result)).toThrow(
      /expected 74 pages, parsed 1; expected 3,003 rows, parsed 3; expected \$50,050,000, parsed \$50,000/
    );
  });

  it("keeps full-PDF integrity separate from the official program headline", () => {
    expect(COOK_COUNTY_SOURCE_GRANTS_FULL_SOURCE_EXPECTATIONS).toEqual({
      pageCount: 74,
      rowCount: 3_003,
      totalAwardUsd: 50_050_000,
    });
    expect(COOK_COUNTY_SOURCE_GRANTS_OFFICIAL_PROGRAM_HEADLINE).toMatchObject({
      rowCount: 3_000,
      totalAwardUsd: 50_000_000,
    });
  });

  it("serializes deterministic private-source fields without an address or active-incentive claim", () => {
    const result = parseCookCountySourceGrantPages([
      fixture("wrapped-and-punctuation.txt"),
    ]);
    const first = serializeCookCountySourceGrantsCsv(result.records);
    const second = serializeCookCountySourceGrantsCsv(result.records);

    expect(first).toBe(second);
    expect(first.split("\n")[0]).toBe(
      "awardee_name,award_amount_usd,municipality,zip,source_url,source_version"
    );
    expect(first).toContain('"O\'Brien & Sons, LLC",20000,Chicago,60608');
    expect(first).not.toMatch(/street|address|eligib|active/i);
    expect(COOK_COUNTY_SOURCE_GRANTS_CLASSIFICATION).toEqual({
      visibility: "private_admin_source",
      programState: "historical_award",
    });
  });
});
