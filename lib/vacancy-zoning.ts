/**
 * Chicago zoning-district glosses — CLIENT-SAFE module (no fs). The site card
 * (components/vacancy/VacancyReportMap.tsx) turns a bare district code like
 * "C1-1" into a plain-language line a non-planner can read, always with an
 * eligibility caution appended (a district permits a use class, never a
 * specific project — that is verified case by case).
 *
 * Prefixes are matched longest-first so multi-letter districts (PMD, POS, DX)
 * win over the single-letter families (B / C / M). An unrecognized code still
 * returns a usable, honest line ("verify allowable uses").
 */

/** Chicago district prefixes, longest-first, mapped to a plain-language use
 * class. First matching prefix wins. */
const ZONING_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["PMD", "Planned Manufacturing District"],
  ["POS", "Parks/open space"],
  ["PD", "Planned Development — site-specific terms"],
  ["DX", "Downtown mixed/core/residential"],
  ["DC", "Downtown mixed/core/residential"],
  ["DR", "Downtown mixed/core/residential"],
  ["RS", "Residential (detached/townhouse/multi-unit)"],
  ["RT", "Residential (detached/townhouse/multi-unit)"],
  ["RM", "Residential (detached/townhouse/multi-unit)"],
  ["B", "Neighborhood/community shopping and mixed-use"],
  ["C", "neighborhood commercial uses"],
  ["M", "Manufacturing/industrial"],
];

/**
 * Plain-language gloss for a Chicago zoning district code, always ending in an
 * eligibility caution. Examples:
 *   "C1-1" -> "C1-1 — neighborhood commercial uses; verify project-specific eligibility."
 *   "XZ-9" -> "Zoning XZ-9 — verify allowable uses."   (unrecognized prefix)
 *   null / "" -> null                                   (nothing to gloss)
 */
export function zoningGloss(zoningClass: string | null): string | null {
  if (zoningClass == null) return null;
  const code = zoningClass.trim();
  if (!code) return null;

  const upper = code.toUpperCase();
  for (const [prefix, gloss] of ZONING_PREFIXES) {
    if (upper.startsWith(prefix)) {
      return `${code} — ${gloss}; verify project-specific eligibility.`;
    }
  }
  return `Zoning ${code} — verify allowable uses.`;
}
