import { describe, expect, it } from "vitest";
import {
  classifyOwnerGeography,
  classifyOwnerStructure,
  normalizeOwnerGeography,
  normalizeOwnerStructure,
  OWNER_GEOGRAPHY_ORDER,
  OWNER_STRUCTURE_COLORS,
  OWNER_STRUCTURE_LABELS,
  OWNER_STRUCTURE_ORDER,
  ownerGeographyFromMailingAddress,
  structureGeographyToLegacyOwnerType,
  tallyOwnerStructureCounts,
  tallyStructureGeography,
  type OwnerGeography,
  type OwnerStructure,
} from "../owner-taxonomy";
import { OWNER_TYPE_COLORS } from "../owner-classify";

describe("classifyOwnerStructure — government (checked before entity/trust)", () => {
  const govNames = [
    "CITY OF CHICAGO",
    "CHICAGO CITY OF",
    "COOK COUNTY",
    "COUNTY OF COOK",
    "C.C. LAND BANK",
    "CCLBA",
    "COOK COUNTY LAND BANK AUTHORITY",
    "SOME LAND BANK",
    "CHICAGO PARK DISTRICT",
    "BOARD OF EDUCATION",
    "BD OF ED",
    "CHICAGO HOUSING AUTHORITY",
    "CHA",
    "CHICAGO TRANSIT AUTHORITY",
    "CTA",
    "STATE OF ILLINOIS",
    "ILLINOIS HOUSING DEVELOPMENT AUTHORITY",
    "IHDA",
    "IDOT",
    "SEC OF HUD",
    "HUD",
    "UNITED STATES OF AMERICA",
    "U S A",
    "USA",
    "FOREST PRESERVE DISTRICT OF COOK COUNTY",
    "METRO WATER RECLAMATION DISTRICT",
    "MWRD",
    "PUBLIC BUILDING COMMISSION",
    "PBC",
    "CHICAGO PUBLIC SCHOOLS",
  ];
  it("classifies every government alias as government", () => {
    for (const name of govNames) {
      expect(classifyOwnerStructure(name), name).toBe("government");
    }
  });
  it("does not mistake 'COOKE' or 'COOK, JAMES' (no COUNTY) for government", () => {
    expect(classifyOwnerStructure("JAMES COOKE")).toBe("individual");
    expect(classifyOwnerStructure("COOK, JAMES")).toBe("individual");
  });
});

describe("classifyOwnerStructure — trust (checked before entity)", () => {
  const trustNames = [
    "SMITH FAMILY TRUST",
    "JOHN DOE AS TRUSTEE",
    "CHICAGO TITLE LAND TRUST COMPANY",
    "CHICAGO TITLE LAND TRUST COMPANY TRUST #8002-374991",
    "ATG TRUST COMPANY",
    "FIRST BANK AS TRUSTEE",
    "MARY JONES TTEE",
    "PARCEL HELD U/T/A DATED 1999",
    "LAND TRUST 12345",
    "TR 8002 374991",
  ];
  it("classifies land-trust / trustee / trust-number forms as trust", () => {
    for (const name of trustNames) {
      expect(classifyOwnerStructure(name), name).toBe("trust");
    }
  });
  it("detects the land trust before the COMPANY entity marker", () => {
    expect(classifyOwnerStructure("CHICAGO TITLE LAND TRUST COMPANY TRUST #8002-374991")).toBe("trust");
  });
});

describe("classifyOwnerStructure — entity", () => {
  const entityNames = [
    "ACME PROPERTIES LLC",
    "ACME PROPERTIES L.L.C.",
    "SMITH HOLDINGS INC",
    "SMITH HOLDINGS INCORPORATED",
    "RIVER CORP",
    "RIVER CORPORATION",
    "SOUTH SIDE PARTNERS LP",
    "SOUTH SIDE PARTNERS LLP",
    "DOE MANAGEMENT",
    "DOE VENTURES",
    "DOE ENTERPRISES",
    "STONE REALTY",
    "STONE DEVELOPMENT GROUP",
    "MAPLE ASSOCIATES",
    "OAK CAPITAL",
    "PINE ACQUISITION",
    "FIRST BAPTIST CHURCH",
    "ST MARY MINISTRIES",
    "SOUTH SIDE COMMUNITY BANK",
    "ST MARY FOUNDATION",
    "CHICAGO STATE UNIVERSITY",
    "MERCY HOSPITAL",
    "LAKESIDE CONDOMINIUM ASSOCIATION",
    "GREENWOOD COOPERATIVE",
    "VFW POST 1234",
    "SUNSET HOLDINGS LTD",
    "GREEN FUND NFP",
    "RIVERSIDE CO",
  ];
  it("classifies corporate / institutional / organizational names as entity", () => {
    for (const name of entityNames) {
      expect(classifyOwnerStructure(name), name).toBe("entity");
    }
  });
});

describe("classifyOwnerStructure — individual", () => {
  const people = [
    "JANE SMITH",
    "MARIA GONZALEZ",
    "JOHN Q PUBLIC",
    "ROBERT E LEE JR",
    "O'BRIEN PATRICK",
    "JEAN-LUC PICARD",
    "SMITH JOHN & MARY",
  ];
  it("classifies plain personal names as individual", () => {
    for (const name of people) {
      expect(classifyOwnerStructure(name), name).toBe("individual");
    }
  });
  it("does not false-positive on name substrings of entity markers (word boundaries)", () => {
    expect(classifyOwnerStructure("JOHN BANKSTON")).toBe("individual"); // not "bank"
    expect(classifyOwnerStructure("MARY POSTLETHWAITE")).toBe("individual"); // not "post ####"
    expect(classifyOwnerStructure("SARA COLE")).toBe("individual"); // not "co"
    expect(classifyOwnerStructure("TRACY MILLER")).toBe("individual"); // not "tr"
  });
});

describe("classifyOwnerStructure — unresolved", () => {
  it("treats empty / null / whitespace as unresolved", () => {
    expect(classifyOwnerStructure(null)).toBe("unresolved");
    expect(classifyOwnerStructure(undefined)).toBe("unresolved");
    expect(classifyOwnerStructure("")).toBe("unresolved");
    expect(classifyOwnerStructure("   ")).toBe("unresolved");
  });
  it("treats placeholders and non-name tokens as unresolved", () => {
    for (const p of ["EXEMPT", "TAXPAYER OF", "CURRENT OWNER", "UNKNOWN", "N/A", "NONE", "TBD"]) {
      expect(classifyOwnerStructure(p), p).toBe("unresolved");
    }
    expect(classifyOwnerStructure("12345")).toBe("unresolved"); // numerics only
    expect(classifyOwnerStructure("----")).toBe("unresolved"); // punctuation only
    expect(classifyOwnerStructure("JP")).toBe("unresolved"); // single sub-3-char token
    expect(classifyOwnerStructure("AB")).toBe("unresolved");
  });
});

describe("classifyOwnerGeography (from mailing STATE)", () => {
  it("maps IL / ILLINOIS to in_state", () => {
    expect(classifyOwnerGeography("IL")).toBe("in_state");
    expect(classifyOwnerGeography("il")).toBe("in_state");
    expect(classifyOwnerGeography(" Illinois ")).toBe("in_state");
  });
  it("maps any other real US state (code or name) to out_of_state", () => {
    for (const s of ["CA", "NY", "FL", "TX", "IN", "WI", "DC", "PR"]) {
      expect(classifyOwnerGeography(s), s).toBe("out_of_state");
    }
    expect(classifyOwnerGeography("CALIFORNIA")).toBe("out_of_state");
    expect(classifyOwnerGeography("NEW YORK")).toBe("out_of_state");
  });
  it("maps missing / unrecognized to unknown", () => {
    expect(classifyOwnerGeography(null)).toBe("unknown");
    expect(classifyOwnerGeography(undefined)).toBe("unknown");
    expect(classifyOwnerGeography("")).toBe("unknown");
    expect(classifyOwnerGeography("ZZ")).toBe("unknown");
    expect(classifyOwnerGeography("MARS")).toBe("unknown");
  });
});

describe("ownerGeographyFromMailingAddress (full mailing string)", () => {
  it("extracts an in-state IL mailing", () => {
    expect(ownerGeographyFromMailingAddress("123 MAIN ST, CHICAGO, IL, 60617")).toBe("in_state");
    expect(ownerGeographyFromMailingAddress("PO BOX 5, EVANSTON, ILLINOIS, 60201")).toBe("in_state");
  });
  it("extracts an out-of-state mailing from the state token", () => {
    expect(ownerGeographyFromMailingAddress("500 5TH AVE, NEW YORK, NY, 10110")).toBe("out_of_state");
    expect(ownerGeographyFromMailingAddress("1 CORP WAY, WILMINGTON, DE, 19801")).toBe("out_of_state");
  });
  it("falls back to the ZIP range when no state token is present", () => {
    expect(ownerGeographyFromMailingAddress("123 MAIN ST 60617")).toBe("in_state");
    expect(ownerGeographyFromMailingAddress("500 BROADWAY 10110")).toBe("out_of_state");
  });
  it("is unknown for a blank or stateless/zipless mailing", () => {
    expect(ownerGeographyFromMailingAddress(null)).toBe("unknown");
    expect(ownerGeographyFromMailingAddress("")).toBe("unknown");
    expect(ownerGeographyFromMailingAddress("PO BOX")).toBe("unknown");
  });
});

describe("structureGeographyToLegacyOwnerType (reconciliation continuity)", () => {
  it("maps government to city_public regardless of geography", () => {
    expect(structureGeographyToLegacyOwnerType("government", "in_state")).toBe("city_public");
    expect(structureGeographyToLegacyOwnerType("government", "out_of_state")).toBe("city_public");
  });
  it("maps unresolved to unknown", () => {
    expect(structureGeographyToLegacyOwnerType("unresolved", "unknown")).toBe("unknown");
  });
  it("maps any out-of-state non-government owner to out_of_state", () => {
    expect(structureGeographyToLegacyOwnerType("entity", "out_of_state")).toBe("out_of_state");
    expect(structureGeographyToLegacyOwnerType("individual", "out_of_state")).toBe("out_of_state");
    expect(structureGeographyToLegacyOwnerType("trust", "out_of_state")).toBe("out_of_state");
  });
  it("maps in-state entity to corporate_llc, in-state individual/trust to local_private", () => {
    expect(structureGeographyToLegacyOwnerType("entity", "in_state")).toBe("corporate_llc");
    expect(structureGeographyToLegacyOwnerType("individual", "in_state")).toBe("local_private");
    expect(structureGeographyToLegacyOwnerType("trust", "unknown")).toBe("local_private");
  });
});

describe("normalizers", () => {
  it("passes through every known structure / geography and defaults the rest", () => {
    for (const s of OWNER_STRUCTURE_ORDER) expect(normalizeOwnerStructure(s)).toBe(s);
    for (const g of OWNER_GEOGRAPHY_ORDER) expect(normalizeOwnerGeography(g)).toBe(g);
    expect(normalizeOwnerStructure("bogus")).toBe("unresolved");
    expect(normalizeOwnerStructure(null)).toBe("unresolved");
    expect(normalizeOwnerGeography("bogus")).toBe("unknown");
    expect(normalizeOwnerGeography(null)).toBe("unknown");
  });
});

describe("tallyOwnerStructureCounts", () => {
  it("lists all five structures in order with honest zeros, and sums to input length", () => {
    const counts = tallyOwnerStructureCounts(["entity", "entity", "individual", "bogus", null]);
    expect(counts.map((c) => c.ownerStructure)).toEqual(OWNER_STRUCTURE_ORDER);
    const by = Object.fromEntries(counts.map((c) => [c.ownerStructure, c.count]));
    expect(by.entity).toBe(2);
    expect(by.individual).toBe(1);
    expect(by.unresolved).toBe(2); // bogus + null both normalize to unresolved
    expect(by.trust).toBe(0);
    expect(by.government).toBe(0);
    expect(counts.reduce((s, c) => s + c.count, 0)).toBe(5);
  });
});

describe("tallyStructureGeography (two-axis cross-tab)", () => {
  it("covers every structure × geography cell with honest zeros, summing to input length", () => {
    const cells = tallyStructureGeography([
      { structure: "entity", geography: "in_state" },
      { structure: "entity", geography: "out_of_state" },
      { structure: "individual", geography: "in_state" },
      { structure: "government", geography: "in_state" },
      { structure: "bogus", geography: "bogus" }, // -> unresolved / unknown
    ]);
    expect(cells).toHaveLength(OWNER_STRUCTURE_ORDER.length * OWNER_GEOGRAPHY_ORDER.length);
    const get = (s: OwnerStructure, g: OwnerGeography) =>
      cells.find((c) => c.ownerStructure === s && c.ownerGeography === g)!.count;
    expect(get("entity", "in_state")).toBe(1);
    expect(get("entity", "out_of_state")).toBe(1);
    expect(get("individual", "in_state")).toBe(1);
    expect(get("government", "in_state")).toBe(1);
    expect(get("unresolved", "unknown")).toBe(1);
    expect(cells.reduce((s, c) => s + c.count, 0)).toBe(5);
  });
});

describe("display metadata coherence", () => {
  it("labels and colors cover all five structures, colors distinct from OWNER_TYPE_COLORS", () => {
    for (const s of OWNER_STRUCTURE_ORDER) {
      expect(OWNER_STRUCTURE_LABELS[s]).toBeTruthy();
      expect(OWNER_STRUCTURE_COLORS[s]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    const structureColors = new Set(Object.values(OWNER_STRUCTURE_COLORS));
    for (const legacy of Object.values(OWNER_TYPE_COLORS)) {
      expect(structureColors.has(legacy), `structure palette collides with ${legacy}`).toBe(false);
    }
    expect(structureColors.size).toBe(5); // all distinct within the set
  });
});
