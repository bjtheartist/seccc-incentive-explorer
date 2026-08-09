import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_PREPARATION_COST_CAVEAT,
  DOCUMENT_PREPARATION_COST_LEGEND,
  classifyDocumentPreparationCost,
  classifyPreparationStepCost,
  isConditionalDocumentRequirement,
  isDocumentRequirementGuidance,
  isExplicitNoDocumentRequirement,
} from "../document-preparation-cost";

interface ProgramCatalogEntry {
  id: string;
  requiredDocs?: string[];
}

const PROGRAM_CATALOG = JSON.parse(
  readFileSync(join(process.cwd(), "public/data/programs.json"), "utf8"),
) as ProgramCatalogEntry[];

const CATALOG_REQUIREMENTS = PROGRAM_CATALOG.flatMap((program) =>
  (program.requiredDocs ?? []).map((requirement) => ({
    programId: program.id,
    requirement,
  })),
);

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
    "Project pro forma and use of funds",
    "Market study",
    "Energy audit",
    "Energy model",
    "Viability analysis",
    "But-for analysis",
    "Viability/'but-for' analysis",
    "Environmental assessments and zoning approvals",
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
    "Collect contractor scopes and estimates",
    "Prepare accountant-reviewed financials",
    "Obtain tax and good-standing records",
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

  it("classifies specialist requirements from the maintained program catalog as $$$", () => {
    const specialistPatterns = [
      /viability.*but-for.*analysis/i,
      /project pro forma/i,
      /environmental assessments/i,
    ];

    for (const pattern of specialistPatterns) {
      const matches = CATALOG_REQUIREMENTS.filter(({ requirement }) =>
        pattern.test(requirement),
      );
      expect(matches.length, `Expected a catalog requirement matching ${pattern}`).toBeGreaterThan(0);
      for (const { programId, requirement } of matches) {
        expect(
          classifyDocumentPreparationCost(requirement).tier,
          `${programId}: ${requirement}`,
        ).toBe("$$$");
      }
    }
  });
});

describe("classifyPreparationStepCost", () => {
  it("signals only steps that explicitly imply paid work", () => {
    expect(classifyPreparationStepCost("Obtain a Phase I environmental assessment")).toMatchObject({ tier: "$$$" });
    expect(classifyPreparationStepCost("Pay the permit filing fee")).toMatchObject({ tier: "$$" });
    expect(classifyPreparationStepCost("Call the program administrator")).toBeNull();
  });
});

describe("isExplicitNoDocumentRequirement", () => {
  it.each([
    "No formal documents required",
    "No formal document is required.",
    "No documents are required",
    "No application needed — benefits are automatic by location",
    "No application is required to receive location-based benefits",
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

describe("document requirement labels", () => {
  it("recognizes non-document referral guidance", () => {
    expect(
      isDocumentRequirementGuidance(
        "Contact your SSA delegate agency for any sub-program requirements",
      ),
    ).toBe(true);
  });

  it.each([
    "Building permits (if applicable)",
    "Allocation letter (if designer claim on tax-exempt building)",
    "Environmental approvals as applicable",
    "Additional records when requested",
  ])("recognizes conditional requirements: %s", (requirement) => {
    expect(isConditionalDocumentRequirement(requirement)).toBe(true);
  });

  it.each(["W-9", "Project pro forma", "Current lease required"])(
    "keeps unqualified requirements required: %s",
    (requirement) => {
      expect(isConditionalDocumentRequirement(requirement)).toBe(false);
    },
  );
});
