import type { Program } from "./types";
import { slugifyProgramName } from "./program-slug";

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

// For server components — reads data/programs-internal.json directly
// (server-only per PR1 section 1.2's next.config.ts outputFileTracingIncludes;
// every caller of this function is a server component or route handler).
export function getProgramsSync(): Program[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../data/programs-internal.json") as Program[];
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
