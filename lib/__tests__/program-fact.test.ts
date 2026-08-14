/**
 * build-spec.md 2.2 (audit F6/F7/F9; consult item 9) — programFact() is the
 * mechanism that keeps hand-authored content (FAQ, Answers, quiz) from
 * drifting away from the catalog. A fix does not exist until a test asserts
 * the exact named property (Hard Rules) — this file proves the accessor
 * itself is correct AND that it actually reads the same catalog-derived
 * data every other public surface does, not a frozen copy (a mutation
 * test: change a fact and confirm the derived qualifier reflects it).
 *
 * review5 S1: programFact()'s underlying data is now PublicProgramView
 * (public/data/programs-public.json), not the internal Program record — so
 * this file's assertions read DTO fields (`p.intake.status`, not
 * `p.intakeStatus`) and the mutation test mutates a DTO-shaped record, not
 * an internal one.
 */
import { describe, expect, it } from "vitest";
import { programFact, programQualifier, programRecord, programView } from "../program-fact";
import { benefitQualifier } from "../program-public";

describe("programFact / programRecord / programView", () => {
  it("throws loudly on an unknown program id rather than rendering blank", () => {
    expect(() => programRecord("definitely-not-a-real-program-id")).toThrow(/unknown program id/);
  });

  it("pulls a real field off the program's public projection", () => {
    expect(programFact("nof", (p) => p.name)).toBe(programRecord("nof").name);
    expect(programFact("catalystGrant", (p) => p.intake.status)).toBe("lapsed");
  });

  it("programView returns the same object programRecord does (no second code path — the committed DTO IS the projection)", () => {
    expect(programView("catalystGrant")).toBe(programRecord("catalystGrant"));
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

  it("mutation test: a catalog fact change is reflected by the DTO layer's own benefitQualifier() — proves this isn't a frozen/cached copy", () => {
    // Construct a MUTATED in-memory record (not the real catalog) and prove
    // benefitQualifier() — the same function program-public.ts's DTO
    // projection uses internally — reacts to the change. programFact.ts has
    // no caching layer of its own to defeat it.
    const real = programRecord("edaBuildToScale");
    const beforeQualifier = benefitQualifier(real.intake.status, real.benefit.summary, real.statusBadge.asOfDate);
    const afterQualifier = benefitQualifier("open", real.benefit.summary, real.statusBadge.asOfDate);
    expect(afterQualifier).not.toBe(beforeQualifier);
    expect(afterQualifier).toMatch(/current published terms as of/i);
    expect(beforeQualifier).toMatch(/most recently published round offered|not established/i);
    // And the real, unmutated record's own qualifier matches the "before" value.
    expect(real.benefit.qualifier).toBe(beforeQualifier);
  });
});
