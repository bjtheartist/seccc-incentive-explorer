import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { cached, roundCoord } from "@/lib/redis";
import type { Business } from "@/lib/types";
import { readFile } from "fs/promises";
import { join } from "path";

/**
 * GET /api/businesses?search=&lat=&lon=&radius=
 *
 * Business list with optional full-text search or proximity query.
 * Uses static business data when DATABASE_URL is not set.
 */
async function getStaticBusinesses(): Promise<Business[]> {
  const file = join(process.cwd(), "public", "data", "businesses.json");
  return JSON.parse(await readFile(file, "utf8")) as Business[];
}

function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const earthRadiusMeters = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

async function getStaticBusinessResults({
  search,
  lat,
  lon,
  radius,
}: {
  search: string | null;
  lat: string | null;
  lon: string | null;
  radius: string;
}): Promise<Business[]> {
  const businesses = await getStaticBusinesses();

  if (search) {
    const q = search.toLowerCase();
    return businesses
      .filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.address.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q) ||
          b.zip.includes(q)
      )
      .slice(0, 50);
  }

  if (lat && lon) {
    const qLat = parseFloat(lat);
    const qLon = parseFloat(lon);
    const radiusMeters = parseInt(radius, 10) || 1000;
    if (Number.isFinite(qLat) && Number.isFinite(qLon)) {
      return businesses
        .filter((b) => b.lat != null && b.lon != null)
        .map((b) => ({
          business: b,
          distance: distanceMeters(qLat, qLon, b.lat as number, b.lon as number),
        }))
        .filter(({ distance }) => distance <= radiusMeters)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 50)
        .map(({ business }) => business);
    }
  }

  return businesses.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500);
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.get("search");
  const lat = request.nextUrl.searchParams.get("lat");
  const lon = request.nextUrl.searchParams.get("lon");
  const radius = request.nextUrl.searchParams.get("radius") || "1000";

  const sql = getSQL();
  if (!sql) {
    const businesses = await getStaticBusinessResults({ search, lat, lon, radius });
    return NextResponse.json(businesses, {
      headers: {
        "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=3600",
      },
    });
  }

  try {
    const rLat = lat ? roundCoord(parseFloat(lat)) : "";
    const rLon = lon ? roundCoord(parseFloat(lon)) : "";
    const cacheKey = `businesses:${search || ""}:${rLat}:${rLon}:${radius}`;

    const businesses = await cached(cacheKey, 43200, async () => {
      let rows;

      if (search) {
        rows = await sql`
          SELECT id, name, address, city, state, zip, lat, lon,
                 phone, website, category, incentive_count,
                 zone_data
          FROM businesses
          WHERE search_vector @@ plainto_tsquery('english', ${search})
             OR name ILIKE ${"%" + search + "%"}
             OR address ILIKE ${"%" + search + "%"}
          ORDER BY ts_rank(search_vector, plainto_tsquery('english', ${search})) DESC
          LIMIT 50
        `;
      } else if (lat && lon) {
        const radiusMeters = parseInt(radius, 10) || 1000;
        rows = await sql`
          SELECT id, name, address, city, state, zip, lat, lon,
                 phone, website, category, incentive_count,
                 zone_data,
                 ST_Distance(geom, ST_SetSRID(ST_MakePoint(${parseFloat(lon)}, ${parseFloat(lat)}), 4326)::geography) AS distance_m
          FROM businesses
          WHERE ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(${parseFloat(lon)}, ${parseFloat(lat)}), 4326)::geography,
            ${radiusMeters}
          )
          ORDER BY distance_m
          LIMIT 50
        `;
      } else {
        rows = await sql`
          SELECT id, name, address, city, state, zip, lat, lon,
                 phone, website, category, incentive_count,
                 zone_data
          FROM businesses
          ORDER BY name
          LIMIT 500
        `;
      }

      return rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        city: r.city,
        state: r.state,
        zip: r.zip,
        lat: r.lat,
        lon: r.lon,
        phone: r.phone || "",
        website: r.website || "",
        category: r.category || "",
        incentiveCount: r.incentive_count || 0,
        zones: typeof r.zone_data === "string" ? JSON.parse(r.zone_data) : (r.zone_data || {}),
      }));
    });

    return NextResponse.json(businesses, {
      headers: {
        "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    console.error("businesses API error:", err);
    return NextResponse.json(
      { error: "Database query failed" },
      { status: 500 }
    );
  }
}
