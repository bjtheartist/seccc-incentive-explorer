import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getSQL } from "@/lib/db";
import { ZONE_KEYS } from "@/lib/constants";
import { memCached } from "@/lib/redis";

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=86400, immutable",
};

async function readStaticZone(fileName: string) {
  const filePath = path.join(process.cwd(), "public", "data", "zones", fileName);
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

/**
 * GET /api/zones/geojson/:key
 *
 * Returns a GeoJSON FeatureCollection for a specific zone layer.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;

  if (!ZONE_KEYS.includes(key)) {
    return NextResponse.json(
      { error: `Unknown zone key: ${key}` },
      { status: 400 }
    );
  }

  if (key === "nof") {
    return NextResponse.json(await readStaticZone("nof-corridors.geojson"), {
      headers: CDN_HEADERS,
    });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  try {
    const cacheKey = `geojson:${key}`;
    const fc = await memCached(cacheKey, 2592000, async () => {
      const rows = await sql`
        SELECT feature_name, feature_properties,
               ST_AsGeoJSON(geom)::json AS geometry
        FROM zones
        WHERE zone_key = ${key}
      `;

      const features = rows.map((r: Record<string, unknown>) => ({
        type: "Feature" as const,
        geometry: r.geometry,
        properties: {
          ...(typeof r.feature_properties === "string"
            ? JSON.parse(r.feature_properties)
            : (r.feature_properties || {})),
          name: r.feature_name,
        },
      }));

      return {
        type: "FeatureCollection",
        features,
      };
    });

    return NextResponse.json(fc, { headers: CDN_HEADERS });
  } catch (err) {
    console.error("zone geojson API error:", err);
    return NextResponse.json(
      { error: "Database query failed" },
      { status: 500 }
    );
  }
}
