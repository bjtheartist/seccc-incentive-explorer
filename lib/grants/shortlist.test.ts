import { describe, expect, it } from "vitest";
import {
  applicantSchema,
  programSchema,
  roundSchema,
  type GrantRecord,
  type Round,
} from "./model";
import { buildGrantShortlist } from "./shortlist";

const now = new Date("2026-09-11T12:00:00Z");
const record = <T>(id: string, data: T): GrantRecord<T> => ({
  id,
  data,
  version: 1,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  updatedBy: "owner",
});
const applicant = () =>
  applicantSchema.parse({
    name: "Business",
    businessType: "LLC",
    industry: "Retail",
    primaryGoal: "Repair roof",
    intakeDate: "2026-09-11",
    role: "landlord",
    entity: "for_profit",
    stage: "operating",
    costs: ["roofing"],
    geography: ["Chicago"],
    fundingTypes: ["grant", "reimbursement"],
    factsSource: "Confirmed intake",
  });
const program = (id: string, type = "grant") =>
  record(
    id,
    programSchema.parse({
      name: `Program ${id}`,
      sponsor: "Test",
      sponsorType: "public",
      fundingType: type,
      cadence: "hybrid",
      sourceUrl: `https://example.org/${id}`,
    }),
  );
const round = (id: string, programId = id, changes: Partial<Round> = {}) =>
  record(
    id,
    roundSchema.parse({
      name: `Round ${id}`,
      programId,
      availability: "open",
      closesAt: "2026-12-01T00:00:00Z",
      evidenceUrl: "https://example.org/rules",
      review: "verified",
      evidence: "Source reviewed",
      verifiedAt: "2026-09-10T12:00:00Z",
      nextReviewAt: "2026-10-10T12:00:00Z",
      rules: {
        roles: ["landlord"],
        entities: ["for_profit"],
        stages: ["any"],
        businessTypes: ["LLC"],
        industries: ["Retail"],
        costs: ["roofing"],
        geography: ["Chicago"],
      },
      ...changes,
    }),
  );

describe("questionnaire-driven grant shortlist", () => {
  it("requires the five core fields on dated intakes, without breaking older profiles", () => {
    for (const key of [
      "name",
      "businessType",
      "industry",
      "primaryGoal",
    ] as const)
      expect(
        applicantSchema.safeParse({ ...applicant(), [key]: " " }).success,
      ).toBe(false);
    expect(
      applicantSchema.safeParse({ ...applicant(), intakeDate: "2026-02-30" })
        .success,
    ).toBe(false);
    expect(
      applicantSchema.parse({
        name: "Legacy",
        role: "unknown",
        entity: "unknown",
        stage: "unknown",
      }).intakeDate,
    ).toBeNull();
  });
  it("returns at most five programs, deduplicating rounds and ranking verified windows first", () => {
    const programs = Array.from({ length: 8 }, (_, i) => program(String(i)));
    const rounds = programs.map((p) => round(p.id));
    rounds.push(round("second-round", "0"));
    rounds[0].data.review = "in_review";
    const result = buildGrantShortlist(applicant(), programs, rounds, now);
    expect(result.candidates).toHaveLength(5);
    expect(new Set(result.candidates.map((c) => c.program.id)).size).toBe(5);
    expect(result.totalRelevant).toBe(8);
    expect(result.candidates.every((c) => c.state === "open")).toBe(true);
  });
  it("changes the shortlist for landlord versus operator, selected support types and cost fit", () => {
    const landlord = round("landlord"),
      operator = round("operator");
    operator.data.rules.roles = ["operator"];
    const result = buildGrantShortlist(
      applicant(),
      [program("landlord"), program("operator"), program("loan", "loan")],
      [landlord, operator, round("loan")],
      now,
    );
    expect(result.candidates.map((c) => c.program.id)).toEqual(["landlord"]);
    expect(
      result.omitted.some((o) => o.reason.includes("outside the selected")),
    ).toBe(true);
    expect(
      buildGrantShortlist(
        { ...applicant(), role: "operator" },
        [program("landlord"), program("operator")],
        [landlord, operator],
        now,
      ).candidates.map((c) => c.program.id),
    ).toEqual(["operator"]);
    expect(
      buildGrantShortlist(
        { ...applicant(), costs: ["training"] },
        [program("landlord")],
        [landlord],
        now,
      ).candidates,
    ).toEqual([]);
  });
  it("keeps missing facts visible and never manufactures alignment for blank rules", () => {
    const unknown = {
      ...applicant(),
      role: "unknown" as const,
      geography: [],
      industry: "Unknown",
    };
    const candidate = buildGrantShortlist(
      unknown,
      [program("one")],
      [round("one")],
      now,
    ).candidates[0];
    expect(candidate.screening.result).toBe("needs_information");
    expect(candidate.screening.gaps).toContain(
      "Applicant role: applicant information needed",
    );
    expect(
      candidate.screening.gaps.some((v) => v.startsWith("Industry:")),
    ).toBe(true);
    const blank = round("blank");
    blank.data.rules.costs = [];
    expect(
      buildGrantShortlist(
        applicant(),
        [program("blank"), program("no-round")],
        [blank],
        now,
      ).candidates,
    ).toEqual([]);
  });
  it("separates future rounds, omits closed rounds and does not reopen recurring programs", () => {
    const result = buildGrantShortlist(
      applicant(),
      [program("future"), program("closed")],
      [
        round("future", "future", {
          opensAt: "2026-10-01T12:00:00Z",
          review: "in_review",
        }),
        round("closed", "closed", { closesAt: "2026-09-01T12:00:00Z" }),
      ],
      now,
    );
    expect(result.candidates).toEqual([]);
    expect(result.watchlist.map((c) => c.program.id)).toEqual(["future"]);
    expect(result.omitted[0].reason).toContain("closed");
  });
  it("retains stale evidence as an unverified lead, and respects cash readiness", () => {
    const p = program("cash", "reimbursement"),
      r = round("cash", "cash", { nextReviewAt: "2026-09-11T11:00:00Z" });
    const result = buildGrantShortlist(
      { ...applicant(), targetDate: "2026-10-01", budget: "$80,000" },
      [p],
      [r],
      now,
    );
    expect(result.candidates[0].state).toBe("unverified");
    expect(result.candidates[0].screening.gaps).toContain(
      "Confirm whether the business can pay costs before reimbursement.",
    );
    expect(
      result.candidates[0].screening.gaps.some((g) => g.includes("2026-10-01")),
    ).toBe(true);
    expect(
      buildGrantShortlist(
        { ...applicant(), reimbursementReady: "no" },
        [p],
        [r],
        now,
      ).candidates,
    ).toEqual([]);
  });
  it("uses industry alignment to rank fits without treating free-text synonyms as ineligible", () => {
    const first = round("a"),
      second = round("b");
    first.data.rules.industries = ["Manufacturing"];
    const results = buildGrantShortlist(
      applicant(),
      [program("a"), program("b")],
      [first, second],
      now,
    );
    expect(results.candidates.map((c) => c.program.id)).toEqual(["b", "a"]);
    expect(results.candidates[1].screening.exclusions).toEqual([]);
  });
});
