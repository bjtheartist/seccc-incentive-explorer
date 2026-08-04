/**
 * Site Activity Context — RAW public measurements around a point. No synthesis.
 *
 * This module deliberately publishes only what a government dataset states,
 * each measure carrying its own source, vintage, and disclosed search radius.
 * There is NO combined "foot traffic" or "visitor" number anywhere in this
 * engine and none may ever be added: an uncalibrated composite would put an
 * invented figure on the same page as reconciliation-gated grant data. The
 * banned-key test in lib/__tests__/site-activity.test.ts enforces this shape.
 *
 * Feeds (data/curated/site-activity/, each with a manifest + verify script):
 *   1. IDOT AADT count stations        — vehicles/day, per-station vintage year
 *   2. CTA 'L' station ridership       — avg weekday entries, measured month
 *   3. ACS + LODES block groups        — residents + jobs, centroid catchment
 *   4. Chicago active business licenses — categorized counts
 * The fifth context line (zoning) comes from the report's existing zoning
 * lookup and is passed through by the caller, not computed here.
 *
 * Search radii are DISCLOSED CONSTANTS, not tuning knobs: they appear verbatim
 * in the UI ("within 0.25 mi") so every claim names its own boundary.
 */

export const ARTERIAL_RADIUS_MI = 0.15; // nearest count station within a block or two
export const RAIL_RADIUS_MI = 0.5; // standard transit walkshed
export const CATCHMENT_RADIUS_MI = 0.5; // block-group centroids within
export const LICENSE_RADIUS_MI = 0.25; // storefront cluster radius

/** One measure's provenance — rendered verbatim under every value. */
export interface SourceRef {
  label: string;
  datasetId: string;
  url: string;
  vintage: string;
  retrieved: string;
}

export interface AadtStationRow {
  id: string;
  roadName: string;
  lat: number;
  lng: number;
  aadt: number;
  aadtYear: string;
}

export interface RailStationRow {
  id: string;
  name: string;
  lines: string;
  lat: number;
  lng: number;
  avgWeekdayEntries: number;
  month: string;
  priorYearAvgWeekdayEntries: number | null;
}

export interface BlockGroupRow {
  geoid: string;
  lat: number;
  lng: number;
  population: number;
  acsVintage: string;
  jobs: number;
  lodesVintage: string;
}

export interface LicenseRow {
  category: string;
  lat: number;
  lng: number;
}

export interface ArterialMeasure {
  roadName: string;
  aadt: number;
  aadtYear: string;
  stationId: string;
  distanceMi: number;
}

export interface RailMeasure {
  name: string;
  lines: string[];
  avgWeekdayEntries: number;
  month: string;
  priorYearAvgWeekdayEntries: number | null;
  distanceMi: number;
}

export interface CatchmentMeasure {
  population: number;
  jobs: number;
  blockGroups: number;
  acsVintage: string;
  lodesVintage: string;
}

export interface LicenseMeasure {
  total: number;
  byCategory: { category: string; count: number }[];
}

/** The whole card payload. A null measure means "nothing inside the disclosed
 * radius" — rendered as an explicit absence, never coerced to zero. */
export interface SiteActivityContext {
  arterial: ArterialMeasure | null;
  rail: RailMeasure[];
  catchment: CatchmentMeasure | null;
  licenses: LicenseMeasure | null;
  radii: {
    arterialMi: number;
    railMi: number;
    catchmentMi: number;
    licenseMi: number;
  };
}

const EARTH_RADIUS_MI = 3958.7613;

/** Great-circle distance in miles (haversine). Pure. */
export function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Nearest IDOT count station within the disclosed radius, or null. The
 * distance ships with the value so "18,500 vehicles/day" can never silently
 * describe a road two neighborhoods away. */
export function nearestArterial(
  lat: number,
  lng: number,
  stations: readonly AadtStationRow[],
): ArterialMeasure | null {
  let best: ArterialMeasure | null = null;
  for (const s of stations) {
    const d = distanceMiles(lat, lng, s.lat, s.lng);
    if (d > ARTERIAL_RADIUS_MI) continue;
    if (!best || d < best.distanceMi) {
      best = {
        roadName: s.roadName,
        aadt: s.aadt,
        aadtYear: s.aadtYear,
        stationId: s.id,
        distanceMi: round2(d),
      };
    }
  }
  return best;
}

/** Every 'L' station inside the walkshed, nearest first. Empty array = none. */
export function railStationsNear(
  lat: number,
  lng: number,
  stations: readonly RailStationRow[],
): RailMeasure[] {
  const out: RailMeasure[] = [];
  for (const s of stations) {
    const d = distanceMiles(lat, lng, s.lat, s.lng);
    if (d > RAIL_RADIUS_MI) continue;
    out.push({
      name: s.name,
      lines: s.lines.split("|").filter(Boolean),
      avgWeekdayEntries: s.avgWeekdayEntries,
      month: s.month,
      priorYearAvgWeekdayEntries: s.priorYearAvgWeekdayEntries,
      distanceMi: round2(d),
    });
  }
  return out.sort((a, b) => a.distanceMi - b.distanceMi);
}

/** Residents + jobs summed over block groups whose CENTROID falls inside the
 * radius — a disclosed approximation (the UI says "block groups by centroid"),
 * not a parcel-exact count. Vintages are carried from the rows themselves. */
export function catchmentAround(
  lat: number,
  lng: number,
  blockGroups: readonly BlockGroupRow[],
): CatchmentMeasure | null {
  let population = 0;
  let jobs = 0;
  let n = 0;
  let acsVintage = "";
  let lodesVintage = "";
  for (const bg of blockGroups) {
    if (distanceMiles(lat, lng, bg.lat, bg.lng) > CATCHMENT_RADIUS_MI) continue;
    population += bg.population;
    jobs += bg.jobs;
    n += 1;
    acsVintage = bg.acsVintage;
    lodesVintage = bg.lodesVintage;
  }
  if (n === 0) return null;
  return { population, jobs, blockGroups: n, acsVintage, lodesVintage };
}

/** Licensed active businesses inside the radius, counted by category, largest
 * first. The uncategorizable remainder stays visible as "other" — hiding it
 * would overstate how specific the categorization is. */
export function licensesNear(
  lat: number,
  lng: number,
  licenses: readonly LicenseRow[],
): LicenseMeasure | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const l of licenses) {
    if (distanceMiles(lat, lng, l.lat, l.lng) > LICENSE_RADIUS_MI) continue;
    counts.set(l.category, (counts.get(l.category) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return null;
  const byCategory = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  return { total, byCategory };
}

/** Assemble the full context. Pure — data rows in, measures out. */
export function buildSiteActivityContext(
  lat: number,
  lng: number,
  data: {
    aadt: readonly AadtStationRow[];
    rail: readonly RailStationRow[];
    blockGroups: readonly BlockGroupRow[];
    licenses: readonly LicenseRow[];
  },
): SiteActivityContext {
  return {
    arterial: nearestArterial(lat, lng, data.aadt),
    rail: railStationsNear(lat, lng, data.rail),
    catchment: catchmentAround(lat, lng, data.blockGroups),
    licenses: licensesNear(lat, lng, data.licenses),
    radii: {
      arterialMi: ARTERIAL_RADIUS_MI,
      railMi: RAIL_RADIUS_MI,
      catchmentMi: CATCHMENT_RADIUS_MI,
      licenseMi: LICENSE_RADIUS_MI,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Human labels for license categories (keys from license_categories.json). */
export const LICENSE_CATEGORY_LABELS: Record<string, string> = {
  grocery: "Grocery",
  restaurant_cafe: "Restaurants & cafes",
  liquor_tavern: "Liquor & taverns",
  retail_general: "General retail",
  gym_fitness: "Gyms & fitness",
  personal_services: "Personal services",
  medical_health: "Medical & health",
  financial_services: "Financial services",
  other: "Other licensed",
};

/** The card's fixed source register — dataset ids and verify links rendered
 * under each measure. Vintage fields that vary per row (AADT year, CTA month,
 * ACS/LODES vintages) are shown from the DATA, not from here. */
export const SITE_ACTIVITY_SOURCES: Record<"aadt" | "rail" | "catchment" | "licenses", SourceRef> = {
  aadt: {
    label: "Illinois DOT traffic counts (AADT)",
    datasetId: "IDOT Getting Around Illinois — AdministrativeData/AADT layer 0",
    url: "https://gis1.dot.illinois.gov/arcgis/rest/services/AdministrativeData/AADT/MapServer/0",
    vintage: "per-station count year in the data",
    retrieved: "2026-08-04",
  },
  rail: {
    label: "CTA 'L' station daily entries",
    datasetId: "Chicago Data Portal 5neh-572f (ridership) + 8pix-ypme (stops)",
    url: "https://data.cityofchicago.org/d/5neh-572f",
    vintage: "latest complete month in the data",
    retrieved: "2026-08-04",
  },
  catchment: {
    label: "U.S. Census Bureau — ACS 5-year population + LODES workplace jobs",
    datasetId: "ACS B01003 (2020–2024) + LEHD LODES8 WAC 2023, block groups",
    url: "https://data.census.gov/",
    vintage: "vintages carried per row",
    retrieved: "2026-08-04",
  },
  licenses: {
    label: "City of Chicago active business licenses",
    datasetId: "Chicago Data Portal uupf-x98q",
    url: "https://data.cityofchicago.org/d/uupf-x98q",
    vintage: "2026-08 publication",
    retrieved: "2026-08-04",
  },
};
