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

/** The five rubric branches that decide a site's portfolio. Two of them
 * ("unknown_owner" and "tax_sale_noncity") map to the SAME portfolio ("verify")
 * but carry different one-sentence reasons, which is why the reason and the
 * portfolio are both derived from this single branch key rather than from the
 * portfolio alone. */
type PortfolioBranch =
  | "unknown_owner"
  | "tax_sale_noncity"
  | "city_priority"
  | "private_priority"
  | "residual";

/** The site fields both portfolioForSite and portfolioReason read. `violation`
 * is carried for a stable call shape but is not (yet) a determinant. */
interface PortfolioSite {
  ownerType: OwnerType;
  priorityTier: PriorityTier;
  saleYear: number | null;
  violation: boolean;
}

/**
 * The single source of truth for the portfolio cascade (D1). Deterministic,
 * evaluated in this exact order (first match wins):
 *   1. unknown owner                                    -> "unknown_owner"
 *   2. tax-sale-exposed non-city parcel                 -> "tax_sale_noncity"
 *      (saleYear != null && ownerType !== city_public — title risk before outreach)
 *   3. city_public at high|medium priority              -> "city_priority"
 *   4. known private/entity owner at high|medium prio   -> "private_priority"
 *      (local_private | corporate_llc | out_of_state)
 *   5. everything else                                  -> "residual"
 * Both portfolioForSite (via BRANCH_PORTFOLIO) and portfolioReason (via
 * BRANCH_REASON) key off this one function, so the label and its "because"
 * sentence can never drift apart.
 */
function portfolioBranchForSite(site: PortfolioSite): PortfolioBranch {
  const { ownerType, priorityTier, saleYear } = site;
  const priority = priorityTier === "high" || priorityTier === "medium";

  if (ownerType === "unknown") return "unknown_owner";
  if (saleYear != null && ownerType !== "city_public") return "tax_sale_noncity";
  if (ownerType === "city_public" && priority) return "city_priority";
  if (
    priority &&
    (ownerType === "local_private" ||
      ownerType === "corporate_llc" ||
      ownerType === "out_of_state")
  ) {
    return "private_priority";
  }
  return "residual";
}

/** Branch -> portfolio. */
const BRANCH_PORTFOLIO: Record<PortfolioBranch, VacancyPortfolio> = {
  unknown_owner: "verify",
  tax_sale_noncity: "verify",
  city_priority: "move_now",
  private_priority: "organize_next",
  residual: "long_term",
};

/** Branch -> the one-sentence "Move now because…" reason. Each reason begins
 * with its portfolio's PORTFOLIO_LABELS text ("Verify", "Move now", "Organize
 * next", "Long-term") so portfolioReason(x) always leads with
 * PORTFOLIO_LABELS[portfolioForSite(x)] — the alignment the unit test guards. */
const BRANCH_REASON: Record<PortfolioBranch, string> = {
  unknown_owner: "Verify — ownership is not sufficiently resolved for outreach.",
  tax_sale_noncity: "Verify — tax-sale exposure requires a title and tax review before outreach.",
  city_priority: "Move now — publicly controlled with a clear disposition pathway.",
  private_priority: "Organize next — a known private owner and a workable outreach pathway.",
  residual: "Long-term — limited near-term leverage; revisit as conditions change.",
};

/** Sort ONE vacant site into an intervention portfolio (D1). See
 * portfolioBranchForSite for the cascade. */
export function portfolioForSite(site: PortfolioSite): VacancyPortfolio {
  return BRANCH_PORTFOLIO[portfolioBranchForSite(site)];
}

/**
 * The one-sentence "because" for a site's portfolio — the decision-oriented
 * REASON Billy asked the site card to carry instead of a bare score. Keyed off
 * the SAME branch as portfolioForSite, so the reason always matches the label
 * (and distinguishes the two "verify" branches, which portfolioForSite alone
 * cannot). Its prefix is exactly PORTFOLIO_LABELS[portfolioForSite(site)].
 */
export function portfolioReason(site: PortfolioSite): string {
  return BRANCH_REASON[portfolioBranchForSite(site)];
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
