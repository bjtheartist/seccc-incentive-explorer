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
});
