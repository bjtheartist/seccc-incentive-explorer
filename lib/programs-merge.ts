import type { Program } from "@/lib/types";

/**
 * Program copy is maintained in static JSON. Prefer those definitions for
 * known ids so older database seeds cannot reintroduce stale names or copy.
 */
export function preferStaticProgramDefinitions(
  staticPrograms: Program[],
  databasePrograms: Program[]
): Program[] {
  const staticIds = new Set(staticPrograms.map((program) => program.id));
  const databaseOnly = databasePrograms.filter((program) => !staticIds.has(program.id));

  return [...staticPrograms, ...databaseOnly];
}
