/**
 * SECTOR axis — the plain public/private reading of ownership, reconciled from
 * the two signals a committed vacancy record actually carries:
 *
 *   • STRUCTURE (lib/owner-taxonomy.ts) — individual | entity | trust |
 *     government | unresolved, derived from the taxpayer NAME.
 *   • legacy owner TYPE (lib/owner-classify.ts) — city_public | corporate_llc |
 *     out_of_state | local_private | unknown, which on the vacancy tracked
 *     universe also carries the CITY-INVENTORY signal: rows sourced from the
 *     City-Owned Land inventory land as `city_public` regardless of what the
 *     tax bill's name string happens to look like.
 *
 * This module adds NO new judgment — it only reconciles the two axes already on
 * disk into the three honest buckets a public reader can act on:
 *
 *   Public            — government / city-inventory ownership
 *   Private           — individual / entity / trust ownership
 *   Not yet classified — neither axis resolved the owner (never guessed)
 *
 * Client-safe and dependency-free (NO `node:fs`), like lib/owner-taxonomy.ts and
 * lib/cook-viewer.ts, so it imports from server components, client components,
 * and the pure export paths alike.
 *
 * Anonymization is preserved end to end: the sector is derived upstream from a
 * name, but only the BUCKET travels — never the taxpayer name itself.
 */

import { normalizeOwnerType, type OwnerType } from "./owner-classify";
import { normalizeOwnerStructure, type OwnerStructure } from "./owner-taxonomy";

// ── Types ────────────────────────────────────────────────────────────────────

export type OwnerSector = "public" | "private" | "unclassified";

// ── Display metadata ─────────────────────────────────────────────────────────

/**
 * Full labels. "Not yet classified" is deliberate wording: it says the record
 * has not resolved yet, not that the owner is unknowable or that we guessed.
 */
export const OWNER_SECTOR_LABELS: Record<OwnerSector, string> = {
  public: "Public",
  private: "Private",
  unclassified: "Not yet classified",
};

/**
 * Short labels for the dense directory table's PUBLIC / PRIVATE column. Every
 * value is a non-empty string — an unresolved row reads "NOT CLASSIFIED", never
 * a blank cell or an em dash that could be mistaken for "no owner".
 */
export const OWNER_SECTOR_ABBREV: Record<OwnerSector, string> = {
  public: "PUBLIC",
  private: "PRIVATE",
  unclassified: "NOT CLASSIFIED",
};

/** Canonical display order wherever sectors are listed together (filter
 * dropdown, legends): the two resolved buckets first, the honest-unknown last —
 * mirrors OWNER_TYPE_ORDER / OWNER_STRUCTURE_ORDER. */
export const OWNER_SECTOR_ORDER: OwnerSector[] = ["public", "private", "unclassified"];

/**
 * Colors deliberately reuse the legacy owner-type language this axis replaces in
 * the directory's first column — blue for city/public, green for private,
 * gray for unresolved — so a returning reader keeps the same color vocabulary.
 */
export const OWNER_SECTOR_COLORS: Record<OwnerSector, string> = {
  public: "#2563EB", // blue — matches OWNER_TYPE_COLORS.city_public
  private: "#059669", // green — matches OWNER_TYPE_COLORS.local_private
  unclassified: "#9CA3AF", // gray — matches OWNER_TYPE_COLORS.unknown
};

// ── Classification ───────────────────────────────────────────────────────────

/** Structures that read as public ownership. */
const PUBLIC_STRUCTURES: ReadonlySet<OwnerStructure> = new Set<OwnerStructure>(["government"]);

/** Structures that read as private ownership. */
const PRIVATE_STRUCTURES: ReadonlySet<OwnerStructure> = new Set<OwnerStructure>([
  "individual",
  "entity",
  "trust",
]);

/** Legacy owner types that read as public ownership (incl. city inventory). */
const PUBLIC_OWNER_TYPES: ReadonlySet<OwnerType> = new Set<OwnerType>(["city_public"]);

/** Legacy owner types that read as private ownership. */
const PRIVATE_OWNER_TYPES: ReadonlySet<OwnerType> = new Set<OwnerType>([
  "corporate_llc",
  "out_of_state",
  "local_private",
]);

/**
 * Reconcile a record's two ownership axes into a SECTOR. Deterministic, total,
 * and order-significant:
 *
 *   1. government structure OR city-inventory owner type  -> public
 *   2. individual/entity/trust structure OR a resolved
 *      private legacy owner type                          -> private
 *   3. neither axis resolved                              -> unclassified
 *
 * Public is checked FIRST on purpose. A City-Owned Land inventory parcel whose
 * tax-bill name string happens to classify as `individual` or `entity` is still
 * city inventory, so the source-of-record signal wins over the name heuristic.
 *
 * Either field may be missing (older exports, partial rows) — each is narrowed
 * through its own normalize* helper first, so an absent or stale value degrades
 * to "unresolved"/"unknown" and the row reports "Not yet classified" rather than
 * being silently bucketed or rendered blank.
 */
export function classifyOwnerSector(input: {
  ownerStructure?: string | null;
  ownerType?: string | null;
}): OwnerSector {
  const structure = normalizeOwnerStructure(input.ownerStructure);
  const ownerType = normalizeOwnerType(input.ownerType);

  if (PUBLIC_STRUCTURES.has(structure) || PUBLIC_OWNER_TYPES.has(ownerType)) return "public";
  if (PRIVATE_STRUCTURES.has(structure) || PRIVATE_OWNER_TYPES.has(ownerType)) return "private";
  return "unclassified";
}

/**
 * Given the sectors present in a loaded dataset, the distinct ones that actually
 * occur, in OWNER_SECTOR_ORDER. Mirrors presentOwnerTypesInOrder — backs any
 * data-driven key that should not list a bucket with nothing in it. An empty
 * input yields an empty list, never a stray "Not yet classified" row.
 */
export function presentOwnerSectorsInOrder(sectors: readonly OwnerSector[]): OwnerSector[] {
  const present = new Set<OwnerSector>(sectors);
  return OWNER_SECTOR_ORDER.filter((key) => present.has(key));
}
