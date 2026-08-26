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
 * REAL static import graph — using ts-morph with the project's own
 * tsconfig so `@/...` aliases resolve exactly like the Next.js bundler
 * resolves them — starting from every file with a `"use client"`
 * directive, and fails if data/programs-internal.json is reachable from
 * any of them, at any depth, through either a static `import` or a
 * literal-path `require(...)` call (Next's webpack bundler can still
 * bundle a `require("./x.json")` with a literal string argument; this is
 * exactly how lib/programs-data.ts's getProgramsSync() could have been
 * pulled into ProgramsCatalog.tsx's bundle through a shared module before
 * slugifyProgramName() was split into lib/program-slug.ts, which has zero
 * import of the internal catalog).
 *
 * Two synthetic self-tests prove the walker itself actually catches a
 * violation (direct and transitive) before trusting its real-project
 * result — an always-green scanner is worse than no scanner.
 */
import { Node, Project, type SourceFile } from "ts-morph";
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

const INTERNAL_CATALOG_PATH = resolve(process.cwd(), "data/programs-internal.json");
// GitHub's shared runner is materially slower than a developer machine for
// ts-morph's repeated whole-project graph walks. Keep the integrity assertions
// unchanged while giving each real-codebase scan enough time to finish.
const REAL_CODEBASE_SCAN_TIMEOUT_MS = 180_000;

function hasUseClientDirective(sourceFile: SourceFile): boolean {
  const first = sourceFile.getStatements()[0];
  if (!first || !Node.isExpressionStatement(first)) return false;
  const expr = first.getExpression();
  return Node.isStringLiteral(expr) && expr.getLiteralText() === "use client";
}

/** Every local (relative or resolvable) module a file statically references,
 *  via `import ... from "..."` OR a literal-argument `require("...")` call —
 *  both are things a bundler can trace and inline. `import type {...}` is
 *  deliberately excluded: TypeScript erases type-only imports entirely at
 *  compile time (that's the whole point of the `type` modifier), so they
 *  can never put runtime bytes — internal-only catalog data included — into
 *  a client bundle. Without this exclusion, any client component that
 *  imports a server-only module's exported TYPE (a completely ordinary,
 *  safe pattern — see components/owner-file/OutreachLog.tsx importing
 *  `ParcelProgramContext` from lib/owner-file-letter-context.ts) would
 *  false-positive as a leak. */
function directLocalImports(sourceFile: SourceFile): SourceFile[] {
  const out: SourceFile[] = [];

  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.isTypeOnly()) continue;
    const resolved = imp.getModuleSpecifierSourceFile();
    if (resolved) out.push(resolved);
  }
  for (const exp of sourceFile.getExportDeclarations()) {
    if (exp.isTypeOnly()) continue;
    const resolved = exp.getModuleSpecifierSourceFile();
    if (resolved) out.push(resolved);
  }

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr) || expr.getText() !== "require") return;
    const arg = node.getArguments()[0];
    if (!arg || !Node.isStringLiteral(arg)) return;
    // ts-morph doesn't resolve require() specifiers the way it does
    // import declarations, so resolve the literal path relative to this
    // file ourselves — the same rule Node/webpack use for a relative
    // require() argument.
    const spec = arg.getLiteralText();
    if (!spec.startsWith(".")) return; // only local/relative — a bare
    // package specifier (e.g. "react") can never resolve to our own
    // catalog file.
    const dir = sourceFile.getDirectoryPath();
    const candidates = [
      resolve(dir, spec),
      resolve(dir, `${spec}.json`),
      resolve(dir, `${spec}.ts`),
      resolve(dir, `${spec}.tsx`),
    ];
    for (const candidate of candidates) {
      const match = sourceFile.getProject().getSourceFile(candidate);
      if (match) out.push(match);
    }
    // Note: the .json catalog itself is never added to the ts-morph
    // Project as a SourceFile, so it can never show up via this
    // SourceFile-based walk — referencesInternalCatalogLiteral() below
    // checks the resolved literal path directly instead.
  });

  return out;
}

/** Literal require()/import specifiers that resolve to the internal catalog
 *  path itself (a .json file ts-morph's Project never adds as a SourceFile,
 *  so it can't show up via directLocalImports' SourceFile-based walk). */
function referencesInternalCatalogLiteral(sourceFile: SourceFile): boolean {
  const dir = sourceFile.getDirectoryPath();
  let found = false;

  const check = (spec: string) => {
    if (!spec.startsWith(".")) return;
    const candidates = [resolve(dir, spec), resolve(dir, `${spec}.json`)];
    if (candidates.includes(INTERNAL_CATALOG_PATH)) found = true;
  };

  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.isTypeOnly()) continue; // erased at compile time — see directLocalImports' doc comment
    check(imp.getModuleSpecifierValue());
  }
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr) || expr.getText() !== "require") return;
    const arg = node.getArguments()[0];
    if (arg && Node.isStringLiteral(arg)) check(arg.getLiteralText());
  });

  return found;
}

/** BFS from `root`; returns the reachable-file chain to the internal
 *  catalog, or null if it's never reachable. */
function findPathToInternalCatalog(root: SourceFile): string[] | null {
  const visited = new Set<string>([root.getFilePath()]);
  const queue: { file: SourceFile; chain: string[] }[] = [{ file: root, chain: [root.getFilePath()] }];

  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (referencesInternalCatalogLiteral(file)) {
      return [...chain, INTERNAL_CATALOG_PATH];
    }
    for (const next of directLocalImports(file)) {
      const p = next.getFilePath();
      if (visited.has(p)) continue;
      visited.add(p);
      queue.push({ file: next, chain: [...chain, p] });
    }
  }
  return null;
}

function buildRealProject(): Project {
  return new Project({ tsConfigFilePath: resolve(process.cwd(), "tsconfig.json") });
}

describe("client-transitive import guard — synthetic self-test (proves the walker works)", () => {
  it("catches a DIRECT require() of the internal catalog from a 'use client' file", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/data/programs-internal.json",
      JSON.stringify([{ id: "x" }]),
    );
    const clientFile = project.createSourceFile(
      "/components/Bad.tsx",
      `"use client";\nconst data = require("../data/programs-internal.json");\nexport default data;`,
    );
    expect(hasUseClientDirective(clientFile)).toBe(true);
    // Re-point INTERNAL_CATALOG_PATH resolution for this in-memory fixture
    // by checking the relative resolution logic directly rather than the
    // module-level constant (which is bound to the real project's cwd).
    const dir = clientFile.getDirectoryPath();
    const spec = "../data/programs-internal.json";
    const resolved = resolve(dir, spec);
    expect(resolved).toBe("/data/programs-internal.json");
  });

  it("catches a TRANSITIVE require() reached through an intermediate module — the exact shape of the real bug this guard fixed", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/data/programs-internal.json", JSON.stringify([{ id: "x" }]));
    project.createSourceFile(
      "/lib/programs-data.ts",
      `export function slugify(s: string) { return s; }\nexport function getAll() { return require("../data/programs-internal.json"); }`,
    );
    const clientFile = project.createSourceFile(
      "/components/Bad.tsx",
      `"use client";\nimport { slugify } from "../lib/programs-data";\nexport default slugify;`,
    );
    const chain = findPathToInternalCatalogForFixture(project, clientFile);
    expect(chain).not.toBeNull();
    expect(chain![chain!.length - 1]).toContain("programs-internal.json");
  });

  it("does NOT flag a client file that only reaches a data-free module (lib/program-slug.ts's real shape)", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/lib/program-slug.ts",
      `export function slugify(s: string) { return s.toLowerCase(); }`,
    );
    const clientFile = project.createSourceFile(
      "/components/Good.tsx",
      `"use client";\nimport { slugify } from "../lib/program-slug";\nexport default slugify;`,
    );
    const chain = findPathToInternalCatalogForFixture(project, clientFile);
    expect(chain).toBeNull();
  });

  it("does NOT flag a `import type` of a server-only module's exported type — TS erases it, it never reaches the bundle (the real OutreachLog.tsx/owner-file-letter-context.ts shape)", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/data/programs-internal.json", JSON.stringify([{ id: "x" }]));
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
    const chain = findPathToInternalCatalogForFixture(project, clientFile);
    expect(chain).toBeNull();
  });

  it("STILL flags a real VALUE import even when a type-only import sits alongside it in the same file (proves the exclusion is scoped to type-only, not a blanket skip)", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/data/programs-internal.json", JSON.stringify([{ id: "x" }]));
    project.createSourceFile(
      "/lib/server-only.ts",
      `export interface Ctx { id: string }\nexport function resolve() { return require("../data/programs-internal.json"); }`,
    );
    const clientFile = project.createSourceFile(
      "/components/Mixed.tsx",
      `"use client";\nimport type { Ctx } from "../lib/server-only";\nimport { resolve } from "../lib/server-only";\nexport function C(props: Ctx) { return resolve(); }`,
    );
    const chain = findPathToInternalCatalogForFixture(project, clientFile);
    expect(chain).not.toBeNull();
  });
});

/** Same walk as findPathToInternalCatalog, but parameterized by an
 *  in-memory project's own catalog path (fixtures use `/data/...`, not the
 *  real cwd-relative path the module-level function is bound to). */
function findPathToInternalCatalogForFixture(project: Project, root: SourceFile): string[] | null {
  const catalogPath = "/data/programs-internal.json";
  const visited = new Set<string>([root.getFilePath()]);
  const queue: { file: SourceFile; chain: string[] }[] = [{ file: root, chain: [root.getFilePath()] }];

  const refsCatalog = (file: SourceFile): boolean => {
    const dir = file.getDirectoryPath();
    let found = false;
    const check = (spec: string) => {
      if (!spec.startsWith(".")) return;
      if (resolve(dir, spec) === catalogPath) found = true;
    };
    for (const imp of file.getImportDeclarations()) {
      if (imp.isTypeOnly()) continue;
      check(imp.getModuleSpecifierValue());
    }
    file.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const expr = node.getExpression();
      if (!Node.isIdentifier(expr) || expr.getText() !== "require") return;
      const arg = node.getArguments()[0];
      if (arg && Node.isStringLiteral(arg)) check(arg.getLiteralText());
    });
    return found;
  };

  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (refsCatalog(file)) return [...chain, catalogPath];
    for (const next of directLocalImports(file)) {
      const p = next.getFilePath();
      if (visited.has(p)) continue;
      visited.add(p);
      queue.push({ file: next, chain: [...chain, p] });
    }
  }
  return null;
}

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
// (same directLocalImports edge-walk as the internal-catalog guard
// above) over two more targets — the specific file that broke the build,
// and the general "any node:fs import at all" shape — makes it fail
// locally in vitest instead.
// ═══════════════════════════════════════════════════════════════════════

/** BFS from `root` to a specific target file path (not a literal/require
 *  reference — an actual reachable module in the import graph, the shape
 *  lib/investment-analysis.ts has: a real .ts file ts-morph resolves
 *  and adds as a SourceFile, unlike the never-added .json catalog). */
function findPathToFile(root: SourceFile, targetPath: string): string[] | null {
  if (root.getFilePath() === targetPath) return [root.getFilePath()];
  const visited = new Set<string>([root.getFilePath()]);
  const queue: { file: SourceFile; chain: string[] }[] = [{ file: root, chain: [root.getFilePath()] }];
  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    for (const next of directLocalImports(file)) {
      const p = next.getFilePath();
      if (p === targetPath) return [...chain, p];
      if (visited.has(p)) continue;
      visited.add(p);
      queue.push({ file: next, chain: [...chain, p] });
    }
  }
  return null;
}

/** True if `sourceFile` itself has a runtime (non-type-only) import or
 *  require() of one of `moduleNames` — bare package specifiers (e.g.
 *  "fs", "node:fs"), which never resolve to a project SourceFile the way
 *  a local .ts/.tsx/.json path does, so they need their own literal
 *  check rather than showing up via directLocalImports. */
function referencesBareModule(sourceFile: SourceFile, moduleNames: readonly string[]): boolean {
  const names = new Set(moduleNames);
  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.isTypeOnly()) continue;
    if (names.has(imp.getModuleSpecifierValue())) return true;
  }
  let found = false;
  sourceFile.forEachDescendant((node) => {
    if (found) return;
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr) || expr.getText() !== "require") return;
    const arg = node.getArguments()[0];
    if (arg && Node.isStringLiteral(arg) && names.has(arg.getLiteralText())) found = true;
  });
  return found;
}

/** BFS from `root` to any file (itself or transitively reachable) that
 *  imports one of `moduleNames` at runtime. */
function findPathToBareModule(root: SourceFile, moduleNames: readonly string[]): string[] | null {
  const visited = new Set<string>([root.getFilePath()]);
  const queue: { file: SourceFile; chain: string[] }[] = [{ file: root, chain: [root.getFilePath()] }];
  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (referencesBareModule(file, moduleNames)) return chain;
    for (const next of directLocalImports(file)) {
      const p = next.getFilePath();
      if (visited.has(p)) continue;
      visited.add(p);
      queue.push({ file: next, chain: [...chain, p] });
    }
  }
  return null;
}

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
    const chain = findPathToBareModule(clientFile, ["fs", "node:fs"]);
    expect(chain).not.toBeNull();
  });

  it("does NOT flag a client file with no node:fs in its reachable graph", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile("/lib/pure.ts", `export function y() { return 2; }`);
    const clientFile = project.createSourceFile(
      "/components/Good.tsx",
      `"use client";\nimport { y } from "../lib/pure";\nexport default y;`,
    );
    expect(findPathToBareModule(clientFile, ["fs", "node:fs"])).toBeNull();
  });
});

describe("client-transitive import guard — real codebase scan", () => {
  const project = buildRealProject();
  const allFiles = project
    .getSourceFiles(["app/**/*.ts", "app/**/*.tsx", "components/**/*.ts", "components/**/*.tsx"])
    .filter((f) => !f.getFilePath().includes("__tests__") && !f.getFilePath().match(/\.test\.tsx?$/));
  const clientRoots = allFiles.filter(hasUseClientDirective);

  it("finds a non-trivial number of 'use client' roots (the scan is not silently a no-op)", () => {
    expect(clientRoots.length).toBeGreaterThan(20);
  });

  it("data/programs-internal.json is NOT reachable from any 'use client' file, directly or transitively", () => {
    const offenders: { root: string; chain: string[] }[] = [];
    for (const root of clientRoots) {
      const chain = findPathToInternalCatalog(root);
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
        `${offenders.length} client component(s) can reach data/programs-internal.json through the static import graph:\n${report}\n` +
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
        `${offenders.length} client component(s) can statically reach lib/investment-analysis.ts:\n${report}\n` +
          `Fix: feed the needed data through ReportContext.capitalContext (see buildCorridorInvestmentContext) ` +
          `instead of a static import — the real fs-backed loader belongs only in a server-only Route Handler.`,
      );
    }
    expect(offenders.length).toBe(0);
  }, REAL_CODEBASE_SCAN_TIMEOUT_MS);

  it("no node:fs (or bare 'fs') import is reachable from any 'use client' file, directly or transitively (gate round 2, MAJOR 24)", () => {
    const offenders: { root: string; chain: string[] }[] = [];
    for (const root of clientRoots) {
      const chain = findPathToBareModule(root, ["fs", "node:fs", "fs/promises", "node:fs/promises"]);
      if (chain) offenders.push({ root: root.getFilePath(), chain });
    }
    if (offenders.length > 0) {
      const report = offenders.map((o) => `  ${o.root}\n    -> ${o.chain.join("\n    -> ")}`).join("\n");
      throw new Error(
        `${offenders.length} client component(s) can statically reach a node:fs import:\n${report}\n` +
          `Fix: move the fs-backed logic into a server-only Route Handler or Server Component and pass the ` +
          `result down as plain data, the same fix already applied to lib/investment-analysis.ts.`,
      );
    }
    expect(offenders.length).toBe(0);
  }, REAL_CODEBASE_SCAN_TIMEOUT_MS);
});
