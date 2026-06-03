/**
 * Neighborhood economic models — transparent, modeled signals.
 *
 * These functions produce MODELED estimates (leakage, local multiplier, anchor
 * ranking), never measured facts. Every model exposes its assumptions so the
 * report can keep them visible, per the Neighborhood Economic Context plan:
 *   - Leakage is a "modeled leakage hypothesis", not observed local sales.
 *   - Multiplier is a "scenario-planning estimate", not guaranteed impact.
 *   - Anchor ranking is a modeled score over curated/public business records;
 *     it never invents businesses or precise headcounts/revenue.
 */

// ── Leakage ──────────────────────────────────────────────────────────
// Share of aggregate resident income that is realistically spent on
// locally-servable retail/food/personal services (the categories a
// neighborhood business district can actually capture).
export const LOCALLY_CAPTURABLE_SHARE = 0.32;
// Rough sales-per-payroll-dollar: payroll is ~20% of retail/services sales,
// so local sales capacity ≈ payroll × 5. Directional only.
export const SALES_PER_PAYROLL_DOLLAR = 5;

export interface LeakageModelInput {
  residentSpendingPowerProxy?: number | null;
  localAnnualPayroll?: number | null;
}

export interface LeakageModelResult {
  estimatedLeakageRate: number | null; // 0..1
  capturableDemand: number | null;
  localCapacity: number | null;
  assumptions: string[];
}

export function modelNeighborhoodLeakage(input: LeakageModelInput): LeakageModelResult | null {
  const { residentSpendingPowerProxy, localAnnualPayroll } = input;
  if (residentSpendingPowerProxy == null || localAnnualPayroll == null) return null;
  if (residentSpendingPowerProxy <= 0) return null;

  const capturableDemand = residentSpendingPowerProxy * LOCALLY_CAPTURABLE_SHARE;
  const localCapacity = localAnnualPayroll * SALES_PER_PAYROLL_DOLLAR;
  const rawRate = (capturableDemand - localCapacity) / capturableDemand;
  const estimatedLeakageRate = Math.min(0.95, Math.max(0, rawRate));

  return {
    estimatedLeakageRate,
    capturableDemand,
    localCapacity,
    assumptions: [
      `Assumes ~${Math.round(LOCALLY_CAPTURABLE_SHARE * 100)}% of resident income is spent on locally-servable retail, food, and personal services.`,
      `Assumes local business sales capacity ≈ ${SALES_PER_PAYROLL_DOLLAR}× annual payroll.`,
      "Directional only — a modeled hypothesis to test with partner sales data, not measured leakage.",
    ],
  };
}

// ── Local multiplier (scenario) ──────────────────────────────────────
export const MULTIPLIER_LOW = 1.4;
export const MULTIPLIER_HIGH = 1.8;

export interface MultiplierModelInput {
  localAnnualPayroll?: number | null;
  localEmployment?: number | null;
}

export interface MultiplierModelResult {
  localOutputEstimateLow: number | null;
  localOutputEstimateHigh: number | null;
  multiplierLow: number;
  multiplierHigh: number;
  assumptions: string[];
}

export function modelLocalMultiplier(input: MultiplierModelInput): MultiplierModelResult | null {
  const { localAnnualPayroll } = input;
  if (localAnnualPayroll == null || localAnnualPayroll <= 0) return null;

  return {
    localOutputEstimateLow: localAnnualPayroll * MULTIPLIER_LOW,
    localOutputEstimateHigh: localAnnualPayroll * MULTIPLIER_HIGH,
    multiplierLow: MULTIPLIER_LOW,
    multiplierHigh: MULTIPLIER_HIGH,
    assumptions: [
      `Applies a scenario local-output multiplier of ${MULTIPLIER_LOW}×–${MULTIPLIER_HIGH}× to measured ZIP annual payroll.`,
      "Scenario-planning estimate only — not a guaranteed job, sales, or tax-revenue forecast.",
    ],
  };
}

// ── Anchor ranking (3-factor: employment × revenue × [draw+linkage+continuity]) ──
export type EmploymentBand =
  | "1-9" | "10-49" | "50-99" | "100-249" | "250-499" | "500+" | "unknown";
export type RevenueBand =
  | "<500K" | "500K-1M" | "1M-5M" | "5M-20M" | "20M+" | "unknown";
export type DrawTrait = "destination" | "mixed" | "neighborhood" | "unknown";
export type LinkageTrait = "high" | "medium" | "low" | "unknown";
export type ContinuityTrait = "established" | "new" | "unknown";

export interface CuratedAnchor {
  name: string;
  category?: string;
  employmentBand?: EmploymentBand;
  revenueBand?: RevenueBand;
  draw?: DrawTrait;
  linkage?: LinkageTrait;
  continuity?: ContinuityTrait;
  note?: string;
  source?: string;
}

export interface RankedAnchor extends CuratedAnchor {
  anchorScore: number;
}

const EMP_WEIGHT: Record<EmploymentBand, number> = {
  "1-9": 1, "10-49": 2, "50-99": 3, "100-249": 4, "250-499": 5, "500+": 6, unknown: 1,
};
const REV_WEIGHT: Record<RevenueBand, number> = {
  "<500K": 1, "500K-1M": 2, "1M-5M": 3, "5M-20M": 4, "20M+": 5, unknown: 1,
};
const DRAW_WEIGHT: Record<DrawTrait, number> = { destination: 3, mixed: 2, neighborhood: 1, unknown: 1 };
const LINKAGE_WEIGHT: Record<LinkageTrait, number> = { high: 3, medium: 2, low: 1, unknown: 1 };
const CONTINUITY_WEIGHT: Record<ContinuityTrait, number> = { established: 3, new: 1, unknown: 1 };

/**
 * Anchor score = 2×employment + 2×revenue + draw + linkage + continuity.
 * Employment and revenue (raw size) are weighted double; draw/linkage/continuity
 * are the multiplier-quality factors that turn "big" into "high local impact".
 */
export function scoreAnchor(anchor: CuratedAnchor): number {
  const emp = EMP_WEIGHT[anchor.employmentBand ?? "unknown"] ?? 1;
  const rev = REV_WEIGHT[anchor.revenueBand ?? "unknown"] ?? 1;
  const draw = DRAW_WEIGHT[anchor.draw ?? "unknown"] ?? 1;
  const linkage = LINKAGE_WEIGHT[anchor.linkage ?? "unknown"] ?? 1;
  const continuity = CONTINUITY_WEIGHT[anchor.continuity ?? "unknown"] ?? 1;
  return emp * 2 + rev * 2 + draw + linkage + continuity;
}

export function rankAnchors(anchors: CuratedAnchor[], limit = 5): RankedAnchor[] {
  return anchors
    .filter((a) => a && typeof a.name === "string" && a.name.trim().length > 0)
    .map((a) => ({ ...a, anchorScore: scoreAnchor(a) }))
    .sort((a, b) => b.anchorScore - a.anchorScore)
    .slice(0, limit);
}

// ── Curated workbook anchors (community-area-keyed, source-cited) ─────
// Shape produced by scripts/import-anchor-workbook.ts. These carry a real
// 6-dimension score (0–100), tier, confidence, rationale, and source URLs —
// human-curated, never model-generated.
export interface CommunityAnchorScores {
  employment: number | null;
  localHiring: number | null;
  procurement: number | null;
  footTraffic: number | null;
  serviceGap: number | null;
  communityBenefit: number | null;
}

export interface CommunityAnchor {
  name: string;
  type?: string;
  category?: string;
  site?: string;
  evidenceScale?: string;
  scores?: CommunityAnchorScores;
  totalScore: number | null;
  impactTier?: string;
  confidence?: string;
  multiplierChannels?: string;
  rationale?: string;
  validationNeeded?: string;
  leakageCaveat?: string;
  sourceUrls?: string[];
}

export interface CommunityAnchorFile {
  source?: string;
  scoringDimensions?: Record<string, number>;
  communityAreaCount?: number;
  anchorCount?: number;
  byCommunityArea: Record<string, { communityArea: string; anchors: CommunityAnchor[] }>;
}

export function rankCommunityAnchors(anchors: CommunityAnchor[], limit = 5): CommunityAnchor[] {
  return anchors
    .filter((a) => a && typeof a.name === "string" && a.name.trim().length > 0)
    .slice()
    .sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0))
    .slice(0, limit);
}
