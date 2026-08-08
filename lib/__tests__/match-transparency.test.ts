import { describe, expect, it } from "vitest";
import { buildPublicMatchExplanation } from "../match-transparency";
import type { Program } from "../types";

const program: Program = {
  id: "sample",
  name: "Sample Improvement Program",
  level: "City",
  zoneKey: "sampleZone",
  summary: "A sample program.",
  whoQualifies: "Published requirements apply.",
  benefits: [],
  howToApply: [],
  requiredDocs: ["Project plan", "Proof of site control"],
  contact: "",
  url: "https://example.gov/program",
  contacts: [
    {
      agency: "Department of Example Programs",
      abbreviation: "DEP",
      phone: "(312) 555-0100",
      email: "programs@example.gov",
      url: "https://example.gov/contact",
      role: "Program administrator",
    },
  ],
  eligibilityRules: [
    {
      criterion: "location",
      description: "The site must be inside the published program boundary",
      verifiedBy: "location",
      required: true,
    },
    {
      criterion: "propertyType",
      description: "The project must have documented site control",
      verifiedBy: "survey",
      required: true,
    },
    {
      criterion: "businessSize",
      description: "Financial thresholds may affect program terms",
      verifiedBy: "manual",
      required: false,
    },
  ],
  lastVerifiedAt: "2026-07-10",
  benefitRange: "$10,000-$50,000",
  status: "active",
  sourceUrl: "https://example.gov/official-program",
  verificationSteps: [
    {
      label: "Ask the administrator to review current requirements",
      agency: "Department of Example Programs",
      url: "https://example.gov/review",
      kind: "preapproval",
    },
  ],
};

describe("public match transparency", () => {
  it("separates public facts, user answers, and open questions", () => {
    const explanation = buildPublicMatchExplanation(program, {
      whyItAppears: ["Public boundary data connects the address to this program."],
      knownFromPublicData: ["The address intersects the published program boundary."],
      basedOnUserAnswers: ["Own commercial property", "Building renovations"],
      rulesEstablishedByPublicData: [
        "The site must be inside the published program boundary",
      ],
    });

    expect(explanation.whyItAppears).toEqual([
      "Public boundary data connects the address to this program.",
    ]);
    expect(explanation.knownFromPublicData).toContain(
      "The address intersects the published program boundary.",
    );
    expect(explanation.basedOnUserAnswers).toEqual([
      "Own commercial property",
      "Building renovations",
    ]);
    expect(explanation.stillToConfirm).toEqual([
      "Property type and site-control requirements",
      "Business size and financial requirements (additional program condition)",
    ]);
  });

  it("keeps self-reported answers from establishing program requirements", () => {
    const explanation = buildPublicMatchExplanation(program, {
      basedOnUserAnswers: ["Own commercial property"],
    });

    expect(explanation.stillToConfirm).toContain(
      "Property type and site-control requirements",
    );
    expect(explanation.knownFromPublicData).not.toContain("Own commercial property");
    expect(JSON.stringify(explanation)).not.toMatch(/confirmed/i);
  });

  it("carries documents, confirming contacts, source, and freshness without value estimates", () => {
    const explanation = buildPublicMatchExplanation(program);

    expect(explanation.currentDocumentsToGather).toEqual([
      "Project plan",
      "Proof of site control",
    ]);
    expect(explanation.confirmWith).toEqual([
      {
        agency: "Department of Example Programs",
        abbreviation: "DEP",
        phone: "(312) 555-0100",
        email: "programs@example.gov",
        url: "https://example.gov/review",
        role: "Program administrator",
      },
    ]);
    expect(explanation.officialSource).toEqual({
      label: "Official Sample Improvement Program source",
      url: "https://example.gov/official-program",
    });
    expect(explanation.lastVerifiedAt).toBe("2026-07-10");

    const serialized = JSON.stringify(explanation);
    expect(serialized).not.toMatch(/score|confidence|benefitRange/i);
    expect(serialized).not.toContain("$10,000");
  });
});
