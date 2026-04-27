import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import { readFile } from "fs/promises";
import { join } from "path";
import { getSQL } from "@/lib/db";
import { memCached, roundCoord } from "@/lib/redis";

/**
 * GET /api/census?lat=&lon=
 *
 * Returns census tract data (ACS estimates) for a given lat/lon.
 * Uses PostGIS to find the enclosing census tract.
 * Falls back to the static 2024 ACS file when DATABASE_URL is absent.
 */

type CensusApiData = {
  tractId: unknown;
  medianIncome: unknown;
  medianHomeValue: unknown;
  population: unknown;
  walkScore?: unknown;
  acsYear?: unknown;
};

type CensusFeatureProperties = {
  tractId?: string;
  medianIncome?: number | null;
  medianHomeValue?: number | null;
  population?: number | null;
  walkScore?: number | null;
  acsYear?: string;
};

async function lookupStaticCensus(
  lat: number,
  lon: number
): Promise<CensusFeatureProperties | null> {
  const file = join(process.cwd(), "public", "data", "census-tracts-2024.geojson");
  const data = JSON.parse(await readFile(file, "utf8")) as GeoJSON.FeatureCollection;
  const point = turf.point([lon, lat]);

  for (const feature of data.features) {
    if (
      feature.geometry.type !== "Polygon" &&
      feature.geometry.type !== "MultiPolygon"
    ) {
      continue;
    }

    if (turf.booleanPointInPolygon(point, feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>)) {
      const p = feature.properties as CensusFeatureProperties | null;
      return p ?? null;
    }
  }

  return null;
}

function toApiData(row: CensusApiData | CensusFeatureProperties) {
  return {
    tractId: row.tractId,
    medianIncome: row.medianIncome,
    medianHomeValue: row.medianHomeValue,
    population: row.population,
    walkScore: "walkScore" in row ? row.walkScore : null,
    acsYear: "acsYear" in row ? row.acsYear : "2024",
  };
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

  const parsedLat = parseFloat(lat);
  const parsedLon = parseFloat(lon);

  const sql = getSQL();
  if (!sql) {
    try {
      const data = await lookupStaticCensus(parsedLat, parsedLon);
      return NextResponse.json(data ? toApiData(data) : null, {
        headers: {
          "Cache-Control":
            "public, s-maxage=86400, stale-while-revalidate=86400",
        },
      });
    } catch (err) {
      console.warn("[census] static fallback failed:", err);
      return NextResponse.json(null, {
        headers: {
          "Cache-Control":
            "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      });
    }
  }

  try {
    const rLat = roundCoord(parsedLat);
    const rLon = roundCoord(parsedLon);
    const cacheKey = `census:${rLat}:${rLon}`;

    const data = await memCached(cacheKey, 2592000, async () => {
      const rows = await sql`
        SELECT tract_id, median_income, median_home_value,
               population, walk_score
        FROM census_tracts
        WHERE ST_Contains(
          geom::geometry,
          ST_SetSRID(ST_MakePoint(${parsedLon}, ${parsedLat}), 4326)
        )
        LIMIT 1
      `;

      if (rows.length === 0) {
        return null;
      }

      const r = rows[0] as Record<string, unknown>;
      return toApiData({
        tractId: r.tract_id,
        medianIncome: r.median_income,
        medianHomeValue: r.median_home_value,
        population: r.population,
        walkScore: r.walk_score,
        acsYear: r.acs_year ?? "2024",
      });
    });

    return NextResponse.json(data, {
      headers: {
        "Cache-Control":
          "public, s-maxage=2592000, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("census API error:", err);
    return NextResponse.json(
      { error: "Database query failed" },
      { status: 500 }
    );
  }
}
