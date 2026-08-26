/**
 * The vacancy-index and shortlist-universe artifacts predate CCLBA ingestion
 * and can describe only City inventory or 311-style evidence. Until their
 * public schemas carry a distinct land-bank evidence type, CCLBA must be
 * excluded instead of being coerced into either legacy category. The source
 * boundary is an allowlist so an unmodeled future source fails closed too.
 */
const MODELED_LEGACY_SOURCES = new Set([
  "cols",
  "dpd_vacant",
  "311_clean_lot",
  "violations",
]);

export function includeInLegacyCity311Export(source: unknown): boolean {
  return typeof source === "string" && MODELED_LEGACY_SOURCES.has(source);
}

export function legacyShortlistEvidenceType(
  source: unknown,
  resolvedPropertyType: "vacant_land" | "vacant_building",
): "city_land" | "311_building" | "311_land" | null {
  if (!includeInLegacyCity311Export(source)) return null;
  if (source === "cols") return "city_land";
  return resolvedPropertyType === "vacant_land" ? "311_land" : "311_building";
}

export function filterLegacyCity311Rows<T extends { source: unknown }>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => includeInLegacyCity311Export(row.source));
}
