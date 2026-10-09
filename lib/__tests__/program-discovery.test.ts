import { describe, expect, it, vi } from "vitest";
import data from "../../data/programs-internal.json";
import type { Program } from "../types";
import { matchesProgramIndustry, matchesProgramSearch, prioritizeCdg, sortProgramsForDirectory } from "../program-discovery";
import { toPublicProgramView } from "../program-public";
import { resolveAvailability } from "../program-gating";
import { runConfidenceEngine } from "../confidence-engine";
import { buildExpectations } from "../report-engine";
import { getProgramBySlug, programSlug } from "../programs-data";
import nextConfig from "../../next.config";

const programs = data as Program[];
const program = (id: string) => programs.find((p) => p.id === id)!;
const publicProgram = (id: string) => toPublicProgramView(program(id), "2026-10-09T17:00:00.000Z");
const today = new Date("2026-10-09T17:00:00Z");
const eitIds = ["illinoisInvent", "advantageIllinois", "illinoisClimateBank", "angelInvestmentCredit",
  "illinoisNewMarkets", "illinoisSbirMatch", "innovationVoucher", "illinoisSbdc", "illinoisItc",
  "illinoisApex", "cejaIncubator", "cejaAccelerator", "firstStopBic", "regulatoryFlexibility", "illinoisSbeap"];

describe("program discovery", () => {
  it("preserves the former EEC round-specific link after refreshing the program title", async () => {
    const redirects = await nextConfig.redirects!();
    const oldLink = redirects.find((redirect) => redirect.source === "/programs/economic-empowerment-centers-eec-grant-program-round-2");
    expect(oldLink).toMatchObject({ destination: `/programs/${programSlug(program("economicEmpowermentCenters"))}`, permanent: true });
    expect(getProgramBySlug(oldLink!.destination.replace("/programs/", ""))?.id).toBe("economicEmpowermentCenters");
  });

  it("puts CDG first and NSF below the general catalog without mutating its source", () => {
    const original = programs.map((p) => p.id);
    const sorted = sortProgramsForDirectory(programs);
    expect(sorted.slice(0, 3).map((p) => p.id)).toEqual(["cdgSmall", "cdgMedium", "cdgLarge"]);
    expect(sorted.at(-1)?.id).toBe("nsfSeedFund");
    expect(programs.map((p) => p.id)).toEqual(original);
  });

  it("includes all 15 current EIT resources as distinct State program pages", () => {
    expect(new Set(programs.map((p) => p.id)).size).toBe(programs.length);
    for (const id of eitIds) {
      const p = program(id);
      expect(p, id).toBeDefined();
      expect(p.level).toBe("State");
      expect(p.resourceType).toBeTruthy();
      expect(p.zoneKey).toBe("");
      expect(p.sourceUrl).toMatch(/^https:\/\//);
      expect(resolveAvailability(p, today).state).not.toBe("expired");
      expect(getProgramBySlug(programSlug(p))?.id).toBe(id);
    }
  });

  it("supports acronym, agency and multi-word discovery searches", () => {
    expect(matchesProgramSearch(publicProgram("cdgSmall"), "cdg")).toBe(true);
    expect(matchesProgramSearch(publicProgram("nsfSeedFund"), "NSF research")).toBe(true);
    expect(matchesProgramSearch(publicProgram("illinoisSbeap"), "DCEO environmental")).toBe(true);
    expect(matchesProgramSearch(publicProgram("illinoisInvent"), "equity")).toBe(true);
    expect(matchesProgramSearch(publicProgram("illinoisInvent"), "unrelated-term")).toBe(false);
  });

  it("makes technology and contractor resources visible through relevant industry filters", () => {
    for (const id of ["nsfSeedFund", "illinoisSbirMatch", "innovationVoucher", "illinoisInvent"]) {
      expect(matchesProgramIndustry(program(id), "tech"), id).toBe(true);
    }
    expect(matchesProgramIndustry(program("cejaIncubator"), "construction")).toBe(true);
    expect(matchesProgramIndustry(program("nsfSeedFund"), "hairBeauty")).toBe(false);
    expect(matchesProgramIndustry(program("cdgSmall"), "hairBeauty")).toBe(true);
    expect(matchesProgramIndustry(program("illinoisSbdc"), "retail")).toBe(true);
  });

  it("only prioritizes CDG when both geographic checks are negative", () => {
    expect(prioritizeCdg({ tif: false, nof: false })).toBe(true);
    const otherCoverage: Array<Record<string, boolean> | undefined> = [undefined, {}, { tif: false }, { nof: false }, { tif: true, nof: false }, { tif: false, nof: true }];
    for (const zones of otherCoverage) {
      expect(prioritizeCdg(zones)).toBe(false);
    }
  });

  it("keeps historical programs out of active discovery and labels closed New Markets intake", () => {
    for (const id of ["illinoisWetLab", "illinoisIivf", "illinoisEmergencyLoan"]) {
      expect(program(id).status).toBe("inactive");
      expect(resolveAvailability(program(id), today)).toMatchObject({ state: "expired", note: expect.stringContaining("maintenance only") });
    }
    expect(resolveAvailability(program("illinoisNewMarkets"), today).state).toBe("window-closed");
  });

  it("keeps current CDG deadlines open through the closing Chicago day", () => {
    for (const id of ["cdgSmall", "cdgMedium"]) {
      expect(resolveAvailability(program(id), today).state).toBe("active");
      expect(resolveAvailability(program(id), new Date("2027-02-17T05:59:00Z")).state).toBe("active");
      expect(resolveAvailability(program(id), new Date("2027-02-17T06:01:00Z")).state).toBe("window-closed");
    }
  });

  it("does not claim address eligibility for CDG, NSF or the new EIT resources", () => {
    const discovery = [...eitIds, "cdgSmall", "cdgMedium", "nsfSeedFund"].map(program);
    const results = runConfidenceEngine(discovery, { tif: false, nof: false }, {});
    expect(results.every((r) => r.relevance === "context_dependent")).toBe(true);
    const surveyed = runConfidenceEngine(discovery, {}, {}, { industry: "retail", property: "own", activities: ["equipment"] });
    expect(surveyed.some((r) => r.relevance === "mapped_with_matching_answers")).toBe(false);
  });
});

// The current catalog uses an exact Chicago-day cutoff in the public window.
it("updates CDG report intake copy after the full Chicago closing day", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2027-02-17T05:59:00Z"));
    expect(buildExpectations(program("cdgSmall"))).toContain("being accepted");
    vi.setSystemTime(new Date("2027-02-17T06:01:00Z"));
    expect(buildExpectations(program("cdgSmall"))).toContain("window closed");
  } finally {
    vi.useRealTimers();
  }
});
