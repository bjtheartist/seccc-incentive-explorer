import type { Program } from "./types";

// build-spec.md 2.2 (hard cutover): public/data/programs.json is deleted.
// Client callers fetch the server route (which itself now reads from
// data/programs-internal.json — see app/api/programs/route.ts).
export async function getPrograms(): Promise<Program[]> {
  const res = await fetch("/api/programs");
  return res.json();
}

// For server components — reads data/programs-internal.json directly
// (server-only per PR1 section 1.2's next.config.ts outputFileTracingIncludes;
// every caller of this function is a server component or route handler).
export function getProgramsSync(): Program[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../data/programs-internal.json") as Program[];
}

/**
 * Build a clean URL slug from a program name.
 * Strips a trailing parenthetical abbreviation so
 * "Neighborhood Opportunity Fund (NOF)" -> "neighborhood-opportunity-fund".
 */
export function slugifyProgramName(name: string): string {
  return name
    .replace(/\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
