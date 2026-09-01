import type { Program } from "./types";
import { slugifyProgramName } from "./program-slug";
import { ProgramSchema } from "./schemas";

// review5 S1: the client fetch variant that used to live here
// (`getPrograms()`) was dead code (zero callers, confirmed by grep) and
// its return-type annotation (`Program[]`) would have silently lied about
// what /api/programs now actually returns (PublicProgramView[], since
// that route projects through the DTO — see app/api/programs/route.ts).
// Removed rather than left as a misleading, unused export.

// review5 S1: slugifyProgramName() moved to lib/program-slug.ts (a module
// with zero data dependency) so a client component that only needs the
// slug function never has to import a file that ALSO require()s the full
// internal catalog. Re-exported here for the server-only callers below
// that legitimately want both.
export { slugifyProgramName };

/**
 * Has the internal catalog been validated in this process yet? Validation runs
 * ONCE, on the first `getProgramsSync()` call, rather than at module top level
 * — a top-level check would `require()` the catalog on import and defeat the
 * lazy pattern the comment above exists to protect.
 */
let _catalogValidated = false;

/**
 * Validate data/programs-internal.json against ProgramSchema.
 *
 * The catalog was read straight off disk and cast — `require(…) as Program[]`
 * — so a malformed record (a missing `summary`, a `level` outside the enum, a
 * `deadlines` entry with no `date`) flowed into the report engine, the
 * confidence engine and every public program surface wearing the `Program`
 * type without anything ever checking it. The public/static path through
 * `safeParseArray` was validated; this one, the INTERNAL catalog that feeds
 * report generation, was not.
 *
 * Fails differently by environment on purpose:
 * - dev/test: THROW. A bad catalog is a committed-data bug, and it should stop
 *   CI at the first test that loads programs rather than surface later as a
 *   wrong report.
 * - production: log loudly and continue with the catalog as-is. Refusing to
 *   serve any report at all because one of ~71 records has a bad field would
 *   be a far worse outage than serving the other 70, and a deploy is not the
 *   place to discover this — CI already had its chance to.
 */
export function assertProgramCatalogValid(catalog: unknown): void {
  if (!Array.isArray(catalog)) {
    reportCatalogProblem("[programs-internal] catalog is not an array");
    return;
  }

  const failures: string[] = [];
  for (const record of catalog) {
    const parsed = ProgramSchema.safeParse(record);
    if (parsed.success) continue;
    const id =
      record && typeof record === "object" && record !== null && "id" in record
        ? String((record as { id: unknown }).id)
        : "(no id)";
    const issue = parsed.error.issues?.[0];
    const where = issue?.path?.length ? issue.path.join(".") : "(root)";
    failures.push(`${id} → ${where}: ${issue?.message ?? "unknown error"}`);
  }

  if (failures.length === 0) return;

  reportCatalogProblem(
    `[programs-internal] ${failures.length} of ${catalog.length} catalog record(s) ` +
      `fail ProgramSchema:\n  ${failures.join("\n  ")}`,
  );
}

function reportCatalogProblem(message: string): void {
  if (process.env.NODE_ENV === "production") {
    console.error(message);
    return;
  }
  throw new Error(message);
}

/** Test-only: re-arm the one-shot catalog validation. */
export function __resetCatalogValidationForTests(): void {
  _catalogValidated = false;
}

// For server components — reads data/programs-internal.json directly
// (server-only per PR1 section 1.2's next.config.ts outputFileTracingIncludes;
// every caller of this function is a server component or route handler).
export function getProgramsSync(): Program[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const catalog = require("../data/programs-internal.json") as Program[];
  if (!_catalogValidated) {
    _catalogValidated = true;
    assertProgramCatalogValid(catalog);
  }
  return catalog;
}

// Lazily-built slug maps (server-only; avoids top-level require in client bundles).
let _slugToProgram: Map<string, Program> | null = null;
let _idToSlug: Map<string, string> | null = null;

function ensureSlugMaps(): void {
  if (_slugToProgram && _idToSlug) return;
  _slugToProgram = new Map();
  _idToSlug = new Map();
  for (const program of getProgramsSync()) {
    let slug = slugifyProgramName(program.name);
    if (!slug || _slugToProgram.has(slug)) {
      slug = `${slug ? `${slug}-` : ""}${program.id.toLowerCase()}`;
    }
    _slugToProgram.set(slug, program);
    _idToSlug.set(program.id, slug);
  }
}

export function getAllPrograms(): Program[] {
  return getProgramsSync();
}

export function getProgramBySlug(slug: string): Program | undefined {
  ensureSlugMaps();
  return _slugToProgram!.get(slug);
}

export function programSlug(program: Program): string {
  ensureSlugMaps();
  return _idToSlug!.get(program.id) ?? slugifyProgramName(program.name);
}

export function allProgramSlugs(): string[] {
  ensureSlugMaps();
  return [..._slugToProgram!.keys()];
}

/** Programs that share the same government level, excluding the given one. */
export function relatedPrograms(program: Program, limit = 4): Program[] {
  return getProgramsSync()
    .filter((p) => p.id !== program.id && p.level === program.level)
    .slice(0, limit);
}
