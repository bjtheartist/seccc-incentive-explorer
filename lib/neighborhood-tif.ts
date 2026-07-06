/**
 * Bridges the community-area neighborhood pages
 * (app/neighborhoods/[slug]/incentives/page.tsx) to the TIF districts that
 * actually overlap each community area, via data/exports/community-area-tif.json
 * (built by scripts/build-ca-tif-map.ts from real TIF-vs-CA polygon overlap).
 *
 * This replaces the old centroid point-in-polygon test for TIF, which
 * under-claimed: a community area can be largely TIF-covered while its single
 * centroid misses every district polygon. Polygon overlap is the ground truth
 * for "which TIF districts are in this neighborhood" — see the build script
 * for why the TIF file's own Community_Areas list was not used (it over-claims).
 *
 * The map is a best-effort batch artifact; every lookup is null-safe so a
 * neighborhood page always renders even with the file missing.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CA_TIF_MAP_PATH = path.join(
  process.cwd(),
  "data/exports/community-area-tif.json",
);

export interface NeighborhoodTifDistrict {
  /** Normalized TIF number, e.g. "T-178". */
  tifNumber: string;
  districtName: string;
  expirationYear: number | null;
  /** Share of the community area's land area inside this district, percent. */
  overlapPct: number;
}

type CommunityAreaTifMap = Record<string, NeighborhoodTifDistrict[] | undefined>;

let caTifCache: CommunityAreaTifMap | null | undefined = undefined;

function loadCommunityAreaTifMap(): CommunityAreaTifMap | null {
  if (caTifCache !== undefined) return caTifCache;

  try {
    if (!existsSync(CA_TIF_MAP_PATH)) {
      caTifCache = null;
      return caTifCache;
    }
    const raw = readFileSync(CA_TIF_MAP_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    caTifCache =
      parsed && typeof parsed === "object"
        ? (parsed as CommunityAreaTifMap)
        : null;
  } catch {
    caTifCache = null;
  }

  return caTifCache;
}

/**
 * TIF districts overlapping a community area, sorted by coverage (largest
 * first). Returns `[]` when the area has no meaningful TIF overlap or the map
 * is unavailable — callers render fine with an empty list.
 */
export function getTifDistrictsForCommunityArea(
  caId: number,
): NeighborhoodTifDistrict[] {
  const map = loadCommunityAreaTifMap();
  if (!map) return [];
  const hits = map[String(caId)];
  return Array.isArray(hits) ? hits : [];
}
