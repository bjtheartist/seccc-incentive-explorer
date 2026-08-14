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

// ═══════════════════════════════════════════════════════════════════════
// review6 S16 (MEDIUM) — repo-wide prohibited-source checks, INDEPENDENT
// of PUBLIC_CLAIM_SURFACES membership.
//
// Everything above this line only ever looks at files a registry entry
// already lists — a real strength (S10's "new public sinks require
// coverage" claim is true for anything actually registered) but also
// the exact blind spot S11 fell through: the deleted
// /api/programs/engine-source route was NEVER a PUBLIC_CLAIM_SURFACES
// entry, so none of the checks above ever looked at it, in either
// direction — it took a human/Sol review round to find it, not this
// file. "S11 and S16 interact — fix S11's architecture first, then
// make S16's checks prove it can't come back" (review6's own words):
// these checks scan the WHOLE repo tree, not the registry, so a NEW
// route with the same shape the old one had gets caught the moment it's
// written, whether or not anyone remembers to register it.
// ═══════════════════════════════════════════════════════════════════════

export interface RepoWideViolation {
  check: "no-raw-program-client-cast" | "no-raw-program-route-response" | "no-v1-zone-usage";
  filePath: string;
  reason: string;
}

const V1_ZONE_ENDPOINT_PATTERN = /\/api\/zones\/check(?!\/v2)(?:["'`?]|$)/;

function isAppComponentsLibSourceFile(sf: SourceFile, rootDir: string): boolean {
  const path = sf.getFilePath();
  if (!path.startsWith(rootDir)) return false;
  const relative = path.slice(rootDir.length).replace(/^[/\\]/, "");
  if (!/^(app|components|lib)\//.test(relative)) return false;
  if (relative.includes("__tests__") || /\.test\.tsx?$/.test(relative)) return false;
  return true;
}

function toRelative(sf: SourceFile, rootDir: string): string {
  return sf.getFilePath().slice(rootDir.length).replace(/^[/\\]/, "");
}

/**
 * Check 1/3 — "raw Program ... casts": FAILS if a `"use client"` file
 * ANYWHERE under app/components/lib contains a TypeScript type assertion
 * (`as Program`, `as Program[]`, or the `<Program>x` form) naming the
 * raw internal `Program` type. A component that casts a fetch response
 * (or anything else) to the raw shape is declaring, in its own types,
 * that it holds full internal records — exactly the shape a
 * `SafeMapProgramMatch`/`GeneratedReport`/`SurveyResult`-narrowed
 * response can never legitimately need. Scoped to `"use client"` files
 * only, matching this file's existing `verifyPublicProgramViewContract`
 * scoping rationale: server-only files legitimately hold full `Program`
 * fidelity (that's the S11 architecture), so a raw-`Program` cast there
 * is not itself the leak — only a CLIENT file casting to it is.
 */
export function verifyNoRawProgramClientCast(project: Project, rootDir: string): RepoWideViolation[] {
  const violations: RepoWideViolation[] = [];
  for (const sf of project.getSourceFiles()) {
    if (!isAppComponentsLibSourceFile(sf, rootDir)) continue;
    if (!hasUseClientDirective(sf)) continue;

    const assertions = [
      ...sf.getDescendantsOfKind(SyntaxKind.AsExpression),
      ...sf.getDescendantsOfKind(SyntaxKind.TypeAssertionExpression),
    ];
    for (const assertion of assertions) {
      const typeText = assertion.getTypeNode()?.getText() ?? "";
      if (typeText === "Program" || typeText === "Program[]" || /^Program\s*\[\s*\]$/.test(typeText)) {
        violations.push({
          check: "no-raw-program-client-cast",
          filePath: toRelative(sf, rootDir),
          reason: `"use client" file casts to the raw internal Program type (${assertion.getText()}) at line ${assertion.getStartLineNumber()} — client code must only ever hold an already-narrowed DTO (SafeMapProgramMatch, PublicProgramView, a GeneratedReport/SurveyResult field), never the full internal record shape.`,
        });
      }
    }
  }
  return violations;
}

/**
 * Check 2/3 — "raw Program ... fetch-responses": FAILS if a
 * `app/api/**\/route.ts` file's `NextResponse.json(...)`/`Response.json(...)`
 * call returns, as its direct argument, either `getProgramsSync()`
 * inlined, or a bare identifier whose declaration's initializer is
 * exactly `getProgramsSync()` (no `.map()`/DTO transform in between) —
 * the EXACT shape the deleted /api/programs/engine-source route had:
 * `return NextResponse.json(getProgramsSync())`. A route that reads
 * `getProgramsSync()` for its OWN internal use (e.g. feeding a
 * server-side digest/engine, never serializing it as the response body)
 * is untouched — this only looks at what actually crosses the
 * `.json(...)` boundary to the network.
 */
export function verifyNoRawProgramRouteResponse(project: Project, rootDir: string): RepoWideViolation[] {
  const violations: RepoWideViolation[] = [];
  for (const sf of project.getSourceFiles()) {
    if (!isAppComponentsLibSourceFile(sf, rootDir)) continue;
    const relative = toRelative(sf, rootDir);
    if (!/^app\/api\/.*\/route\.ts$/.test(relative)) continue;

    sf.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const expr = node.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;
      if (expr.getName() !== "json") return;
      // Only NextResponse.json(...) / Response.json(...) — not an
      // arbitrary unrelated `.json(...)` call (e.g. a fetched Response
      // being PARSED, which is the opposite direction).
      const receiver = expr.getExpression().getText();
      if (receiver !== "NextResponse" && receiver !== "Response") return;

      const arg = node.getArguments()[0];
      if (!arg) return;

      const argText = arg.getText().replace(/\s+/g, "");
      let isRawProgramsCall = argText === "getProgramsSync()";

      if (!isRawProgramsCall && Node.isIdentifier(arg)) {
        const decls = arg.getSymbol()?.getDeclarations() ?? [];
        for (const decl of decls) {
          if (!Node.isVariableDeclaration(decl)) continue;
          const init = decl.getInitializer();
          if (init && init.getText().replace(/\s+/g, "") === "getProgramsSync()") {
            isRawProgramsCall = true;
          }
        }
      }

      if (isRawProgramsCall) {
        violations.push({
          check: "no-raw-program-route-response",
          filePath: relative,
          reason: `${relative}:${node.getStartLineNumber()} returns getProgramsSync()'s result directly as an HTTP response body — the exact shape the deleted /api/programs/engine-source route had (review6 S11). Route server-only fidelity must stay server-only; only an already-narrowed engine RESULT may cross .json(...).`,
        });
      }
    });
  }
  return violations;
}

/**
 * Check 3/3 — "v1 zone endpoints/hand-rolled v1 shapes": FAILS if any
 * file repo-wide references the v1 zone-check function
 * `normalizeZoneCheckResponse` as an identifier (the SAME rule
 * `verifyZoneEvidenceContract` already applies, but registry-independent
 * here), OR contains a string literal naming the v1 HTTP endpoint
 * `/api/zones/check` without the `/v2` suffix (a hand-rolled fetch call
 * to the endpoint that defaults an unresolved layer to `false` —
 * indistinguishable from a confirmed non-match, the S1-S3 anti-pattern).
 */
export function verifyNoV1ZoneUsage(project: Project, rootDir: string): RepoWideViolation[] {
  const violations: RepoWideViolation[] = [];
  for (const sf of project.getSourceFiles()) {
    if (!isAppComponentsLibSourceFile(sf, rootDir)) continue;
    const relative = toRelative(sf, rootDir);

    // Exclude the function's OWN declaration-name identifier — the
    // module that legitimately still DEFINES the deprecated v1 function
    // (kept for its own dedicated backward-compatibility unit tests;
    // lib/zone-response.ts) necessarily contains its own name once, and
    // that single occurrence is not a USAGE of it. Any OTHER identifier
    // occurrence (an import, a call) still fails, including a second,
    // different reference inside that same file.
    const v1FunctionRef = sf.getDescendantsOfKind(SyntaxKind.Identifier).find((id) => {
      if (id.getText() !== V1_ZONE_FUNCTION_NAME) return false;
      const parent = id.getParent();
      if (Node.isFunctionDeclaration(parent) && parent.getNameNode() === id) return false;
      return true;
    });
    if (v1FunctionRef) {
      violations.push({
        check: "no-v1-zone-usage",
        filePath: relative,
        reason: `${relative}:${v1FunctionRef.getStartLineNumber()} references the v1 zone function "${V1_ZONE_FUNCTION_NAME}" — must use v2 (normalizeZoneEvidenceV2/resolveZoneEvidenceV2) instead, repo-wide, regardless of registry membership.`,
      });
    }

    // StringLiteral and NoSubstitutionTemplateLiteral cover a plain
    // string; a template literal WITH interpolation (the realistic case
    // for a URL built as `/api/zones/check?lat=${lat}&lon=${lon}`) is a
    // TemplateExpression whose fixed text lives in its `head` — checked
    // separately since ts-morph does not classify it as either literal
    // kind above.
    for (const str of [
      ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
    ]) {
      if (V1_ZONE_ENDPOINT_PATTERN.test(str.getText())) {
        violations.push({
          check: "no-v1-zone-usage",
          filePath: relative,
          reason: `${relative}:${str.getStartLineNumber()} references the v1 zone-check HTTP endpoint "/api/zones/check" (without /v2) — v1 silently defaults an unresolved layer to a confirmed non-match.`,
        });
      }
    }
    for (const templateExpr of sf.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
      const head = templateExpr.getHead().getText();
      if (V1_ZONE_ENDPOINT_PATTERN.test(head)) {
        violations.push({
          check: "no-v1-zone-usage",
          filePath: relative,
          reason: `${relative}:${templateExpr.getStartLineNumber()} references the v1 zone-check HTTP endpoint "/api/zones/check" (without /v2) in an interpolated template literal — v1 silently defaults an unresolved layer to a confirmed non-match.`,
        });
      }
    }
  }
  return violations;
}

/** Runs all three repo-wide prohibited-source checks against every file
 *  under app/, components/, lib/ — registry-independent. */
export function runRepoWideProhibitedSourceChecks(project: Project, rootDir: string): RepoWideViolation[] {
  return [
    ...verifyNoRawProgramClientCast(project, rootDir),
    ...verifyNoRawProgramRouteResponse(project, rootDir),
    ...verifyNoV1ZoneUsage(project, rootDir),
  ];
}

// ═══════════════════════════════════════════════════════════════════════
// review6 S16 — discovery check: every public sink (app/**/page.tsx,
// app/**/route.ts) must have a PUBLIC_CLAIM_SURFACES registry entry.
//
// KNOWN, DOCUMENTED GAP: a full-repo audit found 100 pre-existing
// page.tsx/route.ts files with no registry entry as of this finding
// (2026-08-14) — auth routes, admin-only tools behind their own login,
// health/cron/internal endpoints, and public pages this review pass did
// not individually re-audit for claim-surface completeness. Retroactively
// classifying and registering all 100 is a real, separate body of work
// this MEDIUM finding does not expand to cover (out of proportion to
// "add a discovery check" — see the acceptance doc's own escape-hatch
// discipline: a loop needs a falsifiable terminal state, not an
// open-ended full audit). The discovery check below is scoped to its
// actual, literal purpose — "a NEW unregistered page/route" must fail —
// by fail-closed baselining today's known gaps: any of THESE specific
// paths is a documented pass-through, but ANY path not in this list AND
// not registered is a genuine, unexplained new gap and fails the check.
// Closing this baseline down to zero (registering or deliberately
// excluding each one with its own reviewed rationale) is real follow-up
// work, tracked here, not silently deferred without a trace.
// ═══════════════════════════════════════════════════════════════════════

export const PUBLIC_CLAIM_SURFACES_KNOWN_GAPS: readonly string[] = [
  "app/admin/analytics/page.tsx",
  "app/admin/future-of-commerce/page.tsx",
  "app/admin/owner-files/[zip]/[clusterKey]/page.tsx",
  "app/admin/owner-files/[zip]/page.tsx",
  "app/admin/owner-files/page.tsx",
  "app/admin/page.tsx",
  "app/admin/support-network/page.tsx",
  "app/admin/zoning-changes/page.tsx",
  "app/api/admin/analytics/login/route.ts",
  "app/api/admin/analytics/route.ts",
  "app/api/admin/future-of-commerce-signups/route.ts",
  "app/api/admin/investment/login/route.ts",
  "app/api/admin/owner-files/login/route.ts",
  "app/api/assets/route.ts",
  "app/api/auth/[...nextauth]/route.ts",
  "app/api/auth/forgot-password/route.ts",
  "app/api/auth/reset-password/route.ts",
  "app/api/auth/signup/route.ts",
  "app/api/business-profiles/[id]/route.ts",
  "app/api/business-profiles/route.ts",
  "app/api/businesses/route.ts",
  "app/api/census/route.ts",
  "app/api/concierge/status/route.ts",
  "app/api/corridor/owners/route.ts",
  "app/api/corridor/route.ts",
  "app/api/cron/watchlist-digest/route.ts",
  "app/api/districts/route.ts",
  "app/api/events/route.ts",
  "app/api/future-of-commerce-signups/route.ts",
  "app/api/geocode/route.ts",
  "app/api/health/reset/route.ts",
  "app/api/health/route.ts",
  "app/api/incentive-preparation/[id]/documents/[documentId]/download/route.ts",
  "app/api/incentive-preparation/[id]/documents/[documentId]/extract/route.ts",
  "app/api/incentive-preparation/[id]/documents/[documentId]/route.ts",
  "app/api/incentive-preparation/[id]/documents/route.ts",
  "app/api/incentive-preparation/[id]/route.ts",
  "app/api/incentive-preparation/[id]/support-request/draft/route.ts",
  "app/api/incentive-preparation/[id]/support-request/route.ts",
  "app/api/incentive-preparation/route.ts",
  "app/api/leads/route.ts",
  "app/api/local-business-support/route.ts",
  "app/api/mobility-access/route.ts",
  "app/api/neighborhood-anchors/route.ts",
  "app/api/neighborhood-economics/route.ts",
  "app/api/owner-file/[clusterKey]/outreach/route.ts",
  "app/api/owner-file/[clusterKey]/route.ts",
  "app/api/owner-file/[clusterKey]/verification/route.ts",
  "app/api/owner-file/geo/route.ts",
  "app/api/owner-file/investment/route.ts",
  "app/api/owner-file/session/route.ts",
  "app/api/parcel/route.ts",
  "app/api/parcel-space/route.ts",
  "app/api/permit-area/route.ts",
  "app/api/permit-match/route.ts",
  "app/api/permits/route.ts",
  "app/api/projects/[id]/route.ts",
  "app/api/projects/route.ts",
  "app/api/representatives/route.ts",
  "app/api/search-log/route.ts",
  "app/api/site-activity/route.ts",
  "app/api/stacking/route.ts",
  "app/api/stats/route.ts",
  "app/api/tif-finance/route.ts",
  "app/api/vacant/route.ts",
  "app/api/watchlist/route.ts",
  "app/api/zones/check/route.ts",
  "app/api/zones/check/v2/route.ts",
  "app/api/zones/geojson/[key]/route.ts",
  "app/api/zoning/legislation/route.ts",
  "app/api/zoning/route.ts",
  "app/check/page.tsx",
  "app/forgot-password/page.tsx",
  "app/future-of-commerce/page.tsx",
  "app/investment/[area]/page.tsx",
  "app/investment/compare/page.tsx",
  "app/investment/page.tsx",
  "app/learn/page.tsx",
  "app/login/page.tsx",
  "app/map/page.tsx",
  "app/page.tsx",
  "app/print/investment/[area]/page.tsx",
  "app/programs/page.tsx",
  "app/reset-password/page.tsx",
  "app/start/page.tsx",
  "app/vacancy/[zip]/areas/[clusterId]/page.tsx",
  "app/vacancy/[zip]/areas/page.tsx",
  "app/vacancy/[zip]/cases/page.tsx",
  "app/vacancy/[zip]/directory/page.tsx",
  "app/vacancy/[zip]/map/page.tsx",
  "app/vacancy/[zip]/page.tsx",
  "app/vacancy/page.tsx",
  "app/vacancy/ux-lab/page.tsx",
  "app/workspace/business-file/[id]/edit/page.tsx",
  "app/workspace/business-file/page.tsx",
  "app/workspace/incentive-preparation/[id]/page.tsx",
  "app/workspace/incentive-preparation/new/page.tsx",
  "app/workspace/page.tsx",
  "app/workspace/projects/[id]/page.tsx",
  "app/workspace/reports/[id]/page.tsx",
] as const;

export interface DiscoveryViolation {
  filePath: string;
  reason: string;
}

/** Walks app/ for every page.tsx and route.ts (excluding tests), and
 *  FAILS for any file that is NEITHER covered by a
 *  PUBLIC_CLAIM_SURFACES entry (exact file OR contained in a listed
 *  directory — the same resolution rule `resolveSurfaceFiles` uses) NOR
 *  in the documented `PUBLIC_CLAIM_SURFACES_KNOWN_GAPS` baseline above.
 *  A genuinely NEW page/route that is neither registered nor an
 *  already-known, already-documented gap is exactly what this exists to
 *  catch. */
export function findUnregisteredPublicSinks(
  allAppFiles: readonly string[],
  registrySurfaces: readonly PublicClaimSurface[],
  knownGaps: readonly string[] = PUBLIC_CLAIM_SURFACES_KNOWN_GAPS,
): DiscoveryViolation[] {
  const registeredDirs = registrySurfaces
    .flatMap((s) => s.files.filter((f) => !/\.(ts|tsx)$/.test(f)))
    .map((d) => `${d.replace(/\/+$/, "")}/`);
  const registeredFiles = new Set(
    registrySurfaces.flatMap((s) => s.files.filter((f) => /\.(ts|tsx)$/.test(f))),
  );
  const knownGapSet = new Set(knownGaps);

  const violations: DiscoveryViolation[] = [];
  for (const file of allAppFiles) {
    if (registeredFiles.has(file)) continue;
    if (registeredDirs.some((dir) => file.startsWith(dir))) continue;
    if (knownGapSet.has(file)) continue;
    violations.push({
      filePath: file,
      reason: `${file} is a public sink (page.tsx/route.ts) with no PUBLIC_CLAIM_SURFACES entry and is not in the documented PUBLIC_CLAIM_SURFACES_KNOWN_GAPS baseline — register it (with the claim contract(s) it's responsible for) or add it to the baseline with a reviewed rationale.`,
    });
  }
  return violations;
}
