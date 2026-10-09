import type { PublicProgramView } from "./program-public";
import { getIndustryById } from "./industries-data";

const CDG_ORDER: Record<string, number> = { cdgSmall: 0, cdgMedium: 1, cdgLarge: 2 };

/** Preserve existing catalog order except for the requested CDG / NSF emphasis. */
export function sortProgramsForDirectory<T extends { id: string }>(programs: T[]): T[] {
  const rank = (program: T) => CDG_ORDER[program.id] ?? (program.id === "nsfSeedFund" ? 100 : 50);
  return [...programs].sort((a, b) => rank(a) - rank(b));
}

export function matchesProgramSearch(program: PublicProgramView, query: string): boolean {
  const text = [program.id, program.name, program.resourceType, program.benefit.summary,
    program.links.administeringAgency, program.links.sourceUrl, ...program.screening.publishedCriteria,
  ].join(" ").toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every((word) => text.includes(word));
}

export function matchesProgramIndustry(program: { id: string; industryIds?: string[] }, industryId: string): boolean {
  if (!industryId) return true;
  return Boolean(getIndustryById(industryId)?.topPrograms.includes(program.id) ||
    program.industryIds?.includes(industryId) || program.industryIds?.includes("all"));
}

/** TIF is the Explorer's SBIF geography proxy; unknown coverage is not a negative match. */
export function prioritizeCdg(zones?: Record<string, boolean>): boolean {
  return zones?.tif === false && zones?.nof === false;
}

export const CDG_PRIORITY_REASON = "Outside the mapped SBIF/TIF and NOF areas: explore citywide CDG for a qualifying capital project. DPD must confirm project eligibility.";

export const RESOURCE_TYPE_LABELS = {
  grant: "Grant",
  loan: "Loan",
  equity: "Equity investment",
  "tax-credit": "Tax credit",
  advisory: "Advisory service",
};
