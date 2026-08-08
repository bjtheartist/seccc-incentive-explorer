export const DOCUMENT_PREPARATION_COST_TIERS = ["$", "$$", "$$$"] as const;

export type DocumentPreparationCostTier =
  (typeof DOCUMENT_PREPARATION_COST_TIERS)[number];

export interface DocumentPreparationCostSignal {
  tier: DocumentPreparationCostTier;
  basis: string;
}

export const DOCUMENT_PREPARATION_COST_LEGEND: ReadonlyArray<{
  tier: DocumentPreparationCostTier;
  label: string;
}> = [
  { tier: "$", label: "Usually self-provided or low/no fee" },
  { tier: "$$", label: "May involve filing fees or professional help" },
  { tier: "$$$", label: "Often requires specialized professional work" },
];

export const DOCUMENT_PREPARATION_COST_CAVEAT =
  "Costs vary; this reflects document preparation, not program value.";

const HIGH_COST_PATTERN =
  /\b(?:audited? financial (?:statement|statements|report|reports)|financial (?:statement|statements|report|reports) audit|appraisal|environmental (?:assessment|review|report|study)|phase (?:i|ii|1|2) environmental|architect(?:ural|ure)? (?:plan|plans|drawing|drawings|services)|engineering (?:plan|plans|drawing|drawings|report|reports|services)|legal opinion|opinion of counsel)\b/i;

const MEDIUM_COST_PATTERN =
  /\b(?:permit|permits|certificate|certificates|good standing|contractor (?:bid|bids|estimate|estimates|quote|quotes)|tax clearance|insurance (?:certificate|certification)|property survey|boundary survey|land survey|survey report|filing fee|filing fees)\b/i;

const LOW_COST_PATTERN =
  /\b(?:w-?9|identification|photo id|government id|driver'?s license|tax return|tax returns|bank statement|bank statements|business plan|proof of (?:property )?ownership|ownership proof|lease|ordinary financial statement|ordinary financial statements|financial statement|financial statements)\b/i;

const NO_DOCUMENT_REQUIRED_PATTERNS = [
  /\bno formal documents? (?:(?:is|are) )?required\b/i,
  /\bno documents? (?:(?:is|are) )?required\b/i,
  /^\s*(?:none|n\/a|not applicable)\s*(?:required)?\s*[.!]?\s*$/i,
] as const;

/**
 * Returns true only for an explicit statement that a program does not request a
 * formal document. These entries are guidance, not document requirements.
 */
export function isExplicitNoDocumentRequirement(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  return NO_DOCUMENT_REQUIRED_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Classify the likely effort/cost to obtain or prepare a document. This is a
 * qualitative preparation signal, never a vendor quote or incentive value.
 */
export function classifyDocumentPreparationCost(
  ...requirementText: Array<string | null | undefined>
): DocumentPreparationCostSignal {
  const text = requirementText.filter(Boolean).join(" ").trim();

  if (HIGH_COST_PATTERN.test(text)) {
    return {
      tier: "$$$",
      basis: "Often requires specialized professional work.",
    };
  }

  if (MEDIUM_COST_PATTERN.test(text)) {
    return {
      tier: "$$",
      basis: "May involve filing fees or professional help.",
    };
  }

  if (LOW_COST_PATTERN.test(text)) {
    return {
      tier: "$",
      basis: "Usually gathered from existing business records.",
    };
  }

  return {
    tier: "$",
    basis: "Typically gathered from existing business records.",
  };
}
