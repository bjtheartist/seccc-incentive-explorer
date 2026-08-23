import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildExpectations, buildVerifySources, buildWorksWith } from "@/lib/report-engine";
import type { Program } from "@/lib/types";

// ─── Program-card content fields (spec v2 amendment) ─────────────────────
// Every field is derived from data the catalog already carries — real
// programs.json fixtures below use the ACTUAL SBIF/TIF records so this
// proves the derivation against real repo content, not an invented sample.

const programs = JSON.parse(
  readFileSync(join(process.cwd(), "data/programs-internal.json"), "utf8"),
) as Program[];

function realProgram(id: string): Program {
  const program = programs.find((p) => p.id === id);
  if (!program) throw new Error(`fixture program "${id}" not found in data/programs-internal.json`);
  return program;
}

describe("buildWorksWith", () => {
  it("returns the real, committed 'can' stacking relationship for SBIF <-> TIF", () => {
    const worksWith = buildWorksWith("sbif");
    expect(worksWith).toBeDefined();
    expect(worksWith?.some((w) => w.label.toLowerCase().includes("tif"))).toBe(true);
    // The reason text traces to the committed stacking-rules.json record,
    // never invented here.
    expect(worksWith?.[0].detail).toMatch(/stack|TIF/i);
  });

  it("returns undefined (no block) for a program with no committed stacking rule — never an empty array pretending to be content", () => {
    // hubzone is a real catalog id with no entry in stacking-rules.json.
    expect(buildWorksWith("hubzone")).toBeUndefined();
  });
});

describe("buildVerifySources", () => {
  it("derives dated source links from the program's own real sourceUrl/url/contacts", () => {
    const sbif = realProgram("sbif");
    const sources = buildVerifySources(sbif);
    expect(sources).toBeDefined();
    expect(sources!.length).toBeGreaterThan(0);
    for (const source of sources!) {
      expect(source.url).toMatch(/^https?:\/\//);
      expect(source.dated).toBe(sbif.lastVerifiedAt);
    }
    // No duplicate URLs even when sourceUrl/url/a contact URL collide.
    const urls = sources!.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("returns undefined for a program with no source links at all", () => {
    const bare = { id: "x", name: "X", level: "City", zoneKey: "x" } as unknown as Program;
    expect(buildVerifySources(bare)).toBeUndefined();
  });
});

describe("buildExpectations", () => {
  it("reads reimbursement structure straight off SBIF's own published benefit text — never a claim this module invents", () => {
    const sbif = realProgram("sbif");
    expect(sbif.benefits?.join(" ")).toMatch(/reimburs/i); // sanity: the source fact is real
    const expectations = buildExpectations(sbif);
    expect(expectations).toMatch(/reimburs/i);
  });

  it("frames intake cadence from intakeStatus without fabricating a specific timeline", () => {
    const sbif = realProgram("sbif");
    const expectations = buildExpectations(sbif);
    expect(expectations).not.toMatch(/\d+\s*days/); // no invented duration
    expect(expectations).toMatch(/rolling|competitive|lapsed|pending/i);
  });

  it("returns undefined when a program has neither an intake signal nor reimbursement language", () => {
    const bare = { id: "x", name: "X", level: "City", zoneKey: "x", benefits: [] } as unknown as Program;
    expect(buildExpectations(bare)).toBeUndefined();
  });
});
