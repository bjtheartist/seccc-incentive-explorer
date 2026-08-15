import type { VacancySource } from "@/lib/vacancy-evidence";

export interface VacancyMembershipRecord {
  id: string;
  source: VacancySource;
}

export interface VacancyReconciliationPlan {
  complete: boolean;
  safeToPrune: boolean;
  retainedIds: string[];
  managedSources: VacancySource[];
}

export type VacancyMembershipRemover = (
  plan: VacancyReconciliationPlan,
) => Promise<number>;

/**
 * Membership pruning is permitted only after a complete source pull. A failed
 * or partial pagination run can still be inspected, but can never manufacture
 * deletions from an incomplete list.
 */
export function buildVacancyReconciliationPlan(
  records: readonly VacancyMembershipRecord[],
  complete: boolean,
  managedSources: readonly VacancySource[] = ["dpd_vacant", "311_clean_lot"],
): VacancyReconciliationPlan {
  const managedSet = new Set<VacancySource>(managedSources);
  const retainedIds = Array.from(
    new Set(
      records
        .filter((record) => managedSet.has(record.source))
        .map((record) => record.id),
    ),
  ).sort();
  return {
    complete,
    safeToPrune: complete,
    retainedIds,
    managedSources: [...managedSources],
  };
}

/** Execute the destructive half only when the source explicitly attests that
 * every page was retrieved. This is the shared, tested gate used by ingest. */
export async function reconcileVacancyMembership(
  records: readonly VacancyMembershipRecord[],
  complete: boolean,
  removeMissing: VacancyMembershipRemover,
  managedSources?: readonly VacancySource[],
): Promise<number> {
  const plan = buildVacancyReconciliationPlan(
    records,
    complete,
    managedSources,
  );
  if (!plan.safeToPrune) return 0;
  return removeMissing(plan);
}
