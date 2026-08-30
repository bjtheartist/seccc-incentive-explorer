/**
 * review5 S1 (CRITICAL) — "NO client path bundles programs-internal.json
 * ... a guard test failing on any client-transitive import of
 * programs-internal.json."
 *
 * The earlier PR2 pass claimed a "hard cutover" to PublicProgramView but
 * left THREE real leaks: ProgramsCatalog.tsx statically imported
 * data/programs-internal.json directly; lib/program-fact.ts did the same;
 * lib/survey-engine.ts did the same. All three are fixed now (DTO-only
 * imports, or a runtime fetch of a sanitized route). This test is what
 * makes that a standing guarantee instead of a one-time fix: it walks the
 * REAL bundler-visible import graph — using ts-morph with the project's own
 * tsconfig so `@/...` aliases resolve exactly like the Next.js bundler
 * resolves them — starting from every file with a `"use client"`
 * directive, and fails if data/programs-internal.json is reachable from
 * any of them, at any depth, through a static import/export, literal
 * `import(...)`, or literal-path `require(...)` call (Next's webpack
 * bundler traces all three; this is
 * exactly how lib/programs-data.ts's getProgramsSync() could have been
 * pulled into ProgramsCatalog.tsx's bundle through a shared module before
 * slugifyProgramName() was split into lib/program-slug.ts, which has zero
 * import of the internal catalog).
 *
 * Synthetic self-tests prove the walker itself actually catches direct,
 * transitive, aliased, and lazy violations before trusting its real-project
 * result — an always-green scanner is worse than no scanner.
 */
import { Project, ts } from "ts-morph";
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  buildRealProject,
  findPathToFile,
  findPathToMatchingSpecifier,
  findRealClientRoots,
  hasUseClientDirective,
} from "@/lib/source-guard/client-bundle-import-graph";

const INTERNAL_CATALOG_PATH = resolve(process.cwd(), "data/programs-internal.json");
// GitHub's shared runner is materially slower than a developer machine for
// ts-morph's repeated whole-project graph walks. Keep the integrity assertions
// unchanged while giving each real-codebase scan enough time to finish.
const REAL_CODEBASE_SCAN_TIMEOUT_MS = 180_000;

function buildFixtureProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      baseUrl: "/",
      paths: { "@/*": ["*"] },
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      resolveJsonModule: true,
    },
  });
}

describe("client-transitive import guard — synthetic self-test (proves the walker works)", () => {
  it("catches a DIRECT require() of the internal catalog from a 'use client' file", () => {
    const project = buildFixtureProject();
    const catalog = project.createSourceFile("/data/programs-internal.json", JSON.stringify([{ id: "x" }]));
    const clientFile = project.createSourceFile(
      "/components/Bad.tsx",
      `"use client";\nconst data = require("../data/programs-internal.json");\nexport default data;`,
    );
    expect(hasUseClientDirective(clientFile)).toBe(true);
    expect(findPathToFile(clientFile, catalog.getFilePath())).toEqual([
      "/components/Bad.tsx",
      "/data/programs-internal.json",
    ]);
  });

  it("loads and catches a require-only aliased JSON target that was not already a Project SourceFile", () => {
    const project = buildFixtureProject();
    const catalogPath = "/data/programs-internal.json";
    project.getFileSystem().writeFileSync(catalogPath, JSON.stringify([{ id: "x" }]));
    const clientFile = project.createSourceFile(
      "/components/RequireAliasLeak.tsx",
      `"use client";\nconst catalog = require("@/data/programs-internal.json");\nexport default catalog;`,
    );

    expect(project.getSourceFile(catalogPath)).toBeUndefined();
    expect(findPathToFile(clientFile, catalogPath)).toEqual([
      "/components/RequireAliasLeak.tsx",
      catalogPath,
    ]);
  });

  it("catches a TRANSITIVE require() reached through an intermediate module — the exact shape of the real bug this guard fixed", () => {
    const project = buildFixtureProject();
    const catalog = project.createSourceFile("/data/programs-internal.json", JSON.stringify([{ id: "x" }]));
    project.createSourceFile(
      "/lib/programs-data.ts",
      `export function slugify(s: string) { return s; }\nexport function getAll() { return require("../data/programs-internal.json"); }`,
    );
    const clientFile = project.createSourceFile(
      "/components/Bad.tsx",
      `"use client";\nimport { slugify } from "../lib/programs-data";\nexport default slugify;`,
    );
    const chain = findPathToFile(clientFile, catalog.getFilePath());
    expect(chain).not.toBeNull();
    expect(chain![chain!.length - 1]).toContain("programs-internal.json");
  });

  it("catches a static aliased import whose resolved SourceFile IS the catalog", () => {
    const project = buildFixtureProject();
    const catalog = project.createSourceFile("/data/programs-internal.json", JSON.stringify([{ id: "x" }]));
    const clientFile = project.createSourceFile(
      "/components/AliasLeak.tsx",
      `"use client";\nimport catalog from "@/data/programs-internal.json";\nexport default catalog;`,
    );
    expect(findPathToFile(clientFile, catalog.getFilePath())).toEqual([
      "/components/AliasLeak.tsx",
      "/data/programs-internal.json",
    ]);
  });

  it("catches a direct literal dynamic import of the catalog", () => {
    const project = buildFixtureProject();
    const catalog = project.createSourceFile("/data/programs-internal.json", JSON.stringify([{ id: "x" }]));
    const clientFile = project.createSourceFile(
      "/components/DynamicLeak.tsx",
      `"use client";\nexport async function load() { return import("@/data/programs-internal.json"); }`,
    );
    expect(findPathToFile(clientFile, catalog.getFilePath())).not.toBeNull();
  });

  it("catches a dynamic import of an intermediate module that reaches the catalog", () => {
    const project = buildFixtureProject();
    const catalog = project.createSourceFile("/data/programs-internal.json", JSON.stringify([{ id: "x" }]));
    project.createSourceFile(
      "/lib/catalog-loader.ts",
      `import catalog from "@/data/programs-internal.json";\nexport default catalog;`,
    );
    const clientFile = project.createSourceFile(
      "/components/DynamicTransitiveLeak.tsx",
      `"use client";\nexport async function load() { return import("../lib/catalog-loader"); }`,
    );
    const chain = findPathToFile(clientFile, catalog.getFilePath());
    expect(chain).toEqual([
      "/components/DynamicTransitiveLeak.tsx",
      "/lib/catalog-loader.ts",
      "/data/programs-internal.json",
    ]);
  });

  it("does NOT flag a client file that only reaches a data-free module (lib/program-slug.ts's real shape)", () => {
    const project = buildFixtureProject();
    const catalog = project.createSourceFile("/data/programs-internal.json", JSON.stringify([{ id: "x" }]));
    project.createSourceFile(
      "/lib/program-slug.ts",
      `export function slugify(s: string) { return s.toLowerCase(); }`,
    );
    const clientFile = project.createSourceFile(
      "/components/Good.tsx",
      `"use client";\nimport { slugify } from "../lib/program-slug";\nexport default slugify;`,
    );
    const chain = findPathToFile(clientFile, catalog.getFilePath());
    expect(chain).toBeNull();
  });

  it("does NOT flag a `import type` of a server-only module's exported type — TS erases it, it never reaches the bundle (the real OutreachLog.tsx/owner-file-letter-context.ts shape)", () => {
    const project = buildFixtureProject();
    const catalog = project.createSourceFile("/data/programs-internal.json", JSON.stringify([{ id: "x" }]));
    project.createSourceFile(
      "/lib/server-only.ts",
      `import { getProgramsSync } from "./programs-data";\nexport interface Ctx { id: string }\nexport function resolve() { return getProgramsSync(); }`,
    );
    project.createSourceFile(
      "/lib/programs-data.ts",
      `export function getProgramsSync() { return require("../data/programs-internal.json"); }`,
    );
    const clientFile = project.createSourceFile(
      "/components/Good.tsx",
      `"use client";\nimport type { Ctx } from "../lib/server-only";\nexport function C(props: Ctx) { return props.id; }`,
    );
    const chain = findPathToFile(clientFile, catalog.getFilePath());
    expect(chain).toBeNull();
  });

  it("does NOT flag an inline type-only import specifier", () => {
    const project = buildFixtureProject();
    const catalog = project.createSourceFile("/data/programs-internal.json", JSON.stringify([{ id: "x" }]));
    project.createSourceFile(
      "/lib/server-only.ts",
      `export interface Ctx { id: string }\nexport const catalog = require("../data/programs-internal.json");`,
    );
    const clientFile = project.createSourceFile(
      "/components/InlineTypeOnly.tsx",
      `"use client";\nimport { type Ctx } from "../lib/server-only";\nexport function C(props: Ctx) { return props.id; }`,
    );
    expect(findPathToFile(clientFile, catalog.getFilePath())).toBeNull();
  });

  it("STILL flags a real VALUE import even when a type-only import sits alongside it in the same file (proves the exclusion is scoped to type-only, not a blanket skip)", () => {
    const project = buildFixtureProject();
    const catalog = project.createSourceFile("/data/programs-internal.json", JSON.stringify([{ id: "x" }]));
    project.createSourceFile(
      "/lib/server-only.ts",
      `export interface Ctx { id: string }\nexport function resolve() { return require("../data/programs-internal.json"); }`,
    );
    const clientFile = project.createSourceFile(
      "/components/Mixed.tsx",
      `"use client";\nimport type { Ctx } from "../lib/server-only";\nimport { resolve } from "../lib/server-only";\nexport function C(props: Ctx) { return resolve(); }`,
    );
    const chain = findPathToFile(clientFile, catalog.getFilePath());
    expect(chain).not.toBeNull();
  });

  it("STILL flags the value edge in one mixed inline type/value import declaration", () => {
    const project = buildFixtureProject();
    const catalog = project.createSourceFile("/data/programs-internal.json", JSON.stringify([{ id: "x" }]));
    project.createSourceFile(
      "/lib/server-only.ts",
      `export interface Ctx { id: string }\nexport function resolve() { return require("../data/programs-internal.json"); }`,
    );
    const clientFile = project.createSourceFile(
      "/components/InlineMixed.tsx",
      `"use client";\nimport { type Ctx, resolve } from "../lib/server-only";\nexport function C(props: Ctx) { return props.id + resolve(); }`,
    );
    expect(findPathToFile(clientFile, catalog.getFilePath())).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Gate round 2, MAJOR 24 — this session already hit and fixed one real
// instance of the regression class this guard exists for: lib/report-
// engine.ts statically imported lib/investment-analysis.ts (which pulls
// in node:fs), and because report-engine.ts is bundled into 'use client'
// app/report/page.tsx, the production webpack client build broke. The
// fix (buildCorridorInvestmentContext made pure, fed via
// ReportContext.capitalContext, with the real fs-backed loader moved
// into the server-only app/api/report/generate/route.ts) was correct,
// but nothing stopped a FUTURE static import from reintroducing the same
// class of break — that class was only ever caught by a slow CI webpack
// build, not by this fast vitest guard. Parameterizing the existing BFS
// (same shared edge-walk as the internal-catalog guard above) over two more
// targets — the specific file that broke the build,
// and the general "any node:fs import at all" shape — makes it fail
// locally in vitest instead.
// ═══════════════════════════════════════════════════════════════════════

describe("client-transitive import guard — extended targets synthetic self-test (gate round 2, MAJOR 24)", () => {
  it("catches a client file that transitively reaches a specific named target file", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/lib/investment-analysis.ts", `export function x() { return 1; }`);
    project.createSourceFile(
      "/lib/report-engine.ts",
      `export { x } from "./investment-analysis";`,
    );
    const clientFile = project.createSourceFile(
      "/app/report/page.tsx",
      `"use client";\nimport { x } from "../../lib/report-engine";\nexport default x;`,
    );
    const chain = findPathToFile(clientFile, "/lib/investment-analysis.ts");
    expect(chain).not.toBeNull();
    expect(chain![chain!.length - 1]).toBe("/lib/investment-analysis.ts");
  });

  it("does NOT flag a client file whose import graph never reaches the named target", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/lib/investment-analysis.ts", `export function x() { return 1; }`);
    project.createSourceFile("/lib/pure.ts", `export function y() { return 2; }`);
    const clientFile = project.createSourceFile(
      "/components/Good.tsx",
      `"use client";\nimport { y } from "../lib/pure";\nexport default y;`,
    );
    expect(findPathToFile(clientFile, "/lib/investment-analysis.ts")).toBeNull();
  });

  it("catches a client file that transitively imports a bare node:fs module", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/lib/investment-analysis.ts",
      `import { readFileSync } from "node:fs";\nexport function load() { return readFileSync("x"); }`,
    );
    const clientFile = project.createSourceFile(
      "/app/report/page.tsx",
      `"use client";\nimport { load } from "../../lib/investment-analysis";\nexport default load;`,
    );
    const chain = findPathToMatchingSpecifier(
      clientFile,
      (specifier) => specifier === "fs" || specifier === "node:fs",
    );
    expect(chain).not.toBeNull();
  });

  it("does NOT flag a client file with no node:fs in its reachable graph", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/lib/pure.ts", `export function y() { return 2; }`);
    const clientFile = project.createSourceFile(
      "/components/Good.tsx",
      `"use client";\nimport { y } from "../lib/pure";\nexport default y;`,
    );
    expect(
      findPathToMatchingSpecifier(
        clientFile,
        (specifier) => specifier === "fs" || specifier === "node:fs",
      ),
    ).toBeNull();
  });
});

describe("client-transitive import guard — real codebase scan", () => {
  const project = buildRealProject();
  const clientRoots = findRealClientRoots(project);

  it("finds a non-trivial number of 'use client' roots (the scan is not silently a no-op)", () => {
    expect(clientRoots.length).toBeGreaterThan(20);
  });

  it("data/programs-internal.json is NOT reachable from any 'use client' file, directly or transitively", () => {
    const offenders: { root: string; chain: string[] }[] = [];
    for (const root of clientRoots) {
      const chain = findPathToFile(root, INTERNAL_CATALOG_PATH);
      if (chain) offenders.push({ root: root.getFilePath(), chain });
    }
    // Note: ~126 independent whole-graph BFS walks over a real Next.js
    // project is inherently slower than a typical unit test; this is a
    // correctness gate run in CI, not a hot-path test. See the extended
    // timeout on this `it(...)` below.
    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  ${o.root}\n    -> ${o.chain.join("\n    -> ")}`)
        .join("\n");
      throw new Error(
        `${offenders.length} client component(s) can reach data/programs-internal.json through the bundler-visible import graph:\n${report}\n` +
          `Fix: route through the sanitized PublicProgramView (public/data/programs-public.json or /api/programs), ` +
          `or split the needed pure logic into a module with zero catalog dependency (see lib/program-slug.ts).`,
      );
    }
    expect(offenders.length).toBe(0);
  }, REAL_CODEBASE_SCAN_TIMEOUT_MS);

  it("lib/investment-analysis.ts is NOT reachable from any 'use client' file, directly or transitively (gate round 2, MAJOR 24 — the exact file whose static import broke the production webpack client build earlier this session)", () => {
    const targetPath = resolve(process.cwd(), "lib/investment-analysis.ts");
    const offenders: { root: string; chain: string[] }[] = [];
    for (const root of clientRoots) {
      const chain = findPathToFile(root, targetPath);
      if (chain) offenders.push({ root: root.getFilePath(), chain });
    }
    if (offenders.length > 0) {
      const report = offenders.map((o) => `  ${o.root}\n    -> ${o.chain.join("\n    -> ")}`).join("\n");
      throw new Error(
        `${offenders.length} client component(s) can reach lib/investment-analysis.ts through a bundler-visible edge:\n${report}\n` +
          `Fix: feed the needed data through ReportContext.capitalContext (see buildCorridorInvestmentContext) ` +
          `instead of a static import — the real fs-backed loader belongs only in a server-only Route Handler.`,
      );
    }
    expect(offenders.length).toBe(0);
  }, REAL_CODEBASE_SCAN_TIMEOUT_MS);

  it("no node:fs (or bare 'fs') import is reachable from any 'use client' file, directly or transitively (gate round 2, MAJOR 24)", () => {
    const offenders: { root: string; chain: string[] }[] = [];
    for (const root of clientRoots) {
      const chain = findPathToMatchingSpecifier(
        root,
        (specifier) => ["fs", "node:fs", "fs/promises", "node:fs/promises"].includes(specifier),
      );
      if (chain) offenders.push({ root: root.getFilePath(), chain });
    }
    if (offenders.length > 0) {
      const report = offenders.map((o) => `  ${o.root}\n    -> ${o.chain.join("\n    -> ")}`).join("\n");
      throw new Error(
        `${offenders.length} client component(s) can reach a node:fs import through a bundler-visible edge:\n${report}\n` +
          `Fix: move the fs-backed logic into a server-only Route Handler or Server Component and pass the ` +
          `result down as plain data, the same fix already applied to lib/investment-analysis.ts.`,
      );
    }
    expect(offenders.length).toBe(0);
  }, REAL_CODEBASE_SCAN_TIMEOUT_MS);
});
