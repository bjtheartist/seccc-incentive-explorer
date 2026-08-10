import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractText } from "unpdf";
import { generateReportBase64, generateReportPdfBase64 } from "../pdf-report";
import {
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  generateReportData,
  normalizePublicReportForDisplay,
  type GeneratedReport,
} from "../report-engine";
import type { LookupResult, Program } from "../types";
import {
  SUPPORT_ORGANIZATIONS_CAPACITY_NOTE,
  SUPPORT_ORGANIZATIONS_DESCRIPTION,
  SUPPORT_ORGANIZATIONS_SECTION_TITLE,
} from "../support-organization-copy";

const PROHIBITED_DETERMINATIONS =
  /appears eligible|may qualify|you qualify|eligible incentive programs|high match|medium match/i;
const PRIVATE_MATCH_FIELDS =
  /"(?:confidenceLevel|confidenceLabel|benefitRange|whyOneLine|matchedRules|notVerified|projectFit|projectFitLabel|projectFitReason)"/i;

function savedReport(sections: GeneratedReport["sections"]): GeneratedReport {
  return {
    title: "Saved report",
    subtitle: "Public report",
    reportType: "site-incentives",
    generatedAt: "2026-08-07T00:00:00.000Z",
    summary: "Review current program requirements.",
    sections,
    recommendedActions: [],
    metadata: { address: "100 E Test St" },
  };
}

function program(): Program {
  return {
    id: "safety-test",
    name: "Safety Test Program",
    level: "City",
    zoneKey: "tif",
    summary: "Published program summary.",
    whoQualifies: "Eligible businesses must document a qualifying rehabilitation project.",
    benefits: ["Published reimbursement terms vary by project."],
    howToApply: ["Contact the program administrator."],
    requiredDocs: ["Project budget", "Scope of work"],
    contact: "Test Agency",
    url: "https://example.com/program",
    sourceUrl: "https://example.com/source",
    contacts: [{ agency: "Test Agency", abbreviation: "TA", phone: "312-555-0100" }],
    eligibilityRules: [
      {
        criterion: "location",
        description: "Property must be within the published district boundary.",
        verifiedBy: "location",
        required: true,
      },
      {
        criterion: "investmentSize",
        description: "Eligible project costs must meet the published minimum.",
        verifiedBy: "manual",
        required: true,
      },
    ],
    benefitRange: "$10,000-$50,000",
    lastVerifiedAt: "2026-08-01",
  };
}

describe("public report safety", () => {
  it("keeps ranking private while preserving factual published requirements", () => {
    const report = generateReportData(
      {
        reportType: "site-incentives",
        address: "100 E Test St",
        lat: 41.8,
        lon: -87.6,
        neighborhood: "",
        industry: "retail",
        budgetRange: "500k-2m",
        projectType: "rehab",
        proposedUse: "",
        fundingCommitted: "",
        remainingGap: "",
        timeline: "",
        siteControl: "",
        documentsAvailable: [],
        jobsImpact: "",
        supportNeeded: [],
        creditsToAnalyze: [],
      },
      [program()],
      { zones: { tif: true }, zoneNames: { tif: "Test TIF District" } },
    );

    const serialized = JSON.stringify(report);
    const item = report.sections
      .flatMap((section) => section.items)
      .find((candidate) => candidate.programId === "safety-test");

    expect(serialized).not.toMatch(PROHIBITED_DETERMINATIONS);
    expect(serialized).not.toMatch(PRIVATE_MATCH_FIELDS);
    expect(serialized).not.toContain("$10,000-$50,000");
    expect(serialized).toContain("Eligible project costs must meet the published minimum.");
    expect(item?.value).toBe("Review published terms");
    expect(item?.matchExplanation).toMatchObject({
      whyItAppears: expect.any(Array),
      knownFromPublicData: expect.arrayContaining([
        expect.stringContaining("recorded within Test TIF District"),
      ]),
      basedOnUserAnswers: expect.arrayContaining([
        expect.stringContaining("project goal"),
      ]),
      stillToConfirm: expect.arrayContaining([
        "Eligible project costs must meet the published minimum.",
      ]),
      currentDocumentsToGather: ["Project budget", "Scope of work"],
      confirmWith: expect.arrayContaining([
        expect.objectContaining({ agency: "Test Agency" }),
      ]),
      officialSource: {
        label: "Official Safety Test Program source",
        url: "https://example.com/source",
      },
      lastVerifiedAt: "2026-08-01",
    });
    expect(item?.matchExplanation?.knownFromPublicData.join(" ")).not.toContain(
      "You selected",
    );
  });

  it("normalizes legacy saved reports without treating user answers as public confirmation", () => {
    const legacy = {
      title: "Eligible Incentive Programs",
      subtitle: "Appears eligible based on location",
      reportType: "site-incentives",
      generatedAt: "2026-08-01T00:00:00.000Z",
      summary: "You may qualify for an address-confirmed program.",
      verdict: {
        signal: "strong",
        headline: "High Match with a potential incentive of $50,000",
        subheadline: "You qualify for an estimated $25,000 benefit",
        topReasons: ["Appears eligible with a benefit range of $10,000-$50,000"],
      },
      executiveSummary: {
        topPrograms: [
          {
            programId: "legacy",
            name: "Legacy Program",
            projectFitLabel: "Strong fit",
            projectFitReason: "High categorical fit based on the selected project.",
            explanation: {
              whyItAppears: ["Appears eligible based on this address."],
              knownFromPublicData: [],
              basedOnUserAnswers: [],
              stillToConfirm: [],
              currentDocumentsToGather: [],
              confirmWith: [],
            },
          },
        ],
        topActions: [],
        zoneCount: 1,
        whyTheseMatter: "Programs to review.",
      },
      sections: [
        {
          title: "Eligible Incentive Programs",
          description: "Appears eligible for a potential incentive of $40,000.",
          items: [
            {
              label: "High Match Legacy Program with projected incentive of $30,000",
              value: "$25,000 possible benefit",
              detail: "You qualify for a possible incentive of $20,000.",
              programId: "legacy",
              confidenceLevel: "appears_eligible",
              confidenceLabel: "High Match",
              whyOneLine: "You qualify based on this location.",
              matchedRules: [
                "You qualify for a possible incentive of $15,000 because you plan to hire.",
              ],
              notVerified: [
                "High Match; confirm projected incentive of $12,000 and payroll records.",
              ],
              matchExplanation: {
                whyItAppears: ["Appears eligible based on this address."],
                knownFromPublicData: [
                  "The address is recorded within the district.",
                  "You selected hiring as your project goal.",
                  "Reported industry: manufacturing.",
                  "Applicant-reported permit cost: $750,000.",
                ],
                basedOnUserAnswers: ["You reported that you plan to hire."],
                stillToConfirm: ["Confirm payroll records."],
                currentDocumentsToGather: [],
                confirmWith: [],
              },
              eligibilityRules: [
                { description: "Eligible businesses must be in good standing.", required: true },
              ],
              sourceLabel: "Official legacy source",
              sourceUrl: "https://example.com/legacy",
            },
          ],
        },
        {
          title: "Recorded Public Activity",
          description: "Awarded public investment totals $8,500,000; a possible incentive estimate is $90,000.",
          items: [
            {
              label: "Building permit",
              value: "Applicant-reported permit cost: $750,000",
              detail: "This site qualifies for a potential incentive of $60,000.",
            },
          ],
        },
      ],
      recommendedActions: [
        {
          label: "Claim a possible $25,000 incentive",
          description: "You qualify for a projected award of $25,000.",
          priority: "high",
        },
      ],
      actionRoadmap: [
        {
          tier: "do-this-week",
          label: "Pursue an estimated $50,000 benefit",
          description: "Appears eligible for a potential incentive of $50,000.",
          callScript: "Tell them you qualify for up to $50,000.",
        },
      ],
      metadata: { address: "100 E Test St" },
    } as unknown as GeneratedReport;

    const normalized = normalizePublicReportForDisplay(legacy);
    const serialized = JSON.stringify(normalized);
    const item = normalized.sections[0].items[0];

    expect(normalized.sections[0].title).toBe(CONFIRMED_PROGRAMS_SECTION_TITLE);
    expect(normalized.sections[0].description).toContain("published program terms");
    expect(serialized).not.toMatch(PROHIBITED_DETERMINATIONS);
    expect(serialized).not.toMatch(PRIVATE_MATCH_FIELDS);
    expect(serialized).not.toContain("$25,000");
    expect(serialized).not.toContain("$50,000");
    expect(serialized).not.toContain("$60,000");
    expect(serialized).not.toContain("$90,000");
    expect(serialized).not.toContain("$30,000");
    expect(serialized).not.toContain("$20,000");
    expect(serialized).not.toContain("$15,000");
    expect(serialized).not.toContain("$12,000");
    expect(serialized).not.toContain("Strong fit");
    expect(serialized).not.toContain("High categorical fit");
    expect(serialized).not.toContain("This site qualifies");
    expect(normalized.verdict?.headline).toContain("published program terms");
    expect(normalized.actionRoadmap?.[0].description).toContain("published program terms");
    expect(normalized.actionRoadmap?.[0].callScript).toContain("published program terms");
    expect(normalized.recommendedActions[0].description).toContain("published program terms");
    expect(normalized.sections[1].description).toBe(
      "Awarded public investment totals $8,500,000; published program terms.",
    );
    expect(normalized.sections[1].items[0].value).toBe(
      "Applicant-reported permit cost: $750,000",
    );
    expect(item.matchExplanation?.basedOnUserAnswers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("you plan to hire"),
        "You selected hiring as your project goal.",
        "Reported industry: manufacturing.",
      ]),
    );
    expect(item.matchExplanation?.knownFromPublicData).toEqual([
      "The address is recorded within the district.",
      "Applicant-reported permit cost: $750,000.",
    ]);
    expect(item.matchExplanation?.stillToConfirm).toEqual(
      expect.arrayContaining([
        expect.stringContaining("payroll records"),
        "Eligible businesses must be in good standing.",
      ]),
    );
    expect(item.matchExplanation?.officialSource).toEqual({
      label: "Official legacy source",
      url: "https://example.com/legacy",
    });
  });

  it("limits program-card fallback behavior to actual program-listing sections", () => {
    const listingTitles = [
      CONFIRMED_PROGRAMS_SECTION_TITLE,
      "Programs to Review for Your Goal",
      "Other Programs Mapped at This Address",
      "Eligible Incentive Programs",
      "Other Programs Tied to This Address",
      "Additional Programs to Explore",
      "Programs Mapped at This Site (3)",
      "Incentive Pathway Review",
      "City-Level Programs",
    ];
    const normalized = normalizePublicReportForDisplay(savedReport(
      listingTitles.map((title) => ({
        title,
        items: [{
          label: `${title} program`,
          value: "Provides up to $100,000",
          detail: "Published program summary.",
          programId: `program-${title}`,
        }],
      })),
    ));

    for (const section of normalized.sections) {
      expect(section.items[0].value).toBe("Review published terms");
      expect(section.items[0].matchExplanation?.whyItAppears[0]).toContain(
        "saved report",
      );
    }
  });

  it("tightens legacy support sections without implying live intake capacity", () => {
    const normalized = normalizePublicReportForDisplay(savedReport([
      {
        title: "Your Support Network",
        description: "Local organizations that provide free advising and application assistance.",
        items: [
          {
            label: "Local Support in South Chicago",
            value: "1 organization",
            detail: "A legacy support summary.",
          },
          {
            label: "Example Organization",
            value: "Primary local access point",
            detail: [
              "Published support services: Business advising",
              "Status: Active resource; Verified current web presence",
            ].join("\n"),
            url: "https://example.com",
          },
        ],
      },
    ]));

    const section = normalized.sections[0];
    expect(section.title).toBe(SUPPORT_ORGANIZATIONS_SECTION_TITLE);
    expect(section.description).toContain(SUPPORT_ORGANIZATIONS_DESCRIPTION);
    expect(section.description).toContain(SUPPORT_ORGANIZATIONS_CAPACITY_NOTE);
    expect(section.items[1].detail).toContain("Availability: Current programs");
    expect(section.items[1].detail).not.toMatch(/Status:|Active resource|Verified current web presence/i);
  });

  it("preserves deadline and project-requirement facts while stripping private item payloads", () => {
    const normalized = normalizePublicReportForDisplay(savedReport([
      {
        title: "Upcoming Deadlines Near This Address",
        items: [{
          label: "Test Program application deadline",
          value: "December 15, 2026",
          detail: "Confirm the current filing window.",
          programId: "deadline-program",
          whoQualifies: "Eligible applicants must file before the published deadline.",
          confidenceLevel: "appears_eligible",
          confidenceLabel: "High Match",
          whyOneLine: "You qualify.",
          matchedRules: ["Reported industry: manufacturing"],
          notVerified: ["Confirm timing"],
          projectFit: { level: "strong", label: "Strong fit", reason: "Internal fit" },
        }],
      },
      {
        title: "Project Requirements",
        items: [{
          label: "Published applicant requirements",
          value: "Eligible businesses must document a qualifying rehabilitation project.",
          detail: "Factual program requirement.",
          programId: "requirement-program",
          whoQualifies: "Eligible businesses must document a qualifying rehabilitation project.",
          projectFit: { level: "strong", label: "Strong fit", reason: "Internal fit" },
        }],
      },
      {
        title: "Site Overview",
        items: [{
          label: "Public record",
          value: "Recorded fact",
          confidenceLabel: "High Match",
          matchedRules: ["Internal answer"],
          projectFit: { level: "strong", label: "Strong fit", reason: "Internal fit" },
        }],
      },
    ]));

    const deadline = normalized.sections[0].items[0];
    const requirement = normalized.sections[1].items[0];
    expect(deadline.value).toBe("December 15, 2026");
    expect(deadline.whoQualifies).toBe(
      "Eligible applicants must file before the published deadline.",
    );
    expect(deadline.matchExplanation).toBeUndefined();
    expect(requirement.value).toBe(
      "Eligible businesses must document a qualifying rehabilitation project.",
    );
    expect(requirement.whoQualifies).toBe(requirement.value);
    expect(requirement.matchExplanation).toBeUndefined();
    expect(JSON.stringify(normalized)).not.toMatch(PRIVATE_MATCH_FIELDS);
  });

  it("only removes incentive-directed dollar claims and preserves factual amounts", () => {
    const factualValues = [
      "Awarded public investment totals $8,500,000, worth reviewing before applying",
      "Applicant-reported permit costs of $750,000, up to 12 filings",
      "Estimated median household income $65,000 (ACS 5-year)",
      "The published program summary says it provides up to $100,000",
      "Up to $5.94 per square foot",
    ];
    const normalized = normalizePublicReportForDisplay(savedReport([
      {
        title: "Factual Context",
        description: "Awarded public investment totals $8,500,000; possible incentive $50,000.",
        items: factualValues.map((value, index) => ({
          label: `Fact ${index + 1}`,
          value,
        })),
      },
    ]));

    expect(normalized.sections[0].items.map((item) => item.value)).toEqual(factualValues);
    expect(normalized.sections[0].description).toBe(
      "Awarded public investment totals $8,500,000; published program terms.",
    );
  });

  it("preserves deadline dates in generated PDFs", async () => {
    const report = savedReport([
      {
        title: "Upcoming Deadlines Near This Address",
        items: [{
          label: "Test Program filing deadline",
          value: "December 15, 2026",
          detail: "Confirm timing with the administrator.",
          programId: "deadline-program",
        }],
      },
    ]);
    const output = generateReportPdfBase64(report);
    const extracted = await extractText(
      new Uint8Array(Buffer.from(output.base64, "base64")),
      { mergePages: true },
    );

    expect(extracted.text).toContain("December 15, 2026");
    expect(extracted.text).not.toContain("This program was included in the saved report");
  });

  it("removes guidance from legacy required-document rows and generated PDFs", async () => {
    const noApplication = "No application needed — benefits are automatic by location";
    const contactGuidance =
      "Contact your SSA delegate agency for any sub-program requirements";
    const legacy = savedReport([
      {
        title: CONFIRMED_PROGRAMS_SECTION_TITLE,
        items: [{
          label: "Special Service Area (SSA)",
          value: "Review published terms",
          programId: "ssa",
          matchExplanation: {
            whyItAppears: ["This program was included for review."],
            knownFromPublicData: [],
            basedOnUserAnswers: [],
            stillToConfirm: [],
            currentDocumentsToGather: [],
            confirmWith: [],
          },
        }],
      },
      {
        title: "Required Documents",
        description: "3 documents across programs mapped at this address.",
        items: [{
          label: "General",
          value: "3 documents",
          detail: [
            `${noApplication} [?] — Special Service Area (SSA)`,
            `${contactGuidance} [?] — Special Service Area (SSA)`,
            "Project budget [?] — Example Program",
          ].join("\n"),
        }],
      },
    ]);

    const normalized = normalizePublicReportForDisplay(legacy);
    const required = normalized.sections.find(
      (section) => section.title === "Required Documents",
    );
    const programItem = normalized.sections
      .find((section) => section.title === CONFIRMED_PROGRAMS_SECTION_TITLE)
      ?.items[0];

    expect(required?.description).toContain("1 document");
    expect(required?.items).toEqual([
      expect.objectContaining({
        value: "1 document",
        detail: "Project budget [?] — Example Program",
      }),
    ]);
    expect(JSON.stringify(required)).not.toContain(noApplication);
    expect(JSON.stringify(required)).not.toContain(contactGuidance);
    expect(programItem?.matchExplanation?.knownFromPublicData).toEqual(
      expect.arrayContaining([noApplication, contactGuidance]),
    );

    const output = generateReportPdfBase64(legacy);
    const extracted = await extractText(
      new Uint8Array(Buffer.from(output.base64, "base64")),
      { mergePages: true },
    );

    expect(extracted.text).toContain("Project budget");
    expect(extracted.text).not.toContain(noApplication);
    expect(extracted.text).not.toContain(contactGuidance);
  });

  it("keeps prohibited legacy labels and benefit headlines out of generated PDFs", async () => {
    const legacy = {
      title: "Eligible Incentive Programs",
      subtitle: "Appears eligible based on location",
      reportType: "site-incentives",
      generatedAt: "2026-08-01T00:00:00.000Z",
      summary: "You may qualify for a High Match program.",
      verdict: {
        signal: "strong",
        headline: "High Match with a potential incentive of $50,000",
        subheadline: "You qualify for an estimated $25,000 benefit",
        topReasons: ["Appears eligible for a benefit range of $10,000-$50,000"],
      },
      sections: [
        {
          title: "Eligible Incentive Programs",
          items: [
            {
              label: "Legacy Program",
              value: "$25,000 possible benefit",
              detail: "Published program summary.",
              programId: "legacy",
              confidenceLabel: "High Match",
              matchedRules: ["You reported a rehabilitation project."],
              notVerified: ["Confirm current program requirements."],
              sourceUrl: "https://example.com/legacy",
            },
          ],
        },
        {
          title: "Site Overview",
          description: "Awarded public investment: $8,500,000; projected incentive: $90,000.",
          items: [
            { label: "Permit cost", value: "Applicant-reported permit cost: $750,000" },
            { label: "Public investment", value: "Awarded public investment: $8,500,000" },
          ],
        },
      ],
      recommendedActions: [
        {
          label: "Claim a possible $25,000 incentive",
          description: "You qualify for a projected award of $25,000.",
          priority: "high",
        },
      ],
      actionRoadmap: [
        {
          tier: "do-this-week",
          label: "Pursue an estimated $50,000 benefit",
          description: "Appears eligible for a potential incentive of $50,000.",
        },
      ],
      metadata: { address: "100 E Test St", projectType: "rehab" },
    } as unknown as GeneratedReport;

    const output = generateReportPdfBase64(legacy);
    const extracted = await extractText(
      new Uint8Array(Buffer.from(output.base64, "base64")),
      { mergePages: true },
    );

    expect(extracted.text).not.toMatch(PROHIBITED_DETERMINATIONS);
    expect(extracted.text).not.toContain("$25,000");
    expect(extracted.text).not.toContain("$50,000");
    expect(extracted.text).not.toContain("$90,000");
    expect(extracted.text).toContain("Review published terms");
    expect(extracted.text).toContain("Your answers:");
    expect(extracted.text).toContain("Still to confirm:");
    expect(extracted.text).toContain("Applicant-reported permit cost: $750,000");
    expect(extracted.text).toContain("Awarded public investment: $8,500,000");
  });

  it("keeps LookupResult zoning states source-honest in generated PDFs", async () => {
    const lookupResult: LookupResult = {
      matched: false,
      address: "100 E Test St",
      lat: 41.8,
      lon: -87.6,
      zones: {},
      zoneNames: {},
      incentiveCount: 0,
    };
    const extractLookupPdf = async (result: LookupResult) => {
      const output = generateReportBase64(result, []);
      return extractText(
        new Uint8Array(Buffer.from(output.base64, "base64")),
        { mergePages: true },
      );
    };

    const available = await extractLookupPdf({
      ...lookupResult,
      cityZoningStatus: "available",
      cityZoning: {
        zoneClass: "B3-2",
        zoneType: "Business",
        recordUpdatedAt: "2026-08-01T00:00:00.000Z",
        source: {
          id: "chicago-arcgis-zoning",
          label: "City of Chicago Zoning Map",
          url: "https://gisapps.chicago.gov/zoning",
          retrievedAt: "2026-08-08T00:00:00.000Z",
          recordUpdatedAt: "2026-08-01T00:00:00.000Z",
        },
      },
    });
    const notFound = await extractLookupPdf({
      ...lookupResult,
      cityZoningStatus: "not_found",
    });
    const unavailable = await extractLookupPdf({
      ...lookupResult,
      cityZoningStatus: "unavailable",
    });

    expect(available.text).toContain("B3-2");
    expect(available.text).toContain("Published district classification only");
    expect(available.text).toContain("Verify whether a proposed use is permitted");
    expect(available.text).toContain("Record updated Aug 1, 2026");
    expect(available.text).toContain("View published City zoning source");
    expect(available.text).not.toMatch(/Zoning determines permitted land uses/i);

    expect(notFound.text).toContain("NO PUBLISHED DISTRICT RETURNED");
    expect(notFound.text).toContain("not evidence that zoning requirements do not apply");
    expect(notFound.text).not.toContain("PUBLISHED SOURCE TEMPORARILY UNAVAILABLE");

    expect(unavailable.text).toContain("PUBLISHED SOURCE TEMPORARILY UNAVAILABLE");
    expect(unavailable.text).toContain("No zoning or proposed-use conclusion was made");
    expect(unavailable.text).not.toContain("NO PUBLISHED DISTRICT RETURNED");
  });

  it("keeps both public report renderers off legacy confidence fields", () => {
    for (const path of [
      "components/report/ReportDisplay.tsx",
      "app/report/page.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source).toContain("normalizePublicReportForDisplay(rawReport)");
      expect(source).toContain("MatchExplanationDetails");
      expect(source).not.toMatch(/prog\.(?:confidence|confidenceLabel|benefitRange|whyOneLine)/);
      expect(source).not.toContain("prog.projectFitLabel");
      expect(source).not.toMatch(/item\.(?:confidenceLabel|matchedRules|notVerified|whyOneLine)/);
      expect(source).not.toContain("item.projectFit");
    }
    const pdfSource = readFileSync(join(process.cwd(), "lib/pdf-report.ts"), "utf8");
    expect(pdfSource).not.toContain("item.projectFit");
  });
});
