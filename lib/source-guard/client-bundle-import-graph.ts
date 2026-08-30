/**
 * lib/source-guard/client-bundle-import-graph.ts
 *
 * Shared ts-morph walker for "does a 'use client' file's STATIC import
 * graph reach X" guards. Extracted from the BFS first written for
 * lib/__tests__/no-internal-catalog-in-client-bundle.test.ts (data/
 * programs-internal.json + lib/investment-analysis.ts + node:fs) so a
 * second guard — lib/__tests__/no-node-builtins-in-client-bundle.test.ts,
 * generalizing to ANY node:* built-in — can reuse the identical resolution
 * rules instead of re-deriving them: what counts as a "local import" a
 * bundler can trace (relative import/export specifiers and literal-
 * argument require() calls; `import type` excluded because TypeScript
 * erases it before anything reaches a bundle), and what counts as a
 * "'use client' root" (a file whose FIRST statement is the bare
 * `"use client"` directive).
 *
 * Both guard files still own their OWN target predicate and their OWN
 * real-codebase-scan `it(...)` (different violation targets, different
 * error messages) — only the graph-walking mechanics live here.
 */
import { Node, Project, type SourceFile } from "ts-morph";
import { resolve } from "node:path";

/** True if `sourceFile`'s first statement is the bare `"use client"`
 *  directive — Next's own rule for what makes a module a client boundary. */
export function hasUseClientDirective(sourceFile: SourceFile): boolean {
  const first = sourceFile.getStatements()[0];
  if (!first || !Node.isExpressionStatement(first)) return false;
  const expr = first.getExpression();
  return Node.isStringLiteral(expr) && expr.getLiteralText() === "use client";
}

/** Every local (relative or resolvable) module a file statically
 *  references, via `import ... from "..."` OR a literal-argument
 *  `require("...")` call — both are things a bundler can trace and inline.
 *  `import type {...}` is deliberately excluded: TypeScript erases
 *  type-only imports entirely at compile time, so they can never put
 *  runtime bytes into a client bundle.
 *
 *  A resolved import under node_modules/ is never followed further, even
 *  when ts-morph can resolve it (a package that ships .d.ts files
 *  resolves via `getModuleSpecifierSourceFile()` same as a local file
 *  would). A published package's TYPE declarations are not its runtime —
 *  e.g. the `ai` SDK's dist/index.d.ts has a plain (non-type-only, since
 *  a .d.ts's contents are ambient by construction) `import { ServerResponse }
 *  from "node:http"` purely for a type annotation; that import produces
 *  zero runtime bytes in any real bundle, but a walk that recursed into it
 *  would wrongly flag every client component that imports anything from
 *  `ai`. Third-party runtime bundling is that package's own concern
 *  (its package.json "browser"/exports conditions decide what actually
 *  ships to a client, not its .d.ts), not something a local source-graph
 *  guard over OUR OWN app/ and components/ code can or should audit. */
export function directLocalImports(sourceFile: SourceFile): SourceFile[] {
  const out: SourceFile[] = [];
  const isLocal = (file: SourceFile) => !file.getFilePath().includes("/node_modules/");

  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.isTypeOnly()) continue;
    const resolved = imp.getModuleSpecifierSourceFile();
    if (resolved && isLocal(resolved)) out.push(resolved);
  }
  for (const exp of sourceFile.getExportDeclarations()) {
    if (exp.isTypeOnly()) continue;
    const resolved = exp.getModuleSpecifierSourceFile();
    if (resolved && isLocal(resolved)) out.push(resolved);
  }

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr) || expr.getText() !== "require") return;
    const arg = node.getArguments()[0];
    if (!arg || !Node.isStringLiteral(arg)) return;
    const spec = arg.getLiteralText();
    if (!spec.startsWith(".")) return; // only local/relative — a bare
    // package specifier (e.g. "react") can never resolve to one of our
    // own project files this way.
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
  });

  return out;
}

/** True if `sourceFile` itself has a runtime (non-type-only) import or
 *  require() whose specifier satisfies `matches` — bare specifiers (e.g.
 *  "fs", "node:crypto") never resolve to a project SourceFile the way a
 *  local .ts/.tsx/.json path does, so they need this literal-specifier
 *  check rather than showing up via directLocalImports. */
export function referencesMatchingSpecifier(
  sourceFile: SourceFile,
  matches: (specifier: string) => boolean,
): boolean {
  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.isTypeOnly()) continue;
    if (matches(imp.getModuleSpecifierValue())) return true;
  }
  let found = false;
  sourceFile.forEachDescendant((node) => {
    if (found) return;
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr) || expr.getText() !== "require") return;
    const arg = node.getArguments()[0];
    if (arg && Node.isStringLiteral(arg) && matches(arg.getLiteralText())) found = true;
  });
  return found;
}

/** BFS from `root`; returns the reachable-file chain to the first file
 *  (itself or transitively imported) whose specifiers satisfy `matches`,
 *  with the offending specifier appended, or null if never reachable. */
export function findPathToMatchingSpecifier(
  root: SourceFile,
  matches: (specifier: string) => boolean,
): string[] | null {
  const visited = new Set<string>([root.getFilePath()]);
  const queue: { file: SourceFile; chain: string[] }[] = [{ file: root, chain: [root.getFilePath()] }];
  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (referencesMatchingSpecifier(file, matches)) return chain;
    for (const next of directLocalImports(file)) {
      const p = next.getFilePath();
      if (visited.has(p)) continue;
      visited.add(p);
      queue.push({ file: next, chain: [...chain, p] });
    }
  }
  return null;
}

/** BFS from `root` to a specific target file path (a real, ts-morph-
 *  resolved module — not a literal/require specifier check). */
export function findPathToFile(root: SourceFile, targetPath: string): string[] | null {
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

/** A ts-morph Project over the real repo, using its own tsconfig.json so
 *  `@/...` aliases resolve exactly like the Next.js bundler resolves
 *  them. */
export function buildRealProject(): Project {
  return new Project({ tsConfigFilePath: resolve(process.cwd(), "tsconfig.json") });
}

/** Every `"use client"` root under app/ and components/ in the real repo
 *  (test files excluded — they are never bundled). */
export function findRealClientRoots(project: Project): SourceFile[] {
  return project
    .getSourceFiles(["app/**/*.ts", "app/**/*.tsx", "components/**/*.ts", "components/**/*.tsx"])
    .filter((f) => !f.getFilePath().includes("__tests__") && !f.getFilePath().match(/\.test\.tsx?$/))
    .filter(hasUseClientDirective);
}
