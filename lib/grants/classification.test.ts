import { describe, expect, it } from "vitest";
import {
  classificationFor,
  naicsBusinessTypes,
  naicsMatches,
} from "./classification";
import { applicantSchema, roundSchema, screenMatch } from "./model";

const profile = () =>
  applicantSchema.parse({
    name: "Business",
    role: "operator",
    entity: "for_profit",
    stage: "operating",
    naicsCode: "624410",
    businessStructure: "llc",
    spaceArrangement: "leases",
  });
const round = () =>
  roundSchema.parse({
    name: "Round",
    programId: "p",
    availability: "rolling",
    evidenceUrl: "https://example.org/rules",
    rules: {
      roles: ["operator"],
      entities: ["any"],
      stages: ["any"],
      geography: ["any"],
      costs: ["any"],
      businessStructures: ["llc"],
      naicsCodes: ["62"],
    },
  });

describe("code-backed business classification", () => {
  it("provides all 1,012 official six-digit codes with a sector", () => {
    expect(naicsBusinessTypes).toHaveLength(1012);
    expect(new Set(naicsBusinessTypes.map((r) => r.code)).size).toBe(1012);
    for (const row of naicsBusinessTypes)
      expect(classificationFor(row.code)?.industryCode).toBeTruthy();
  });
  it("derives canonical labels and sector from the code, ignoring submitted labels", () => {
    expect(
      applicantSchema.parse({
        ...profile(),
        businessType: "LLC",
        industry: "Retail",
        industryCode: "44-45",
      }),
    ).toMatchObject({
      businessStructure: "llc",
      naicsCode: "624410",
      businessType: "Child Care Services",
      industryCode: "62",
      industry: "Health Care and Social Assistance",
    });
  });
  it("rejects invalid, broad, and wrong-edition business codes", () => {
    for (const code of ["999999", "62", "62441", "000000"])
      expect(
        applicantSchema.safeParse({ ...profile(), naicsCode: code }).success,
      ).toBe(false);
    expect(
      applicantSchema.safeParse({ ...profile(), naicsEdition: "2017" }).success,
    ).toBe(false);
    expect(
      roundSchema.safeParse({
        ...round(),
        rules: { ...round().rules, naicsCodes: ["999999"] },
      }).success,
    ).toBe(false);
  });
  it("retains legacy descriptions, separates LLC from industry, and migrates tenant to operator plus lease", () => {
    const legacy = applicantSchema.parse({
      name: "Legacy",
      role: "tenant",
      entity: "unknown",
      stage: "unknown",
      businessType: "LLC",
      industry: "daycare",
    });
    expect(legacy).toMatchObject({
      role: "operator",
      spaceArrangement: "leases",
      businessStructure: "llc",
      naicsCode: null,
      businessType: "",
      industry: "",
      legacyBusinessType: "LLC",
      legacyIndustry: "daycare",
    });
    expect(applicantSchema.parse(legacy)).toEqual(legacy);
  });
  it("matches hierarchical and combined-sector codes without guessing missing codes", () => {
    expect(naicsMatches("624410", "62")).toBe(true);
    expect(naicsMatches("624410", "6244")).toBe(true);
    expect(naicsMatches("459420", "44-45")).toBe(true);
    expect(naicsMatches("332999", "31-33")).toBe(true);
    expect(naicsMatches("624410", "61")).toBe(false);
    expect(screenMatch(profile(), round()).exclusions).toEqual([]);
    expect(
      screenMatch({ ...profile(), naicsCode: "459420" }, round()).exclusions,
    ).toContain("NAICS industry: does not match recorded code criteria");
    expect(
      screenMatch({ ...profile(), naicsCode: null }, round()).gaps,
    ).toContain("NAICS industry: confirm the business's six-digit code");
  });
  it("allows an operating tenant through both operator and tenant rules, keeping unknown premises unresolved", () => {
    expect(screenMatch(profile(), round()).exclusions).toEqual([]);
    const tenantRound = {
      ...round(),
      rules: { ...round().rules, roles: ["tenant"] as const },
    };
    const r = roundSchema.parse(tenantRound);
    expect(screenMatch(profile(), r).exclusions).toEqual([]);
    expect(
      screenMatch({ ...profile(), spaceArrangement: "owns" }, r).exclusions,
    ).toContain("Applicant role: does not match recorded criteria");
    const uncertain = screenMatch(
      { ...profile(), spaceArrangement: "unknown" },
      r,
    );
    expect(uncertain.exclusions).toEqual([]);
    expect(uncertain.gaps).toContain(
      "Applicant role: confirm whether the operator leases the project space",
    );
  });
});
