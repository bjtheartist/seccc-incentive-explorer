/**
 * Stable map taxonomy for City of Chicago Building Permits (`ydr8-5enu`).
 *
 * `sourceValue` is the exact value persisted from the City dataset. Retired
 * categories remain explicit historical types so the map can show every
 * published filing category without folding unlike records together.
 */
export const PERMIT_MAP_TYPES = [
  {
    key: "express_permit_program",
    label: "Express Permit Program",
    sourceValue: "PERMIT \u2013 EXPRESS PERMIT PROGRAM",
    color: "#2563EB",
  },
  {
    key: "easy_permit_process",
    label: "Easy Permit Process",
    sourceValue: "PERMIT - EASY PERMIT PROCESS",
    color: "#0891B2",
  },
  {
    key: "renovation_alteration",
    label: "Renovation/Alteration",
    sourceValue: "PERMIT - RENOVATION/ALTERATION",
    color: "#7C3AED",
  },
  {
    key: "signs",
    label: "Signs",
    sourceValue: "PERMIT - SIGNS",
    color: "#D97706",
  },
  {
    key: "new_construction",
    label: "New Construction",
    sourceValue: "PERMIT - NEW CONSTRUCTION",
    color: "#059669",
  },
  {
    key: "elevator_equipment",
    label: "Elevator Equipment",
    sourceValue: "PERMIT - ELEVATOR EQUIPMENT",
    color: "#DB2777",
  },
  {
    key: "wrecking_demolition",
    label: "Wrecking/Demolition",
    sourceValue: "PERMIT - WRECKING/DEMOLITION",
    color: "#DC2626",
  },
  {
    key: "scaffolding",
    label: "Scaffolding",
    sourceValue: "PERMIT - SCAFFOLDING",
    color: "#475569",
  },
  {
    key: "reinstate_revoked_permit",
    label: "Reinstate Revoked Permit",
    sourceValue: "PERMIT - REINSTATE REVOKED PMT",
    color: "#4F46E5",
  },
  {
    key: "porch_construction",
    label: "Porch Construction (historical)",
    sourceValue: "PERMIT - PORCH CONSTRUCTION",
    color: "#A16207",
  },
  {
    key: "permit_extension",
    label: "Permit Extension (historical)",
    sourceValue: "PERMIT - FOR EXTENSION OF PMT",
    color: "#78716C",
  },
] as const;

export type PermitMapType = (typeof PERMIT_MAP_TYPES)[number];
export type PermitMapTypeKey = PermitMapType["key"];

function normalizeSourceValue(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, " - ");
}

const PERMIT_MAP_TYPE_BY_SOURCE = new Map<string, PermitMapType>(
  PERMIT_MAP_TYPES.map((type) => [normalizeSourceValue(type.sourceValue), type]),
);

/** Resolve a raw City permit type without inventing a catch-all category. */
export function permitMapTypeForSource(
  raw: string | null | undefined,
): PermitMapType | null {
  if (!raw?.trim()) return null;
  return PERMIT_MAP_TYPE_BY_SOURCE.get(normalizeSourceValue(raw)) ?? null;
}

/** A new mutable visibility record with every source type enabled. */
export function defaultPermitTypeVisibility(): Record<PermitMapTypeKey, boolean> {
  return Object.fromEntries(
    PERMIT_MAP_TYPES.map((type) => [type.key, true]),
  ) as Record<PermitMapTypeKey, boolean>;
}
