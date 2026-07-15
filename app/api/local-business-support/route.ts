import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { booleanPointInPolygon, point } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import citywideSupportData from "@/data/curated/citywide_business_support_resources.json";
import supportData from "@/data/exports/chicago-neighborhood-economics/local_business_support_by_community_area.json";
import {
  mergeCitywideBusinessSupport,
  rankLocalBusinessSupport,
  type LocalBusinessSupportContext,
  type LocalBusinessSupportOrganization,
  type LocalBusinessSupportRequest,
} from "@/lib/local-business-support";

interface CommunityAreaProps {
  community?: string;
  area_numbe?: string;
  area_num_1?: string;
}

interface LocalBusinessSupportFile {
  source: string;
  generatedAt: string;
  communityAreaCount: number;
  providerCount: number;
  byCommunityArea: Record<string, LocalBusinessSupportContext>;
}

interface CitywideBusinessSupportFile {
  source: string;
  generatedAt: string;
  providerCount: number;
  organizations: LocalBusinessSupportOrganization[];
  sourceUrls: string[];
}

const supportFile = supportData as LocalBusinessSupportFile;
const citywideSupportFile = citywideSupportData as CitywideBusinessSupportFile;

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
 * GET /api/local-business-support?lat=..&lon=..  (or ?ca=<area number>)
 *
 * Resolves the report address to a Chicago community area and returns the
 * curated local organizations most likely to support business owners there.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const caParam = params.get("ca")?.trim();
  const latStr = params.get("lat");
  const lonStr = params.get("lon");
  const reportType = params.get("reportType")?.trim().slice(0, 80) || undefined;
  const projectType = params.get("projectType")?.trim().slice(0, 80) || undefined;
  const proposedUse = params.get("proposedUse")?.trim().slice(0, 80) || undefined;

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
      { communityArea: null, communityAreaNumber: null, organizations: [] },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
    );
  }

  const entry = supportFile.byCommunityArea?.[caNumber];
  if (!entry) {
    return NextResponse.json(
      { communityArea: resolvedName, communityAreaNumber: caNumber, organizations: [] },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
    );
  }

  const supportRequest: LocalBusinessSupportRequest = {
    communityAreaNumber: caNumber,
    communityArea: entry.communityArea || resolvedName || undefined,
    region: entry.region,
    reportType,
    projectType,
    proposedUse,
  };
  const supportPool = mergeCitywideBusinessSupport(
    entry.organizations,
    citywideSupportFile.organizations,
    supportRequest,
  );
  const organizations = rankLocalBusinessSupport(supportPool, 6, supportRequest);
  const sourceUrls = Array.from(
    new Set([
      ...(entry.sourceUrls ?? []),
      ...organizations.flatMap((org) => org.sourceUrls ?? []),
    ])
  );

  return NextResponse.json(
    {
      ...entry,
      communityArea: entry.communityArea || resolvedName || "",
      organizations,
      organizationCount: organizations.length,
      sourceUrls,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    }
  );
}
