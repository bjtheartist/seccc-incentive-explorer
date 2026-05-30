/**
 * Corridor Health — pure metric functions.
 *
 * These functions compute the six corridor-health metrics and a composite
 * health score from plain in-memory row arrays. They are intentionally free of
 * any DB / network dependency so they can be unit-tested with hand-built
 * fixtures. The compute script (`scripts/compute-corridor.ts`) is responsible
 * for running the SQL aggregations and feeding the resulting rows into these
 * functions.
 *
 * A "corridor" is keyed by ZIP code for v1 (60617 / 60619 / 60649), since most
 * domain tables carry a `zip` column.
 */

import type { OwnerType } from "./owner-classify";

/* ──────────────────────────────────────────────────────────────────────────
 * Input row shapes (minimal — only the fields each metric needs)
 * ──────────────────────────────────────────────────────────────────────── */

/** A parcel row, as consumed by ownership / vacancy metrics. */
export interface ParcelRow {
  pin: string;
  is_vacant?: boolean | null;
  owner_name?: string | null;
  owner_type?: OwnerType | string | null;
}

/** A business-license row, as consumed by the turnover metric. */
export interface BusinessLicenseRow {
  license_status?: string | null;
  license_start_date?: string | Date | null;
  expiration_date?: string | Date | null;
}

/** A building-permit row, as consumed by the permit-activity metric. */
export interface PermitRow {
  issue_date?: string | Date | null;
  reported_cost?: number | string | null;
  is_demolition?: boolean | null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Per-metric result types
 * ──────────────────────────────────────────────────────────────────────── */

export interface VacancyMetric {
  /** Share of parcels flagged vacant, 0..1. */
  vacancyRate: number;
  vacantCount: number;
  totalParcels: number;
}

export interface TurnoverMetric {
  openings: number;
  closures: number;
  /** Net openings minus closures. */
  net: number;
  /** Churn = (openings + closures) / active-ish base, 0..1+ (clamped at base). */
  turnoverRate: number;
}

export interface OwnershipConcentrationMetric {
  /** Herfindahl-Hirschman Index over owner_name shares, 0..1 (1 = monopoly). */
  hhi: number;
  /** Share held by the single largest owner, 0..1. */
  topOwnerShare: number;
  distinctOwners: number;
  totalParcels: number;
}

export interface OwnershipOriginMetric {
  /** Share of parcels owned by local_private owners, 0..1. */
  localShare: number;
  /** Share owned by out_of_state + corporate_llc (outside capital), 0..1. */
  outsideShare: number;
  localCount: number;
  outsideCount: number;
  totalParcels: number;
}

export interface PermitActivityMetric {
  permitCount: number;
  totalReportedCost: number;
  demolitionCount: number;
}

export interface IncentiveCoverageMetric {
  /** Share of parcels inside any incentive zone, 0..1, or null when unknown. */
  coverageShare: number | null;
  coveredCount: number | null;
  totalParcels: number;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Aggregate metrics + composite score
 * ──────────────────────────────────────────────────────────────────────── */

export interface CorridorMetrics {
  corridorType: "zip";
  corridorId: string;
  asOf: string; // ISO date (YYYY-MM-DD)
  vacancy: VacancyMetric;
  turnover: TurnoverMetric;
  ownershipConcentration: OwnershipConcentrationMetric;
  ownershipOrigin: OwnershipOriginMetric;
  permits: PermitActivityMetric;
  incentiveCoverage: IncentiveCoverageMetric;
  healthScore: number; // 0..100
}

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────── */

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Clamp a value into [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** License statuses that indicate a license is no longer active. */
const CLOSED_STATUSES = new Set(["AAC", "REV", "CAN", "EXP", "INA"]);

/* ──────────────────────────────────────────────────────────────────────────
 * Metric 1 — Vacancy
 * Formula: vacancyRate = vacantParcels / totalParcels.
 * ──────────────────────────────────────────────────────────────────────── */

export function computeVacancy(parcels: ParcelRow[]): VacancyMetric {
  const totalParcels = parcels.length;
  const vacantCount = parcels.filter((p) => p.is_vacant === true).length;
  return {
    vacancyRate: totalParcels === 0 ? 0 : vacantCount / totalParcels,
    vacantCount,
    totalParcels,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Metric 2 — Business turnover
 * Openings  = licenses whose start_date falls inside the trailing window.
 * Closures  = licenses with a closed status whose expiration_date falls inside
 *             the window (or any closed-status license when no date present).
 * turnoverRate = (openings + closures) / total licenses considered (0 when none).
 * ──────────────────────────────────────────────────────────────────────── */

export function computeTurnover(
  licenses: BusinessLicenseRow[],
  windowStart: Date,
  windowEnd: Date
): TurnoverMetric {
  let openings = 0;
  let closures = 0;

  for (const lic of licenses) {
    const start = toDate(lic.license_start_date);
    if (start && start >= windowStart && start <= windowEnd) openings += 1;

    const closed = CLOSED_STATUSES.has((lic.license_status ?? "").toUpperCase());
    if (closed) {
      const exp = toDate(lic.expiration_date);
      // Count a closure if its expiration lands in the window, or if it is
      // flagged closed but carries no usable date (treat as recent closure).
      if (!exp || (exp >= windowStart && exp <= windowEnd)) closures += 1;
    }
  }

  const total = licenses.length;
  const turnoverRate = total === 0 ? 0 : clamp((openings + closures) / total, 0, 1);

  return { openings, closures, net: openings - closures, turnoverRate };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Metric 3 — Ownership concentration
 * HHI = Σ (sᵢ)²  where sᵢ is owner i's share of parcels (0..1).
 *   1 parcel-per-distinct-owner → HHI → 1/n  (low concentration)
 *   single owner of everything  → HHI = 1    (monopoly)
 * topOwnerShare = largest single owner's parcel share.
 * ──────────────────────────────────────────────────────────────────────── */

export function computeOwnershipConcentration(
  parcels: ParcelRow[]
): OwnershipConcentrationMetric {
  const totalParcels = parcels.length;
  if (totalParcels === 0) {
    return { hhi: 0, topOwnerShare: 0, distinctOwners: 0, totalParcels: 0 };
  }

  const counts = new Map<string, number>();
  for (const p of parcels) {
    const owner = (p.owner_name ?? "").trim().toUpperCase() || "(UNKNOWN)";
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }

  let hhi = 0;
  let maxCount = 0;
  for (const count of counts.values()) {
    const share = count / totalParcels;
    hhi += share * share;
    if (count > maxCount) maxCount = count;
  }

  return {
    hhi,
    topOwnerShare: maxCount / totalParcels,
    distinctOwners: counts.size,
    totalParcels,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Metric 4 — Local vs outside ownership
 * localShare   = local_private parcels / total.
 * outsideShare = (out_of_state + corporate_llc) parcels / total.
 * (city_public + unknown are neither local nor "outside capital".)
 * ──────────────────────────────────────────────────────────────────────── */

const OUTSIDE_TYPES = new Set<string>(["out_of_state", "corporate_llc"]);

export function computeOwnershipOrigin(parcels: ParcelRow[]): OwnershipOriginMetric {
  const totalParcels = parcels.length;
  let localCount = 0;
  let outsideCount = 0;

  for (const p of parcels) {
    const t = (p.owner_type ?? "").toString();
    if (t === "local_private") localCount += 1;
    else if (OUTSIDE_TYPES.has(t)) outsideCount += 1;
  }

  return {
    localShare: totalParcels === 0 ? 0 : localCount / totalParcels,
    outsideShare: totalParcels === 0 ? 0 : outsideCount / totalParcels,
    localCount,
    outsideCount,
    totalParcels,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Metric 5 — Permit activity
 * Counts permits in the trailing window, sums reported_cost, flags demolitions.
 * ──────────────────────────────────────────────────────────────────────── */

export function computePermitActivity(
  permits: PermitRow[],
  windowStart: Date,
  windowEnd: Date
): PermitActivityMetric {
  let permitCount = 0;
  let totalReportedCost = 0;
  let demolitionCount = 0;

  for (const permit of permits) {
    const issued = toDate(permit.issue_date);
    if (!issued || issued < windowStart || issued > windowEnd) continue;
    permitCount += 1;
    totalReportedCost += toNumber(permit.reported_cost);
    if (permit.is_demolition === true) demolitionCount += 1;
  }

  return { permitCount, totalReportedCost, demolitionCount };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Metric 6 — Incentive coverage
 * Incentive zones are stored as GeoJSON polygons (point-in-polygon lookup),
 * not as a ZIP-joinable DB table, so a per-ZIP coverage share cannot be
 * computed in pure SQL during the batch job. Until a parcel→zone join table
 * exists, callers pass `coveredCount = null` and this metric is reported as
 * unknown (coverageShare = null) and excluded from the health score.
 * ──────────────────────────────────────────────────────────────────────── */

export function computeIncentiveCoverage(
  totalParcels: number,
  coveredCount: number | null
): IncentiveCoverageMetric {
  if (coveredCount == null || totalParcels === 0) {
    return { coverageShare: null, coveredCount, totalParcels };
  }
  return {
    coverageShare: clamp(coveredCount / totalParcels, 0, 1),
    coveredCount,
    totalParcels,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Composite health score (0..100)
 *
 * Each component is normalized to a 0..1 "goodness" sub-score (higher = better)
 * then combined with transparent fixed weights. Components with unknown data
 * (e.g. incentive coverage = null) are dropped and the remaining weights are
 * re-normalized so the score always spans 0..100.
 *
 *   vacancy        25%  — lower vacancy is healthier              → 1 - rate
 *   turnover       15%  — moderate churn is fine, but net closures
 *                          drag the score                          → 0.5 + net/2N
 *   concentration  20%  — diffuse ownership is healthier           → 1 - HHI
 *   localOwnership 15%  — more local ownership is healthier        → localShare
 *   permits        15%  — investment signal, demolitions penalize  → activity − demo
 *   incentive      10%  — more incentive coverage is healthier     → coverageShare
 * ──────────────────────────────────────────────────────────────────────── */

export interface HealthScoreWeights {
  vacancy: number;
  turnover: number;
  concentration: number;
  localOwnership: number;
  permits: number;
  incentive: number;
}

export const DEFAULT_WEIGHTS: HealthScoreWeights = {
  vacancy: 0.25,
  turnover: 0.15,
  concentration: 0.2,
  localOwnership: 0.15,
  permits: 0.15,
  incentive: 0.1,
};

/** Permit count that maps to a "full" investment sub-score before saturation. */
const PERMIT_SATURATION = 50;

export function computeHealthScore(
  m: Pick<
    CorridorMetrics,
    | "vacancy"
    | "turnover"
    | "ownershipConcentration"
    | "ownershipOrigin"
    | "permits"
    | "incentiveCoverage"
  >,
  weights: HealthScoreWeights = DEFAULT_WEIGHTS
): number {
  const subScores: Array<{ weight: number; score: number }> = [];

  // Vacancy: lower is better.
  subScores.push({ weight: weights.vacancy, score: 1 - clamp(m.vacancy.vacancyRate, 0, 1) });

  // Turnover: net openings vs closures, centered at 0.5 (neutral).
  const total = m.turnover.openings + m.turnover.closures;
  const turnoverScore = total === 0 ? 0.5 : clamp(0.5 + m.turnover.net / (2 * total), 0, 1);
  subScores.push({ weight: weights.turnover, score: turnoverScore });

  // Concentration: diffuse ownership (low HHI) is better.
  subScores.push({
    weight: weights.concentration,
    score: 1 - clamp(m.ownershipConcentration.hhi, 0, 1),
  });

  // Local ownership: higher local share is better.
  subScores.push({
    weight: weights.localOwnership,
    score: clamp(m.ownershipOrigin.localShare, 0, 1),
  });

  // Permits: saturating investment signal, penalized by demolitions.
  const invest = clamp(m.permits.permitCount / PERMIT_SATURATION, 0, 1);
  const demoPenalty = m.permits.permitCount === 0
    ? 0
    : clamp(m.permits.demolitionCount / m.permits.permitCount, 0, 1);
  subScores.push({ weight: weights.permits, score: clamp(invest - demoPenalty * 0.5, 0, 1) });

  // Incentive coverage: only counts when known.
  if (m.incentiveCoverage.coverageShare != null) {
    subScores.push({
      weight: weights.incentive,
      score: clamp(m.incentiveCoverage.coverageShare, 0, 1),
    });
  }

  const totalWeight = subScores.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight === 0) return 0;

  const weighted = subScores.reduce((sum, s) => sum + s.weight * s.score, 0);
  return Math.round((weighted / totalWeight) * 1000) / 10; // 0..100, 1 decimal
}
