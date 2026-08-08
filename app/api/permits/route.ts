import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import {
  PERMIT_MAP_TYPES,
  permitMapTypeForSource,
  type PermitMapTypeKey,
} from "@/lib/permit-map";
import { PERMIT_SINCE_DATE } from "@/lib/permit-match";

/**
 * Viewport-based City of Chicago Building Permits API.
 *
 * GET /api/permits?bounds=west,south,east,north
 * GET /api/permits?bounds=west,south,east,north&types=signs,new_construction
 *
 * The response exposes individual source records only. In particular, the
 * applicant-reported cost field is not queried, returned, or aggregated.
 * `meta.asOf` is the latest `fetched_at` value among the queried rows.
 */

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

const DEFAULT_LIMIT = 750;
const MAX_LIMIT = 3000;
const TYPE_BY_KEY = new Map<PermitMapTypeKey, (typeof PERMIT_MAP_TYPES)[number]>(
  PERMIT_MAP_TYPES.map((type) => [type.key, type]),
);

type PermitRow = {
  permit_id: unknown;
  permit_type: unknown;
  address: unknown;
  issue_date: unknown;
  permit_status: unknown;
  permit_milestone: unknown;
  work_type: unknown;
  work_description: unknown;
  lat: unknown;
  lon: unknown;
  source_as_of: unknown;
};

type Bounds = [west: number, south: number, east: number, north: number];

type PermitCoverageMetadata = {
  sourceMode: "database";
  sourcePath: "database:building_permits";
  asOf: string | null;
  asOfBasis: "latest_queried_row_fetched_at" | null;
  returnedCount: number;
  configuredLimit: number;
  queryLimit: number;
  coverageStatus: "complete" | "truncated";
  potentiallyTruncated: boolean;
};

type PermitFeatureCollection = GeoJSON.FeatureCollection & {
  meta: PermitCoverageMetadata;
};

function error(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function parseBounds(raw: string | null): Bounds | string {
  if (!raw) return "bounds is required";

  const values = raw.split(",");
  if (values.length !== 4 || values.some((value) => value.trim() === "")) {
    return "bounds must be 4 comma-separated numbers: west,south,east,north";
  }

  const parsed = values.map(Number);
  if (parsed.some((value) => !Number.isFinite(value))) {
    return "bounds must be 4 comma-separated numbers: west,south,east,north";
  }

  const [west, south, east, north] = parsed;
  if (west < -180 || east > 180 || south < -90 || north > 90) {
    return "bounds coordinates are outside valid longitude/latitude ranges";
  }
  if (west >= east || south >= north) {
    return "bounds must satisfy west < east and south < north";
  }

  return [west, south, east, north];
}

function parseLimit(raw: string | null): number | string {
  if (raw == null) return DEFAULT_LIMIT;

  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    return `limit must be an integer between 1 and ${MAX_LIMIT}`;
  }

  const limit = Number(normalized);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return `limit must be an integer between 1 and ${MAX_LIMIT}`;
  }
  return limit;
}

function parseTypeKeys(raw: string | null): PermitMapTypeKey[] | string {
  if (raw == null) return PERMIT_MAP_TYPES.map((type) => type.key);

  const values = raw.split(",").map((value) => value.trim());
  if (values.length === 0 || values.some((value) => value === "")) {
    return "types must include at least one permit type key";
  }

  const unique = [...new Set(values)];
  const invalid = unique.filter(
    (value) => !TYPE_BY_KEY.has(value as PermitMapTypeKey),
  );
  if (invalid.length > 0) {
    return `unknown permit type key: ${invalid.join(", ")}`;
  }

  return unique as PermitMapTypeKey[];
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function coordinate(value: unknown): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampOrNull(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== "string") return null;
  const timestamp = value.trim();
  return timestamp === "" ? null : timestamp;
}

function latestTimestamp(values: unknown[]): string | null {
  let latest: string | null = null;
  let latestMillis = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    const timestamp = timestampOrNull(value);
    if (!timestamp) continue;
    const millis = Date.parse(timestamp);
    if (Number.isFinite(millis) && millis > latestMillis) {
      latest = timestamp;
      latestMillis = millis;
    } else if (latest === null) {
      latest = timestamp;
    }
  }

  return latest;
}

function rowsToGeoJSON(rows: PermitRow[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const row of rows) {
    const rawPermitType = textOrNull(row.permit_type);
    const permitType = permitMapTypeForSource(rawPermitType);
    const permitId = textOrNull(row.permit_id);
    const lat = coordinate(row.lat);
    const lon = coordinate(row.lon);

    if (!permitType || !permitId || lat == null || lon == null) continue;

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        permitId,
        permitTypeKey: permitType.key,
        permitTypeLabel: permitType.label,
        rawPermitType,
        address: textOrNull(row.address),
        issueDate: textOrNull(row.issue_date),
        permitStatus: textOrNull(row.permit_status),
        permitMilestone: textOrNull(row.permit_milestone),
        workType: textOrNull(row.work_type),
        workDescription: textOrNull(row.work_description),
      },
    });
  }

  return { type: "FeatureCollection", features };
}

function buildPermitResponse(rows: PermitRow[], limit: number): PermitFeatureCollection {
  // The query asks for one extra row so truncation is observed, not guessed.
  const potentiallyTruncated = rows.length > limit;
  const collection = rowsToGeoJSON(rows.slice(0, limit));
  const asOf = latestTimestamp(rows.map((row) => row.source_as_of));

  return {
    ...collection,
    meta: {
      sourceMode: "database",
      sourcePath: "database:building_permits",
      asOf,
      asOfBasis: asOf ? "latest_queried_row_fetched_at" : null,
      returnedCount: collection.features.length,
      configuredLimit: limit,
      queryLimit: limit + 1,
      coverageStatus: potentiallyTruncated ? "truncated" : "complete",
      potentiallyTruncated,
    },
  };
}

export async function GET(request: NextRequest) {
  const bounds = parseBounds(request.nextUrl.searchParams.get("bounds"));
  if (typeof bounds === "string") return error(bounds);

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  if (typeof limit === "string") return error(limit);

  const typeKeys = parseTypeKeys(request.nextUrl.searchParams.get("types"));
  if (typeof typeKeys === "string") return error(typeKeys);

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  const sourceValues = typeKeys.map((key) => TYPE_BY_KEY.get(key)!.sourceValue);
  const [west, south, east, north] = bounds;

  try {
    const rows = await sql`
      SELECT
        permit_id,
        permit_type,
        address,
        issue_date::text AS issue_date,
        permit_status,
        permit_milestone,
        work_type,
        work_description,
        lat,
        lon,
        fetched_at::text AS source_as_of
      FROM building_permits
      WHERE geom IS NOT NULL
        AND issue_date >= ${PERMIT_SINCE_DATE}::date
        AND ST_Intersects(
          geom,
          ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)::geography
        )
        AND permit_type = ANY(${sourceValues})
      ORDER BY issue_date DESC NULLS LAST, permit_id
      LIMIT ${limit + 1}
    `;

    return NextResponse.json(buildPermitResponse(rows as PermitRow[], limit), {
      headers: CDN_HEADERS,
    });
  } catch (err) {
    console.warn(
      "permit map lookup failed:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "permit map unavailable" }, { status: 503 });
  }
}
