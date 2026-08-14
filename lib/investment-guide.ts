/**
 * First-visit spotlight tour for the gated /investment landing page. Kept
 * entirely separate from lib/first-visit-guide.ts (the public-site tour):
 * its own storage key, its own version counter, its own replay event — so
 * completing one tour can never be mistaken for completing the other, and a
 * version bump on one never silently reopens the other.
 *
 * The page is admin-only and single-page (no cross-page handoff like the
 * public tour's home → report legs), so this module stays much smaller:
 * one step list, one storage key, no session-storage leg-handoff machinery.
 */

export const INVESTMENT_GUIDE_VERSION = 1;
export const INVESTMENT_GUIDE_STORAGE_KEY = "cie:investment-guide";
/** Dispatched by the persistent replay button to re-trigger the tour on demand. */
export const INVESTMENT_GUIDE_OPEN_EVENT = "cie:open-investment-guide";

export type InvestmentGuideStatus = "completed" | "skipped";

export interface InvestmentGuidePreference {
  version: number;
  status: InvestmentGuideStatus;
  updatedAt: string;
}

export interface InvestmentTourStep {
  key: string;
  selector: string;
  title: string;
  description: string;
  side: "top" | "right" | "bottom" | "left";
}

/**
 * Six stops across the landing page, anchored to elements that exist in
 * app/investment/page.tsx today (verified against that file, not assumed).
 * Two selectors (pin-button, ranking-filter) ride a compound CSS selector
 * scoped under the ranking section's own data-tour hook rather than a
 * dedicated data-tour attribute of their own: CommunityRankingList.tsx and
 * PinControls.tsx render the filter input and the per-row pin buttons, and
 * neither file is in this change's edit fence, so the anchor is expressed
 * structurally (input[type="search"], button[aria-pressed]) instead. Both
 * are unique within the scoped section on this page today.
 */
export const INVESTMENT_TOUR_STEPS: InvestmentTourStep[] = [
  {
    key: "status-cards",
    selector: '[data-tour="investment-status-cards"]',
    title: "Three ways to read the money",
    description:
      "Awarded dollars are documented public commitments. Announced capital is self-reported private development cost. Disbursements are actual payments — only closed recovery programs report those, citywide, and ordinary award/foundation/TIF/HUD/tax-credit/appropriation sources don't. These three are never added together, and an award means a commitment on paper, not money received.",
    side: "bottom",
  },
  {
    key: "trust-capsule",
    selector: '[data-tour="investment-trust-capsule"]',
    title: "What the numbers do not claim",
    description:
      "This line never collapses, because it carries two limits worth knowing before you trust a number: the date the data is current as of, and the fact that some records have no map location and are counted in the totals above but never plotted anywhere.",
    side: "bottom",
  },
  {
    key: "start-here",
    selector: '[data-tour="investment-start-here"]',
    title: "Three ways to use this page",
    description:
      "Open one community below for its full funding profile, pin a few communities to compare them side by side, or open a community and use its printable brief to hand off to someone else. Each block here says exactly how to start.",
    side: "bottom",
  },
  {
    key: "community-ranking",
    selector: '[data-tour="investment-community-ranking"]',
    title: "Every community, ranked",
    description:
      "Communities are ranked by awarded dollars, highest first. Type into the filter box above the list to narrow it by name — filtering never re-ranks, so a community keeps its original position number even inside a narrowed list.",
    side: "top",
  },
  {
    key: "pin-button",
    // Scoped under the ranking section's own hook; see the module comment above.
    selector: '[data-tour="investment-community-ranking"] button[aria-pressed]',
    title: "Pin communities to compare",
    description:
      "This star button adds a community to a working compare set. Pin between two and four communities this way and a compare bar appears fixed to the bottom of the page, with a link to a full side-by-side view once enough are pinned. The button is easy to miss — the comparison it opens up is not.",
    side: "left",
  },
  {
    key: "about-data",
    selector: '[data-tour="investment-about-data"]',
    title: "Where the full picture lives",
    description:
      "This collapsed block holds the funding-purpose definitions and the per-source coverage — what each source covers, whether it is mapped, how often it refreshes, and its review posture. From here, click any community above for its full funding profile, including recipients and funders, then use Print brief on that page for a clean, hand-off-ready PDF.",
    side: "top",
  },
];

export function readInvestmentGuidePreference(
  storage: Pick<Storage, "getItem">,
): InvestmentGuidePreference | null {
  try {
    const raw = storage.getItem(INVESTMENT_GUIDE_STORAGE_KEY);
    if (!raw) return null;

    const value = JSON.parse(raw) as Partial<InvestmentGuidePreference>;
    if (
      value.version !== INVESTMENT_GUIDE_VERSION ||
      (value.status !== "completed" && value.status !== "skipped") ||
      typeof value.updatedAt !== "string"
    ) {
      return null;
    }

    return value as InvestmentGuidePreference;
  } catch {
    return null;
  }
}

export function writeInvestmentGuidePreference(
  storage: Pick<Storage, "setItem">,
  status: InvestmentGuideStatus,
) {
  const preference: InvestmentGuidePreference = {
    version: INVESTMENT_GUIDE_VERSION,
    status,
    updatedAt: new Date().toISOString(),
  };

  try {
    storage.setItem(INVESTMENT_GUIDE_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // The tour remains optional when storage is blocked or unavailable.
  }

  return preference;
}
