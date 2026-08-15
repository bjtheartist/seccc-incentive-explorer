import type { VacancyPropertyType } from "@/lib/vacancy-evidence";

export const STATIC_FALLBACK_LIMIT = 2_000;

/** Minimum per-class representation when that class exists in the live snapshot. */
export const STATIC_FALLBACK_TYPE_QUOTAS: Readonly<
  Record<VacancyPropertyType, number>
> = {
  vacant_land: 600,
  reported_vacant_lot: 600,
  vacant_building: 600,
  vacant_storefront: 100,
};

export function staticFallbackReservedCount(): number {
  return Object.values(STATIC_FALLBACK_TYPE_QUOTAS).reduce(
    (total, quota) => total + quota,
    0,
  );
}
