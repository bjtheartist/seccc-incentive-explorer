import * as turf from "@turf/turf";
import { readFile } from "fs/promises";
import path from "path";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { normalizeTifKey } from "@/lib/tif-finance";

/**
 * Server-side TIF district boundary lookup.
 *
 * Extracted from app/api/tif-finance/route.ts so both that route and the
 * watchlist digest cron can resolve a lat/lon to a TIF district (with its
 * expiration date) without duplicating the point-in-polygon logic.
 */

export interface TifBoundaryContext {
  districtId: string;
  rawDistrictId: string | null;
  districtName: string;
  expirationDate: string | null;
  boundaryWards: string | null;
}

let tifBoundaryCache: FeatureCollection | null = null;

async function loadTifBoundaries(): Promise<FeatureCollection> {
  if (tifBoundaryCache) return tifBoundaryCache;
  const filePath = path.join(
    process.cwd(),
    "public",
    "data",
    "zones",
    "tif-districts.geojson"
  );
  const raw = await readFile(filePath, "utf8");
  tifBoundaryCache = JSON.parse(raw) as FeatureCollection;
  return tifBoundaryCache;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function boundaryContextFromFeature(
  feature: Feature
): TifBoundaryContext | null {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  // The published TIF boundary GeoJSON uses underscore keys (TIF_Number,
  // District_Name, Expiration_Date). The snake/space variants below are kept
  // only as defensive fallbacks for other/older exports; without TIF_Number
  // first this resolved to null for every feature, blanking all TIF finance.
  const rawDistrictId = firstString(
    properties.TIF_Number,
    properties["TIF Number"],
    properties.tif_number,
    properties.ref,
    properties.REF
  );
  const districtId = normalizeTifKey(rawDistrictId);
  if (!districtId) return null;

  return {
    districtId,
    rawDistrictId,
    districtName:
      firstString(
        properties.District_Name,
        properties["District Name"],
        properties.name,
        properties.NAME,
        properties.tif_district,
        properties.tif_name
      ) ?? districtId,
    expirationDate:
      firstString(
        properties.Expiration_Date,
        properties["Expiration Date"],
        properties.expiration,
        properties.expiration_date
      ) ?? null,
    boundaryWards: firstString(properties.Wards, properties.wards) ?? null,
  };
}

export async function findTifBoundaryAtPoint(
  lat: number,
  lon: number
): Promise<TifBoundaryContext | null> {
  const collection = await loadTifBoundaries();
  const point = turf.point([lon, lat]);

  const match = collection.features.find(
    (feature): feature is Feature<Polygon | MultiPolygon> => {
      if (!feature.geometry) return false;
      try {
        return turf.booleanPointInPolygon(
          point,
          feature as Feature<Polygon | MultiPolygon>
        );
      } catch {
        // The city's TIF boundary GeoJSON ships at least one malformed
        // feature (an unclosed ring), which makes turf throw "First and
        // last coordinates in a ring must be the same". Skip that feature
        // and keep scanning the rest instead of failing the whole lookup.
        return false;
      }
    }
  );

  return match ? boundaryContextFromFeature(match) : null;
}
