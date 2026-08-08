import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import {
  PERMIT_AREA_DATA_WINDOW_LABEL,
  PERMIT_AREA_PORTAL_URL,
  PERMIT_AREA_RECORD_LIMIT,
  PERMIT_AREA_SOURCE_LABEL,
  PERMIT_AREA_SOURCE_URL,
  type PermitAreaRecord,
  type PermitAreaResult,
  type PermitAreaStatusCount,
  type PermitAreaTypeCount,
  type PermitAreaYearCount,
} from "@/lib/permit-area";
import { permitMapTypeForSource } from "@/lib/permit-map";
import { PERMIT_SINCE_DATE } from "@/lib/permit-match";

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

const MAX_POLYGON_CHARACTERS = 100_000;
const MAX_POLYGON_POINTS = 2_000;
const UNKNOWN_TYPE_COLOR = "#64748B";

type AggregateRow = {
  total_filings: unknown;
  distinct_addresses: unknown;
  first_issue_date: unknown;
  latest_issue_date: unknown;
  source_as_of: unknown;
  type_breakdown: unknown;
  year_breakdown: unknown;
  status_breakdown: unknown;
  recent_filings: unknown;
};

type TypeCountRow = {
  permit_type?: unknown;
  filing_count?: unknown;
};

type YearCountRow = {
  year?: unknown;
  filing_count?: unknown;
};

type StatusCountRow = {
  permit_status?: unknown;
  filing_count?: unknown;
};

type RecentPermitRow = {
  permit_id?: unknown;
  permit_type?: unknown;
  address?: unknown;
  issue_date?: unknown;
  permit_status?: unknown;
  permit_milestone?: unknown;
  work_type?: unknown;
  work_description?: unknown;
};

function error(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function jsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function samePosition(a: unknown[], b: unknown[]): boolean {
  return Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]);
}

function parsePolygon(raw: string | null): GeoJSON.Polygon | string {
  if (!raw) return "polygon is required";
  if (raw.length > MAX_POLYGON_CHARACTERS) return "polygon is too large";

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "polygon must be valid JSON";
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { type?: unknown }).type !== "Polygon" ||
    !Array.isArray((parsed as { coordinates?: unknown }).coordinates)
  ) {
    return "polygon must be a GeoJSON Polygon geometry";
  }

  const coordinates = (parsed as { coordinates: unknown[] }).coordinates;
  if (coordinates.length === 0 || coordinates.length > 20) {
    return "polygon must include between 1 and 20 rings";
  }

  let pointCount = 0;
  for (const ring of coordinates) {
    if (!Array.isArray(ring) || ring.length < 4) {
      return "each polygon ring must contain at least 4 positions";
    }
    pointCount += ring.length;
    if (pointCount > MAX_POLYGON_POINTS) return "polygon has too many positions";

    for (const position of ring) {
      if (!Array.isArray(position) || position.length < 2) {
        return "polygon positions must be longitude and latitude pairs";
      }
      const lon = Number(position[0]);
      const lat = Number(position[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return "polygon positions must contain finite coordinates";
      }
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        return "polygon coordinates are outside valid longitude/latitude ranges";
      }
    }

    if (!samePosition(ring[0] as unknown[], ring[ring.length - 1] as unknown[])) {
      return "each polygon ring must be closed";
    }
  }

  return parsed as GeoJSON.Polygon;
}

function mapTypeCounts(value: unknown): PermitAreaTypeCount[] {
  return jsonArray<TypeCountRow>(value).map((row) => {
    const sourceValue = textOrNull(row.permit_type);
    const knownType = permitMapTypeForSource(sourceValue);
    return {
      key: knownType?.key ?? null,
      label: knownType?.label ?? sourceValue ?? "Not recorded",
      sourceValue,
      color: knownType?.color ?? UNKNOWN_TYPE_COLOR,
      count: integer(row.filing_count),
    };
  });
}

function mapYearCounts(value: unknown): PermitAreaYearCount[] {
  return jsonArray<YearCountRow>(value)
    .map((row) => ({ year: integer(row.year), count: integer(row.filing_count) }))
    .filter((row) => row.year > 0);
}

function mapStatusCounts(value: unknown): PermitAreaStatusCount[] {
  return jsonArray<StatusCountRow>(value).map((row) => ({
    status: textOrNull(row.permit_status) ?? "Not recorded",
    count: integer(row.filing_count),
  }));
}

function mapRecentFilings(value: unknown): PermitAreaRecord[] {
  const records: PermitAreaRecord[] = [];
  for (const row of jsonArray<RecentPermitRow>(value)) {
    const permitId = textOrNull(row.permit_id);
    if (!permitId) continue;
    const rawPermitType = textOrNull(row.permit_type);
    const knownType = permitMapTypeForSource(rawPermitType);
    records.push({
      permitId,
      permitTypeKey: knownType?.key ?? null,
      permitTypeLabel: knownType?.label ?? rawPermitType ?? "Not recorded",
      rawPermitType,
      address: textOrNull(row.address),
      issueDate: textOrNull(row.issue_date),
      permitStatus: textOrNull(row.permit_status),
      permitMilestone: textOrNull(row.permit_milestone),
      workType: textOrNull(row.work_type),
      workDescription: textOrNull(row.work_description),
    });
  }
  return records;
}

export async function GET(request: NextRequest) {
  const polygon = parsePolygon(request.nextUrl.searchParams.get("polygon"));
  if (typeof polygon === "string") return error(polygon);

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  const polygonJson = JSON.stringify(polygon);

  try {
    const rows = await sql`
      WITH scoped AS MATERIALIZED (
        SELECT
          permit_id,
          permit_type,
          address,
          issue_date,
          permit_status,
          permit_milestone,
          work_type,
          work_description,
          fetched_at
        FROM building_permits
        WHERE geom IS NOT NULL
          AND issue_date >= ${PERMIT_SINCE_DATE}::date
          AND ST_Intersects(
            geom,
            ST_SetSRID(ST_GeomFromGeoJSON(${polygonJson}), 4326)::geography
          )
      ),
      type_counts AS (
        SELECT
          COALESCE(NULLIF(BTRIM(permit_type), ''), 'Not recorded') AS permit_type,
          COUNT(*)::int AS filing_count
        FROM scoped
        GROUP BY 1
      ),
      year_counts AS (
        SELECT EXTRACT(YEAR FROM issue_date)::int AS year, COUNT(*)::int AS filing_count
        FROM scoped
        GROUP BY 1
      ),
      status_counts AS (
        SELECT
          COALESCE(NULLIF(BTRIM(permit_status), ''), 'Not recorded') AS permit_status,
          COUNT(*)::int AS filing_count
        FROM scoped
        GROUP BY 1
      ),
      recent_filings AS (
        SELECT
          permit_id,
          permit_type,
          address,
          issue_date,
          permit_status,
          permit_milestone,
          work_type,
          work_description
        FROM scoped
        ORDER BY issue_date DESC NULLS LAST, permit_id
        LIMIT ${PERMIT_AREA_RECORD_LIMIT}
      )
      SELECT
        (SELECT COUNT(*)::int FROM scoped) AS total_filings,
        (
          SELECT COUNT(DISTINCT NULLIF(LOWER(BTRIM(address)), ''))::int
          FROM scoped
        ) AS distinct_addresses,
        (SELECT MIN(issue_date)::text FROM scoped) AS first_issue_date,
        (SELECT MAX(issue_date)::text FROM scoped) AS latest_issue_date,
        (SELECT MAX(fetched_at)::text FROM scoped) AS source_as_of,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'permit_type', permit_type,
                'filing_count', filing_count
              )
              ORDER BY filing_count DESC, permit_type
            )
            FROM type_counts
          ),
          '[]'::jsonb
        ) AS type_breakdown,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object('year', year, 'filing_count', filing_count)
              ORDER BY year DESC
            )
            FROM year_counts
          ),
          '[]'::jsonb
        ) AS year_breakdown,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'permit_status', permit_status,
                'filing_count', filing_count
              )
              ORDER BY filing_count DESC, permit_status
            )
            FROM status_counts
          ),
          '[]'::jsonb
        ) AS status_breakdown,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'permit_id', permit_id,
                'permit_type', permit_type,
                'address', address,
                'issue_date', issue_date::text,
                'permit_status', permit_status,
                'permit_milestone', permit_milestone,
                'work_type', work_type,
                'work_description', work_description
              )
              ORDER BY issue_date DESC NULLS LAST, permit_id
            )
            FROM recent_filings
          ),
          '[]'::jsonb
        ) AS recent_filings
    `;

    const row = (rows as AggregateRow[])[0] ?? ({} as AggregateRow);
    const totalFilings = integer(row.total_filings);
    const records = mapRecentFilings(row.recent_filings);
    const firstIssueDate = textOrNull(row.first_issue_date);
    const latestIssueDate = textOrNull(row.latest_issue_date);
    const sourceAsOf = textOrNull(row.source_as_of);

    const result: PermitAreaResult = {
      status: "ready",
      source: {
        label: PERMIT_AREA_SOURCE_LABEL,
        url: PERMIT_AREA_SOURCE_URL,
        portalUrl: PERMIT_AREA_PORTAL_URL,
      },
      dataWindow: PERMIT_AREA_DATA_WINDOW_LABEL,
      sourceRefresh: {
        asOf: sourceAsOf,
        asOfBasis: sourceAsOf ? "latest_queried_row_fetched_at" : null,
      },
      locatedRecordsOnly: true,
      totalFilings,
      distinctAddresses: integer(row.distinct_addresses),
      issueDateSpan:
        firstIssueDate && latestIssueDate
          ? { first: firstIssueDate, latest: latestIssueDate }
          : null,
      typeBreakdown: mapTypeCounts(row.type_breakdown),
      yearBreakdown: mapYearCounts(row.year_breakdown),
      statusBreakdown: mapStatusCounts(row.status_breakdown),
      records,
      recordsReturned: records.length,
      recordsTruncated: totalFilings > records.length,
    };

    return NextResponse.json(result, { headers: CDN_HEADERS });
  } catch (err) {
    console.warn(
      "permit area analysis failed:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: "permit area analysis unavailable" },
      { status: 503 },
    );
  }
}
