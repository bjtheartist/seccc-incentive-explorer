import { socrataHeaders } from "@/lib/socrata";
import { PERMIT_SINCE_DATE } from "@/lib/permit-match";
import { toDigitsOnlyPin } from "./pin-batch";
import type { FetchOpts, Provenance, SourceAdapter, SQL } from "./types";

/**
 * Chicago Building Permits adapter — CITYWIDE.
 *
 * Source: Socrata `ydr8-5enu` (data.cityofchicago.org).
 *
 * ── What changed from the SE-Chicago pilot, and why ──
 *
 * 1. NO BOUNDING BOX. The pilot scoped the fetch with
 *    `within_box(location, 41.77, -87.63, 41.65, -87.51)` — a box over ZIPs
 *    60617/60619/60649. That box is gone: the fetch is now the whole city,
 *    bounded only by the issue-date window ({@link SINCE_DATE}). A side effect
 *    of dropping `within_box` is that permits with NO `location` point are no
 *    longer excluded by the server (a `within_box` predicate is false for a
 *    null point), which is what makes rule 3 below reachable at all.
 *
 * 2. EVERY PIN, NOT JUST THE FIRST. `pin_list` is multi-valued. Verified live
 *    (2026-08-04, 25k-row sample): the separator is " | " (space-pipe-space),
 *    NOT a semicolon or comma — e.g. "1733326038 | 1733326039 | 1733326040".
 *    {@link parsePinList} therefore splits on any run of non-digits, which
 *    covers the observed " | " plus the semicolon/comma forms the pilot
 *    assumed, and keeps every PIN in {@link PermitRow.pins}. `pin` still
 *    carries the first one for the pre-existing consumers.
 *
 * 3. UN-GEOCODED PERMITS ARE KEPT. The pilot dropped any row without usable
 *    coordinates (~0.24% of the sample) even when it carried a PIN or a street
 *    address — i.e. exactly the rows a PIN/address match could still place.
 *    A row now survives when it has a permit id AND at least one of
 *    {valid coordinates, a usable PIN, a street address}; `lat`/`lon` are
 *    nullable and `geom` is written NULL when they are absent.
 *
 * 4. MORE METADATA. `permit_status`, `permit_milestone`, `work_type` and
 *    `permit_condition` are all real columns on ydr8-5enu — verified against
 *    the live column list (122 columns, fetched 2026-08-04 from
 *    /api/views/ydr8-5enu.json), not assumed.
 *
 * ── Fields this dataset does NOT have (do not re-add) ──
 *
 * There is no ZIP column. The live schema exposes only computed region ids
 * (`:@computed_region_rpca_8um6` / `_6mkv_f3dw`), which are region keys, not
 * ZIP strings. {@link PermitRow.zip} is therefore always null; the column is
 * retained because `building_permits.zip` and its index already exist.
 *
 * ── Honesty rail ──
 *
 * `reported_cost` is the APPLICANT'S OWN ESTIMATE at application time. It is
 * not an award, an appropriation, a disbursement, or a verified spend. It must
 * never be summed into any capital/investment/awarded total anywhere in this
 * codebase. Permits are evidence that a filing happened, not dollars.
 */

const SOURCE_KEY = "building_permits";

const PERMITS_URL = "https://data.cityofchicago.org/resource/ydr8-5enu.json";

/**
 * The issue-date window. Re-exported from lib/permit-match.ts, which is the
 * single source of truth: the UI prints the window it actually queried (see
 * `PERMIT_DATA_WINDOW_LABEL` in lib/permit-match-lines.ts) by reading the same
 * constant, so a surface can never claim a window we did not query.
 */
export const SINCE_DATE = PERMIT_SINCE_DATE;

/** Rows per Socrata page. 25k was measured at ~10s/page against the live
 *  endpoint; 467k rows is then ~19 pages. */
const PAGE_SIZE = 25000;

/**
 * The columns we retrieve. Projecting explicitly keeps the transfer (and the
 * `raw_json` provenance blob) to ~360 B/row instead of ~2 KB for all 122
 * columns. `raw_json` therefore preserves exactly what was retrieved — this
 * projection — not the full upstream row.
 */
const SELECT_COLS = [
  "permit_",
  "permit_status",
  "permit_milestone",
  "permit_type",
  "permit_condition",
  "work_type",
  "work_description",
  "issue_date",
  "reported_cost",
  "pin_list",
  "street_number",
  "street_direction",
  "street_name",
  "latitude",
  "longitude",
].join(",");

/** Chicago sanity bounds — coordinates outside these are treated as ABSENT
 *  (the row survives on its PIN/address), never silently trusted. */
const BOUNDS = { latMin: 41.6, latMax: 42.1, lonMin: -88.0, lonMax: -87.4 };

/** A PIN of all zeros is the dataset's placeholder, not a parcel. */
const PLACEHOLDER_PIN = /^0+$/;

/** Raw Socrata Building Permits record (the subset {@link SELECT_COLS} asks for). */
export interface RawPermit {
  permit_?: string;
  permit_status?: string;
  permit_milestone?: string;
  permit_type?: string;
  permit_condition?: string;
  work_type?: string;
  work_description?: string;
  issue_date?: string;
  reported_cost?: string;
  pin_list?: string;
  street_number?: string;
  street_direction?: string;
  street_name?: string;
  latitude?: string;
  longitude?: string;
}

/** Normalized, DB-ready permit row. */
export interface PermitRow {
  permitId: string;
  /** First PIN of {@link pins}, or null. Kept for pre-existing consumers. */
  pin: string | null;
  /**
   * EVERY PIN on the permit, digits-only. Note these are Cook County
   * **10-digit** PINs (area-subarea-block-parcel) — the permits dataset omits
   * the 4-digit unit suffix that `parcels.pin` / the COLS inventory carry. The
   * match engine compares them against `LEFT(parcel_pin, 10)` for that reason.
   */
  pins: string[];
  address: string | null;
  /** Always null: ydr8-5enu has no ZIP column. See the file header. */
  zip: string | null;
  permitType: string | null;
  permitStatus: string | null;
  permitMilestone: string | null;
  workType: string | null;
  permitCondition: string | null;
  workDescription: string | null;
  issueDate: string | null;
  /** APPLICANT ESTIMATE. Never sum into a capital/investment total. */
  reportedCost: number | null;
  isDemolition: boolean;
  lat: number | null;
  lon: number | null;
  provenance: Provenance;
}

/** What one citywide fetch retrieved, alongside the source's own count for the
 *  identical filter — so a run can prove it did not silently truncate. */
export interface PermitFetchAudit {
  /** `count(1)` reported by Socrata for the same `$where`. Null if unavailable. */
  sourceCount: number | null;
  /** Rows actually retrieved across all pages. */
  retrieved: number;
  /** Rows retrieved after dropping duplicate `permit_` values. */
  distinct: number;
  pages: number;
}

/** Populated by the most recent {@link permitsAdapter.fetch}. Read by
 *  scripts/sync-condition.ts to print the retrieved-vs-source reconciliation. */
export let lastFetchAudit: PermitFetchAudit | null = null;

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bigint(v: string | undefined): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

function text(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * Split `pin_list` into every PIN it carries, digits-only and de-duplicated,
 * preserving order.
 *
 * The split is on separator characters only — whitespace, pipe, semicolon,
 * comma — and NOT on "any non-digit". That distinction matters: splitting on
 * every non-digit would shred a dashed PIN ("16-11-105-004-0000") into five
 * useless fragments. Each token is then run through `toDigitsOnlyPin`, so both
 * the live " | "-separated 10-digit form and a dashed 14-digit form survive.
 *
 * All-zero placeholders and tokens that are not a plausible PIN length (10 or
 * 14 digits) are dropped rather than stored as junk that could produce a false
 * match.
 */
export function parsePinList(pinList: string | undefined): string[] {
  if (!pinList) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of pinList.split(/[\s|;,]+/)) {
    const pin = toDigitsOnlyPin(token);
    if (pin.length !== 10 && pin.length !== 14) continue;
    if (PLACEHOLDER_PIN.test(pin)) continue;
    if (seen.has(pin)) continue;
    seen.add(pin);
    out.push(pin);
  }
  return out;
}

/** Compose a street address from the parts the dataset provides. */
function joinAddress(r: RawPermit): string | null {
  const parts = [r.street_number, r.street_direction, r.street_name]
    .map((p) => p?.toString().trim())
    .filter((p): p is string => p != null && p !== "");
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Coordinates when both are present, finite and inside Chicago; else nulls. */
function coords(r: RawPermit): { lat: number | null; lon: number | null } {
  const lat = num(r.latitude);
  const lon = num(r.longitude);
  if (lat == null || lon == null || lat === 0 || lon === 0) return { lat: null, lon: null };
  if (lat < BOUNDS.latMin || lat > BOUNDS.latMax) return { lat: null, lon: null };
  if (lon < BOUNDS.lonMin || lon > BOUNDS.lonMax) return { lat: null, lon: null };
  return { lat, lon };
}

/** The `$where` every citywide query (rows and count alike) shares. */
function baseWhere(): string {
  return `issue_date>='${SINCE_DATE}'`;
}

/** Socrata's own row count for {@link baseWhere}, or null when unavailable. */
async function fetchSourceCount(): Promise<number | null> {
  try {
    const url = `${PERMITS_URL}?$select=count(1)&$where=${encodeURIComponent(baseWhere())}`;
    const res = await fetch(url, {
      headers: socrataHeaders(),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { count_1?: string }[];
    const raw = body?.[0]?.count_1;
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export const permitsAdapter: SourceAdapter<RawPermit, PermitRow> = {
  sourceKey: SOURCE_KEY,
  targetTable: "building_permits",

  /**
   * Citywide fetch, keyset-paginated on the dataset's own unique `id`
   * (843,123 rows / 843,123 distinct ids, verified live) rather than `$offset`,
   * so a page boundary can never skip or repeat a row at depth. The retrieved
   * count is reconciled against the source's `count(1)` for the identical
   * filter and recorded in {@link lastFetchAudit}.
   */
  async fetch(_opts: FetchOpts): Promise<RawPermit[]> {
    const sourceCount = await fetchSourceCount();

    const byId = new Map<string, RawPermit>();
    let retrieved = 0;
    let pages = 0;
    let cursor = "";

    for (;;) {
      const where = cursor ? `${baseWhere()} AND id>'${cursor}'` : baseWhere();
      const params = new URLSearchParams({
        // `id` is projected only to drive the cursor; it is stripped below so
        // raw_json stays the documented SELECT_COLS projection.
        $select: `id,${SELECT_COLS}`,
        $where: where,
        $order: "id",
        $limit: String(PAGE_SIZE),
      });
      const res = await fetch(`${PERMITS_URL}?${params.toString()}`, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) {
        throw new Error(
          `Socrata ${res.status} on page ${pages + 1} (cursor "${cursor}") — refusing to report a truncated fetch as complete`,
        );
      }
      const page = (await res.json()) as (RawPermit & { id?: string })[];
      if (page.length === 0) break;

      pages++;
      retrieved += page.length;
      // A citywide backfill is ~19 pages and several minutes; a silent process
      // is indistinguishable from a hung one, and an operator who cannot see
      // progress cannot tell a short run from a complete one.
      console.log(
        `  permits: page ${pages}, ${retrieved}${
          sourceCount != null ? `/${sourceCount}` : ""
        } rows retrieved`,
      );
      for (const row of page) {
        const { id: _id, ...rest } = row;
        const key = rest.permit_?.trim();
        if (key) byId.set(key, rest);
      }
      const lastId = page[page.length - 1]?.id;
      if (!lastId) break;
      cursor = lastId;
      if (page.length < PAGE_SIZE) break;
    }

    lastFetchAudit = { sourceCount, retrieved, distinct: byId.size, pages };
    return Array.from(byId.values());
  },

  normalize(raw: RawPermit): PermitRow | null {
    const permitId = raw.permit_?.trim();
    if (!permitId) return null;

    const { lat, lon } = coords(raw);
    const pins = parsePinList(raw.pin_list);
    const address = joinAddress(raw);

    // A permit we cannot place by ANY of coordinates / PIN / address is not
    // evidence about a parcel, so it is dropped. A permit we can place by even
    // one of them is kept — that is the fix for the pilot's coordinate-only gate.
    const placeable = (lat != null && lon != null) || pins.length > 0 || address != null;
    if (!placeable) return null;

    const permitType = text(raw.permit_type);
    const workType = text(raw.work_type);
    const isDemolition = `${permitType ?? ""} ${workType ?? ""}`
      .toUpperCase()
      .includes("DEMOLITION");

    return {
      permitId,
      pin: pins[0] ?? null,
      pins,
      address,
      zip: null,
      permitType,
      permitStatus: text(raw.permit_status),
      permitMilestone: text(raw.permit_milestone),
      workType,
      permitCondition: text(raw.permit_condition),
      workDescription: text(raw.work_description),
      issueDate: raw.issue_date || null,
      reportedCost: bigint(raw.reported_cost),
      isDemolition,
      lat,
      lon,
      provenance: { source: SOURCE_KEY, raw_json: raw },
    };
  },

  /**
   * Set-based upsert. The pilot issued one INSERT per row, which is ~467k HTTP
   * round trips citywide; this unnests parallel arrays so a page of rows costs
   * one statement. Multi-valued `pins` travels as a comma-joined string and is
   * re-split server-side (Postgres cannot take a ragged text[][] parameter).
   */
  async upsert(sql: SQL, rows: PermitRow[]): Promise<number> {
    const BATCH = 2000;
    let written = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      // ON CONFLICT DO UPDATE cannot touch the same row twice in one statement.
      const deduped = Array.from(new Map(batch.map((r) => [r.permitId, r])).values());

      await sql`
        INSERT INTO building_permits (
          permit_id, pin, pins, address, zip, permit_type, permit_status,
          permit_milestone, work_type, permit_condition, work_description,
          issue_date, reported_cost, is_demolition, lat, lon, geom,
          source, fetched_at, raw_json
        )
        SELECT
          t.permit_id,
          t.pin,
          CASE WHEN t.pins_csv IS NULL OR t.pins_csv = '' THEN NULL
               ELSE string_to_array(t.pins_csv, ',') END,
          t.address, t.zip, t.permit_type, t.permit_status,
          t.permit_milestone, t.work_type, t.permit_condition, t.work_description,
          NULLIF(t.issue_date, '')::timestamp::date,
          t.reported_cost, t.is_demolition, t.lat, t.lon,
          CASE WHEN t.lat IS NULL OR t.lon IS NULL THEN NULL
               ELSE ST_MakePoint(t.lon, t.lat)::geography END,
          t.source, NOW(), t.raw_json::jsonb
        FROM UNNEST(
          ${deduped.map((r) => r.permitId)}::text[],
          ${deduped.map((r) => r.pin)}::text[],
          ${deduped.map((r) => r.pins.join(","))}::text[],
          ${deduped.map((r) => r.address)}::text[],
          ${deduped.map((r) => r.zip)}::text[],
          ${deduped.map((r) => r.permitType)}::text[],
          ${deduped.map((r) => r.permitStatus)}::text[],
          ${deduped.map((r) => r.permitMilestone)}::text[],
          ${deduped.map((r) => r.workType)}::text[],
          ${deduped.map((r) => r.permitCondition)}::text[],
          ${deduped.map((r) => r.workDescription)}::text[],
          ${deduped.map((r) => r.issueDate ?? "")}::text[],
          ${deduped.map((r) => r.reportedCost)}::bigint[],
          ${deduped.map((r) => r.isDemolition)}::boolean[],
          ${deduped.map((r) => r.lat)}::double precision[],
          ${deduped.map((r) => r.lon)}::double precision[],
          ${deduped.map((r) => r.provenance.source)}::text[],
          ${deduped.map((r) => JSON.stringify(r.provenance.raw_json))}::text[]
        ) AS t(
          permit_id, pin, pins_csv, address, zip, permit_type, permit_status,
          permit_milestone, work_type, permit_condition, work_description,
          issue_date, reported_cost, is_demolition, lat, lon, source, raw_json
        )
        ON CONFLICT (permit_id) DO UPDATE SET
          pin = EXCLUDED.pin,
          pins = EXCLUDED.pins,
          address = EXCLUDED.address,
          zip = EXCLUDED.zip,
          permit_type = EXCLUDED.permit_type,
          permit_status = EXCLUDED.permit_status,
          permit_milestone = EXCLUDED.permit_milestone,
          work_type = EXCLUDED.work_type,
          permit_condition = EXCLUDED.permit_condition,
          work_description = EXCLUDED.work_description,
          issue_date = EXCLUDED.issue_date,
          reported_cost = EXCLUDED.reported_cost,
          is_demolition = EXCLUDED.is_demolition,
          lat = EXCLUDED.lat,
          lon = EXCLUDED.lon,
          geom = EXCLUDED.geom,
          source = EXCLUDED.source,
          fetched_at = NOW(),
          raw_json = EXCLUDED.raw_json
      `;
      written += deduped.length;
    }

    return written;
  },
};
