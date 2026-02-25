import { NextRequest, NextResponse } from "next/server";
import { cached } from "@/lib/redis";

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
};

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "Address is required" }, { status: 400 });
  }

  try {
    const cacheKey = `geocode:${address.toLowerCase().trim()}`;
    const result = await cached(cacheKey, 2592000, async () => {
      const query = encodeURIComponent(`${address}, Chicago, IL`);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=us`,
        {
          headers: {
            "User-Agent": "Chicago-Site-Incentive-Map/1.0",
          },
        }
      );

      const data = await res.json();

      if (!data || data.length === 0) {
        return null;
      }

      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
        displayName: data[0].display_name,
      };
    });

    if (!result) {
      return NextResponse.json(
        { error: "Address not found" },
        { status: 404, headers: CDN_HEADERS }
      );
    }

    return NextResponse.json(result, { headers: CDN_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Geocoding service unavailable" },
      { status: 500 }
    );
  }
}
