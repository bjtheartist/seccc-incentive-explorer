/**
 * Normalize a source parcel/building area into a usable published measure.
 * Source sentinel zeroes, negative values, NaN, infinities, blanks, and
 * malformed strings are unknown (`null`), never real square footage.
 */
export function normalizePublishedArea(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
