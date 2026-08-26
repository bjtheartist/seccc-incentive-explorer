import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  filterLegacyCity311Rows,
  legacyShortlistEvidenceType,
} from "../legacy-vacancy-derived-sources";

describe("legacy City/311 derived vacancy source boundary", () => {
  it("never coerces CCLBA public inventory into a 311 evidence type", () => {
    const evidenceType = legacyShortlistEvidenceType("cclba", "vacant_land");

    expect(evidenceType).toBeNull();
    expect(["311_land", "311_building"]).not.toContain(evidenceType);
    expect(
      filterLegacyCity311Rows([
        { id: "cols-16153030120000", source: "cols" },
        { id: "cclba-52905642", source: "cclba" },
        { id: "future-county-source-1", source: "future_county_source" },
        { id: "311-clean-lot-SR26-2", source: "311_clean_lot" },
      ]).map((row) => row.id),
    ).toEqual(["cols-16153030120000", "311-clean-lot-SR26-2"]);
  });

  it("keeps the existing City and 311 evidence mappings", () => {
    expect(legacyShortlistEvidenceType("cols", "vacant_land")).toBe("city_land");
    expect(legacyShortlistEvidenceType("311_clean_lot", "vacant_land")).toBe("311_land");
    expect(legacyShortlistEvidenceType("dpd_vacant", "vacant_building")).toBe(
      "311_building",
    );
  });

  it("fails closed for an unmodeled future source", () => {
    const evidenceType = legacyShortlistEvidenceType(
      "future_county_source",
      "vacant_land",
    );

    expect(evidenceType).toBeNull();
    expect(["311_land", "311_building"]).not.toContain(evidenceType);
  });

  it("requires both legacy exporters to apply the shared CCLBA exclusion", () => {
    for (const script of ["export-shortlist-universe.ts", "export-vacancy-index.ts"]) {
      const source = readFileSync(resolve(process.cwd(), "scripts", script), "utf8");
      expect(source, script).toContain("filterLegacyCity311Rows");
    }
  });
});
