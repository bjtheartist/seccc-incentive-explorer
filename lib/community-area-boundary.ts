import { join } from "node:path";
import { loadCommunityAreaPolygons } from "@/lib/community-area-stamp";
import type { PermitAreaGeometry } from "@/lib/permit-area";

let boundaryCache: Map<string, PermitAreaGeometry> | null = null;

/**
 * Return the City-published boundary geometry for a canonical community-area
 * name. The committed GeoJSON is City dataset igwz-8jzy and is also the source
 * used by the investment export's point-in-polygon assignment.
 */
export function getCommunityAreaBoundary(
  communityArea: string,
): PermitAreaGeometry | null {
  if (!boundaryCache) {
    const boundaryPath = join(
      process.cwd(),
      "public",
      "data",
      "community-areas.geojson",
    );
    boundaryCache = new Map(
      loadCommunityAreaPolygons(boundaryPath).map((entry) => [
        entry.name,
        entry.feature.geometry,
      ]),
    );
  }

  return boundaryCache.get(communityArea) ?? null;
}
