import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildCostSignals, buildExpectations, buildVerifySources, buildWorksWith } from "@/lib/report-engine";
import type { CostSignalTag, Program } from "@/lib/types";

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
  // Gate finding 2+3 (regression, real bug this fixes): SBIF is
  // recurring=true AND intakeStatus="open" with real per-TIF-district
  // windows (the same data FundingWindowChart plots). The old
  // `recurring && intakeStatus !== "closed"` branch matched SBIF FIRST and
  // produced "no fixed application window published" — a false statement
  // that directly contradicted this report's own chart. intakeStatus is
  // now the only signal, checked via a single switch.
  it("never claims SBIF has 'no fixed application window' — it has real, resolved windows", () => {
    const sbif = realProgram("sbif");
    expect(sbif.intakeStatus).toBe("open");
    expect(sbif.recurring).toBe(true); // the exact condition that used to misfire
    const expectations = buildExpectations(sbif);
    expect(expectations).not.toMatch(/no fixed application window/i);
    expect(expectations).toBe("Applications are being accepted under the published intake window.");
  });

  it("never derives a reimbursement claim from benefits[] text — expectations is structured-fields-only now", () => {
    const sbif = realProgram("sbif");
    expect(sbif.benefits?.join(" ")).toMatch(/reimburs/i); // sanity: the source fact is real...
    const expectations = buildExpectations(sbif);
    expect(expectations).not.toMatch(/reimburs/i); // ...but is no longer surfaced here at all.
  });

  it("frames intake cadence from intakeStatus without fabricating a specific timeline", () => {
    const expectations = buildExpectations({ intakeStatus: "rolling" } as unknown as Program);
    expect(expectations).not.toMatch(/\d+\s*days/); // no invented duration
    expect(expectations).toMatch(/rolling/i);
  });

  it("covers every intakeStatus value with exactly one non-overlapping branch", () => {
    expect(buildExpectations({ intakeStatus: "open" } as unknown as Program)).toMatch(/accepted/i);
    expect(buildExpectations({ intakeStatus: "rolling" } as unknown as Program)).toMatch(/rolling/i);
    expect(buildExpectations({ intakeStatus: "closed" } as unknown as Program)).toMatch(/not currently open/i);
    expect(buildExpectations({ intakeStatus: "lapsed" } as unknown as Program)).toMatch(/lapsed/i);
    expect(buildExpectations({ intakeStatus: "pending" } as unknown as Program)).toMatch(/not yet opened/i);
  });

  it("returns undefined (renders nothing) when intakeStatus carries no signal — never a fallback guess", () => {
    expect(buildExpectations({ intakeStatus: "unknown" } as unknown as Program)).toBeUndefined();
    expect(buildExpectations({ id: "x", name: "X", level: "City", zoneKey: "x" } as unknown as Program)).toBeUndefined();
  });
});

describe("buildCostSignals (gate finding 4)", () => {
  it("returns undefined (renders nothing) for the real SBIF record — the catalog carries no confirmed cost-signal tags yet", () => {
    // This is the honest-omission case the parity doc documents: the R5
    // board's SBIF pills are not yet backed by real structured catalog
    // data, so the block must not render anything for SBIF today.
    const sbif = realProgram("sbif");
    expect(sbif.costSignals).toBeUndefined();
    expect(buildCostSignals(sbif)).toBeUndefined();
  });

  it("maps each confirmed structured tag to its fixed label/severity — never invents copy", () => {
    const program = { ...realProgram("sbif"), costSignals: ["free_to_apply", "permit_fees_apply"] as CostSignalTag[] };
    const signals = buildCostSignals(program);
    expect(signals).toEqual([
      { label: "Free to apply", severity: "info" },
      { label: "Permit fees apply", severity: "amber" },
    ]);
  });

  it("covers every CostSignalTag value with a defined label/severity — exhaustiveness", () => {
    const allTags: CostSignalTag[] = [
      "free_to_apply",
      "application_fee_required",
      "reimbursement_after_spend",
      "upfront_funds_no_reimbursement_wait",
      "drawings_required",
      "permit_fees_apply",
      "matching_funds_required",
    ];
    const program = { ...realProgram("sbif"), costSignals: allTags };
    const signals = buildCostSignals(program);
    expect(signals).toHaveLength(allTags.length);
    expect(signals?.every((s) => typeof s.label === "string" && s.label.length > 0)).toBe(true);
    expect(signals?.every((s) => s.severity === "info" || s.severity === "amber")).toBe(true);
  });

  it("returns undefined for an empty costSignals array — never an empty-but-truthy block", () => {
    const program = { ...realProgram("sbif"), costSignals: [] as CostSignalTag[] };
    expect(buildCostSignals(program)).toBeUndefined();
  });

  it("never derives a signal from benefits[]/requiredDocs[] text even when it contains matching keywords — SBIF's real prose says 'reimbursement' and lists 'Building permits', but that must not leak into signals absent the structured field", () => {
    const sbif = realProgram("sbif");
    expect(sbif.benefits?.join(" ")).toMatch(/reimburs/i); // sanity: prose is real
    expect(sbif.requiredDocs?.join(" ")).toMatch(/permit/i); // sanity: prose is real
    expect(buildCostSignals(sbif)).toBeUndefined(); // but neither leaks through
  });
});
