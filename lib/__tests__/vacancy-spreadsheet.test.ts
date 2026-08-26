import { describe, expect, it } from "vitest";
import {
  buildIncentiveAnalysisUrl,
  buildTableCsv,
  buildVacancySpreadsheetCsv,
  programContextToText,
  slugifyFilePart,
  toCsvCell,
  zoneMatchesToText,
} from "@/lib/vacancy-spreadsheet";

const GENERATION_CCLBA_COVERAGE = {
  status: "available",
  source: "cclba",
  sourceDatasetId: "epropertyplus-published-properties",
  sourceUrl: "https://public-cclba.epropertyplus.com/",
  publishedCountyTotal: 1_033,
  chicagoTotal: 915,
  locatedChicagoTotal: 913,
  unlocatedChicagoTotal: 2,
  sourceAsOf: null,
  retrievedAt: "2026-08-26T18:00:00.000Z",
} as const;

const CURRENT_CCLBA_COVERAGE = {
  ...GENERATION_CCLBA_COVERAGE,
  publishedCountyTotal: 1_040,
  chicagoTotal: 920,
  locatedChicagoTotal: 918,
  retrievedAt: "2026-08-26T20:00:00.000Z",
} as const;

describe("toCsvCell", () => {
  it("quotes values and escapes embedded quotes", () => {
    expect(toCsvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(toCsvCell(42)).toBe('"42"');
  });

  it("neutralizes formula-leading source text even when it contains quotes", () => {
    expect(toCsvCell(' ="cmd"')).toBe('"\' =""cmd"""');
    expect(toCsvCell("+SUM(A1:A2)")).toBe('"\'+SUM(A1:A2)"');
    expect(toCsvCell("\t@payload")).toBe('"\'\t@payload"');
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

describe("programContextToText", () => {
  it("preserves source flags without describing an ineligible row as eligible", () => {
    expect(programContextToText([
      {
        id: "16827962",
        isIneligible: true,
        isBeforeApplicationStart: false,
        isAfterApplicationEnd: false,
        program: { name: "Residential/Community Developer" },
      },
    ])).toBe(
      "Residential/Community Developer [isIneligible=true; isBeforeApplicationStart=false; isAfterApplicationEnd=false]",
    );
  });

  it("preserves the ePropertyPlus source status and inventory context", () => {
    expect(programContextToText([
      {
        sourceRowId: "52905642",
        currentStatus: "Acquired",
        inventoryType: "Vacant Land",
        propertyClass: "Vacant",
        structureType: "None",
        occupied: "No",
        askingPrice: 25_000,
        minimumBid: 5_000,
        neighborhood: "Chatham",
        comments: "Published source note",
      },
    ])).toBe(
      "Source row ID=52905642; Current status=Acquired; Inventory type=Vacant Land; Property class=Vacant; Structure type=None; Occupied=No; Asking price=25000; Minimum bid=5000; Neighborhood=Chatham; Comments=Published source note",
    );
  });
});

describe("buildVacancySpreadsheetCsv", () => {
  it("emits the header plus one escaped row per feature", () => {
    const csv = buildVacancySpreadsheetCsv([
      {
        properties: {
          recordId: "cclba:52905642",
          pin: "16141010090000",
          source: "cclba",
          sourceDatasetId: "epropertyplus-published-properties",
          sourceDatasetLabel:
            "Cook County Land Bank Authority Published Property Inventory",
          sourceRowId: "52905642",
          sourceUrl: "https://public-cclba.epropertyplus.com/",
          sourceSnapshotId: null,
          sourceAsOf: null,
          sourceRetrievedAt: "2026-08-26T18:00:00.000Z",
          status: "Acquired",
          address: "9101 S Commercial Ave",
          propertyType: "Vacant Land",
          ward: 10,
          communityArea: "South Chicago",
          zoningClass: "B3-2",
          squareFeet: 3125,
          ownerName: "Cook County Land Bank Authority",
          ownerType: "city_public",
          incentiveCount: 4,
          zoneMatches: [{ zoneKey: "tif" }, "oz"],
          ownerJurisdiction: "cook_county",
          programContext: [
            {
              sourceRowId: "52905642",
              currentStatus: "Acquired",
              inventoryType: "Vacant Land",
              propertyClass: "Vacant",
              occupied: "No",
            },
          ],
        },
      },
    ], {
      scopeFingerprint: "sha256:test",
      selectionMethod: "point_in_saved_polygon",
      scopeGeneratedAt: "2026-08-26T17:00:00.000Z",
      generationFreshnessFilter: "current_screening",
      generationLicenseFilter: "conflicts",
      generationManifestSelectedCount: 1,
      generationCoverageStatus: "complete",
      generationLicenseScreeningStatus: "available",
      generationSourcePath: "database:vacant_properties",
      generationFallbackReason: null,
      generationCclbaSourceCoverage: GENERATION_CCLBA_COVERAGE,
      currentCoverageStatus: "complete",
      currentLicenseScreeningStatus: "available",
      currentSourcePath: "database:vacant_properties",
      currentFallbackReason: null,
      currentCclbaSourceCoverage: CURRENT_CCLBA_COVERAGE,
    });
    const [header, row] = csv.split("\n");
    expect(header).toContain("Address");
    expect(header).toContain("Zone Matches");
    expect(header).toContain("Source Snapshot ID");
    expect(header).toContain("Source Status");
    expect(header).toContain("Published Source / Program Context Details");
    expect(header).toContain("Scope Fingerprint");
    expect(header.split(",").slice(-16)).toEqual([
      "Scope Fingerprint",
      "Selection Method",
      "Scope Generated At",
      "Generation Freshness Filter",
      "Generation License Filter",
      "Generation Manifest Selected Count",
      "Generation Coverage Status",
      "Generation License Screening Status",
      "Generation Source Path",
      "Generation Fallback Reason",
      "Generation CCLBA Source Coverage",
      "Current Coverage Status",
      "Current License Screening Status",
      "Current Source Path",
      "Current Fallback Reason",
      "Current CCLBA Source Coverage",
    ]);
    expect(row).toContain('"9101 S Commercial Ave"');
    expect(row).toContain('"Cook County Land Bank Authority"');
    expect(row).toContain('"tif; oz"');
    expect(row).toContain('"cclba:52905642"');
    expect(row).toContain('"epropertyplus-published-properties"');
    expect(row).toContain('"https://public-cclba.epropertyplus.com/"');
    expect(row).toContain('"cook_county"');
    expect(row).toContain('"Acquired"');
    expect(row).toContain(
      '"Source row ID=52905642; Current status=Acquired; Inventory type=Vacant Land; Property class=Vacant; Occupied=No"',
    );
    expect(row.endsWith([
      "sha256:test",
      "point_in_saved_polygon",
      "2026-08-26T17:00:00.000Z",
      "current_screening",
      "conflicts",
      1,
      "complete",
      "available",
      "database:vacant_properties",
      null,
      "1,033 published countywide; 915 Chicago; 913 located Chicago; 2 unlocated Chicago; retrieved 2026-08-26T18:00:00.000Z; source as-of not published by source; dataset epropertyplus-published-properties; https://public-cclba.epropertyplus.com/",
      "complete",
      "available",
      "database:vacant_properties",
      null,
      "1,040 published countywide; 920 Chicago; 918 located Chicago; 2 unlocated Chicago; retrieved 2026-08-26T20:00:00.000Z; source as-of not published by source; dataset epropertyplus-published-properties; https://public-cclba.epropertyplus.com/",
    ].map(toCsvCell).join(","))).toBe(true);
  });

  it("discloses partial coverage even when the export contains zero records", () => {
    const csv = buildVacancySpreadsheetCsv([], {
      scopeFingerprint: "sha256:empty",
      selectionMethod: "point_in_saved_polygon",
      scopeGeneratedAt: "2026-08-26T17:00:00.000Z",
      generationFreshnessFilter: "recent_reports",
      generationLicenseFilter: "all",
      generationManifestSelectedCount: 0,
      generationCoverageStatus: "complete",
      generationLicenseScreeningStatus: "not_requested",
      generationSourcePath: "database:vacant_properties",
      generationFallbackReason: null,
      currentCoverageStatus: "partial",
      currentLicenseScreeningStatus: "unavailable",
      currentSourcePath: "/data/vacant-properties.json",
      currentFallbackReason: "database_query_failed",
    });
    expect(csv).toContain('"Export Metadata","Value"');
    expect(csv).toContain('"Generation Freshness Filter","recent_reports"');
    expect(csv).toContain('"Generation License Filter","all"');
    expect(csv).toContain('"Generation Manifest Selected Count","0"');
    expect(csv).toContain('"Generation Coverage Status","complete"');
    expect(csv).toContain('"Generation License Screening Status","not_requested"');
    expect(csv).toContain('"Current Coverage Status","partial"');
    expect(csv).toContain('"Current License Screening Status","unavailable"');
    expect(csv).toContain('"Current Source Path","/data/vacant-properties.json"');
    expect(csv).toContain('"Current Fallback Reason","database_query_failed"');
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
