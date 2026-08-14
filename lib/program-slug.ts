// review5 S1: split out of lib/programs-data.ts on purpose. That file also
// exports getProgramsSync()/getAllPrograms(), which `require()` the full
// internal catalog (data/programs-internal.json) — every internal-only
// field, unsanitized. slugifyProgramName() is a pure string function with
// no data dependency at all, but before this split it lived in the SAME
// module as that require() call. components/programs/ProgramsCatalog.tsx
// ("use client") only ever needed the slug function, yet importing it
// pulled in a file that also contains a catalog require() — a real,
// non-hypothetical version of exactly the client-transitive leak this
// finding is about, left to bundler tree-shaking to save it rather than
// the import graph itself being safe. This module has zero import of
// programs-internal.json, directly or transitively, so any client
// component using it is provably clean regardless of what the bundler
// decides to tree-shake.
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
