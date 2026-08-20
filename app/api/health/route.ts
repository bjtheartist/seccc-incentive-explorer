import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { socrataHeaders } from "@/lib/socrata";
import { COOK_COUNTY_CURRENT_PARCELS_QUERY_URL } from "@/lib/cook-viewer";

/**
 * System health probe — checks every external dependency.
 *
 * GET /api/health
 * Header: x-admin-key: <ADMIN_SECRET>
 *
 * Returns a JSON report of all service statuses, latencies,
 * database table stats, and data freshness indicators.
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

interface ProbeResult {
  name: string;
  status: "ok" | "degraded" | "down";
  latencyMs: number;
  message?: string;
  details?: Record<string, unknown>;
}

interface ArcgisQueryResponse {
  features?: Array<{
    attributes?: {
      ZONE_CLASS?: unknown;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
  };
}

/** Probe a URL and return status + latency. */
async function probeUrl(
  name: string,
  url: string,
  timeoutMs = 8000,
  headers?: Record<string, string>
): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { name, status: "ok", latencyMs };
    }
    return {
      name,
      status: "degraded",
      latencyMs,
      message: `HTTP ${res.status} ${res.statusText}`,
    };
  } catch (err) {
    return {
      name,
      status: "down",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/** Probe the queryable Chicago zoning feature layer at a known city point. */
async function probeChicagoZoning(timeoutMs = 8000): Promise<ProbeResult> {
  const name = "Chicago ArcGIS Zoning";
  const start = Date.now();
  const params = new URLSearchParams({
    where: "1=1",
    geometry: "-87.62318,41.88183",
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "ZONE_CLASS",
    returnGeometry: "false",
    resultRecordCount: "1",
    f: "json",
  });
  const url =
    "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1/query" +
    `?${params.toString()}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        name,
        status: "degraded",
        latencyMs,
        message: `HTTP ${res.status} ${res.statusText}`,
      };
    }

    let payload: ArcgisQueryResponse | null;
    try {
      payload = (await res.json()) as ArcgisQueryResponse | null;
    } catch {
      return {
        name,
        status: "degraded",
        latencyMs,
        message: "Zoning query returned invalid JSON",
      };
    }

    if (!payload || typeof payload !== "object") {
      return {
        name,
        status: "degraded",
        latencyMs,
        message: "Zoning query returned an invalid payload",
      };
    }

    if (payload.error) {
      const code = payload.error.code ? ` ${payload.error.code}` : "";
      const message = payload.error.message || "Unknown ArcGIS query error";
      return {
        name,
        status: "degraded",
        latencyMs,
        message: `ArcGIS query error${code}: ${message}`,
      };
    }

    const zoneClass = payload.features?.[0]?.attributes?.ZONE_CLASS;
    if (typeof zoneClass !== "string" || !zoneClass.trim()) {
      return {
        name,
        status: "degraded",
        latencyMs,
        message: "Zoning query returned no usable ZONE_CLASS",
      };
    }

    return {
      name,
      status: "ok",
      latencyMs,
      details: { zoneClass },
    };
  } catch (err) {
    return {
      name,
      status: "down",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/** Probe the Neon database with a simple query. */
async function probeDatabase(): Promise<ProbeResult> {
  const sql = getSQL();
  if (!sql) {
    return {
      name: "Neon Postgres",
      status: "down",
      latencyMs: 0,
      message: "DATABASE_URL not configured",
    };
  }
  const start = Date.now();
  try {
    const rows = await sql`SELECT 1 as ok, NOW() as server_time`;
    return {
      name: "Neon Postgres",
      status: "ok",
      latencyMs: Date.now() - start,
      details: { serverTime: rows[0]?.server_time },
    };
  } catch (err) {
    return {
      name: "Neon Postgres",
      status: "down",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Query failed",
    };
  }
}

/** Probe Upstash Redis. */
async function probeRedis(): Promise<ProbeResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return {
      name: "Upstash Redis",
      status: "down",
      latencyMs: 0,
      message: "UPSTASH_REDIS_REST_URL/TOKEN not configured",
    };
  }
  const start = Date.now();
  try {
    const res = await fetch(`${url}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      return { name: "Upstash Redis", status: "ok", latencyMs: Date.now() - start };
    }
    return {
      name: "Upstash Redis",
      status: "degraded",
      latencyMs: Date.now() - start,
      message: `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      name: "Upstash Redis",
      status: "down",
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

/** Get database table statistics. */
async function getTableStats(): Promise<Record<string, unknown>[] | null> {
  const sql = getSQL();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT
        t.table_name,
        (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name AND c.table_schema = 'public') as column_count,
        pg_total_relation_size(quote_ident(t.table_name))::bigint as size_bytes
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name
    `;
    // Get row counts separately (information_schema doesn't have row counts)
    // Get row counts using pg_stat_user_tables (avoids dynamic SQL)
    const statRows = await sql`
      SELECT relname as table_name, n_live_tup as row_estimate
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
    `;
    const rowMap = new Map(statRows.map((r) => [r.table_name, Number(r.row_estimate)]));

    return rows.map((row) => ({
      table: row.table_name,
      rows: rowMap.get(row.table_name as string) ?? 0,
      columns: Number(row.column_count),
      sizeBytes: Number(row.size_bytes),
      sizeMB: (Number(row.size_bytes) / 1024 / 1024).toFixed(2),
    }));
  } catch {
    return null;
  }
}

/** Get data freshness from key tables. */
async function getDataFreshness(): Promise<Record<string, unknown> | null> {
  const sql = getSQL();
  if (!sql) return null;
  try {
    const results: Record<string, unknown> = {};

    // Vacant properties freshness
    try {
      const vp = await sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE incentive_count > 0) as with_incentives,
          COUNT(*) FILTER (WHERE owner_type IS NOT NULL) as with_ownership,
          MIN(updated_at) as oldest_update,
          MAX(updated_at) as newest_update,
          COUNT(DISTINCT owner_type) as owner_type_count
        FROM vacant_properties
      `;
      if (vp[0]) {
        results.vacantProperties = {
          total: Number(vp[0].total),
          withIncentives: Number(vp[0].with_incentives),
          withOwnership: Number(vp[0].with_ownership),
          oldestUpdate: vp[0].oldest_update,
          newestUpdate: vp[0].newest_update,
          ownerTypes: Number(vp[0].owner_type_count),
        };
      }
    } catch { /* table may not exist */ }

    // Owner type breakdown
    try {
      const ot = await sql`
        SELECT COALESCE(owner_type, 'null') as owner_type, COUNT(*) as cnt
        FROM vacant_properties GROUP BY owner_type ORDER BY cnt DESC
      `;
      results.ownerTypeBreakdown = ot.map((r) => ({
        type: r.owner_type,
        count: Number(r.cnt),
      }));
    } catch { /* skip */ }

    // Businesses freshness
    try {
      const biz = await sql`SELECT COUNT(*) as cnt FROM businesses`;
      results.businesses = { total: Number(biz[0]?.cnt || 0) };
    } catch { /* skip */ }

    // Zones freshness
    try {
      const zones = await sql`
        SELECT zone_key, COUNT(*) as features
        FROM zones GROUP BY zone_key ORDER BY zone_key
      `;
      results.zones = zones.map((r) => ({
        key: r.zone_key,
        features: Number(r.features),
      }));
    } catch { /* skip */ }

    // Census tracts
    try {
      const ct = await sql`SELECT COUNT(*) as cnt FROM census_tracts`;
      results.censusTracts = { total: Number(ct[0]?.cnt || 0) };
    } catch { /* skip */ }

    // Community assets
    try {
      const ca = await sql`
        SELECT type, COUNT(*) as cnt FROM community_assets GROUP BY type ORDER BY type
      `;
      results.communityAssets = ca.map((r) => ({
        type: r.type,
        count: Number(r.cnt),
      }));
    } catch { /* skip */ }

    // Programs
    try {
      const pg = await sql`SELECT COUNT(*) as cnt FROM programs`;
      results.programs = { total: Number(pg[0]?.cnt || 0) };
    } catch { /* skip */ }

    return results;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const authError = verifyAdminRequest(request);
  if (authError) return authError;

  const startTime = Date.now();

  // Run all probes in parallel
  const [
    neonResult,
    redisResult,
    nominatimResult,
    arcgisParcelResult,
    arcgisZoningResult,
    socrataChicagoResult,
    socrataCookCountyResult,
    assessorResult,
    mapboxResult,
  ] = await Promise.all([
    probeDatabase(),
    probeRedis(),
    probeUrl(
      "OpenStreetMap Nominatim",
      "https://nominatim.openstreetmap.org/search?q=Chicago&format=json&limit=1",
      8000,
      { "User-Agent": "Chicago-Site-Incentive-Map/1.0" }
    ),
    probeUrl(
      "Cook County ArcGIS Parcels",
      // Mirrors /api/parcel's real point-in-polygon query shape so the probe
      // fails when parcel resolution would fail, not only when the service is
      // unreachable (a bare where=1=1 stays green through query-level breaks).
      `${COOK_COUNTY_CURRENT_PARCELS_QUERY_URL}?geometry=${encodeURIComponent(
        JSON.stringify({ x: -87.62422, y: 41.88132, spatialReference: { wkid: 4326 } })
      )}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=PIN14,street_address&returnGeometry=false&f=json`,
      8000
    ),
    probeChicagoZoning(),
    probeUrl(
      "Socrata Chicago Data Portal",
      "https://data.cityofchicago.org/resource/dj47-wfun.json?$limit=1",
      8000,
      socrataHeaders()
    ),
    probeUrl(
      "Socrata Cook County",
      // $select the columns the ingest layer actually reads so a dataset
      // restructure (like the 2026 Parcel Universe migration that removed
      // prop_address / loc_property_location) turns this probe red instead of
      // a column-free $limit=1 staying green through the outage.
      "https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json?$select=pin,zip_code,class,year&$limit=1",
      8000,
      socrataHeaders()
    ),
    probeUrl(
      "Cook County Assessor",
      "https://datacatalog.cookcountyassessor.com/resource/uzyt-m557.json?$select=pin,certified_tot_land,certified_tot_bldg,tax_bill_name&$limit=1",
      8000,
      socrataHeaders()
    ),
    probeUrl(
      "Mapbox API",
      `https://api.mapbox.com/tokens/v2?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ""}`,
      8000
    ),
  ]);

  const probes: ProbeResult[] = [
    neonResult,
    redisResult,
    nominatimResult,
    arcgisParcelResult,
    arcgisZoningResult,
    socrataChicagoResult,
    socrataCookCountyResult,
    assessorResult,
    mapboxResult,
  ];

  // Get database details (only if DB is up)
  const [tableStats, dataFreshness] = await Promise.all([
    neonResult.status === "ok" ? getTableStats() : null,
    neonResult.status === "ok" ? getDataFreshness() : null,
  ]);

  // Compute overall status
  const downCount = probes.filter((p) => p.status === "down").length;
  const degradedCount = probes.filter((p) => p.status === "degraded").length;
  let overallStatus: "healthy" | "degraded" | "critical" = "healthy";
  if (downCount >= 3 || (neonResult.status === "down" && redisResult.status === "down")) {
    overallStatus = "critical";
  } else if (downCount > 0 || degradedCount > 0) {
    overallStatus = "degraded";
  }

  // Environment config check
  const envCheck = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    NEXT_PUBLIC_MAPBOX_TOKEN: !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
    SOCRATA_APP_TOKEN: !!process.env.SOCRATA_APP_TOKEN,
    ADMIN_SECRET: process.env.ADMIN_SECRET !== undefined,
  };

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      totalLatencyMs: Date.now() - startTime,
      probes,
      environment: envCheck,
      database: tableStats
        ? { tables: tableStats }
        : { error: "Database unavailable" },
      data: dataFreshness || { error: "Database unavailable" },
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}
