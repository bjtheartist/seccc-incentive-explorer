import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DCEO_CAPITAL_APPROPRIATIONS_SOURCE_URL,
  DceoCapitalAppropriationParseError,
  extractExplicitProjectAddress,
  hasHighConfidenceChicagoDceoLocation,
  parseDceoCapitalAppropriationsPages,
} from "../dceo-capital-appropriations";
import {
  parseDceoCapitalAppropriationCliArgs,
  serializeDceoCapitalAppropriationsCsv,
} from "../../scripts/import-dceo-capital-appropriations";

const FIXTURE_DIR = fileURLToPath(
  new URL("./fixtures/dceo-capital-appropriations/", import.meta.url),
);

const FIXTURE_PAGES = ["page-1.txt", "page-2.txt"].map((name) =>
  readFileSync(`${FIXTURE_DIR}${name}`, "utf8"),
);

describe("parseDceoCapitalAppropriationsPages", () => {
  it("recovers wrapped names and descriptions across page headers and breaks", () => {
    const result = parseDceoCapitalAppropriationsPages(FIXTURE_PAGES, {
      strictFullDocument: true,
      expectedPageCount: 2,
      sourceVersion: "fixture-v1",
    });

    expect(result.records).toHaveLength(3);
    expect(result.records[0]).toEqual({
      lineName: "129-115. University of Chicago Medical Center",
      appropriationCode: "141-42091-4900-0419",
      appropriatedAmount: 1_250_000,
      originalDescription:
        "SECTION 115. THE SUM IS REAPPROPRIATED FOR IMPROVEMENTS TO THE COMMUNITY CENTER, LOCATED AT 62-64 SOUTH LASALLE STREET IN AURORA, INCLUDING PRIOR INCURRED COSTS.",
      lineType: "line_item",
      explicitProjectAddress: "62-64 SOUTH LASALLE STREET",
      sourceUrl: DCEO_CAPITAL_APPROPRIATIONS_SOURCE_URL,
      sourceVersion: "fixture-v1",
    });
  });

  it("does not mistake a next-row name containing Lump Sum for the current row type", () => {
    const result = parseDceoCapitalAppropriationsPages(FIXTURE_PAGES);
    expect(result.records[0].lineType).toBe("line_item");
    expect(result.records[1].lineName).toBe("170-1. SR MI - Lump Sum");
    expect(result.records[1].lineType).toBe("lump_sum");
  });

  it("preserves accounting-style negative appropriations and reconciles exact cents", () => {
    const result = parseDceoCapitalAppropriationsPages(FIXTURE_PAGES, {
      strictFullDocument: true,
      expectedPageCount: 2,
    });

    expect(result.records[2].appropriatedAmount).toBe(-50_000);
    expect(result.diagnostics).toMatchObject({
      anchorCount: 3,
      parsedRecordCount: 3,
      lineItemCount: 1,
      lumpSumCount: 2,
      negativeAmountCount: 1,
      appropriatedAmountByType: {
        lineItem: 1_250_000,
        lumpSum: 450_000,
        total: 1_700_000,
      },
      groupBalances: {
        lineItem: 1_250_000,
        lumpSum: 450_000,
        total: 1_700_000,
      },
      reconcilesToGroupBalances: true,
    });
  });

  it("fails closed when parsed amounts do not reconcile to the source balances", () => {
    const changedPages = [
      FIXTURE_PAGES[0],
      FIXTURE_PAGES[1].replace("$500,000.00", "$500,001.00"),
    ];

    expect(() =>
      parseDceoCapitalAppropriationsPages(changedPages, {
        strictFullDocument: true,
        expectedPageCount: 2,
      }),
    ).toThrow(/do not reconcile/i);
  });

  it("fails closed instead of emitting a partial record when a type marker is missing", () => {
    const changedPages = [
      FIXTURE_PAGES[0],
      FIXTURE_PAGES[1].replace(
        "AND NORTH NEENAH AVENUE IN CHICAGO.\nLump Sum\n129-260.",
        "AND NORTH NEENAH AVENUE IN CHICAGO.\n129-260.",
      ),
    ];

    expect(() => parseDceoCapitalAppropriationsPages(changedPages)).toThrow(
      DceoCapitalAppropriationParseError,
    );
    expect(() => parseDceoCapitalAppropriationsPages(changedPages)).toThrow(
      /Missing line type/,
    );
  });
});

describe("extractExplicitProjectAddress", () => {
  it("returns only a numbered street address literally present in the description", () => {
    expect(
      extractExplicitProjectAddress(
        "Work at 1501 N 17TH AVE and later at 1001-1101 N 25TH AVE.",
      ),
    ).toBe("1501 N 17TH AVE");
  });

  it("does not infer an address from an intersection or a numbered street name", () => {
    expect(
      extractExplicitProjectAddress(
        "A field at WEST BELLE PLAINE AVENUE AND NORTH NEENAH AVENUE IN CHICAGO.",
      ),
    ).toBeNull();
    expect(
      extractExplicitProjectAddress(
        "Resurfacing 136TH STREET BETWEEN PULASKI AVENUE AND SPRINGFIELD AVENUE.",
      ),
    ).toBeNull();
  });
});

describe("hasHighConfidenceChicagoDceoLocation", () => {
  it("accepts source-literal Chicago ZIPs and explicit Chicago location phrases", () => {
    expect(
      hasHighConfidenceChicagoDceoLocation({
        lineName: "Community center",
        originalDescription: "Capital improvements at 1234 S State St, Chicago, IL 60605.",
      }),
    ).toBe(true);
    expect(
      hasHighConfidenceChicagoDceoLocation({
        lineName: "Neighborhood project",
        originalDescription: "Infrastructure improvements located in Chicago.",
      }),
    ).toBe(true);
  });

  it("accepts City-jurisdiction public entities without treating every Chicago-named organization as local", () => {
    expect(
      hasHighConfidenceChicagoDceoLocation({
        lineName: "Chicago Park District - Tuley Park",
        originalDescription: "Capital improvements at Tuley Park.",
      }),
    ).toBe(true);
    expect(
      hasHighConfidenceChicagoDceoLocation({
        lineName: "YMCA of Metropolitan Chicago",
        originalDescription:
          "Pre-apprenticeship programming for individuals in Naperville and Palatine.",
      }),
    ).toBe(false);
    expect(
      hasHighConfidenceChicagoDceoLocation({
        lineName: "Chicago Botanic Garden",
        originalDescription: "Water-system and roof improvements.",
      }),
    ).toBe(false);
  });

  it("fails closed for Chicago-named suburbs and source-literal non-606 ZIPs", () => {
    expect(
      hasHighConfidenceChicagoDceoLocation({
        lineName: "West Chicago project",
        originalDescription: "Infrastructure improvements in West Chicago.",
      }),
    ).toBe(false);
    expect(
      hasHighConfidenceChicagoDceoLocation({
        lineName: "UCP Seguin of Greater Chicago",
        originalDescription: "Roof work at 416 N Humphrey Avenue, Oak Park, IL 60302.",
      }),
    ).toBe(false);
  });
});

describe("DCEO appropriation CSV importer helpers", () => {
  it("emits a stable appropriation-only schema and source order", () => {
    const records = parseDceoCapitalAppropriationsPages(FIXTURE_PAGES).records;
    const first = serializeDceoCapitalAppropriationsCsv(records);
    const second = serializeDceoCapitalAppropriationsCsv(records);

    expect(first).toBe(second);
    expect(first.split("\n")[0]).toBe(
      "line_name,appropriation_code,appropriated_amount,original_description,line_type,explicit_project_address,source_url,source_version",
    );
    expect(first).not.toContain("amount_awarded");
    expect(first).not.toContain("available");
    expect(first.indexOf("University of Chicago")).toBeLessThan(
      first.indexOf("SR MI - Lump Sum"),
    );
  });

  it("accepts a local path or URL and defaults to strict full-document parsing", () => {
    expect(parseDceoCapitalAppropriationCliArgs(["source.pdf"]).strictFullDocument).toBe(true);
    expect(
      parseDceoCapitalAppropriationCliArgs([
        "--input",
        "https://example.test/source.pdf",
        "--allow-noncanonical",
      ]).strictFullDocument,
    ).toBe(false);
  });
});
