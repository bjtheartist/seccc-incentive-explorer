import { NextRequest, NextResponse } from "next/server";
import { invalidatePattern } from "@/lib/redis";

/**
 * POST /api/health/reset
 *
 * Clear Redis cache by API route namespace.
 * Body: { action: "clear-cache", targets: ["parcel", "zoning", ...] }
 *   or: { action: "clear-all" }
 *
 * Requires `x-admin-key: <ADMIN_SECRET>` for auth.
 */

function verifyAdminRequest(request: NextRequest): NextResponse | null {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json(
      { error: "ADMIN_SECRET not configured" },
      { status: 503 },
    );
  }

  if (request.headers.get("x-admin-key") !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/** Known cache namespaces mapped to human-readable labels and glob patterns. */
const CACHE_NAMESPACES: Record<
  string,
  { label: string; pattern: string; description: string }
> = {
  businesses: {
    label: "Businesses",
    pattern: "businesses:*",
    description: "Business search/proximity queries",
  },
  geojson: {
    label: "Zone GeoJSON",
    pattern: "geojson:*",
    description: "Zone GeoJSON layer data",
  },
  zones: {
    label: "Zone Check",
    pattern: "zones:*",
    description: "Point-in-zone membership lookups",
  },
  districts: {
    label: "Districts",
    pattern: "districts:*",
    description: "Special district lookups by coordinates",
  },
  vacant: {
    label: "Vacant Properties",
    pattern: "vacant:*",
    description: "Vacant property viewport queries",
  },
  parcel: {
    label: "Parcel Lookup",
    pattern: "parcel:*",
    description: "Cook County parcel/assessment data",
  },
  stacking: {
    label: "Incentive Stacking",
    pattern: "stacking:*",
    description: "Program stacking analysis",
  },
  programs: {
    label: "Programs",
    pattern: "programs:*",
    description: "Incentive program listings",
  },
  zoning: {
    label: "Chicago Zoning",
    pattern: "zoning:*",
    description: "Chicago zoning classification",
  },
  census: {
    label: "Census Data",
    pattern: "census:*",
    description: "Census tract ACS data",
  },
  assets: {
    label: "Community Assets",
    pattern: "assets:*",
    description: "EDOs, BSOs, and other assets",
  },
  stats: {
    label: "Aggregate Stats",
    pattern: "stats:*",
    description: "Coverage statistics",
  },
  geocode: {
    label: "Geocoding",
    pattern: "geocode:*",
    description: "Nominatim geocoding results",
  },
};

export async function GET(request: NextRequest) {
  const authError = verifyAdminRequest(request);
  if (authError) return authError;

  // Return available cache namespaces
  const namespaces = Object.entries(CACHE_NAMESPACES).map(([id, info]) => ({
    id,
    ...info,
  }));

  return NextResponse.json({ namespaces });
}

export async function POST(request: NextRequest) {
  const authError = verifyAdminRequest(request);
  if (authError) return authError;

  let body: { action: string; targets?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, targets } = body;

  if (action === "clear-all") {
    const results: Record<string, number> = {};
    let totalDeleted = 0;

    for (const [id, info] of Object.entries(CACHE_NAMESPACES)) {
      const deleted = await invalidatePattern(info.pattern);
      results[id] = deleted;
      totalDeleted += deleted;
    }

    return NextResponse.json({
      action: "clear-all",
      totalDeleted,
      results,
      timestamp: new Date().toISOString(),
    });
  }

  if (action === "clear-cache" && Array.isArray(targets) && targets.length > 0) {
    const results: Record<string, number> = {};
    let totalDeleted = 0;

    for (const target of targets) {
      const ns = CACHE_NAMESPACES[target];
      if (!ns) continue;
      const deleted = await invalidatePattern(ns.pattern);
      results[target] = deleted;
      totalDeleted += deleted;
    }

    return NextResponse.json({
      action: "clear-cache",
      targets,
      totalDeleted,
      results,
      timestamp: new Date().toISOString(),
    });
  }

  return NextResponse.json(
    { error: "Invalid action. Use 'clear-cache' with targets or 'clear-all'." },
    { status: 400 }
  );
}
