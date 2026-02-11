import type { Program } from "./types";

export async function getPrograms(): Promise<Program[]> {
  const res = await fetch("/data/programs.json");
  return res.json();
}

// For server components
export function getProgramsSync(): Program[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../public/data/programs.json") as Program[];
}
