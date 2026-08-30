/**
 * lib/source-guard/client-bundle-import-graph.ts
 *
 * Shared ts-morph walker for "does a 'use client' file's bundler-visible
 * graph reach X" guards. Extracted from the BFS first written for
 * lib/__tests__/no-internal-catalog-in-client-bundle.test.ts (data/
 * programs-internal.json + lib/investment-analysis.ts + node:fs) so a
 * second guard — lib/__tests__/no-node-builtins-in-client-bundle.test.ts,
 * generalizing to ANY node:* built-in — can reuse the identical resolution
 * rules instead of re-deriving them: what counts as a local edge a bundler
 * can trace (static imports/exports, literal `import()`, and literal
 * `require()`; type-only specifiers excluded because TypeScript erases them
 * before anything reaches a bundle), and what counts as a
 * "'use client' root" (a file whose FIRST statement is the bare
 * `"use client"` directive).
 *
 * Both guard files still own their OWN target predicate and their OWN
 * real-codebase-scan `it(...)` (different violation targets, different
 * error messages) — only the graph-walking mechanics live here.
 */
import {
  Node,
  Project,
  SyntaxKind,
  ts,
  type ExportDeclaration,
  type ImportDeclaration,
  type SourceFile,
} from "ts-morph";
import { resolve } from "node:path";

function importDeclarationHasRuntimeEdge(declaration: ImportDeclaration): boolean {
  if (declaration.isTypeOnly()) return false;
  if (declaration.getDefaultImport() || declaration.getNamespaceImport()) return true;
  const namedImports = declaration.getNamedImports();
  return namedImports.length === 0 || namedImports.some((specifier) => !specifier.isTypeOnly());
}

function exportDeclarationHasRuntimeEdge(declaration: ExportDeclaration): boolean {
  if (declaration.isTypeOnly()) return false;
  const namedExports = declaration.getNamedExports();
  return namedExports.length === 0 || namedExports.some((specifier) => !specifier.isTypeOnly());
}

/** Resolve one literal module specifier with the project's real TypeScript
 *  resolution settings. This covers aliases, extensionless paths, index
 *  modules, and JSON exactly the way the static declaration resolver does. */
function resolveProjectSourceFile(sourceFile: SourceFile, specifier: string): SourceFile | null {
  const project = sourceFile.getProject();
  const resolved = ts.resolveModuleName(
    specifier,
    sourceFile.getFilePath(),
    project.getCompilerOptions(),
    project.getModuleResolutionHost(),
  ).resolvedModule?.resolvedFileName;
  if (!resolved || resolved.includes("/node_modules/")) return null;
  return project.getSourceFile(resolved) ?? project.addSourceFileAtPathIfExists(resolved) ?? null;
}

/** Return the exact runtime module text when an argument remains a compile-
 * time literal after removing syntax-only wrappers. Webpack follows quoted
 * strings and no-substitution templates through these wrappers; expressions
 * with a genuinely runtime-computed target deliberately return null. */
function literalModuleSpecifierArgument(node: Node | undefined): string | null {
  if (!node) return null;

  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }

  if (Node.isStringLiteral(current) || Node.isNoSubstitutionTemplateLiteral(current)) {
    return current.getLiteralText();
  }
  return null;
}

/** True if `sourceFile`'s first statement is the bare `"use client"`
 *  directive — Next's own rule for what makes a module a client boundary. */
export function hasUseClientDirective(sourceFile: SourceFile): boolean {
  const first = sourceFile.getStatements()[0];
  if (!first || !Node.isExpressionStatement(first)) return false;
  const expr = first.getExpression();
  return Node.isStringLiteral(expr) && expr.getLiteralText() === "use client";
}

/** Every local (relative or resolvable) module a file visibly
 *  references, via `import ... from "..."`, `export ... from "..."`, a
 *  literal `import("...")`, OR a literal-argument `require("...")` call —
 *  all are things a bundler can trace and place in an initial or lazy chunk.
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

  for (const imp of sourceFile.getImportDeclarations()) {
    if (!importDeclarationHasRuntimeEdge(imp)) continue;
    const resolved = resolveProjectSourceFile(sourceFile, imp.getModuleSpecifierValue());
    if (resolved) out.push(resolved);
  }
  for (const exp of sourceFile.getExportDeclarations()) {
    if (!exportDeclarationHasRuntimeEdge(exp)) continue;
    const specifier = exp.getModuleSpecifierValue();
    if (!specifier) continue;
    const resolved = resolveProjectSourceFile(sourceFile, specifier);
    if (resolved) out.push(resolved);
  }

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    const isRequire = Node.isIdentifier(expr) && expr.getText() === "require";
    const isDynamicImport = expr.getKind() === SyntaxKind.ImportKeyword;
    if (!isRequire && !isDynamicImport) return;
    const specifier = literalModuleSpecifierArgument(node.getArguments()[0]);
    if (!specifier) return;
    const resolved = resolveProjectSourceFile(sourceFile, specifier);
    if (resolved) out.push(resolved);
  });

  return out;
}

/** True if `sourceFile` itself has a runtime (non-type-only) import,
 *  export, literal `import()`, or literal `require()` whose specifier
 *  satisfies `matches`. Bare specifiers (e.g. "fs", "node:crypto") never
 *  resolve to a local SourceFile, so they need this literal check rather
 *  than appearing through directLocalImports. */
export function referencesMatchingSpecifier(
  sourceFile: SourceFile,
  matches: (specifier: string) => boolean,
): boolean {
  for (const imp of sourceFile.getImportDeclarations()) {
    if (!importDeclarationHasRuntimeEdge(imp)) continue;
    if (matches(imp.getModuleSpecifierValue())) return true;
  }
  for (const exp of sourceFile.getExportDeclarations()) {
    if (!exportDeclarationHasRuntimeEdge(exp)) continue;
    const specifier = exp.getModuleSpecifierValue();
    if (specifier && matches(specifier)) return true;
  }
  let found = false;
  sourceFile.forEachDescendant((node) => {
    if (found) return;
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    const isRequire = Node.isIdentifier(expr) && expr.getText() === "require";
    const isDynamicImport = expr.getKind() === SyntaxKind.ImportKeyword;
    if (!isRequire && !isDynamicImport) return;
    const specifier = literalModuleSpecifierArgument(node.getArguments()[0]);
    if (specifier && matches(specifier)) found = true;
  });
  return found;
}

/** BFS from `root`; returns the reachable-file chain to the first file
 *  (itself or transitively imported) whose specifiers satisfy `matches`,
 *  or null if never reachable. */
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
