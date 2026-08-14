/**
 * build-spec.md 2.4 (audit F10; consult item 12) — the typed authority
 * registry. Binding doctrine: zoning -> ZBA, condition -> DOB,
 * licensing -> BACP, tif -> DPD only.
 */
import { describe, expect, it } from "vitest";
import { authorityFor, authorityReferenceLine, buildZoningOfficialLinks } from "../authority-routing";

describe("authority-routing", () => {
  it("routes zoning to ZBA, condition to DOB, licensing to BACP, tif to DPD", () => {
    expect(authorityFor("zoning").abbreviation).toBe("ZBA");
    expect(authorityFor("condition").abbreviation).toBe("DOB");
    expect(authorityFor("licensing").abbreviation).toBe("BACP");
    expect(authorityFor("tif").abbreviation).toBe("DPD");
  });

  it("authorityReferenceLine never names a generic 'the City' alone", () => {
    for (const domain of ["zoning", "condition", "licensing", "tif"] as const) {
      const line = authorityReferenceLine(domain);
      expect(line).not.toMatch(/^the city$/i);
      expect(line.length).toBeGreaterThan(5);
    }
  });

  it("buildZoningOfficialLinks always puts ZBA first and cannot be starved by an empty caller list", () => {
    expect(buildZoningOfficialLinks([])[0].label).toContain("ZBA");
    expect(buildZoningOfficialLinks()[0].label).toContain("ZBA");
  });

  it("buildZoningOfficialLinks appends, never replaces, caller-supplied links", () => {
    const links = buildZoningOfficialLinks([{ label: "Extra source", url: "https://example.gov" }]);
    expect(links[0].label).toContain("ZBA");
    expect(links.some((l) => l.label === "Extra source")).toBe(true);
  });
});
