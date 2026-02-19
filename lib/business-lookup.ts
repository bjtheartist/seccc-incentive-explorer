import type { Business, LookupResult } from "./types";

/** Normalize an address string for fuzzy matching */
function normalizeAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\bplace\b/g, "pl")
    .replace(/\broad\b/g, "rd")
    .replace(/\bcourt\b/g, "ct")
    .replace(/\bsouth\b/g, "s")
    .replace(/\bnorth\b/g, "n")
    .replace(/\beast\b/g, "e")
    .replace(/\bwest\b/g, "w")
    .replace(/\bsuite\b/g, "ste")
    .replace(/\bapartment\b/g, "apt")
    .replace(/\bfloor\b/g, "fl")
    .replace(/\bunit\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract just the street number + street name for matching */
function extractStreetCore(normalized: string): string {
  // Remove unit/suite/apt suffixes
  return normalized
    .replace(/\b(ste|apt|fl|unit|#)\s*\w*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Search businesses by address. Returns the best match or null.
 * Uses normalized string comparison — handles common abbreviation differences.
 */
export function findBusinessByAddress(
  query: string,
  businesses: Business[]
): Business | null {
  const normalizedQuery = normalizeAddress(query);
  const queryCore = extractStreetCore(normalizedQuery);

  // Exact normalized match
  for (const biz of businesses) {
    const normalizedBiz = normalizeAddress(biz.address);
    if (normalizedBiz === normalizedQuery) return biz;
  }

  // Core street match (ignoring unit/suite)
  for (const biz of businesses) {
    const bizCore = extractStreetCore(normalizeAddress(biz.address));
    if (bizCore === queryCore) return biz;
  }

  // Partial match — query contains the street number and street name
  const queryParts = queryCore.split(" ");
  if (queryParts.length >= 2) {
    const streetNum = queryParts[0];
    const streetName = queryParts.slice(1).join(" ");

    for (const biz of businesses) {
      const bizNorm = normalizeAddress(biz.address);
      if (bizNorm.includes(streetNum) && bizNorm.includes(streetName)) {
        return biz;
      }
    }
  }

  return null;
}

/**
 * Search businesses by name (case-insensitive substring match).
 */
export function findBusinessByName(
  query: string,
  businesses: Business[]
): Business[] {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];
  return businesses.filter((b) => b.name.toLowerCase().includes(q));
}

/**
 * Build a lookup result from a matched business.
 * Extracts zone names (tifName, ssaName, etc.) and employment data
 * from the business record's zones object.
 */
export function businessToLookupResult(biz: Business): LookupResult {
  const zones: Record<string, boolean> = {};
  const zoneNames: Record<string, string> = {};

  for (const [key, val] of Object.entries(biz.zones)) {
    if (typeof val === "boolean") {
      zones[key] = val;
    } else if (typeof val === "string" && key.endsWith("Name")) {
      // Map e.g. "tifName" -> zoneNames["tif"]
      const baseKey = key.replace(/Name$/, "");
      zoneNames[baseKey] = val;
    }
  }

  // Extract employment data from high-unemployment zone name metadata.
  // The business record stores the census tract name in highUnemploymentName.
  let employment: LookupResult["employment"] = undefined;
  if (zones.highUnemployment && zoneNames.highUnemployment) {
    employment = {
      censusTract: zoneNames.highUnemployment,
      unemploymentRate: "",  // Rate not stored in business JSON; will be enriched by zone-check if needed
      population: 0,
    };
  }

  return {
    matched: true,
    business: biz,
    address: biz.address,
    lat: biz.lat ?? 0,
    lon: biz.lon ?? 0,
    zones,
    zoneNames,
    incentiveCount: biz.incentiveCount,
    employment,
  };
}
