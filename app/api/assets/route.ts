import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { cached } from "@/lib/redis";

/**
 * GET /api/assets?type=edo,bso
 *
 * Returns community assets (EDOs, BSOs, universities, libraries).
 * Optional type filter (comma-separated).
 */

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=86400",
};

// Static fallback data (from MapView.tsx EDO_BSO_POINTS)
const STATIC_ASSETS = [
  { id: "seccc", name: "Southeast Chicago Chamber of Commerce (SECCC)", type: "EDO", address: "8751 S Houston Ave, Chicago, IL 60617", lat: 41.7395, lon: -87.5687 },
  { id: "claretian", name: "Claretian Associates", type: "EDO", address: "3039 E 91st St, Chicago, IL 60617", lat: 41.7298444, lon: -87.5492184 },
  { id: "cni", name: "Chicago Neighborhood Initiatives (CNI)", type: "EDO", address: "11045 S Michigan Ave, Chicago, IL 60628", lat: 41.7254, lon: -87.6037 },
  { id: "sbs", name: "Cook County Small Business Source", type: "BSO", address: "69 W Washington St, Chicago, IL 60602", lat: 41.8397, lon: -87.6252 },
  { id: "sbdc", name: "Illinois SBDC at Women's Business Development Center", type: "BSO", address: "8 S Michigan Ave #400, Chicago, IL 60603", lat: 41.8768, lon: -87.6278 },
  { id: "somercor", name: "SomerCor 504 (SBA Lender)", type: "BSO", address: "2 E 8th St, Chicago, IL 60605", lat: 41.7528, lon: -87.5839 },
  { id: "fscdc", name: "Far South Community Development Corp", type: "EDO", address: "34 E 75th St, Chicago, IL 60619", lat: 41.7495, lon: -87.6048 },
];

const REQUIRED_STATIC_ASSET_IDS = new Set(["claretian"]);

type CommunityAssetRow = typeof STATIC_ASSETS[number];

function withRequiredStaticAssets(
  assets: CommunityAssetRow[],
  types: string[] | null,
) {
  const existingIds = new Set(assets.map((asset) => asset.id));
  const requiredAssets = STATIC_ASSETS.filter(
    (asset) =>
      REQUIRED_STATIC_ASSET_IDS.has(asset.id) &&
      !existingIds.has(asset.id) &&
      (!types || types.includes(asset.type)),
  );

  return [...assets, ...requiredAssets];
}

export async function GET(request: NextRequest) {
  const typeParam = request.nextUrl.searchParams.get("type");
  const types = typeParam ? typeParam.split(",").map((t) => t.trim().toUpperCase()) : null;
  const typeKey = types ? types.sort().join(",") : "all";

  const sql = getSQL();
  if (!sql) {
    const filtered = types
      ? STATIC_ASSETS.filter((a) => types.includes(a.type))
      : STATIC_ASSETS;
    return NextResponse.json(filtered, { headers: CDN_HEADERS });
  }

  try {
    const cacheKey = `assets:${typeKey}`;
    const rows = await cached(cacheKey, 604800, async () => {
      if (types && types.length > 0) {
        return await sql`
          SELECT id, name, type, address, lat, lon
          FROM community_assets
          WHERE UPPER(type) = ANY(${types})
          ORDER BY type, name
        `;
      } else {
        return await sql`
          SELECT id, name, type, address, lat, lon
          FROM community_assets
          ORDER BY type, name
        `;
      }
    });

    return NextResponse.json(withRequiredStaticAssets(rows as CommunityAssetRow[], types), { headers: CDN_HEADERS });
  } catch {
    const filtered = types
      ? STATIC_ASSETS.filter((a) => types.includes(a.type))
      : STATIC_ASSETS;
    return NextResponse.json(filtered, { headers: CDN_HEADERS });
  }
}
