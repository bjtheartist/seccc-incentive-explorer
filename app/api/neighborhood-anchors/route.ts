import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { booleanPointInPolygon, point } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import anchorsData from "@/data/exports/chicago-neighborhood-economics/neighborhood_anchors_by_community_area.json";
import {
  rankCommunityAnchors,
  type CommunityAnchorFile,
} from "@/lib/neighborhood-economic-models";

const anchorFile = anchorsData as CommunityAnchorFile;

interface CommunityAreaProps {
  community?: string;
  area_numbe?: string;
  area_num_1?: string;
}

// Parse the community-area boundaries once per cold start.
let cachedAreas: Array<Feature<Polygon | MultiPolygon, CommunityAreaProps>> | null = null;
function communityAreaFeatures() {
  if (cachedAreas) return cachedAreas;
  try {
    const raw = readFileSync(
      resolve(process.cwd(), "public/data/community-areas.geojson"),
      "utf8"
    );
    const fc = JSON.parse(raw) as { features: Array<Feature<Polygon | MultiPolygon, CommunityAreaProps>> };
    cachedAreas = fc.features ?? [];
  } catch {
    cachedAreas = [];
  }
  return cachedAreas;
}

function resolveCommunityArea(lat: number, lon: number): { number: string; name: string } | null {
  const pt = point([lon, lat]);
  for (const feature of communityAreaFeatures()) {
    try {
      if (feature.geometry && booleanPointInPolygon(pt, feature.geometry)) {
        const props = feature.properties ?? {};
        const number = props.area_numbe ?? props.area_num_1 ?? "";
        if (number) return { number: String(number), name: props.community ?? "" };
      }
    } catch {
      // skip malformed geometry
    }
  }
  return null;
}

/**
 * GET /api/neighborhood-anchors?lat=..&lon=..  (or ?ca=<area number>)
 *
 * Resolves the Chicago community area for a point and returns curated,
 * source-cited anchor businesses for that area, ranked by impact score.
 * Aggregate, public-record context only — no owner/contact rows.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const caParam = params.get("ca")?.trim();
  const latStr = params.get("lat");
  const lonStr = params.get("lon");

  let caNumber: string | null = caParam && /^\d{1,2}$/.test(caParam) ? caParam : null;
  let resolvedName: string | null = null;

  if (!caNumber && latStr != null && lonStr != null) {
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const resolved = resolveCommunityArea(lat, lon);
      if (resolved) {
        caNumber = resolved.number;
        resolvedName = resolved.name;
      }
    }
  }

  if (!caNumber) {
    return NextResponse.json(
      { communityArea: null, communityAreaNumber: null, anchors: [] },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
    );
  }

  const entry = anchorFile.byCommunityArea?.[caNumber];
  const anchors = entry ? rankCommunityAnchors(entry.anchors, 5) : [];

  return NextResponse.json(
    {
      communityArea: entry?.communityArea ?? resolvedName,
      communityAreaNumber: caNumber,
      anchorCount: anchors.length,
      anchors,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    }
  );
}
