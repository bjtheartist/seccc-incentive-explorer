import { describe, expect, it } from "vitest";
import {
  buildIncentiveAnalysisUrl,
  buildTableCsv,
  buildVacancySpreadsheetCsv,
  slugifyFilePart,
  toCsvCell,
  zoneMatchesToText,
} from "@/lib/vacancy-spreadsheet";

describe("toCsvCell", () => {
  it("quotes values and escapes embedded quotes", () => {
    expect(toCsvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(toCsvCell(42)).toBe('"42"');
  });

  it("renders null/undefined as empty quoted cells", () => {
    expect(toCsvCell(null)).toBe('""');
    expect(toCsvCell(undefined)).toBe('""');
  });
});

describe("slugifyFilePart", () => {
  it("lowercases and collapses non-alphanumerics to hyphens", () => {
    expect(slugifyFilePart("South Chicago (Ward 10)")).toBe(
      "south-chicago-ward-10",
    );
  });

  it("falls back to 'locale' when nothing survives", () => {
    expect(slugifyFilePart("  ??? ")).toBe("locale");
  });
});

describe("zoneMatchesToText", () => {
  it("joins string zones with semicolons", () => {
    expect(zoneMatchesToText(["tif", "enterprise"])).toBe("tif; enterprise");
  });

  it("reads zoneKey from object zones and drops empties", () => {
    expect(
      zoneMatchesToText([{ zoneKey: "tif" }, { zoneKey: "" }, "oz"]),
    ).toBe("tif; oz");
  });

  it("returns empty string for non-arrays", () => {
    expect(zoneMatchesToText(null)).toBe("");
    expect(zoneMatchesToText("tif")).toBe("");
  });
});

describe("buildVacancySpreadsheetCsv", () => {
  it("emits the header plus one escaped row per feature", () => {
    const csv = buildVacancySpreadsheetCsv([
      {
        properties: {
          address: "9101 S Commercial Ave",
          propertyType: "Vacant Land",
          ward: 10,
          communityArea: "South Chicago",
          zoningClass: "B3-2",
          squareFeet: 3125,
          ownerName: 'ACME "Holdings" LLC',
          ownerType: "corporate_llc",
          incentiveCount: 4,
          zoneMatches: [{ zoneKey: "tif" }, "oz"],
        },
      },
    ]);
    const [header, row] = csv.split("\n");
    expect(header).toContain("Address");
    expect(header).toContain("Zone Matches");
    expect(row).toContain('"9101 S Commercial Ave"');
    expect(row).toContain('"ACME ""Holdings"" LLC"');
    expect(row).toContain('"tif; oz"');
  });
});

describe("buildTableCsv", () => {
  it("quotes every column and row cell", () => {
    expect(
      buildTableCsv(
        ["Name", "Count"],
        [
          ["A", "1"],
          ["B", "2"],
        ],
      ),
    ).toBe('"Name","Count"\n"A","1"\n"B","2"');
  });
});

describe("buildIncentiveAnalysisUrl", () => {
  it("links to an instant report with rounded coordinates", () => {
    expect(
      buildIncentiveAnalysisUrl({
        geometry: { coordinates: [-87.551234567, 41.729876543] },
        properties: { address: "9101 S Commercial Ave" },
      }),
    ).toBe(
      "/report?instant=true&lat=41.72988&lon=-87.55123&addr=9101%20S%20Commercial%20Ave",
    );
  });

  it("falls back to an address-only link without coordinates", () => {
    expect(
      buildIncentiveAnalysisUrl({
        properties: { address: "9101 S Commercial Ave" },
      }),
    ).toBe("/report?addr=9101%20S%20Commercial%20Ave");
  });
});
