/**
 * Portfolio rubric — CLIENT-SAFE module (no fs). lib/vacancy-index.ts
 * re-exports everything here, so server code keeps importing from there;
 * client components must import from THIS module to keep node:fs out of
 * the bundle (the vacancy-index loader reads the export from disk).
 */

import type { OwnerType } from "./owner-classify";

export type VacancyPortfolio = "move_now" | "organize_next" | "verify" | "long_term";

type PriorityTier = "high" | "medium" | "low"; // mirrors VacancyPriorityTier (type lives in vacancy-index)

export const PORTFOLIO_LABELS: Record<VacancyPortfolio, string> = {
  move_now: "Move now",
  organize_next: "Organize next",
  verify: "Verify",
  long_term: "Long-term",
};

/** Canonical ordering for the four portfolios wherever they're listed/tallied. */
export const PORTFOLIO_ORDER: VacancyPortfolio[] = [
  "move_now",
  "organize_next",
  "verify",
  "long_term",
];

/** The portfolio rubric, printed verbatim beneath the coordinated-intervention
 * cards. One sentence, deriving the four buckets from portfolioForSite's rules. */
export const PORTFOLIO_RUBRIC_NOTE =
  "Portfolios: Verify = owner unknown, or a non-city parcel exposed to tax sale " +
  "(clear title before outreach); Move now = city or public land at high or medium " +
  "priority (disposition-ready); Organize next = a known private or entity owner at " +
  "high or medium priority (outreach candidate); Long-term = everything else.";

/**
 * Sort ONE vacant site into an intervention portfolio (D1). Deterministic,
 * evaluated in this exact order (first match wins):
 *   1. unknown owner                                    -> "verify"
 *   2. tax-sale-exposed non-city parcel                 -> "verify"
 *      (saleYear != null && ownerType !== city_public — title risk before outreach)
 *   3. city_public at high|medium priority              -> "move_now"
 *   4. known private/entity owner at high|medium prio   -> "organize_next"
 *      (local_private | corporate_llc | out_of_state)
 *   5. everything else                                  -> "long_term"
 * `violation` is carried on the input for a stable call shape but is not (yet) a
 * determinant — the rules above are the whole rubric (PORTFOLIO_RUBRIC_NOTE).
 */
export function portfolioForSite(site: {
  ownerType: OwnerType;
  priorityTier: PriorityTier;
  saleYear: number | null;
  violation: boolean;
}): VacancyPortfolio {
  const { ownerType, priorityTier, saleYear } = site;
  const priority = priorityTier === "high" || priorityTier === "medium";

  if (ownerType === "unknown") return "verify";
  if (saleYear != null && ownerType !== "city_public") return "verify";
  if (ownerType === "city_public" && priority) return "move_now";
  if (
    priority &&
    (ownerType === "local_private" ||
      ownerType === "corporate_llc" ||
      ownerType === "out_of_state")
  ) {
    return "organize_next";
  }
  return "long_term";
}

/** Tally portfolios into a full four-key record (honest zeros for absent ones). */
export function tallyPortfolioCounts(
  portfolios: readonly VacancyPortfolio[],
): Record<VacancyPortfolio, number> {
  const counts: Record<VacancyPortfolio, number> = {
    move_now: 0,
    organize_next: 0,
    verify: 0,
    long_term: 0,
  };
  for (const p of portfolios) counts[p] += 1;
  return counts;
}
