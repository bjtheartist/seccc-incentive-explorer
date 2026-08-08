import { describe, expect, it } from "vitest";
import {
  DOCUMENT_PREPARATION_COST_CAVEAT,
  DOCUMENT_PREPARATION_COST_LEGEND,
  classifyDocumentPreparationCost,
  isExplicitNoDocumentRequirement,
} from "../document-preparation-cost";

describe("classifyDocumentPreparationCost", () => {
  it.each([
    "Audited financial statements",
    "Property appraisal",
    "Phase I environmental assessment",
    "Architectural plans",
    "Engineering report",
    "Legal opinion",
    "Detailed pro forma",
    "Full pro forma",
    "Market study",
    "Energy audit",
    "Energy model",
    "Viability analysis",
    "But-for analysis",
    "Professional site plan",
    "Professional building plans",
  ])("classifies specialized work as $$$: %s", (requirement) => {
    expect(classifyDocumentPreparationCost(requirement)).toEqual({
      tier: "$$$",
      basis: "Often requires specialized professional work.",
    });
  });

  it.each([
    "Building permits",
    "Certificate of good standing",
    "Two contractor bids",
    "Tax clearance",
    "Insurance certificate",
    "Boundary survey",
  ])("classifies filings or professional help as $$: %s", (requirement) => {
    expect(classifyDocumentPreparationCost(requirement)).toEqual({
      tier: "$$",
      basis: "May involve filing fees or professional help.",
    });
  });

  it.each([
    "W-9",
    "Government ID",
    "Tax returns",
    "Bank statements",
    "Business plan",
    "Proof of property ownership or lease",
    "Financial statements",
  ])("classifies ordinary business records as $: %s", (requirement) => {
    expect(classifyDocumentPreparationCost(requirement).tier).toBe("$");
  });

  it("defaults unknown requirements conservatively without claiming precision", () => {
    expect(classifyDocumentPreparationCost("Program narrative attachment")).toEqual({
      tier: "$",
      basis: "Typically gathered from existing business records.",
    });
  });

  it.each(["Project plan", "Project budget", "Operating plan and budget"])(
    "keeps ordinary planning records at the conservative $ default: %s",
    (requirement) => {
      expect(classifyDocumentPreparationCost(requirement).tier).toBe("$");
    },
  );

  it("publishes a qualitative legend and a preparation-only caveat", () => {
    expect(DOCUMENT_PREPARATION_COST_LEGEND.map((item) => item.tier)).toEqual([
      "$",
      "$$",
      "$$$",
    ]);
    expect(DOCUMENT_PREPARATION_COST_CAVEAT).toBe(
      "Costs vary; this reflects document preparation, not program value.",
    );
  });
});

describe("isExplicitNoDocumentRequirement", () => {
  it.each([
    "No formal documents required",
    "No formal document is required.",
    "No documents are required",
    "No application needed — benefits are automatic by location",
    "None required",
    "N/A",
  ])("recognizes non-requirement guidance: %s", (value) => {
    expect(isExplicitNoDocumentRequirement(value)).toBe(true);
  });

  it.each(["Current lease required", "Requirements confirmed by administrator", ""])(
    "does not suppress a real or unknown requirement: %s",
    (value) => {
      expect(isExplicitNoDocumentRequirement(value)).toBe(false);
    },
  );
});
