import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import {
  PERMIT_AREA_DATA_WINDOW_LABEL,
  PERMIT_AREA_PORTAL_URL,
  PERMIT_AREA_RECORD_LIMIT,
  PERMIT_AREA_SOURCE_LABEL,
  PERMIT_AREA_SOURCE_URL,
  type PermitAreaRecord,
  type PermitAreaGeometry,
  type PermitAreaMonthCount,
  type PermitAreaResult,
  type PermitAreaStatusCount,
  type PermitAreaTopAddress,
  type PermitAreaTypeCount,
  type PermitAreaYearCount,
} from "@/lib/permit-area";
import { permitMapTypeForSource } from "@/lib/permit-map";
import { PERMIT_SINCE_DATE } from "@/lib/permit-match";

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

const MAX_POLYGON_CHARACTERS = 100_000;
// The largest official community-area boundary currently has 2,424 positions.
// Stay comfortably above that source-backed shape while retaining a hard cap
// against unbounded public requests.
const MAX_POLYGON_POINTS = 5_000;
const UNKNOWN_TYPE_COLOR = "#64748B";

type AggregateRow = {
  total_filings: unknown;
  distinct_addresses: unknown;
  first_issue_date: unknown;
  latest_issue_date: unknown;
  source_as_of: unknown;
  current_start: unknown;
  current_end: unknown;
  current_filings: unknown;
  current_distinct_addresses: unknown;
  current_addressed_filings: unknown;
  previous_start: unknown;
  previous_end: unknown;
  previous_filings: unknown;
  previous_distinct_addresses: unknown;
  previous_addressed_filings: unknown;
  monthly_breakdown: unknown;
  top_addresses: unknown;
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

type MonthCountRow = {
  month?: unknown;
  filing_count?: unknown;
};

type TopAddressRow = {
  address?: unknown;
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

function isoTimestampOrNull(value: unknown): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(String(value).trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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

function parsePolygonCoordinates(
  polygons: unknown[],
): { pointCount: number } | string {
  let pointCount = 0;
  let ringCount = 0;

  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0 || polygon.length > 20) {
      return "each polygon must include between 1 and 20 rings";
    }

    for (const ring of polygon) {
      ringCount += 1;
      if (ringCount > 60) return "polygon geometry has too many rings";
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
  }

  return { pointCount };
}

function parsePolygon(raw: string | null | undefined): PermitAreaGeometry | string {
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
    !["Polygon", "MultiPolygon"].includes(String((parsed as { type?: unknown }).type)) ||
    !Array.isArray((parsed as { coordinates?: unknown }).coordinates)
  ) {
    return "polygon must be a GeoJSON Polygon or MultiPolygon geometry";
  }

  const geometry = parsed as { type: "Polygon" | "MultiPolygon"; coordinates: unknown[] };
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  if (polygons.length === 0 || polygons.length > 10) {
    return "polygon geometry must include between 1 and 10 polygons";
  }

  const validation = parsePolygonCoordinates(polygons);
  if (typeof validation === "string") return validation;

  return parsed as PermitAreaGeometry;
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

function mapMonthCounts(value: unknown): PermitAreaMonthCount[] {
  return jsonArray<MonthCountRow>(value)
    .map((row) => ({
      month: textOrNull(row.month) ?? "",
      count: integer(row.filing_count),
    }))
    .filter((row) => row.month !== "");
}

function mapTopAddresses(value: unknown): PermitAreaTopAddress[] {
  return jsonArray<TopAddressRow>(value)
    .map((row) => ({
      address: textOrNull(row.address) ?? "",
      count: integer(row.filing_count),
    }))
    .filter((row) => row.address !== "" && row.count > 0);
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

async function analyzePolygon(polygon: PermitAreaGeometry) {
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
          fetched_at,
          regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g')
            AS normalized_address
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
      rolling_bounds AS (
        SELECT
          latest_issue_date,
          (latest_issue_date - INTERVAL '1 year' + INTERVAL '1 day')::date
            AS current_start,
          latest_issue_date AS current_end,
          (latest_issue_date - INTERVAL '2 years' + INTERVAL '1 day')::date
            AS previous_start,
          (latest_issue_date - INTERVAL '1 year')::date AS previous_end
        FROM (SELECT MAX(issue_date)::date AS latest_issue_date FROM scoped) latest
      ),
      rolling_counts AS (
        SELECT
          bounds.latest_issue_date,
          bounds.current_start,
          bounds.current_end,
          bounds.previous_start,
          bounds.previous_end,
          COUNT(*) FILTER (
            WHERE scoped.issue_date BETWEEN bounds.current_start AND bounds.current_end
          )::int AS current_filings,
          COUNT(DISTINCT NULLIF(scoped.normalized_address, '')) FILTER (
            WHERE scoped.issue_date BETWEEN bounds.current_start AND bounds.current_end
          )::int AS current_distinct_addresses,
          COUNT(*) FILTER (
            WHERE scoped.issue_date BETWEEN bounds.current_start AND bounds.current_end
              AND scoped.normalized_address <> ''
          )::int AS current_addressed_filings,
          COUNT(*) FILTER (
            WHERE scoped.issue_date BETWEEN bounds.previous_start AND bounds.previous_end
          )::int AS previous_filings,
          COUNT(DISTINCT NULLIF(scoped.normalized_address, '')) FILTER (
            WHERE scoped.issue_date BETWEEN bounds.previous_start AND bounds.previous_end
          )::int AS previous_distinct_addresses,
          COUNT(*) FILTER (
            WHERE scoped.issue_date BETWEEN bounds.previous_start AND bounds.previous_end
              AND scoped.normalized_address <> ''
          )::int AS previous_addressed_filings
        FROM rolling_bounds bounds
        LEFT JOIN scoped ON TRUE
        GROUP BY
          bounds.latest_issue_date,
          bounds.current_start,
          bounds.current_end,
          bounds.previous_start,
          bounds.previous_end
      ),
      month_series AS (
        SELECT generate_series(
          date_trunc('month', latest_issue_date) - INTERVAL '35 months',
          date_trunc('month', latest_issue_date),
          INTERVAL '1 month'
        )::date AS month
        FROM rolling_bounds
        WHERE latest_issue_date IS NOT NULL
      ),
      month_counts AS (
        SELECT
          months.month,
          COUNT(scoped.issue_date)::int AS filing_count
        FROM month_series months
        LEFT JOIN scoped
          ON scoped.issue_date >= months.month
         AND scoped.issue_date < months.month + INTERVAL '1 month'
        GROUP BY months.month
      ),
      current_address_counts AS (
        SELECT
          scoped.normalized_address,
          MIN(BTRIM(scoped.address)) AS address,
          COUNT(*)::int AS filing_count
        FROM scoped
        CROSS JOIN rolling_bounds bounds
        WHERE bounds.latest_issue_date IS NOT NULL
          AND scoped.issue_date BETWEEN bounds.current_start AND bounds.current_end
          AND scoped.normalized_address <> ''
        GROUP BY scoped.normalized_address
      ),
      top_address_counts AS (
        SELECT address, filing_count
        FROM current_address_counts
        ORDER BY filing_count DESC, address
        LIMIT 10
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
          SELECT COUNT(DISTINCT NULLIF(normalized_address, ''))::int
          FROM scoped
        ) AS distinct_addresses,
        (SELECT MIN(issue_date)::text FROM scoped) AS first_issue_date,
        (SELECT MAX(issue_date)::text FROM scoped) AS latest_issue_date,
        (SELECT MAX(fetched_at)::text FROM scoped) AS source_as_of,
        (SELECT current_start::text FROM rolling_counts) AS current_start,
        (SELECT current_end::text FROM rolling_counts) AS current_end,
        (SELECT current_filings FROM rolling_counts) AS current_filings,
        (
          SELECT current_distinct_addresses FROM rolling_counts
        ) AS current_distinct_addresses,
        (SELECT current_addressed_filings FROM rolling_counts) AS current_addressed_filings,
        (SELECT previous_start::text FROM rolling_counts) AS previous_start,
        (SELECT previous_end::text FROM rolling_counts) AS previous_end,
        (SELECT previous_filings FROM rolling_counts) AS previous_filings,
        (
          SELECT previous_distinct_addresses FROM rolling_counts
        ) AS previous_distinct_addresses,
        (SELECT previous_addressed_filings FROM rolling_counts) AS previous_addressed_filings,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'month', TO_CHAR(month, 'YYYY-MM'),
                'filing_count', filing_count
              )
              ORDER BY month
            )
            FROM month_counts
          ),
          '[]'::jsonb
        ) AS monthly_breakdown,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object('address', address, 'filing_count', filing_count)
              ORDER BY filing_count DESC, address
            )
            FROM top_address_counts
          ),
          '[]'::jsonb
        ) AS top_addresses,
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
    const sourceAsOf = isoTimestampOrNull(row.source_as_of);
    const currentFilings = integer(row.current_filings);
    const previousFilings = integer(row.previous_filings);
    const changeCount = currentFilings - previousFilings;

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
      rollingPulse: {
        asOf: latestIssueDate,
        current: {
          start: textOrNull(row.current_start),
          end: textOrNull(row.current_end),
          filings: currentFilings,
          distinctAddresses: integer(row.current_distinct_addresses),
          addressedFilings: integer(row.current_addressed_filings),
        },
        previous: {
          start: textOrNull(row.previous_start),
          end: textOrNull(row.previous_end),
          filings: previousFilings,
          distinctAddresses: integer(row.previous_distinct_addresses),
          addressedFilings: integer(row.previous_addressed_filings),
        },
        changeCount,
        changePercent:
          previousFilings === 0 ? null : (changeCount / previousFilings) * 100,
      },
      monthlyBreakdown: mapMonthCounts(row.monthly_breakdown),
      topAddresses: mapTopAddresses(row.top_addresses),
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

export async function GET(request: NextRequest) {
  const polygon = parsePolygon(request.nextUrl.searchParams.get("polygon"));
  if (typeof polygon === "string") return error(polygon);
  return analyzePolygon(polygon);
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return error("polygon is required");
  }

  const rawPolygon = JSON.stringify((body as { polygon?: unknown }).polygon);
  const polygon = parsePolygon(rawPolygon);
  if (typeof polygon === "string") return error(polygon);
  return analyzePolygon(polygon);
}
