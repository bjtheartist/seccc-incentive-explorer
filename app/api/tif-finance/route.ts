import { NextRequest, NextResponse } from "next/server";
import { memCached, roundCoord } from "@/lib/redis";
import {
  fetchLatestTifFinanceContext,
  type TifFinanceContext,
} from "@/lib/tif-finance";
import { findTifBoundaryAtPoint } from "@/lib/tif-boundary";

export const runtime = "nodejs";

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
