import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractText } from "unpdf";
import { generateReportPdfBase64 } from "../pdf-report";
import {
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  generateReportData,
  normalizePublicReportForDisplay,
  type GeneratedReport,
} from "../report-engine";
import type { Program } from "../types";

const PROHIBITED_DETERMINATIONS =
  /appears eligible|may qualify|you qualify|eligible incentive programs|high match|medium match/i;
const PRIVATE_MATCH_FIELDS =
  /"(?:confidenceLevel|confidenceLabel|benefitRange|whyOneLine|matchedRules|notVerified)"/i;

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
      sections: [
        {
          title: "Eligible Incentive Programs",
          description: "Appears eligible for a potential incentive of $40,000.",
          items: [
            {
              label: "Legacy Program",
              value: "$25,000 possible benefit",
              detail: "Published program summary.",
              programId: "legacy",
              confidenceLevel: "appears_eligible",
              confidenceLabel: "High Match",
              whyOneLine: "You qualify based on this location.",
              matchedRules: ["You reported that you plan to hire."],
              notVerified: ["Confirm payroll records."],
              matchExplanation: {
                whyItAppears: ["Appears eligible based on this address."],
                knownFromPublicData: [
                  "The address is recorded within the district.",
                  "You selected hiring as your project goal.",
                ],
                basedOnUserAnswers: ["You reported that you plan to hire."],
                stillToConfirm: ["Confirm payroll records."],
                currentDocumentsToGather: [],
                confirmWith: [],
              },
              eligibilityRules: [
                { description: "Eligible businesses must be in good standing.", required: true },
              ],
              sourceUrl: "https://example.com/legacy",
            },
          ],
        },
        {
          title: "Recorded Public Activity",
          description: "Awarded public investment totals $8,500,000.",
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
    expect(serialized).not.toContain("This site qualifies");
    expect(normalized.verdict?.headline).toContain("published program terms");
    expect(normalized.actionRoadmap?.[0].description).toContain("published program terms");
    expect(normalized.actionRoadmap?.[0].callScript).toContain("published program terms");
    expect(normalized.recommendedActions[0].description).toContain("published program terms");
    expect(normalized.sections[1].description).toBe(
      "Awarded public investment totals $8,500,000.",
    );
    expect(normalized.sections[1].items[0].value).toBe(
      "Applicant-reported permit cost: $750,000",
    );
    expect(item.matchExplanation?.basedOnUserAnswers).toEqual(
      expect.arrayContaining([
        "You reported that you plan to hire.",
        "You selected hiring as your project goal.",
      ]),
    );
    expect(item.matchExplanation?.knownFromPublicData).toEqual([
      "The address is recorded within the district.",
    ]);
    expect(item.matchExplanation?.stillToConfirm).toEqual(
      expect.arrayContaining([
        "Confirm payroll records.",
        "Eligible businesses must be in good standing.",
      ]),
    );
    expect(item.matchExplanation?.officialSource).toEqual({
      label: "Official Legacy Program source",
      url: "https://example.com/legacy",
    });
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
          description: "Recorded permit and investment context.",
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
    expect(extracted.text).toContain("Review published terms");
    expect(extracted.text).toContain("Your answers:");
    expect(extracted.text).toContain("Still to confirm:");
    expect(extracted.text).toContain("Applicant-reported permit cost: $750,000");
    expect(extracted.text).toContain("Awarded public investment: $8,500,000");
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
      expect(source).not.toMatch(/item\.(?:confidenceLabel|matchedRules|notVerified|whyOneLine)/);
    }
  });
});
