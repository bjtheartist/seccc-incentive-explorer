import { describe, expect, it } from "vitest";
import programs from "../../public/data/programs.json";
import type { Program } from "../types";

describe("program data guardrails", () => {
  it("keeps the SSA program citywide instead of hard-coding one local SSA", () => {
    const ssaProgram = (programs as Program[]).find((program) => program.id === "ssa");
    expect(ssaProgram).toBeDefined();

    const serialized = JSON.stringify(ssaProgram);
    expect(ssaProgram!.name).toBe("Special Service Area (SSA)");
    expect(serialized).not.toMatch(/SSA\s*#?\s*50/i);
    expect(serialized).not.toMatch(/Calumet Heights|Avalon|SECCC|Southeast Chicago Chamber/i);
  });

  it("keeps Economic Empowerment Centers framed as an organization-facing grant", () => {
    const eecProgram = (programs as Program[]).find(
      (program) => program.id === "economicEmpowermentCenters"
    );

    expect(eecProgram).toBeDefined();
    expect(eecProgram!.level).toBe("State");
    expect(eecProgram!.zoneKey).toBe("");
    expect(eecProgram!.whoQualifies).toMatch(/career education agencies/i);
    expect(eecProgram!.whoQualifies).toMatch(/nonprofit organizations/i);
    expect(eecProgram!.benefitRange).toBe("$250,000-$500,000");
  });

  it("keeps restored federal polygon programs wired to reportable zone keys", () => {
    const hubzone = (programs as Program[]).find((program) => program.id === "hubzone");
    const energyCommunityBonus = (programs as Program[]).find(
      (program) => program.id === "energyCommunityBonus"
    );

    expect(hubzone).toBeDefined();
    expect(hubzone!.level).toBe("Federal");
    expect(hubzone!.zoneKey).toBe("hubzone");
    expect(hubzone!.eligibilityRules?.some((rule) => rule.verifiedBy === "location")).toBe(true);

    expect(energyCommunityBonus).toBeDefined();
    expect(energyCommunityBonus!.level).toBe("Federal");
    expect(energyCommunityBonus!.zoneKey).toBe("energyCommunities");
    expect(energyCommunityBonus!.summary).toMatch(/Investment Tax Credit/i);
  });

  it("uses the current CCSAP name while preserving the existing map key", () => {
    const ccsap = (programs as Program[]).find((program) => program.id === "ccsa");

    expect(ccsap).toBeDefined();
    expect(ccsap!.name).toBe("Commercial Corridor Storefront Activation Program (CCSAP)");
    expect(ccsap!.zoneKey).toBe("ccsa");
    expect(ccsap!.benefitRange).not.toMatch(/\$\s*\d/);
    expect(ccsap!.recurring).toBe(true);
    expect(ccsap!.deadlines).toContainEqual({
      label: "Quarterly round — 5 p.m. cutoff",
      date: "2026-08-21",
    });
  });

  it("keeps Class 6b SER's ten-year test tied to the occupying enterprise", () => {
    const class6bSer = (programs as Program[]).find(
      (program) => program.id === "class6bSer"
    );

    expect(class6bSer).toBeDefined();
    expect(class6bSer!.summary).toMatch(/occupied by long-tenured industrial enterprises/i);
    expect(class6bSer!.summary).not.toMatch(/long-tenured industrial owners/i);
    expect(class6bSer!.requiredDocs.join(" ")).toMatch(/occupying industrial enterprise/i);
    expect(class6bSer!.requiredDocs.join(" ")).not.toMatch(/years of ownership/i);
    expect(class6bSer!.eligibilityRules?.find((rule) => rule.criterion === "propertyType")?.description)
      .toMatch(/enterprise occupying the same premises/i);
    expect(JSON.stringify(class6bSer!.eligibilityRules)).not.toMatch(/same ownership/i);
  });

  it("does not present expired section 30C as an actionable ComEd project step", () => {
    const comed = (programs as Program[]).find((program) => program.id === "comedEvRebate");

    expect(comed).toBeDefined();
    expect(JSON.stringify(comed!.verificationSteps ?? [])).not.toMatch(/30C|refueling property/i);
  });

  it("structures the requested current deadlines and CNRP terminology", () => {
    const ahsap = (programs as Program[]).find((program) => program.id === "ahsap");
    const cnrp = (programs as Program[]).find(
      (program) => program.id === "microMarketRecovery"
    );

    expect(ahsap?.deadlines).toContainEqual({
      label: "2026 Part 1 + Part 2 application deadline",
      date: "2026-09-05",
    });
    expect(ahsap?.recurring).toBe(true);
    expect(cnrp?.requiredDocs.join(" ")).toMatch(/CNRP target area/i);
    expect(cnrp?.requiredDocs.join(" ")).not.toMatch(/MMRP area/i);
  });

  it("preserves the Data Center certification distinction while disclosing paused intake", () => {
    const dataCenter = (programs as Program[]).find(
      (program) => program.id === "dataCenter"
    );

    expect(dataCenter?.suspensionNote).toMatch(/new applications are not being processed/i);
    expect(`${dataCenter?.summary} ${dataCenter?.whoQualifies}`).toMatch(
      /existing certifications are unaffected|currently certified projects continue/i
    );
  });

  it("separates SBA Microloan and 504 pathways without promising financing", () => {
    const microloan = (programs as Program[]).find(
      (program) => program.id === "sbaMicroloan"
    );
    const sevenAAnd504 = (programs as Program[]).find(
      (program) => program.id === "sba7a504"
    );

    expect(microloan).toBeDefined();
    expect(sevenAAnd504).toBeDefined();
    expect(microloan!.summary).toMatch(/equipment/i);
    expect(microloan!.contacts?.some((contact) => contact.agency === "Justine PETERSEN")).toBe(
      true
    );
    expect(
      sevenAAnd504!.contacts?.some(
        (contact) => contact.agency === "Small Business Growth Corporation"
      )
    ).toBe(true);

    for (const program of [microloan!, sevenAAnd504!]) {
      expect(program.name).not.toMatch(/\$\s*\d/);
      expect(program.benefitRange).not.toMatch(/\$\s*\d/);
      expect(program.benefitRange).toMatch(/no approval|no financing amount/i);
    }
  });

  it("does not invent an NSAP program from an ambiguous call transcript", () => {
    expect(
      (programs as Program[]).some((program) => /\bNSAP\b/i.test(`${program.id} ${program.name}`))
    ).toBe(false);
  });
});
