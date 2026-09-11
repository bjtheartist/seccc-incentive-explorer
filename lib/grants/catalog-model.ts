import { z } from "zod";
import type { Applicant } from "./model";
export const catalogSources = [
  "curated",
  "grants.gov",
  "irs_990pf",
  "sam.gov",
  "illinois_csfa",
  "illinois_nofo",
] as const;
export const catalogQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  source: z.enum(["", ...catalogSources]).default(""),
  type: z
    .enum(["", "opportunity", "standing_program", "foundation"])
    .default(""),
  timing: z
    .enum(["", "current", "upcoming", "closed", "unconfirmed"])
    .default(""),
  scope: z.enum(["chicago", "all"]).default("chicago"),
  page: z.coerce.number().int().min(1).max(2000).default(1),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export interface CatalogItem {
  id: string;
  name: string;
  sponsor: string;
  source: string;
  recordType: string;
  relevance: string;
  amount: string;
  fundingType: string;
  sourceStatus: string;
  deadline: string | null;
  opensAt: string | null;
  checkedAt: string | null;
  reviewAt: string | null;
  sourceUrl: string | null;
  complete: boolean;
  missing: string[];
  entities: string[];
  geography: string;
  uses: string[];
  purpose: string;
  linkedProgramId: string | null;
  linkedRoundId: string | null;
  timing: "current" | "upcoming" | "closed" | "unconfirmed";
  payload?: Record<string, unknown>;
}
export interface CatalogPage {
  items: CatalogItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: {
    total: number;
    curated: number;
    opportunities: number;
    foundations: number;
    standing: number;
  };
}
export interface CatalogSuggestions {
  items: CatalogItem[];
  explanation: string;
  applicantId: string;
  applicantVersion: number;
}
export const costFamilies: Record<string, string[]> = {
  roofing: ["building_improvements"],
  plumbing: ["building_improvements"],
  "flood control": ["building_improvements"],
  rehabilitation: ["building_improvements"],
  rehab: ["building_improvements"],
  "building rehabilitation": ["building_improvements"],
  accessibility: ["building_improvements"],
  facade: ["facade", "building_improvements"],
  equipment: ["equipment"],
  "working capital": ["working_capital"],
  marketing: ["marketing"],
  training: ["training"],
  "energy efficiency": ["energy"],
  energy: ["energy"],
};
export function catalogMatchCriteria(a: Applicant) {
  const costs = [
    ...new Set(
      a.costs.flatMap(
        (c) =>
          costFamilies[c.toLowerCase()] ?? [
            c.toLowerCase().replaceAll(" ", "_"),
          ],
      ),
    ),
  ];
  const words =
    `${a.businessType || ""} ${a.industry || a.legacyIndustry || ""} ${a.primaryGoal || ""} ${a.costs.join(" ")}`
      .toLowerCase()
      .match(/[a-z]{3,}/g) ?? [];
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "business",
    "unknown",
    "not",
    "confirmed",
    "open",
    "need",
    "needs",
    "funding",
    "help",
    "primary",
    "goal",
    "new",
    "our",
    "repair",
  ]);
  const terms = [...new Set(words.filter((t) => !stop.has(t)))].slice(0, 16);
  const selected = a.fundingTypes ?? [
    "grant",
    "reimbursement",
    "tax_benefit",
    "loan",
    "in_kind",
  ];
  const funding = selected.flatMap((t) =>
    t === "reimbursement"
      ? a.reimbursementReady === "no"
        ? []
        : ["reimbursement", "rebate"]
      : t === "loan"
        ? ["loan", "forgivable_loan"]
        : [t],
  );
  const entities =
    a.entity === "for_profit"
      ? ["for_profit", "small_business", "unrestricted"]
      : a.entity === "nonprofit"
        ? ["nonprofit", "unrestricted"]
        : a.entity === "individual"
          ? ["individual", "unrestricted"]
          : [];
  return { costs, terms, funding, entities };
}
export function catalogTiming(
  r: {
    recordType: string;
    sourceStatus: string;
    deadline: string | null;
    opensAt: string | null;
    checkedAt: string | null;
    reviewAt: string | null;
  },
  today: string,
): CatalogItem["timing"] {
  if (
    (r.deadline && r.deadline < today) ||
    ["closed", "archived"].includes(r.sourceStatus)
  )
    return "closed";
  // Foundation filings and standing listings do not establish a current round.
  if (
    r.recordType !== "opportunity" ||
    !r.checkedAt ||
    !r.reviewAt ||
    r.reviewAt <= today
  )
    return "unconfirmed";
  if ((r.opensAt && r.opensAt > today) || r.sourceStatus === "scheduled")
    return "upcoming";
  return ["open", "rolling"].includes(r.sourceStatus)
    ? "current"
    : "unconfirmed";
}
export function safeCatalogUrl(value: unknown): string | null {
  if (typeof value !== "string" || /\s/.test(value)) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443")
      ? u.href
      : null;
  } catch {
    return null;
  }
}
