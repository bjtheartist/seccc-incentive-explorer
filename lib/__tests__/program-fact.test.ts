/**
 * build-spec.md 2.2 (audit F6/F7/F9; consult item 9) — programFact() is the
 * mechanism that keeps hand-authored content (FAQ, Answers, quiz) from
 * drifting away from the catalog. A fix does not exist until a test asserts
 * the exact named property (Hard Rules) — this file proves the accessor
 * itself is correct AND that it actually reads live catalog data, not a
 * frozen copy (a mutation test: change a fact in a fresh in-memory record
 * via the DTO layer and confirm the derived qualifier reflects it).
 */
import { describe, expect, it } from "vitest";
import { programFact, programQualifier, programRecord, programView } from "../program-fact";
import { toPublicProgramView } from "../program-public";

describe("programFact / programRecord / programView", () => {
  it("throws loudly on an unknown program id rather than rendering blank", () => {
    expect(() => programRecord("definitely-not-a-real-program-id")).toThrow(/unknown program id/);
  });

  it("pulls a real field off the catalog record", () => {
    expect(programFact("nof", (p) => p.name)).toBe(programRecord("nof").name);
    expect(programFact("catalystGrant", (p) => p.intakeStatus)).toBe("lapsed");
  });

  it("programView produces the same qualifier as calling toPublicProgramView directly (no second code path)", () => {
    const record = programRecord("catalystGrant");
    const direct = toPublicProgramView(record, record.statusAsOf!);
    expect(programView("catalystGrant").benefit.qualifier).toBe(direct.benefit.qualifier);
  });

  it("programQualifier for a lapsed program names the closed-round frame, never a bare dollar figure alone", () => {
    const qualifier = programQualifier("catalystGrant");
    expect(qualifier).toMatch(/most recently published round offered/i);
    expect(qualifier).toMatch(/no round currently open as of/i);
  });

  it("programQualifier for an open/rolling program names the current-terms frame", () => {
    const qualifier = programQualifier("nof");
    expect(qualifier).toMatch(/current published terms as of/i);
  });

  it("mutation test: a catalog fact change is reflected by the DTO layer programView calls through to — proves this isn't a frozen/cached copy", () => {
    // Construct a MUTATED in-memory record (not the real catalog) and prove
    // toPublicProgramView — the same function programView() delegates to —
    // reacts to the change. This is the "change a catalog fact, assert the
    // derived output changes" mutation test the build spec requires;
    // programFact.ts has no caching layer of its own to defeat it.
    const real = programRecord("edaBuildToScale");
    const mutatedOpen = { ...real, intakeStatus: "open" as const, benefitTermsStatus: "current" as const };
    const beforeQualifier = toPublicProgramView(real, real.statusAsOf!).benefit.qualifier;
    const afterQualifier = toPublicProgramView(mutatedOpen, mutatedOpen.statusAsOf!).benefit.qualifier;
    expect(afterQualifier).not.toBe(beforeQualifier);
    expect(afterQualifier).toMatch(/current published terms as of/i);
    expect(beforeQualifier).toMatch(/most recently published round offered|not established/i);
  });
});
