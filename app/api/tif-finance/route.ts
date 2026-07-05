import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import { readFile } from "fs/promises";
import path from "path";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { memCached, roundCoord } from "@/lib/redis";
import {
  fetchLatestTifFinanceContext,
  normalizeTifKey,
  type TifFinanceContext,
} from "@/lib/tif-finance";

export const runtime = "nodejs";

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

function boundaryContextFromFeature(feature: Feature): {
  districtId: string;
  rawDistrictId: string | null;
  districtName: string;
  expirationDate: string | null;
  boundaryWards: string | null;
} | null {
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

async function findTifBoundaryAtPoint(lat: number, lon: number) {
  const collection = await loadTifBoundaries();
  const point = turf.point([lon, lat]);

  const match = collection.features.find(
    (feature): feature is Feature<Polygon | MultiPolygon> =>
      Boolean(feature.geometry) &&
      turf.booleanPointInPolygon(point, feature as Feature<Polygon | MultiPolygon>)
  );

  return match ? boundaryContextFromFeature(match) : null;
}

export async function GET(request: NextRequest) {
  const lat = request.nextUrl.searchParams.get("lat");
  const lon = request.nextUrl.searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json(
      { error: "lat and lon are required" },
      { status: 400 }
    );
  }

  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    return NextResponse.json(
      { error: "lat and lon must be valid numbers" },
      { status: 400 }
    );
  }

  try {
    const cacheKey = `tif-finance:${roundCoord(latNum)}:${roundCoord(lonNum)}`;
    const tifFinance = await memCached<TifFinanceContext | null>(
      cacheKey,
      86400,
      async () => {
        const boundary = await findTifBoundaryAtPoint(latNum, lonNum);
        if (!boundary) return null;
        return fetchLatestTifFinanceContext(boundary);
      }
    );

    return NextResponse.json(
      { tifFinance },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=86400, stale-while-revalidate=604800",
        },
      }
    );
  } catch (error) {
    console.error("tif finance API error:", error);
    return NextResponse.json(
      { tifFinance: null, error: "TIF finance lookup failed" },
      { status: 500 }
    );
  }
}
