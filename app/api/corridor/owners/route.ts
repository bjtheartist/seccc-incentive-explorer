import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { fetchOwnerClusters, loadStaticOwnerClusters } from "@/lib/corridor-owners";

/**
 * Owner & Operator clusters for a corridor ZIP.
 *
 * Live DB first (refresh branches carry full parcel/ownership data), then
 * the committed static export (corridor-metrics doctrine: prod DB holds no
 * parcel data by design — refreshes run on disposable Neon branches →
 * export → drop branch), then an empty list.
 */

/**
 * 42P01 = undefined table, 42703 = undefined column. Both mean the database
 * predates the parcels/ownership migrations (e.g. parcels.zip missing), so
 * fall back to the static export instead of a 500.
 */
function isMissingSchemaError(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  const code = (err as { code?: unknown }).code;
  return code === "42P01" || code === "42703";
}

const STATIC_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=300",
};

function staticResponse(zip: string, limit: number) {
  const clusters = loadStaticOwnerClusters(zip, limit) ?? [];
  return NextResponse.json({ clusters }, { headers: STATIC_CACHE_HEADERS });
}

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get("zip");
  const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? 25);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 25;

  if (!zip || !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "zip must be a 5-digit ZIP code" }, { status: 400 });
  }

  const sql = getSQL();
  if (!sql) return staticResponse(zip, limit);

  try {
    const clusters = await fetchOwnerClusters(sql, zip, limit);
    if (clusters.length === 0) return staticResponse(zip, limit);
    return NextResponse.json({ clusters }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (isMissingSchemaError(err)) {
      console.warn(
        "corridor owners API: schema not migrated (missing table/column), serving static export:",
        err instanceof Error ? err.message : err
      );
      return staticResponse(zip, limit);
    }
    console.error("corridor owners API error:", err);
    return NextResponse.json({ error: "Database query failed" }, { status: 500 });
  }
}
