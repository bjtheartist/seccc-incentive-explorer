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
