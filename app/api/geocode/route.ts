import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "Address is required" }, { status: 400 });
  }

  try {
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
      return NextResponse.json(
        { error: "Address not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      displayName: data[0].display_name,
    });
  } catch {
    return NextResponse.json(
      { error: "Geocoding service unavailable" },
      { status: 500 }
    );
  }
}
