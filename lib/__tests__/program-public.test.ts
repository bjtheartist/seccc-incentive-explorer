import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import internalCatalog from "../../data/programs-internal.json";
import publicArtifact from "../../public/data/programs-public.json";
import type { Program } from "../types";
import {
  benefitQualifier,
  buildPublicProgramsEnvelope,
  catalogRevisionFromRaw,
  toPublicProgramView,
} from "../program-public";

const programs = internalCatalog as unknown as Program[];
const byId = new Map(programs.map((p) => [p.id, p]));

describe("toPublicProgramView", () => {
  it("never exposes raw whoQualifies on the DTO", () => {
    for (const program of programs) {
      const view = toPublicProgramView(program, "2026-08-13") as unknown as Record<
        string,
        unknown
      >;
      expect(Object.hasOwn(view, "whoQualifies")).toBe(false);
      // Also guard nested objects — no field anywhere on the DTO should be
      // literally the raw whoQualifies string.
      const serialized = JSON.stringify(view);
      if (program.whoQualifies && program.whoQualifies.length > 20) {
        expect(serialized.includes(JSON.stringify(program.whoQualifies))).toBe(false);
      }
    }
  });

  it("sources screening.publishedCriteria from eligibilityRules descriptions, not whoQualifies", () => {
    const nof = byId.get("nof")!;
    const view = toPublicProgramView(nof, "2026-08-13");
    expect(view.screening.publishedCriteria).toEqual(
      nof.eligibilityRules!.map((r) => r.description)
    );
  });

  it("open/rolling programs get the 'Current published terms' qualifier", () => {
    const tif = byId.get("tif")!;
    expect(tif.intakeStatus).toBe("rolling");
    const view = toPublicProgramView(tif, "2026-08-13");
    expect(view.benefit.qualifier).toBe(`Current published terms as of ${tif.statusAsOf}`);
  });

  it("catalystGrant (lapsed) produces the closed-round qualifier", () => {
    const catalystGrant = byId.get("catalystGrant")!;
    const view = toPublicProgramView(catalystGrant, "2026-08-13");
    expect(view.benefit.qualifier).toContain("Most recently published round offered");
    expect(view.benefit.qualifier).toContain(catalystGrant.benefitRange!);
    expect(view.benefit.qualifier).toContain("No round currently open as of");
    expect(view.benefit.qualifier).toContain(catalystGrant.statusAsOf!);
    // never claims current terms
    expect(view.benefit.qualifier).not.toContain("Current published terms");
  });

  it("edaBuildToScale (pending) produces the closed-round qualifier", () => {
    const eda = byId.get("edaBuildToScale")!;
    const view = toPublicProgramView(eda, "2026-08-13");
    expect(view.benefit.qualifier).toContain("Most recently published round offered");
    expect(view.benefit.qualifier).toContain("No round currently open as of");
    expect(view.benefit.qualifier).not.toContain("Current published terms");
  });

  it("microMarketRecovery (closed) produces the closed-round qualifier", () => {
    const mmr = byId.get("microMarketRecovery")!;
    const view = toPublicProgramView(mmr, "2026-08-13");
    expect(view.benefit.qualifier).toContain("Most recently published round offered");
    expect(view.benefit.qualifier).not.toContain("Current published terms");
  });

  it("falls back to record.statusAsOf even when a different asOf is passed", () => {
    const tif = byId.get("tif")!;
    const view = toPublicProgramView(tif, "1999-01-01");
    expect(view.statusBadge.asOfDate).toBe(tif.statusAsOf);
    expect(view.statusBadge.asOfDate).not.toBe("1999-01-01");
  });

  it("uses the passed-in asOf only when the record has no statusAsOf (defensive DB-row path)", () => {
    const withoutStatusAsOf: Program = {
      ...byId.get("tif")!,
      statusAsOf: undefined,
      intakeStatus: undefined,
    };
    const view = toPublicProgramView(withoutStatusAsOf, "2026-08-13");
    expect(view.statusBadge.asOfDate).toBe("2026-08-13");
    expect(view.statusBadge.state).toBe("unknown");
  });
});

describe("benefitQualifier", () => {
  it("unknown intake status never defaults to open/current language", () => {
    const text = benefitQualifier("unknown", "Up to $50,000", "2026-08-13");
    expect(text).not.toContain("Current published terms");
    expect(text).not.toMatch(/most recently published round offered/i);
    expect(text.toLowerCase()).toContain("not established");
  });

  it("closed/lapsed/pending with no benefit summary still produces a safe fallback", () => {
    const text = benefitQualifier("lapsed", null, "2026-08-13");
    expect(text).toContain("Most recently published round terms are on file.");
    expect(text).toContain("No round currently open as of 2026-08-13");
  });
});

describe("catalog binding invariant, restated at the DTO layer", () => {
  it("no lapsed/sunset/pending-status record's DTO qualifier claims current terms", () => {
    for (const program of programs) {
      if (
        program.status === "lapsed" ||
        program.status === "sunset" ||
        program.status === "pending"
      ) {
        const view = toPublicProgramView(program, "2026-08-13");
        expect(
          view.benefit.qualifier,
          `${program.id} qualifier should not claim current terms`
        ).not.toContain("Current published terms");
      }
    }
  });
});

describe("public artifact regen + diff (CI check, in-process)", () => {
  it("public/data/programs-public.json matches a fresh regeneration from data/programs-internal.json", () => {
    const rawInternal = readFileSync(
      join(process.cwd(), "data", "programs-internal.json"),
      "utf8"
    );
    const catalogRevision = catalogRevisionFromRaw(rawInternal);
    const regenerated = buildPublicProgramsEnvelope(programs, catalogRevision, "irrelevant-for-diff");

    expect(publicArtifact.catalogRevision).toBe(regenerated.catalogRevision);
    expect(publicArtifact.schemaVersion).toBe(regenerated.schemaVersion);
    expect(publicArtifact.programs).toEqual(regenerated.programs);
  });

  it("MUTATION TEST: a mutated catalog fact fails the regen-diff check", () => {
    const mutated = programs.map((p) =>
      p.id === "catalystGrant" ? { ...p, benefitRange: "Up to $999,999" } : p
    );
    const catalogRevision = catalogRevisionFromRaw("mutated-fixture-does-not-match-committed-hash");
    const regenerated = buildPublicProgramsEnvelope(mutated, catalogRevision, "irrelevant");

    // catalogRevision alone already diverges (different raw bytes hashed),
    // and the programs array diverges too — both are exactly what the
    // --check script and the test above assert are equal in the clean case.
    expect(regenerated.catalogRevision).not.toBe(publicArtifact.catalogRevision);
    expect(regenerated.programs).not.toEqual(publicArtifact.programs);
  });

  it("committed artifact has schemaVersion 1 and 71 programs", () => {
    expect(publicArtifact.schemaVersion).toBe(1);
    expect(publicArtifact.programs).toHaveLength(71);
  });
});

describe("data/programs-internal.json vs public/data/programs.json (PR1 duplication window)", () => {
  it("are byte-identical — PR1 keeps the legacy public copy in place unmodified; PR2 deletes it", () => {
    const internalRaw = readFileSync(
      join(process.cwd(), "data", "programs-internal.json"),
      "utf8"
    );
    const legacyPublicRaw = readFileSync(
      join(process.cwd(), "public", "data", "programs.json"),
      "utf8"
    );
    expect(legacyPublicRaw).toBe(internalRaw);
  });
});
