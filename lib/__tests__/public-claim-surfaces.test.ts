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
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Project, ts } from "ts-morph";
import { describe, expect, it } from "vitest";
import { PUBLIC_CLAIM_SURFACES, type ClaimContract, type PublicClaimSurface } from "../public-claim-surfaces";
import {
  buildVerificationProject,
  verifyPublicClaimSurface,
  runRepoWideProhibitedSourceChecks,
  verifyNoRawProgramClientCast,
  verifyNoRawProgramRouteResponse,
  verifyNoV1ZoneUsage,
  findUnregisteredPublicSinks,
  PUBLIC_CLAIM_SURFACES_KNOWN_GAPS,
} from "../public-claim-surfaces-verify";

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

/**
 * review6 S16 (MEDIUM) — "add repo-wide prohibited-source checks
 * INDEPENDENT of registry membership ... raw Program imports/casts/
 * fetch-responses anywhere public, v1 zone endpoints/hand-rolled v1
 * shapes; PLUS discovery — every public sink must have a registry
 * entry." Everything in this describe block runs against the REAL
 * codebase, not the registry — the exact gap S11's deleted
 * /api/programs/engine-source route fell through (it was never a
 * PUBLIC_CLAIM_SURFACES entry, so every check above this point would
 * have stayed silent about it forever).
 */
describe("public-claim-surfaces-verify — repo-wide checks against the REAL codebase (review6 S16)", () => {
  const rootDir = process.cwd();
  const project = buildVerificationProject(rootDir);

  it("zero raw-Program/v1-zone violations across the whole app/components/lib tree — not just registered surfaces", () => {
    const violations = runRepoWideProhibitedSourceChecks(project, rootDir);
    if (violations.length > 0) {
      const report = violations.map((v) => `  [${v.check}] ${v.filePath}: ${v.reason}`).join("\n");
      throw new Error(`${violations.length} repo-wide prohibited-source violation(s):\n${report}`);
    }
    expect(violations).toEqual([]);
  }, 30000);

  function walkAppFiles(dir: string, base: string, out: string[]): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "__tests__" || entry.name.includes(".test.")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkAppFiles(full, base, out);
      } else if (entry.name === "page.tsx" || entry.name === "route.ts") {
        out.push(full.slice(base.length + 1));
      }
    }
  }

  it("every real page.tsx/route.ts is either registered or a documented PUBLIC_CLAIM_SURFACES_KNOWN_GAPS entry — no SILENT third option", () => {
    const files: string[] = [];
    walkAppFiles(join(rootDir, "app"), rootDir, files);
    expect(files.length).toBeGreaterThan(50);

    const violations = findUnregisteredPublicSinks(files, PUBLIC_CLAIM_SURFACES);
    if (violations.length > 0) {
      const report = violations.map((v) => `  ${v.filePath}`).join("\n");
      throw new Error(
        `${violations.length} public sink(s) neither registered nor in the known-gaps baseline:\n${report}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it("the three review6 S11 routes created this session are genuinely REGISTERED (not merely absent from the known-gaps list)", () => {
    const registeredFiles = new Set(PUBLIC_CLAIM_SURFACES.flatMap((s) => s.files));
    for (const route of [
      "app/api/programs/match/route.ts",
      "app/api/report/generate/route.ts",
      "app/api/survey/score/route.ts",
    ]) {
      expect(registeredFiles.has(route), route).toBe(true);
      expect(PUBLIC_CLAIM_SURFACES_KNOWN_GAPS, route).not.toContain(route);
    }
  });

  it("the known-gaps baseline and the registry never claim the SAME path (no ambiguous double-coverage)", () => {
    const registeredFiles = new Set(PUBLIC_CLAIM_SURFACES.flatMap((s) => s.files));
    const overlap = PUBLIC_CLAIM_SURFACES_KNOWN_GAPS.filter((g) => registeredFiles.has(g));
    expect(overlap).toEqual([]);
  });
});

/**
 * review6 S16 — the coordinator's TEST requirement verbatim: "fixtures
 * that fail for a registered client fetching raw Program[], a public
 * server route returning raw programs, a v1 endpoint/manual
 * normalization, and a new unregistered page/route." Synthetic,
 * in-memory fixtures (Hard Rule: no dependence on real files/DB) proving
 * each CHECK FUNCTION itself correctly fails on the named violation
 * shape — plus a corrected control for each, proving the failure is
 * about the violation and not the fixture harness.
 */
describe("public-claim-surfaces-verify — S16 fixture-based failure proof", () => {
  function makeFixtureProject() {
    return new Project({ useInMemoryFileSystem: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX } });
  }

  it("TEST 1: a registered client fetching raw Program[] FAILS — casts a fetch response to the raw internal type", () => {
    const project = makeFixtureProject();
    project.createSourceFile(
      "/fixture-root/components/some-new-widget.tsx",
      [
        `"use client";`,
        `import type { Program } from "../lib/types";`,
        `export async function loadPrograms() {`,
        `  const res = await fetch("/api/some-new-endpoint");`,
        `  return (await res.json()) as Program[];`,
        `}`,
      ].join("\n"),
    );
    const violations = verifyNoRawProgramClientCast(project, "/fixture-root");
    expect(violations).toHaveLength(1);
    expect(violations[0].check).toBe("no-raw-program-client-cast");
    expect(violations[0].filePath).toBe("components/some-new-widget.tsx");
    expect(violations[0].reason).toContain("Program");
  });

  it("CONTROL 1: the same client component using an already-narrow DTO cast PASSES", () => {
    const project = makeFixtureProject();
    project.createSourceFile(
      "/fixture-root/components/some-new-widget.tsx",
      [
        `"use client";`,
        `import type { SafeMapProgramMatch } from "../lib/types";`,
        `export async function loadPrograms() {`,
        `  const res = await fetch("/api/programs/match", { method: "POST" });`,
        `  return (await res.json()) as { programs: SafeMapProgramMatch[] };`,
        `}`,
      ].join("\n"),
    );
    expect(verifyNoRawProgramClientCast(project, "/fixture-root")).toEqual([]);
  });

  it("TEST 2: a public server route returning raw programs FAILS — the exact deleted /api/programs/engine-source shape", () => {
    const project = makeFixtureProject();
    project.createSourceFile(
      "/fixture-root/app/api/some-new-route/route.ts",
      [
        `import { NextResponse } from "next/server";`,
        `import { getProgramsSync } from "../../../lib/programs-data";`,
        `export async function GET() {`,
        `  return NextResponse.json(getProgramsSync());`,
        `}`,
      ].join("\n"),
    );
    const violations = verifyNoRawProgramRouteResponse(project, "/fixture-root");
    expect(violations).toHaveLength(1);
    expect(violations[0].check).toBe("no-raw-program-route-response");
    expect(violations[0].filePath).toBe("app/api/some-new-route/route.ts");
    expect(violations[0].reason).toContain("engine-source");
  });

  it("TEST 2b: the same shape via an intermediate variable (no inline call) still FAILS", () => {
    const project = makeFixtureProject();
    project.createSourceFile(
      "/fixture-root/app/api/some-new-route/route.ts",
      [
        `import { NextResponse } from "next/server";`,
        `import { getProgramsSync } from "../../../lib/programs-data";`,
        `export async function GET() {`,
        `  const programs = getProgramsSync();`,
        `  return NextResponse.json(programs);`,
        `}`,
      ].join("\n"),
    );
    expect(verifyNoRawProgramRouteResponse(project, "/fixture-root")).toHaveLength(1);
  });

  it("CONTROL 2: a route that MAPS getProgramsSync()'s result before responding PASSES", () => {
    const project = makeFixtureProject();
    project.createSourceFile(
      "/fixture-root/app/api/some-new-route/route.ts",
      [
        `import { NextResponse } from "next/server";`,
        `import { getProgramsSync } from "../../../lib/programs-data";`,
        `export async function GET() {`,
        `  const safe = getProgramsSync().map((p) => ({ id: p.id, name: p.name }));`,
        `  return NextResponse.json(safe);`,
        `}`,
      ].join("\n"),
    );
    expect(verifyNoRawProgramRouteResponse(project, "/fixture-root")).toEqual([]);
  });

  it("CONTROL 2b: a route using getProgramsSync() ONLY for its own internal computation, never in the response, PASSES", () => {
    const project = makeFixtureProject();
    project.createSourceFile(
      "/fixture-root/app/api/some-new-route/route.ts",
      [
        `import { NextResponse } from "next/server";`,
        `import { getProgramsSync } from "../../../lib/programs-data";`,
        `export async function GET() {`,
        `  const count = getProgramsSync().length;`,
        `  return NextResponse.json({ count });`,
        `}`,
      ].join("\n"),
    );
    expect(verifyNoRawProgramRouteResponse(project, "/fixture-root")).toEqual([]);
  });

  it("TEST 3: a v1 endpoint/manual normalization FAILS — both the v1 function identifier and a hand-rolled fetch to the v1 HTTP endpoint", () => {
    const project = makeFixtureProject();
    project.createSourceFile(
      "/fixture-root/lib/some-new-zone-helper.ts",
      [
        `import { normalizeZoneCheckResponse } from "./zone-response";`,
        `export async function checkZones(lat: number, lon: number) {`,
        `  const res = await fetch(\`/api/zones/check?lat=\${lat}&lon=\${lon}\`);`,
        `  return normalizeZoneCheckResponse(await res.json());`,
        `}`,
      ].join("\n"),
    );
    const violations = verifyNoV1ZoneUsage(project, "/fixture-root");
    // Both the identifier reference AND the v1 endpoint string literal
    // are independently flagged — a hand-rolled v1 caller doesn't get a
    // pass just because one half of the shape is fixed.
    expect(violations.length).toBeGreaterThanOrEqual(2);
    expect(violations.some((v) => v.reason.includes("normalizeZoneCheckResponse"))).toBe(true);
    expect(violations.some((v) => v.reason.includes("/api/zones/check"))).toBe(true);
  });

  it("CONTROL 3: the same helper migrated to v2 (function AND endpoint) PASSES", () => {
    const project = makeFixtureProject();
    project.createSourceFile(
      "/fixture-root/lib/some-new-zone-helper.ts",
      [
        `import { normalizeZoneEvidenceV2 } from "./zone-response";`,
        `export async function checkZones(lat: number, lon: number) {`,
        `  const res = await fetch(\`/api/zones/check/v2?lat=\${lat}&lon=\${lon}\`);`,
        `  return normalizeZoneEvidenceV2(await res.json());`,
        `}`,
      ].join("\n"),
    );
    expect(verifyNoV1ZoneUsage(project, "/fixture-root")).toEqual([]);
  });

  it("CONTROL 3b: the v1 function's own DEFINING module is not flagged for its own declaration (only a USAGE counts)", () => {
    const project = makeFixtureProject();
    project.createSourceFile(
      "/fixture-root/lib/zone-response.ts",
      [
        `export function normalizeZoneCheckResponse(data: unknown) {`,
        `  return data;`,
        `}`,
      ].join("\n"),
    );
    expect(verifyNoV1ZoneUsage(project, "/fixture-root")).toEqual([]);
  });

  it("TEST 4: a new unregistered page/route FAILS discovery", () => {
    const violations = findUnregisteredPublicSinks(
      ["app/some-brand-new-feature/page.tsx"],
      PUBLIC_CLAIM_SURFACES,
      [], // empty known-gaps baseline — proves the check itself, independent of today's real-repo baseline
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].filePath).toBe("app/some-brand-new-feature/page.tsx");
  });

  it("CONTROL 4a: a page covered by an EXACT registered file PASSES", () => {
    const surfaces: PublicClaimSurface[] = [
      { id: "x", description: "x", contracts: ["reviewed-copy"], files: ["app/faq/page.tsx"] },
    ];
    expect(findUnregisteredPublicSinks(["app/faq/page.tsx"], surfaces, [])).toEqual([]);
  });

  it("CONTROL 4b: a route covered by a registered DIRECTORY PASSES", () => {
    const surfaces: PublicClaimSurface[] = [
      { id: "x", description: "x", contracts: ["reviewed-copy"], files: ["app/api/shortlist"] },
    ];
    expect(
      findUnregisteredPublicSinks(["app/api/shortlist/route.ts"], surfaces, []),
    ).toEqual([]);
  });

  it("CONTROL 4c: a page in the documented known-gaps baseline PASSES (a reviewed, tracked pass-through — not silent)", () => {
    expect(
      findUnregisteredPublicSinks(["app/some-known-gap/page.tsx"], [], ["app/some-known-gap/page.tsx"]),
    ).toEqual([]);
  });
});
