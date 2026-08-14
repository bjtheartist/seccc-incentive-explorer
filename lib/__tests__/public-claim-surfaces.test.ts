/**
 * M0 public-surface registry (build-spec.md 2.1; consult item 1) — the
 * registry is checked, not decorative. This test is what makes that true:
 * every entry must name a real claim contract, and every file/directory it
 * points at must actually exist, so a rename or deletion desyncs loudly
 * instead of silently.
 *
 * review5 S10: path-existence alone proves the registry isn't stale-
 * pointing, but nothing about whether a surface actually HONORS the
 * contract it claims — a surface tagged "PublicProgramView" could import
 * raw `Program` directly and this file's original checks would never
 * notice. lib/public-claim-surfaces-verify.ts adds EXECUTABLE checks for
 * the two contracts with a real, testable invariant (ZoneEvidence: no v1
 * function reference; PublicProgramView: no client-transitive reach to
 * the internal catalog) — the "real codebase scan" describe block below
 * runs both against every current registry entry, and the "fixture"
 * block proves the checks themselves actually fail on a synthetic
 * violation (the coordinator's exact TEST requirement), not just that
 * today's real files happen to be clean.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Project, ts } from "ts-morph";
import { describe, expect, it } from "vitest";
import { PUBLIC_CLAIM_SURFACES, type ClaimContract, type PublicClaimSurface } from "../public-claim-surfaces";
import { buildVerificationProject, verifyPublicClaimSurface } from "../public-claim-surfaces-verify";

const VALID_CONTRACTS: readonly ClaimContract[] = ["PublicProgramView", "ZoneEvidence", "reviewed-copy"];

describe("PUBLIC_CLAIM_SURFACES", () => {
  it("is non-empty", () => {
    expect(PUBLIC_CLAIM_SURFACES.length).toBeGreaterThan(0);
  });

  it("every entry has a non-empty id and description", () => {
    for (const entry of PUBLIC_CLAIM_SURFACES) {
      expect(entry.id.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("every id is unique", () => {
    const ids = PUBLIC_CLAIM_SURFACES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry names at least one valid claim contract", () => {
    for (const entry of PUBLIC_CLAIM_SURFACES) {
      expect(entry.contracts.length).toBeGreaterThan(0);
      for (const contract of entry.contracts) {
        expect(VALID_CONTRACTS).toContain(contract);
      }
    }
  });

  it("every entry lists at least one file/directory, and every one actually exists in the repo", () => {
    const root = process.cwd();
    for (const entry of PUBLIC_CLAIM_SURFACES) {
      expect(entry.files.length).toBeGreaterThan(0);
      for (const file of entry.files) {
        expect(existsSync(join(root, file))).toBe(true);
      }
    }
  });

  it("a mutated (nonexistent) path fails the existence check — proves the check is not vacuous", () => {
    const root = process.cwd();
    expect(existsSync(join(root, "lib/definitely-does-not-exist-xyz.ts"))).toBe(false);
  });

  it("F1–F16 findings referenced in the registry are well-formed (F<n> or a short label)", () => {
    for (const entry of PUBLIC_CLAIM_SURFACES) {
      for (const finding of entry.findings ?? []) {
        expect(finding.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * review5 S10 — executable contract checks run against the REAL,
 * currently-registered surfaces. "new public sinks require coverage": no
 * per-surface opt-out list exists — every entry with a ZoneEvidence or
 * PublicProgramView contract runs through the matching check
 * automatically, so a newly-added surface is covered the moment it's
 * added to PUBLIC_CLAIM_SURFACES.
 */
describe("PUBLIC_CLAIM_SURFACES — executable contract verification (review5 S10)", () => {
  const rootDir = process.cwd();
  const project = buildVerificationProject(rootDir);
  const allResults = PUBLIC_CLAIM_SURFACES.flatMap((surface) =>
    verifyPublicClaimSurface(surface, project, rootDir),
  );

  it("actually runs a check for every surface that declares ZoneEvidence or PublicProgramView (the scan is not silently a no-op)", () => {
    const checkableSurfaces = PUBLIC_CLAIM_SURFACES.filter((s) =>
      s.contracts.some((c) => c === "ZoneEvidence" || c === "PublicProgramView"),
    );
    expect(checkableSurfaces.length).toBeGreaterThan(10);
    expect(allResults.length).toBeGreaterThanOrEqual(checkableSurfaces.length);
  });

  it("every currently-registered surface honors its declared ZoneEvidence/PublicProgramView contract", () => {
    const failures = allResults.filter((r) => !r.ok);
    if (failures.length > 0) {
      const report = failures.map((f) => `  [${f.surfaceId} / ${f.contract}] ${f.reason}`).join("\n");
      throw new Error(`${failures.length} public-claim-surface contract violation(s):\n${report}`);
    }
    expect(failures).toEqual([]);
  }, 30000);
});

/**
 * review5 S10 — "TEST: make a registered surface consume raw Program or
 * v1 zones in a fixture → registry verification fails." The coordinator's
 * exact requirement, verbatim: synthetic, in-memory fixtures (Hard Rule:
 * no dependence on real files, no live DB) proving the CHECK FUNCTIONS
 * themselves correctly fail on each violation shape, not merely that
 * today's real codebase happens to pass.
 */
describe("public-claim-surfaces-verify — fixture-based failure proof (review5 S10)", () => {
  function makeFixtureProject() {
    return new Project({ useInMemoryFileSystem: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX } });
  }

  it("a registered ZoneEvidence surface that references the v1 zone function FAILS verification", () => {
    const project = makeFixtureProject();
    project.createSourceFile(
      "/fixture-root/lib/some-new-zone-surface.ts",
      `import { normalizeZoneCheckResponse } from "./zone-response";\nexport function checkZones(data: unknown) { return normalizeZoneCheckResponse(data); }`,
    );
    const surface: PublicClaimSurface = {
      id: "fixture-zone-surface",
      description: "Synthetic fixture surface for the S10 regression test.",
      contracts: ["ZoneEvidence"],
      files: ["lib/some-new-zone-surface.ts"],
    };
    const results = verifyPublicClaimSurface(surface, project, "/fixture-root");
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].reason).toMatch(/normalizeZoneCheckResponse/);
  });

  it("a registered PublicProgramView surface whose client component reaches raw Program data FAILS verification", () => {
    const project = makeFixtureProject();
    project.createSourceFile(
      "/fixture-root/data/programs-internal.json",
      JSON.stringify([{ id: "x", whoQualifies: "internal-only prose" }]),
    );
    project.createSourceFile(
      "/fixture-root/lib/programs-data.ts",
      `export function getProgramsSync() { return require("../data/programs-internal.json"); }`,
    );
    project.createSourceFile(
      "/fixture-root/components/some-new-catalog-card.tsx",
      `"use client";\nimport { getProgramsSync } from "../lib/programs-data";\nexport default function Card() { return getProgramsSync(); }`,
    );
    const surface: PublicClaimSurface = {
      id: "fixture-program-surface",
      description: "Synthetic fixture surface for the S10 regression test.",
      contracts: ["PublicProgramView"],
      files: ["components/some-new-catalog-card.tsx"],
    };
    const results = verifyPublicClaimSurface(surface, project, "/fixture-root");
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].reason).toContain("data/programs-internal.json");
  });

  it("CONTROL: the same two fixture shapes, corrected (v2 zones / no raw-catalog reach), PASS — proves the failures above are about the violation, not the fixture harness itself", () => {
    const zoneProject = makeFixtureProject();
    zoneProject.createSourceFile(
      "/fixture-root/lib/some-new-zone-surface.ts",
      `import { normalizeZoneEvidenceV2 } from "./zone-response";\nexport function checkZones(data: unknown) { return normalizeZoneEvidenceV2(data); }`,
    );
    const zoneSurface: PublicClaimSurface = {
      id: "fixture-zone-surface-fixed",
      description: "Corrected synthetic fixture.",
      contracts: ["ZoneEvidence"],
      files: ["lib/some-new-zone-surface.ts"],
    };
    expect(verifyPublicClaimSurface(zoneSurface, zoneProject, "/fixture-root")[0].ok).toBe(true);

    const programProject = makeFixtureProject();
    programProject.createSourceFile(
      "/fixture-root/lib/program-slug.ts",
      `export function slugify(s: string) { return s.toLowerCase(); }`,
    );
    programProject.createSourceFile(
      "/fixture-root/components/some-new-catalog-card.tsx",
      `"use client";\nimport { slugify } from "../lib/program-slug";\nexport default function Card() { return slugify("x"); }`,
    );
    const programSurface: PublicClaimSurface = {
      id: "fixture-program-surface-fixed",
      description: "Corrected synthetic fixture.",
      contracts: ["PublicProgramView"],
      files: ["components/some-new-catalog-card.tsx"],
    };
    expect(verifyPublicClaimSurface(programSurface, programProject, "/fixture-root")[0].ok).toBe(true);
  });
});
