/**
 * lib/public-claim-surfaces-verify.ts — review5 S10.
 *
 * "registry entries get an EXECUTABLE contract check (import guards / DTO-
 * shape assertions), not path-existence; new public sinks require
 * coverage." lib/__tests__/public-claim-surfaces.test.ts's original checks
 * (non-empty id/description, valid contract enum, and — the one this file
 * replaces the WEAKEST part of — every listed file/directory exists on
 * disk) prove the registry is internally well-formed and not stale-pointing.
 * They prove NOTHING about whether a surface actually honors the claim
 * contract it declares: a surface tagged "PublicProgramView" could import
 * raw `Program`/the internal catalog directly and the old test would
 * never notice, because it only checked that the FILE exists, not what it
 * DOES.
 *
 * Two contracts get a real, executable check here — chosen because they
 * are exactly the two historical bug shapes this whole review5 pass has
 * been fixing (S1/S2's client-transitive raw-Program leaks and v1-vs-v2
 * zone evidence), so a regression here is not hypothetical:
 *
 *   - "ZoneEvidence": FAILS if any listed file's source references the
 *     v1 zone-check function `normalizeZoneCheckResponse` as an
 *     identifier anywhere — that function defaults an unresolved layer to
 *     `false`, indistinguishable from a confirmed non-match, which is the
 *     exact anti-pattern S1-S3 spent this whole pass removing from real
 *     surfaces. A surface that has moved to v2 has no legitimate reason
 *     to still reference the v1 function name.
 *   - "PublicProgramView": for every listed file that is a CLIENT
 *     component (has a `"use client"` directive), FAILS if
 *     `data/programs-internal.json` is reachable through that file's real
 *     static import graph — reusing the exact BFS mechanism
 *     lib/__tests__/no-internal-catalog-in-client-bundle.test.ts already
 *     proved sound (including the `import type` exclusion) against
 *     REGISTRY-LISTED files specifically. Server-only files in this
 *     registry are NOT checked by this rule — several (report-pdf,
 *     owner-file-pdf, the survey/report engines) legitimately need full
 *     `Program` fidelity server-side to synthesize their own
 *     already-DTO-safe output — the same documented, bounded exception S1
 *     established, now realized as review6 S11's architecture: full
 *     internal fidelity stays server-side (`getProgramsSync()` inside
 *     app/api/{report/generate,programs/match,survey/score}/route.ts and
 *     the engine modules they call), only the already-safe RESULT crosses
 *     the network. There is no longer any route that serializes the raw
 *     catalog to the client (the old /api/programs/engine-source route
 *     S1 bounded is deleted outright, not just re-bounded). Verifying THAT
 *     boundary (full fidelity in, safe output out) is a data-flow
 *     property, not an import-graph property, and is out of this
 *     executable check's reach — flagged here, not silently assumed
 *     proven; review6 S16 adds a repo-wide prohibited-source check that
 *     narrows this gap further.
 *   - "reviewed-copy" has no executable check, by the registry's own
 *     original design: its safety is established by a dedicated
 *     rendered-output test per surface, not a schema this file could
 *     verify generically.
 *
 * "new public sinks require coverage": every entry in
 * PUBLIC_CLAIM_SURFACES gets run through whichever of the two checks
 * above apply to its declared `contracts` — there is no per-surface
 * opt-out list. Adding a new surface with a ZoneEvidence or
 * PublicProgramView contract means it is automatically checked from the
 * moment it's added; there is nothing more to wire up.
 *
 * PERFORMANCE NOTE: `buildVerificationProject` must be called ONCE (a
 * `tsConfigFilePath`-based ts-morph `Project` loads and type-checks the
 * whole project graph) and the resulting `Project` reused across every
 * surface — building a fresh tsconfig-based Project per surface/contract
 * (an earlier version of this file did) took minutes for the ~20-entry
 * registry and was killed for timing out.
 */
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import { resolve as resolvePath } from "node:path";
import type { PublicClaimSurface } from "./public-claim-surfaces";

export interface ContractVerificationResult {
  surfaceId: string;
  contract: string;
  ok: boolean;
  /** Populated only when ok is false. */
  reason?: string;
}

const V1_ZONE_FUNCTION_NAME = "normalizeZoneCheckResponse";
const INTERNAL_CATALOG_RELATIVE_PATH = "data/programs-internal.json";

/** Build ONCE per test run (or CLI invocation) and pass into every
 *  `verifyPublicClaimSurface` call — see the perf note above. */
export function buildVerificationProject(rootDir: string): Project {
  return new Project({ tsConfigFilePath: `${rootDir}/tsconfig.json` });
}

function hasUseClientDirective(sourceFile: SourceFile): boolean {
  const first = sourceFile.getStatements()[0];
  if (!first || !Node.isExpressionStatement(first)) return false;
  const expr = first.getExpression();
  return Node.isStringLiteral(expr) && expr.getLiteralText() === "use client";
}

/** Resolve a registry `files` entry (a file OR a directory) to the real,
 *  ALREADY-LOADED .ts/.tsx source files under it (from the shared
 *  project — nothing is added to the project here, only looked up), by
 *  matching each loaded source file's path against the entry. Test files
 *  are excluded. */
function resolveSurfaceFiles(project: Project, rootDir: string, entries: readonly string[]): SourceFile[] {
  const absoluteDirs = entries
    .filter((e) => !/\.(ts|tsx)$/.test(e))
    .map((e) => `${rootDir}/${e}/`.replace(/\/+$/, "/"));
  const absoluteFiles = new Set(entries.filter((e) => /\.(ts|tsx)$/.test(e)).map((e) => `${rootDir}/${e}`));

  return project.getSourceFiles().filter((sf) => {
    const path = sf.getFilePath();
    if (path.includes("__tests__") || /\.test\.tsx?$/.test(path)) return false;
    if (absoluteFiles.has(path)) return true;
    return absoluteDirs.some((dir) => path.startsWith(dir));
  });
}

/** ZoneEvidence contract: fail if the v1 function name appears as an
 *  identifier reference anywhere in the surface's files. */
function verifyZoneEvidenceContract(
  surface: PublicClaimSurface,
  project: Project,
  rootDir: string,
): ContractVerificationResult {
  const files = resolveSurfaceFiles(project, rootDir, surface.files);

  for (const sourceFile of files) {
    const found = sourceFile
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .some((id) => id.getText() === V1_ZONE_FUNCTION_NAME);
    if (found) {
      const relative = sourceFile.getFilePath().slice(rootDir.length).replace(/^[/\\]/, "");
      return {
        surfaceId: surface.id,
        contract: "ZoneEvidence",
        ok: false,
        reason: `${relative} references the v1 zone function "${V1_ZONE_FUNCTION_NAME}" — a ZoneEvidence surface must use v2 (normalizeZoneEvidenceV2/resolveZoneEvidenceV2) instead.`,
      };
    }
  }
  return { surfaceId: surface.id, contract: "ZoneEvidence", ok: true };
}

function referencesInternalCatalogLiteral(sourceFile: SourceFile, internalCatalogPath: string): boolean {
  const dir = sourceFile.getDirectoryPath();
  let found = false;
  const check = (spec: string) => {
    if (!spec.startsWith(".")) return;
    const candidates = [resolvePath(dir, spec), resolvePath(dir, `${spec}.json`)];
    if (candidates.includes(internalCatalogPath)) found = true;
  };
  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.isTypeOnly()) continue;
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

function directLocalImports(sourceFile: SourceFile): SourceFile[] {
  const out: SourceFile[] = [];
  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.isTypeOnly()) continue;
    const resolved = imp.getModuleSpecifierSourceFile();
    if (resolved) out.push(resolved);
  }
  return out;
}

function findPathToInternalCatalog(root: SourceFile, internalCatalogPath: string): string[] | null {
  const visited = new Set<string>([root.getFilePath()]);
  const queue: { file: SourceFile; chain: string[] }[] = [{ file: root, chain: [root.getFilePath()] }];
  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (referencesInternalCatalogLiteral(file, internalCatalogPath)) return [...chain, internalCatalogPath];
    for (const next of directLocalImports(file)) {
      const p = next.getFilePath();
      if (visited.has(p)) continue;
      visited.add(p);
      queue.push({ file: next, chain: [...chain, p] });
    }
  }
  return null;
}

/** PublicProgramView contract: for every listed file that is a client
 *  component, fail if data/programs-internal.json is reachable through
 *  its real static import graph (value imports + require(), excluding
 *  erased `import type`). */
function verifyPublicProgramViewContract(
  surface: PublicClaimSurface,
  project: Project,
  rootDir: string,
): ContractVerificationResult {
  const internalCatalogPath = `${rootDir}/${INTERNAL_CATALOG_RELATIVE_PATH}`;
  const files = resolveSurfaceFiles(project, rootDir, surface.files);
  const clientFiles = files.filter(hasUseClientDirective);

  for (const clientFile of clientFiles) {
    const chain = findPathToInternalCatalog(clientFile, internalCatalogPath);
    if (chain) {
      const relative = clientFile.getFilePath().slice(rootDir.length).replace(/^[/\\]/, "");
      return {
        surfaceId: surface.id,
        contract: "PublicProgramView",
        ok: false,
        reason: `${relative} (a "use client" file in this surface) can reach data/programs-internal.json through its static import graph: ${chain.join(" -> ")}`,
      };
    }
  }
  return { surfaceId: surface.id, contract: "PublicProgramView", ok: true };
}

/** Run every executable check that applies to `surface`'s declared
 *  contracts, against a shared `project` (see `buildVerificationProject`).
 *  Contracts with no executable check ("reviewed-copy") are omitted from
 *  the result — not silently marked passing. */
export function verifyPublicClaimSurface(
  surface: PublicClaimSurface,
  project: Project,
  rootDir: string,
): ContractVerificationResult[] {
  const results: ContractVerificationResult[] = [];
  if (surface.contracts.includes("ZoneEvidence")) {
    results.push(verifyZoneEvidenceContract(surface, project, rootDir));
  }
  if (surface.contracts.includes("PublicProgramView")) {
    results.push(verifyPublicProgramViewContract(surface, project, rootDir));
  }
  return results;
}
