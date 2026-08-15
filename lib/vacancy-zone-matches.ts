export interface CanonicalVacancyZoneMatch {
  zoneKey: string;
  zoneName: string;
}

export function isVacancyZoneMatchInput(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((raw) => {
      if (typeof raw === "string") return raw.trim().length > 0;
      if (!raw || typeof raw !== "object") return false;
      const record = raw as Record<string, unknown>;
      return (
        typeof record.zoneKey === "string" &&
        record.zoneKey.trim().length > 0 &&
        (record.zoneName === undefined ||
          record.zoneName === null ||
          typeof record.zoneName === "string")
      );
    })
  );
}

/** Canonicalize one logical incentive zone per feature, keyed by zoneKey. */
export function canonicalizeVacancyZoneMatches(
  value: unknown,
): CanonicalVacancyZoneMatch[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, CanonicalVacancyZoneMatch>();
  for (const raw of value) {
    const zoneKey =
      typeof raw === "string"
        ? raw.trim()
        : raw && typeof raw === "object" &&
            typeof (raw as Record<string, unknown>).zoneKey === "string"
          ? String((raw as Record<string, unknown>).zoneKey).trim()
          : "";
    if (!zoneKey) continue;
    const publishedName =
      raw && typeof raw === "object" &&
      typeof (raw as Record<string, unknown>).zoneName === "string"
        ? String((raw as Record<string, unknown>).zoneName).trim()
        : "";
    const existing = byKey.get(zoneKey);
    if (existing) {
      if (existing.zoneName === zoneKey && publishedName) {
        byKey.set(zoneKey, { zoneKey, zoneName: publishedName });
      }
      continue;
    }
    byKey.set(zoneKey, {
      zoneKey,
      zoneName: publishedName || zoneKey,
    });
  }
  return [...byKey.values()];
}

/** Client response gate: the API must already have canonicalized the set. */
export function isCanonicalVacancyZoneMatchSet(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  return value.every((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const record = raw as Record<string, unknown>;
    if (
      typeof record.zoneKey !== "string" ||
      !record.zoneKey.trim() ||
      typeof record.zoneName !== "string" ||
      !record.zoneName.trim() ||
      seen.has(record.zoneKey)
    ) {
      return false;
    }
    seen.add(record.zoneKey);
    return true;
  });
}
