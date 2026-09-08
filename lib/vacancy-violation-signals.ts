import { createHash } from "node:crypto";
import { fetchCompleteOffsetPages } from "./complete-source-pagination";
import {
  chicagoCalendarDay,
  normalizeChicagoSourceCalendarDate,
  shiftCalendarDayYears,
  VACANCY_RETENTION_YEARS,
} from "./vacancy-evidence";

export const VACANCY_VIOLATION_DATASET = "22u3-xenr";
export const VACANCY_VIOLATION_URL = `https://data.cityofchicago.org/resource/${VACANCY_VIOLATION_DATASET}.json`;
// Explicit vacant-building citations. CN192019 concerns use of vacant LAND;
// general building violations and inspection categories do not prove vacancy.
export const VACANCY_BUILDING_CODES = ["CN193110", "CN193100", "CN193105"] as const;

export interface VacancyViolationRecord {
  id?: string;
  property_group?: string;
  address?: string;
  latitude?: string | number;
  longitude?: string | number;
  violation_code?: string;
  violation_description?: string;
  violation_date?: string;
  violation_status?: string;
  violation_status_date?: string;
  violation_last_modified_date?: string;
  violation_inspector_comments?: string;
}

export interface VacancyViolationSignal {
  id: string;
  source: "violations";
  property_type: "vacant_building";
  address: string;
  lat: number;
  lon: number;
  status: "OPEN";
  property_status: string;
  source_record_date: string;
  source_dataset_id: typeof VACANCY_VIOLATION_DATASET;
  source_row_id: string;
  source_url: string;
  source_as_of: string | null;
  source_retrieved_at: string;
}

function cutoffFor(reference: Date): string {
  return shiftCalendarDayYears(chicagoCalendarDay(reference), -VACANCY_RETENTION_YEARS);
}

export function vacancyViolationWhere(reference: Date): string {
  return `violation_code in (${VACANCY_BUILDING_CODES.map((code) => `'${code}'`).join(",")}) AND violation_date >= '${cutoffFor(reference)}T00:00:00' AND violation_date <= '${chicagoCalendarDay(reference)}T23:59:59.999'`;
}

/** Include all statuses in the pull so a newer resolved citation can suppress
 * an older open citation for the same property group. Never import by title of
 * the community-created u7si-yh3t view, whose contents also include vacant land. */
export async function fetchVacancyViolationRecords(
  reference: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<VacancyViolationRecord[]> {
  return fetchCompleteOffsetPages<VacancyViolationRecord>({
    sourceLabel: "Chicago vacancy-specific building violations",
    pageSize: 1000,
    timeoutMs: 60_000,
    retries: 1,
    fetchImpl,
    buildUrl: (offset, pageSize) => {
      const url = new URL(VACANCY_VIOLATION_URL);
      url.searchParams.set("$where", vacancyViolationWhere(reference));
      url.searchParams.set("$order", "violation_date DESC,id DESC");
      url.searchParams.set("$offset", String(offset));
      url.searchParams.set("$limit", String(pageSize));
      return url.toString();
    },
  });
}

/** One dated vacancy signal per City property group, with an address fallback
 * only when the official group is absent. No PIN or ownership is inferred. */
export function buildVacancyViolationImport(
  rows: readonly VacancyViolationRecord[],
  reference: Date,
) {
  const referenceDay = chicagoCalendarDay(reference);
  const cutoff = cutoffFor(reference);
  const groups = new Map<string, VacancyViolationRecord[]>();
  let rejected = 0;
  for (const row of rows) {
    const date = normalizeChicagoSourceCalendarDate(row.violation_date)?.slice(0, 10);
    const address = row.address?.trim();
    if (!row.id?.trim() || !address || !date || date < cutoff || date > referenceDay ||
        !(VACANCY_BUILDING_CODES as readonly string[]).includes(row.violation_code || "")) {
      rejected += 1;
      continue;
    }
    const group = row.property_group?.trim();
    const key = group && /^\d+$/.test(group) && Number(group) > 0
      ? `group-${group}`
      : `address-${createHash("sha256").update(address.toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex").slice(0, 24)}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  const signals: VacancyViolationSignal[] = [];
  let notOpen = 0;
  let unlocated = 0;
  for (const [key, records] of groups) {
    // A non-open status wins a same-day tie, conservatively withholding a
    // conflicted property. Source modification time never refreshes vacancy age.
    records.sort((a, b) =>
      b.violation_date!.localeCompare(a.violation_date!) ||
      Number(a.violation_status === "OPEN") - Number(b.violation_status === "OPEN") ||
      (b.violation_status_date || "").localeCompare(a.violation_status_date || "") ||
      b.id!.localeCompare(a.id!),
    );
    const row = records[0];
    if (row.violation_status !== "OPEN") {
      notOpen += 1;
      continue;
    }
    const lat = row.latitude == null || row.latitude === "" ? NaN : Number(row.latitude);
    const lon = row.longitude == null || row.longitude === "" ? NaN : Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 41.6 || lat > 42.1 || lon < -88 || lon > -87.4) {
      unlocated += 1;
      continue;
    }
    const comments = row.violation_inspector_comments?.trim();
    signals.push({
      id: `violation-building-${key}`,
      source: "violations",
      property_type: "vacant_building",
      address: row.address!.trim(),
      lat,
      lon,
      status: "OPEN",
      // Preserve the actual scope (including partial/unit vacancy) rather than
      // inferring that every structure at the point address is wholly vacant.
      property_status: comments
        ? `Vacancy citation: ${comments}`
        : "Vacancy citation; extent of building vacancy not specified",
      source_record_date: normalizeChicagoSourceCalendarDate(row.violation_date)!,
      source_dataset_id: VACANCY_VIOLATION_DATASET,
      source_row_id: row.id!.trim(),
      source_url: `${VACANCY_VIOLATION_URL}?${new URLSearchParams({ "$where": `id='${row.id!.replaceAll("'", "''")}'` })}`,
      source_as_of: normalizeChicagoSourceCalendarDate(row.violation_last_modified_date),
      source_retrieved_at: reference.toISOString(),
    });
  }
  signals.sort((a, b) => a.id.localeCompare(b.id));
  return { referenceDay, cutoff, fetched: rows.length, rejected, propertyGroups: groups.size, notOpen, unlocated, signals };
}

/** Additive, idempotent import: preserve existing sources and manually enriched
 * fields. On a repeat run, do not overwrite a newer source observation. */
export function buildVacancyViolationInsertSql(signals: readonly VacancyViolationSignal[]): string {
  const payload = JSON.stringify(signals).replaceAll("'", "''");
  return `WITH incoming AS (
    SELECT * FROM jsonb_to_recordset('${payload}'::jsonb) AS r(
      id text, source text, property_type text, address text, lat double precision,
      lon double precision, status text, property_status text,
      source_record_date timestamptz, source_dataset_id text, source_row_id text,
      source_url text, source_as_of timestamptz, source_retrieved_at timestamptz
    )
  ), written AS (
    INSERT INTO vacant_properties (
      id, source, property_type, address, lat, lon, status, property_status,
      source_record_date, source_dataset_id, source_row_id, source_url,
      source_as_of, source_retrieved_at, owner_type, geom, zone_matches, incentive_count
    )
    SELECT id, source, property_type, address, lat, lon, status, property_status,
      source_record_date, source_dataset_id, source_row_id, source_url,
      source_as_of, source_retrieved_at, 'unknown', ST_SetSRID(ST_MakePoint(lon, lat),4326)::geography,
      memberships.zone_matches, memberships.incentive_count
    FROM incoming
    CROSS JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('zoneKey', zone_key, 'zoneName', zone_name) ORDER BY zone_key),'[]'::jsonb) AS zone_matches,
        count(*)::int AS incentive_count
      FROM (
        SELECT z.zone_key, COALESCE(MIN(NULLIF(BTRIM(z.feature_name),'')),z.zone_key) AS zone_name
        FROM zones z
        WHERE ST_Intersects(z.geom,ST_SetSRID(ST_MakePoint(incoming.lon,incoming.lat),4326)::geography)
        GROUP BY z.zone_key
      ) unique_zones
    ) memberships
    ON CONFLICT (id) DO UPDATE SET
      address=EXCLUDED.address, lat=EXCLUDED.lat, lon=EXCLUDED.lon, geom=EXCLUDED.geom,
      status=EXCLUDED.status, property_status=EXCLUDED.property_status,
      source_record_date=EXCLUDED.source_record_date, source_dataset_id=EXCLUDED.source_dataset_id,
      source_row_id=EXCLUDED.source_row_id, source_url=EXCLUDED.source_url,
      source_as_of=EXCLUDED.source_as_of, source_retrieved_at=EXCLUDED.source_retrieved_at,
      zone_matches=EXCLUDED.zone_matches, incentive_count=EXCLUDED.incentive_count,
      updated_at=NOW()
    WHERE vacant_properties.source='violations'
      AND COALESCE(vacant_properties.source_record_date,'-infinity'::timestamptz) <= EXCLUDED.source_record_date
    RETURNING id
  ) SELECT count(*)::int AS written FROM written;`;
}
