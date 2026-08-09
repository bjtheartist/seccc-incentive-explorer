import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "@/lib/mobility-access";
import {
  buildSiteActivityContext,
  SITE_ACTIVITY_SOURCES,
  type AadtStationRow,
  type BlockGroupRow,
  type LicenseRow,
  type RailStationRow,
} from "@/lib/site-activity";

/**
 * Site Activity Context — PUBLIC route, deliberately.
 *
 * Everything served here is a raw measurement from an open government dataset
 * (IDOT counts, CTA ridership, Census population/jobs, active licenses) with
 * its provenance attached; there are no recipient names, no grant records, and
 * nothing from the gated Community Investment dataset. That is why this route
 * carries public cache headers while /api/owner-file/investment stays
 * private,no-store — do not blur the two postures.
 *
 * The four curated CSVs (~4.5 MB total) are read once per process and reused.
 */

const DATA_DIR = path.join(process.cwd(), "data", "curated", "site-activity");

// Chicago-area sanity bounds — reject far-away coordinates loudly instead of
// returning an all-null context that reads as "quiet neighborhood".
const BOUNDS = { latMin: 41.6, latMax: 42.1, lngMin: -87.95, lngMax: -87.5 };

interface SiteActivityData {
  aadt: AadtStationRow[];
  rail: RailStationRow[];
  blockGroups: BlockGroupRow[];
  licenses: LicenseRow[];
}

let cache: SiteActivityData | null | undefined;

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function loadData(): SiteActivityData | null {
  if (cache !== undefined) return cache;
  try {
    const read = (name: string) => {
      const p = path.join(DATA_DIR, name);
      if (!existsSync(p)) throw new Error(`missing ${name}`);
      return parseCsv(readFileSync(p, "utf8"));
    };

    const aadt: AadtStationRow[] = [];
    for (const r of read("idot_aadt_stations.csv")) {
      const lat = num(r.lat);
      const lng = num(r.lng);
      const value = num(r.aadt);
      if (lat == null || lng == null || value == null) continue;
      aadt.push({
        id: r.station_or_segment_id ?? "",
        roadName: r.road_name ?? "",
        lat,
        lng,
        aadt: value,
        aadtYear: r.aadt_year ?? "",
      });
    }

    const rail: RailStationRow[] = [];
    for (const r of read("cta_l_station_avg_weekday.csv")) {
      const lat = num(r.lat);
      const lng = num(r.lng);
      const entries = num(r.avg_weekday_entries);
      if (lat == null || lng == null || entries == null) continue;
      rail.push({
        id: r.station_id ?? "",
        name: r.station_name ?? "",
        lines: r.lines ?? "",
        lat,
        lng,
        avgWeekdayEntries: entries,
        month: r.month ?? "",
        priorYearAvgWeekdayEntries: num(r.prior_year_avg_weekday_entries),
      });
    }

    const blockGroups: BlockGroupRow[] = [];
    for (const r of read("catchment_block_groups.csv")) {
      const lat = num(r.lat);
      const lng = num(r.lng);
      const population = num(r.population);
      const jobs = num(r.jobs);
      if (lat == null || lng == null || population == null || jobs == null) continue;
      blockGroups.push({
        geoid: r.bg_geoid ?? "",
        lat,
        lng,
        population,
        acsVintage: r.acs_vintage ?? "",
        jobs,
        lodesVintage: r.lodes_vintage ?? "",
      });
    }

    const licenses: LicenseRow[] = [];
    for (const r of read("active_licenses_compact.csv")) {
      const lat = num(r.lat);
      const lng = num(r.lng);
      if (lat == null || lng == null) continue;
      licenses.push({ category: r.category ?? "other", lat, lng });
    }

    cache = { aadt, rail, blockGroups, licenses };
  } catch {
    // Missing/unreadable inputs degrade to 503, never to a fabricated context.
    cache = null;
  }
  return cache;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lon") ?? url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400 });
  }
  if (lat < BOUNDS.latMin || lat > BOUNDS.latMax || lng < BOUNDS.lngMin || lng > BOUNDS.lngMax) {
    return NextResponse.json(
      { error: "coordinates outside the Chicago data coverage area" },
      { status: 422 },
    );
  }
  const data = loadData();
  if (!data) {
    return NextResponse.json({ error: "site activity data unavailable" }, { status: 503 });
  }
  const context = buildSiteActivityContext(lat, lng, data);
  return NextResponse.json(
    { context, sources: SITE_ACTIVITY_SOURCES },
    {
      headers: {
        // public data, generous shared cache; revalidate daily
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
      },
    },
  );
}
