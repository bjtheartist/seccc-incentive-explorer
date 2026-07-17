/**
 * Classifies property owners into categories based on taxpayer name
 * and mailing address pattern matching.
 */

export type OwnerType = "city_public" | "out_of_state" | "corporate_llc" | "local_private" | "unknown";

export const OWNER_TYPE_LABELS: Record<OwnerType, string> = {
  city_public: "City / Public",
  out_of_state: "Out-of-State Investor",
  corporate_llc: "Corporate / LLC",
  local_private: "Local Private",
  unknown: "Unknown",
};

export const OWNER_TYPE_COLORS: Record<OwnerType, string> = {
  city_public: "#2563EB",      // blue
  out_of_state: "#7C3AED",     // purple
  corporate_llc: "#EA580C",    // orange
  local_private: "#059669",    // green
  unknown: "#9CA3AF",          // gray
};

/**
 * Canonical display order for owner types wherever they're listed together
 * (map legend color key, filter chips) — Corporate/LLC first as the most
 * actionable outreach target, Unknown last as the least informative.
 */
export const OWNER_TYPE_ORDER: OwnerType[] = [
  "corporate_llc",
  "out_of_state",
  "local_private",
  "city_public",
  "unknown",
];

/**
 * Narrow an arbitrary/possibly-stale owner-type string (e.g. from an older
 * static export, or a value that predates a classifyOwner change) to a known
 * OwnerType, defaulting to "unknown" rather than throwing or rendering a raw
 * string. Used wherever a persisted OwnerCluster.ownerType (typed as
 * `string | null` since it round-trips through JSON/SQL) needs to key into
 * OWNER_TYPE_COLORS/LABELS.
 */
export function normalizeOwnerType(value: string | null | undefined): OwnerType {
  return value != null && (OWNER_TYPE_ORDER as string[]).includes(value)
    ? (value as OwnerType)
    : "unknown";
}

/**
 * Given the owner types present in a loaded dataset (e.g. every feature in
 * the ownership-cluster map layer), returns the distinct types that actually
 * occur, in OWNER_TYPE_ORDER. Backs the map legend's data-driven color key —
 * it only shows a dot for a type genuinely present rather than always
 * listing all five. Each value is normalized via normalizeOwnerType first
 * (null/unrecognized -> "unknown"), matching the map paint expression's own
 * fallback, so a cluster with a missing ownerType still shows an "Unknown"
 * key row when one is actually on the map. An empty input yields an empty
 * key (nothing loaded yet), never a stray "Unknown" row.
 */
export function presentOwnerTypesInOrder(
  types: Array<string | null | undefined>
): OwnerType[] {
  const present = new Set<OwnerType>();
  for (const type of types) {
    present.add(normalizeOwnerType(type));
  }
  return OWNER_TYPE_ORDER.filter((key) => present.has(key));
}

/** Known public/government entity patterns (case-insensitive). */
const PUBLIC_PATTERNS = [
  /\bcity of chicago\b/i,
  /\bchicago city of\b/i,
  /\bchicago land\s*bank\b/i,
  /\bcook county\b/i,
  /\bstate of illinois\b/i,
  /\bcclba\b/i,
  /\bcommunity development\b/i,
  /\bhousing authority\b/i,
  /\bpark district\b/i,
  /\bboard of education\b/i,
  /\bboard of ed\b/i,
  /\bchicago transit\b/i,
  /\bchicago public\b/i,
  /\bmetropolitan water\b/i,
  /\bforest preserve\b/i,
  /\bpublic building commission\b/i,
  /\bchicago housing\b/i,
  /\burban renewal\b/i,
  /\bredevelopment authority\b/i,
];

/** Placeholder names that do not identify a usable owner. */
const UNKNOWN_PATTERNS = [
  /^taxpayer of$/i,
  /^unknown$/i,
  /^not available$/i,
];

/** Corporate/LLC entity indicators. */
const CORPORATE_PATTERNS = [
  /\bllc\b/i,
  /\binc\b\.?$/i,
  /\binc\b/i,
  /\bcorp\b\.?$/i,
  /\bcorporation\b/i,
  /\bltd\b\.?$/i,
  /\blimited\b/i,
  /\blp\b$/i,
  /\bl\.?p\.?\b/i,
  /\btrust\b/i,
  /\btrustee\b/i,
  /\bholdings?\b/i,
  /\binvestment[s]?\b/i,
  /\bproperties\b/i,
  /\brealty\b/i,
  /\bdevelopment\b/i,
  /\bventures?\b/i,
  /\benterprises?\b/i,
  /\bassociates?\b/i,
  /\bpartners?\b/i,
  /\bmanagement\b/i,
  /\bgroup\b/i,
  /\bfund\b/i,
  /\bcapital\b/i,
  /\bacquisition[s]?\b/i,
  /\bnfp\b/i,
];

/**
 * Additional entity markers beyond PUBLIC_PATTERNS/CORPORATE_PATTERNS — used
 * only by hasEntityMarkers (the entity-owner boundary check), never by
 * classifyOwner. Covers institutional/organizational owner types classifyOwner
 * doesn't need to distinguish for its Local/Out-of-State/Corporate buckets:
 * financial institutions, religious and civic organizations, schools and
 * medical institutions, and ownership-association structures. All
 * word-boundary, case-insensitive. `post` is deliberately NOT a bare-word
 * marker — "Post" is a common surname (e.g. "JOHN POST") and a false
 * positive here would wrongly unlock automated outreach letters for an
 * individual; veteran/fraternal posts are instead matched by the
 * organization-name conventions they actually use ("VFW", "American
 * Legion", "POST ####").
 */
const ADDITIONAL_ENTITY_MARKERS = [
  /\bbank\b/i,
  /\bchurch\b/i,
  /\bministries\b/i,
  /\bministry\b/i,
  /\bcongregation\b/i,
  /\btemple\b/i,
  /\bsynagogue\b/i,
  /\bmosque\b/i,
  /\bcompany\b/i,
  /\bfoundation\b/i,
  /\buniversity\b/i,
  /\bcollege\b/i,
  /\bhospital\b/i,
  /\bclinic\b/i,
  /\bassociation\b/i,
  /\bcondominium\b/i,
  /\bcooperative\b/i,
  /\bland\s+trust\b/i,
  /\blodge\b/i,
  /\bvfw\b/i,
  /\bamerican\s+legion\b/i,
  /\bpost\s+#?\d+\b/i,
];

/**
 * True when a taxpayer name carries any recognizable entity marker — public/
 * government (PUBLIC_PATTERNS), corporate/LLC (CORPORATE_PATTERNS), or the
 * additional institutional/organizational markers above. Backs the
 * entity-owner boundary (lib/owner-file.ts resolveIsEntityOwner): automated
 * outreach letters are reserved for entity owners, never individual people,
 * so this is deliberately a superset of what classifyOwner treats as
 * "corporate_llc" — it must NOT change classifyOwner's own behavior.
 */
export function hasEntityMarkers(taxpayerName: string | null | undefined): boolean {
  const name = (taxpayerName || "").trim();
  if (!name) return false;
  return [...PUBLIC_PATTERNS, ...CORPORATE_PATTERNS, ...ADDITIONAL_ENTITY_MARKERS].some((pattern) =>
    pattern.test(name)
  );
}

/** Illinois ZIP code ranges: 60001–62999. */
function isIllinoisZip(zip: string): boolean {
  const num = parseInt(zip.replace(/-.*$/, ""), 10);
  return num >= 60001 && num <= 62999;
}

/** Illinois city/state patterns. */
const IL_STATE_PATTERNS = [
  /\bil\b/i,
  /\billinois\b/i,
  /\bchicago\b/i,
];

/**
 * Classify an owner based on taxpayer name and mailing address.
 */
export function classifyOwner(
  taxpayerName: string | null | undefined,
  mailingAddress: string | null | undefined
): OwnerType {
  const name = (taxpayerName || "").trim();
  const addr = (mailingAddress || "").trim();

  if (!name && !addr) return "unknown";

  for (const pattern of UNKNOWN_PATTERNS) {
    if (pattern.test(name)) return "unknown";
  }

  // Check public/government entities first
  for (const pattern of PUBLIC_PATTERNS) {
    if (pattern.test(name)) return "city_public";
  }

  // Check corporate/LLC patterns
  for (const pattern of CORPORATE_PATTERNS) {
    if (pattern.test(name)) {
      // Corporate entity — but is it out-of-state?
      if (addr && isOutOfState(addr)) return "out_of_state";
      return "corporate_llc";
    }
  }

  // Individual (no corporate indicator) — check if out-of-state
  if (addr && isOutOfState(addr)) return "out_of_state";

  // If we have a name but no clear classification
  if (name) return "local_private";

  return "unknown";
}

/** Check if a mailing address is outside Illinois. */
function isOutOfState(address: string): boolean {
  // Extract ZIP if present
  const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zipMatch) {
    if (!isIllinoisZip(zipMatch[1])) return true;
    return false;
  }

  // Check for IL state indicators in the address
  for (const pattern of IL_STATE_PATTERNS) {
    if (pattern.test(address)) return false;
  }

  // If there's a state abbreviation that's not IL, it's out-of-state
  const stateMatch = address.match(/,\s*([A-Z]{2})\s/);
  if (stateMatch && stateMatch[1] !== "IL") return true;

  // Can't determine — assume local
  return false;
}
