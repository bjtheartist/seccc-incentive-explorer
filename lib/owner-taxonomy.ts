/**
 * Two-axis ownership taxonomy — the v2 classification that sits ALONGSIDE the
 * legacy single-axis classifyOwner (lib/owner-classify.ts), never replacing it.
 *
 *   • STRUCTURE  — what kind of owner it is, from the taxpayer NAME:
 *                  individual | entity | trust | government | unresolved
 *   • GEOGRAPHY  — where the taxpayer receives mail, from the MAILING STATE:
 *                  in_state | out_of_state | unknown
 *
 * Client-safe and dependency-free (NO `node:fs`), so it imports from server
 * components, client components, and the pure export/aggregation paths alike —
 * exactly like lib/cook-viewer.ts. The two systems coexist: legacy owner-type
 * fields are still computed by the OLD classifier and are NOT re-derived from
 * this module (see structureGeographyToLegacyOwnerType's doc — it exists for
 * reconciliation continuity, not to overwrite the legacy series).
 *
 * Every classifier is deterministic and word-boundary aware. Geography is always
 * labeled as coming from the taxpayer mailing address, never asserted as the
 * physical location of the owner.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type OwnerStructure = "individual" | "entity" | "trust" | "government" | "unresolved";
/** FROM TAXPAYER MAILING ADDRESS — always surfaced as such, never a claim about
 * where the owner physically is. */
export type OwnerGeography = "in_state" | "out_of_state" | "unknown";

// ── Display metadata ─────────────────────────────────────────────────────────

export const OWNER_STRUCTURE_LABELS: Record<OwnerStructure, string> = {
  individual: "Individual",
  entity: "Entity",
  trust: "Trust",
  government: "Government",
  unresolved: "Unresolved",
};

/** Short labels for dense tables (the directory / site-index OWNER column). */
export const OWNER_STRUCTURE_ABBREV: Record<OwnerStructure, string> = {
  individual: "IND",
  entity: "ENT",
  trust: "TRUST",
  government: "GOV",
  unresolved: "UNR",
};

/**
 * Canonical display order wherever structures are listed together (breakdown
 * tables, filter chips). Entity first as the widest actionable outreach lane,
 * Unresolved last as the least informative — mirrors OWNER_TYPE_ORDER's logic.
 */
export const OWNER_STRUCTURE_ORDER: OwnerStructure[] = [
  "entity",
  "individual",
  "trust",
  "government",
  "unresolved",
];

/**
 * A coherent five-color set for the structure axis, deliberately DISTINCT from
 * OWNER_TYPE_COLORS (blue #2563EB / purple #7C3AED / orange #EA580C /
 * green #059669 / gray #9CA3AF) — a jewel-tone family so a two-axis view never
 * reads as the legacy owner-type palette.
 */
export const OWNER_STRUCTURE_COLORS: Record<OwnerStructure, string> = {
  entity: "#A16207", // ochre
  individual: "#0F766E", // teal
  trust: "#4338CA", // indigo
  government: "#1E3A8A", // deep navy (distinct from city_public's #2563EB)
  unresolved: "#6B7280", // slate (distinct from unknown's #9CA3AF)
};

export const OWNER_GEOGRAPHY_LABELS: Record<OwnerGeography, string> = {
  in_state: "In-state",
  out_of_state: "Out-of-state",
  unknown: "Unknown",
};

/** Display order for the geography columns of the two-axis table. */
export const OWNER_GEOGRAPHY_ORDER: OwnerGeography[] = ["in_state", "out_of_state", "unknown"];

// ── Narrowing helpers (persisted string -> known enum) ───────────────────────

/** Narrow a possibly-stale/unknown structure string to a known OwnerStructure,
 * defaulting to "unresolved" (never throwing, never rendering a raw string).
 * Mirrors normalizeOwnerType. */
export function normalizeOwnerStructure(value: string | null | undefined): OwnerStructure {
  return value != null && (OWNER_STRUCTURE_ORDER as string[]).includes(value)
    ? (value as OwnerStructure)
    : "unresolved";
}

/** Narrow a possibly-stale/unknown geography string to a known OwnerGeography,
 * defaulting to "unknown". */
export function normalizeOwnerGeography(value: string | null | undefined): OwnerGeography {
  return value != null && (OWNER_GEOGRAPHY_ORDER as string[]).includes(value)
    ? (value as OwnerGeography)
    : "unknown";
}

// ── Structure classification ─────────────────────────────────────────────────

/**
 * Names that do not identify a usable owner. Anchored so only the WHOLE name
 * (not a substring) counts as a placeholder — a real "SAMENESS LLC" is an
 * entity, not the placeholder "SAME".
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^exempt$/i,
  /^taxpayer of$/i,
  /^current owner$/i,
  /^owner$/i,
  /^owner of record$/i,
  /^unknown$/i,
  /^unknown owner$/i,
  /^not available$/i,
  /^n\/?a$/i,
  /^none$/i,
  /^tbd$/i,
  /^same$/i,
  /^see (deed|attached)$/i,
];

/**
 * Government / public-institution patterns. Checked BEFORE trust/entity because
 * names like "CHICAGO PARK DISTRICT" carry no LLC marker and "CHICAGO TITLE
 * LAND TRUST COMPANY" would otherwise be swept up by entity markers. All
 * word-boundary aware so "COOK COUNTY" matches but "COOKE" does not.
 */
const GOVERNMENT_PATTERNS: RegExp[] = [
  /\bcity of chicago\b/i,
  /\bchicago\s+city\b/i,
  /\bcook county\b/i,
  /\bcounty of cook\b/i,
  /\bc\.?\s?c\.?\s*land bank\b/i,
  /\bcclba\b/i,
  /\bland bank\b/i,
  /\bpark district\b/i,
  /\bchicago park\b/i,
  /\bboard of education\b/i,
  /\bbd\.? of ed\b/i,
  /\bbrd of ed\b/i,
  /\bchicago housing\b/i,
  /\bhousing authority\b/i,
  /\bcha\b/i,
  /\bchicago transit\b/i,
  /\btransit authority\b/i,
  /\bcta\b/i,
  /\bstate of illinois\b/i,
  /\bil(linois)? housing\b/i,
  /\bihda\b/i,
  /\bidot\b/i,
  /\bdept\.? of transportation\b/i,
  /\bsec(retary)? of hud\b/i,
  /\bhud\b/i,
  /\bunited states\b/i,
  /\bu\.?\s?s\.?\s?a\b/i,
  /\busa\b/i,
  /\bfederal\b/i,
  /\bforest preserve\b/i,
  /\bmetro(politan)? water\b/i,
  /\bmwrd\b/i,
  /\bpublic bldg\b/i,
  /\bpublic building comm/i,
  /\bpbc\b/i,
  /\bredevelopment authority\b/i,
  /\burban renewal\b/i,
  /\bcommunity development\b/i,
  /\bchicago public\b/i,
  /\bschool district\b/i,
];

/**
 * Trust patterns — a signature Cook County local form. Checked BEFORE entity so
 * "CHICAGO TITLE LAND TRUST COMPANY TRUST #8002-374991" (which also matches the
 * COMPANY entity marker) resolves as a trust. Covers bank-as-trustee and
 * trust-number conventions.
 */
const TRUST_PATTERNS: RegExp[] = [
  /\btrust\b/i,
  /\btrustee\b/i,
  /\bttee\b/i,
  /\bas trustee\b/i,
  /\bland trust\b/i,
  /\bu\/?t\/?a\b/i, // U/T/A, UTA
  /\buta\b/i,
  /\btr\b/i, // " TR " token / "... TR" suffix
  /\btr\.?\s*#?\s*\d/i, // TR 8002, TR #8002
];

/**
 * Entity (corporate / institutional / organizational) markers — churches and
 * nonprofits are entities here, which is fine. Trust markers are deliberately
 * NOT in this list (they are handled above), so a plain "SMITH FAMILY TRUST"
 * never falls through to entity. All word-boundary aware.
 */
const ENTITY_PATTERNS: RegExp[] = [
  /\bl\.?\s?l\.?\s?c\.?\b/i, // LLC, L.L.C.
  /\bl\.?\s?l\.?\s?p\.?\b/i, // LLP
  /\bl\.?\s?p\.?\b/i, // LP, L.P.
  /\binc(orporated)?\b/i,
  /\bcorp(oration)?\b/i,
  /\bco\b/i, // CO (word-boundary caution — "COOK" is unaffected)
  /\bcompany\b/i,
  /\bltd\b/i,
  /\blimited\b/i,
  /\bpartners?(hip)?\b/i,
  /\bholdings?\b/i,
  /\bproperties\b/i,
  /\bproperty\b/i,
  /\brealty\b/i,
  /\bmanagement\b/i,
  /\bmgmt\b/i,
  /\bventures?\b/i,
  /\benterprises?\b/i,
  /\bassociates?\b/i,
  /\bassociation\b/i,
  /\binvestment[s]?\b/i,
  /\bdevelopment\b/i,
  /\bgroup\b/i,
  /\bfund\b/i,
  /\bcapital\b/i,
  /\bacquisition[s]?\b/i,
  /\bnfp\b/i,
  /\bnot for profit\b/i,
  /\bfoundation\b/i,
  /\bchurch\b/i,
  /\bministr(y|ies)\b/i,
  /\bcongregation\b/i,
  /\btemple\b/i,
  /\bsynagogue\b/i,
  /\bmosque\b/i,
  /\buniversity\b/i,
  /\bcollege\b/i,
  /\bhospital\b/i,
  /\bclinic\b/i,
  /\bbank\b/i,
  /\bcondominium\b/i,
  /\bcooperative\b/i,
  /\blodge\b/i,
  /\bvfw\b/i,
  /\bamerican legion\b/i,
  /\bpost\s+#?\d+\b/i,
];

/**
 * Classify an owner's STRUCTURE from the taxpayer name (deterministic, first
 * match wins):
 *   1. empty / placeholder / numerics-only / single sub-3-char token -> unresolved
 *   2. government institution patterns                                -> government
 *   3. trust patterns (incl. Cook County land trusts)                 -> trust
 *   4. entity markers (LLC/INC/CORP/CHURCH/…)                         -> entity
 *   5. everything else (reads as a personal name)                     -> individual
 * Order matters: government precedes trust/entity (no entity marker on
 * "CHICAGO PARK DISTRICT"); trust precedes entity ("… LAND TRUST COMPANY").
 */
export function classifyOwnerStructure(name: string | null | undefined): OwnerStructure {
  const n = (name ?? "").trim();
  if (!n) return "unresolved";
  if (PLACEHOLDER_PATTERNS.some((p) => p.test(n))) return "unresolved";
  // No letters at all (all digits / punctuation) — not a usable owner name.
  if (!/[a-z]/i.test(n)) return "unresolved";
  // A single short token (e.g. "JP", "AB") is not a usable owner name.
  const tokens = n.split(/\s+/);
  if (tokens.length === 1 && n.replace(/[^a-z0-9]/gi, "").length < 3) return "unresolved";

  if (GOVERNMENT_PATTERNS.some((p) => p.test(n))) return "government";
  if (TRUST_PATTERNS.some((p) => p.test(n))) return "trust";
  if (ENTITY_PATTERNS.some((p) => p.test(n))) return "entity";
  return "individual";
}

// ── Geography classification ─────────────────────────────────────────────────

/** US state / territory two-letter codes (IL included, checked first). */
const US_STATE_CODES = new Set<string>([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "PR", "VI", "GU", "AS", "MP",
]);

/** Full state / territory names (upper-case), for a mailing string that spells
 * the state out rather than abbreviating it. Illinois is handled separately. */
const US_STATE_NAMES_NON_IL = new Set<string>([
  "ALABAMA", "ALASKA", "ARIZONA", "ARKANSAS", "CALIFORNIA", "COLORADO",
  "CONNECTICUT", "DELAWARE", "FLORIDA", "GEORGIA", "HAWAII", "IDAHO", "INDIANA",
  "IOWA", "KANSAS", "KENTUCKY", "LOUISIANA", "MAINE", "MARYLAND",
  "MASSACHUSETTS", "MICHIGAN", "MINNESOTA", "MISSISSIPPI", "MISSOURI",
  "MONTANA", "NEBRASKA", "NEVADA", "NEW HAMPSHIRE", "NEW JERSEY", "NEW MEXICO",
  "NEW YORK", "NORTH CAROLINA", "NORTH DAKOTA", "OHIO", "OKLAHOMA", "OREGON",
  "PENNSYLVANIA", "RHODE ISLAND", "SOUTH CAROLINA", "SOUTH DAKOTA",
  "TENNESSEE", "TEXAS", "UTAH", "VERMONT", "VIRGINIA", "WASHINGTON",
  "WEST VIRGINIA", "WISCONSIN", "WYOMING", "PUERTO RICO",
]);

/**
 * Classify GEOGRAPHY from the taxpayer MAILING STATE (a state code or spelled
 * name — never a full address; use ownerGeographyFromMailingAddress for that):
 *   • "IL" / "ILLINOIS"          -> in_state
 *   • any other real US state    -> out_of_state
 *   • missing / unrecognized     -> unknown
 * The geography is the mailing address's state, NOT a claim about where the
 * owner physically lives.
 */
export function classifyOwnerGeography(mailingState: string | null | undefined): OwnerGeography {
  const s = (mailingState ?? "").trim().toUpperCase();
  if (!s) return "unknown";
  if (s === "IL" || s === "ILLINOIS") return "in_state";
  if (/^[A-Z]{2}$/.test(s)) return US_STATE_CODES.has(s) ? "out_of_state" : "unknown";
  if (US_STATE_NAMES_NON_IL.has(s)) return "out_of_state";
  return "unknown";
}

/** Illinois ZIP range (60001–62999) — the fallback geography signal when a
 * mailing string carries no parseable state token. */
function zipLooksIllinois(zip: string): boolean {
  const n = parseInt(zip, 10);
  return n >= 60001 && n <= 62999;
}

/**
 * Derive GEOGRAPHY from a full taxpayer mailing-address string (the form
 * `parcels.owner_mailing_address` stores — "…, CITY, STATE, ZIP"). Extracts the
 * state token (or spelled name), falling back to the ZIP's Illinois range, then
 * delegates to classifyOwnerGeography. Missing/ambiguous -> unknown. Pure.
 */
export function ownerGeographyFromMailingAddress(
  address: string | null | undefined,
): OwnerGeography {
  const a = (address ?? "").trim();
  if (!a) return "unknown";
  const upper = a.toUpperCase();

  // Scan comma-separated parts from the end for a bare state code / name.
  const parts = upper.split(",").map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    for (const word of parts[i].split(/\s+/)) {
      if (/^[A-Z]{2}$/.test(word) && US_STATE_CODES.has(word)) {
        return classifyOwnerGeography(word);
      }
    }
    if (parts[i] === "ILLINOIS") return "in_state";
    if (US_STATE_NAMES_NON_IL.has(parts[i])) return "out_of_state";
  }
  if (/\bILLINOIS\b/.test(upper)) return "in_state";

  // ZIP fallback.
  const zip = upper.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zip) return zipLooksIllinois(zip[1]) ? "in_state" : "out_of_state";
  return "unknown";
}

// ── Legacy mapping (reconciliation continuity only) ──────────────────────────

/**
 * Map a (structure, geography) pair onto the LEGACY OwnerType vocabulary
 * ("city_public" | "out_of_state" | "corporate_llc" | "local_private" |
 * "unknown"). This exists ONLY for reconciliation continuity where a caller
 * needs a legacy-shaped value from the new axes; the committed legacy
 * owner-type fields are still computed by the OLD classifyOwner and are NOT
 * re-derived from this helper — the two systems coexist.
 */
export function structureGeographyToLegacyOwnerType(
  structure: OwnerStructure,
  geography: OwnerGeography,
): "city_public" | "out_of_state" | "corporate_llc" | "local_private" | "unknown" {
  if (structure === "government") return "city_public";
  if (structure === "unresolved") return "unknown";
  if (geography === "out_of_state") return "out_of_state";
  if (structure === "entity") return "corporate_llc";
  // individual / trust, in-state or unknown geography.
  return "local_private";
}

// ── Aggregation (pure) ───────────────────────────────────────────────────────

export interface OwnerStructureCount {
  ownerStructure: OwnerStructure;
  count: number;
}

/** One cell of the structure × geography cross-tab (the two-axis land table). */
export interface StructureGeographyCell {
  ownerStructure: OwnerStructure;
  ownerGeography: OwnerGeography;
  count: number;
}

/**
 * Tally a flat list of structures into an OwnerStructureCount[] covering ALL
 * five structures in OWNER_STRUCTURE_ORDER (honest zeros; an absent structure
 * renders as count 0, never dropped). Each value is narrowed via
 * normalizeOwnerStructure. Mirrors tallyOwnerTypeCounts.
 */
export function tallyOwnerStructureCounts(
  structures: readonly (string | null | undefined)[],
): OwnerStructureCount[] {
  const counts = new Map<OwnerStructure, number>();
  for (const key of OWNER_STRUCTURE_ORDER) counts.set(key, 0);
  for (const raw of structures) {
    const key = normalizeOwnerStructure(raw);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return OWNER_STRUCTURE_ORDER.map((ownerStructure) => ({
    ownerStructure,
    count: counts.get(ownerStructure) ?? 0,
  }));
}

/**
 * Build the full structure × geography cross-tab (every structure × every
 * geography, honest zeros) from paired inputs. `pairs[i]` is one owner's
 * (structure, geography). Row-major in OWNER_STRUCTURE_ORDER ×
 * OWNER_GEOGRAPHY_ORDER. Pure — the two-axis land-universe table.
 */
export function tallyStructureGeography(
  pairs: readonly { structure: string | null | undefined; geography: string | null | undefined }[],
): StructureGeographyCell[] {
  const counts = new Map<string, number>();
  const key = (s: OwnerStructure, g: OwnerGeography) => `${s}|${g}`;
  for (const s of OWNER_STRUCTURE_ORDER) for (const g of OWNER_GEOGRAPHY_ORDER) counts.set(key(s, g), 0);
  for (const p of pairs) {
    const s = normalizeOwnerStructure(p.structure);
    const g = normalizeOwnerGeography(p.geography);
    counts.set(key(s, g), (counts.get(key(s, g)) ?? 0) + 1);
  }
  const out: StructureGeographyCell[] = [];
  for (const ownerStructure of OWNER_STRUCTURE_ORDER) {
    for (const ownerGeography of OWNER_GEOGRAPHY_ORDER) {
      out.push({ ownerStructure, ownerGeography, count: counts.get(key(ownerStructure, ownerGeography)) ?? 0 });
    }
  }
  return out;
}
