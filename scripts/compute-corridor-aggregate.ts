#!/usr/bin/env npx tsx
/**
 * Corridor metrics from Socrata server-side aggregates — no database.
 *
 * This is the aggregate-query engine validated against the DB pipeline on
 * 2026-07-03 (health scores identical; vacancy exact; ownership within 0.33%;
 * turnover within ~2%). It exists so corridor refreshes don't need a Neon
 * branch or row-level ingestion, and so coverage can extend beyond the
 * SE-Chicago footprint without hitting project storage limits.
 *
 * METHOD NOTE — permits: the DB pipeline assigns each permit to the ZIP of
 * its nearest parcel within 200m (PostGIS). This engine assigns permits by
 * point-in-ZIP-polygon (city ZIP boundaries), i.e. "permits in the ZIP".
 * Counts differ a few percent at boundaries; reported-cost sums can differ
 * more when a mega-permit sits near an edge. The polygon definition is the
 * intended one going forward.
 *
 * TEST FEATURE — citywide output is NOT wired into the report UI. The report
 * reads public/data/corridor-metrics.json (footprint ZIPs only); the citywide
 * export lands in data/exports/ and is not web-served.
 *
 * Usage:
 *   npx tsx scripts/compute-corridor-aggregate.ts                 # footprint 3 ZIPs
 *   npx tsx scripts/compute-corridor-aggregate.ts --citywide      # all city ZIPs
 *   npx tsx scripts/compute-corridor-aggregate.ts --out=path.json # custom output
 *
 * Default output: data/exports/corridor-metrics-aggregate.json (footprint)
 *                 data/exports/corridor-metrics-citywide.json (--citywide).
 * To refresh the production report file, pass
 * --out=public/data/corridor-metrics.json explicitly (footprint mode only).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { socrataHeaders } from "../lib/socrata";
import { classifyOwner } from "../lib/owner-classify";
import { isVacantClass } from "../lib/parcel-classes";
import {
  computeHealthScore,
  computeIncentiveCoverage,
  type VacancyMetric,
  type TurnoverMetric,
  type OwnershipConcentrationMetric,
  type OwnershipOriginMetric,
  type PermitActivityMetric,
} from "../lib/corridor-health";

/** ZIP corridors the report is scoped to. */
const FOOTPRINT_ZIPS = ["60617", "60619", "60649"];

/** Trailing window (months) for turnover + permit-activity metrics. */
const WINDOW_MONTHS = 24;

/** ZIPs processed concurrently (keep polite to the portals). */
const ZIP_CONCURRENCY = 4;

const PARCEL_UNIVERSE_URL =
  "https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json";
const PARCEL_ADDRESSES_URL =
  "https://datacatalog.cookcountyil.gov/resource/3723-97qp.json";
const LICENSES_URL = "https://data.cityofchicago.org/resource/r5kz-chrr.json";
const PERMITS_URL = "https://data.cityofchicago.org/resource/ydr8-5enu.json";
const ZIP_BOUNDARIES_URL =
  "https://data.cityofchicago.org/resource/unjd-c2ca.json";

/** Same coordinate sanity bounds as the ingest adapters. */
const LAT_MIN = 41.6, LAT_MAX = 42.1, LON_MIN = -88.0, LON_MAX = -87.4;

const CLOSED_STATUSES = ["AAC", "REV", "CAN", "EXP", "INA"];

let requestCount = 0;

async function soda<T>(base: string, params: Record<string, string>): Promise<T> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `${base}?${qs}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      requestCount++;
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) return (await res.json()) as T;
      lastError = new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error(`fetch failed: ${url}`);
}

async function sodaCount(base: string, where: string): Promise<number> {
  const rows = await soda<Array<{ count?: string }>>(base, {
    $select: "count(*)",
    $where: where,
  });
  return Number(rows[0]?.count ?? 0);
}

/* ── window boundaries ─────────────────────────────────────────────────────
 * The DB pipeline compares JS Date instants (local midnight), so a dataset
 * date equal to the windowStart calendar date is EXCLUDED and one equal to
 * the asOf calendar date is INCLUDED. Express that as date-string bounds.
 */
function windowBounds(asOf: Date) {
  const windowStart = new Date(asOf);
  windowStart.setMonth(windowStart.getMonth() - WINDOW_MONTHS);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return { startExclusive: d(windowStart), endInclusive: d(asOf) };
}

/* ── Metric 1: vacancy via class-code group-by ── */
async function vacancyForZip(zip: string, dataYear: string): Promise<VacancyMetric> {
  const where =
    `zip_code='${zip}' AND year='${dataYear}'` +
    ` AND lat >= ${LAT_MIN} AND lat <= ${LAT_MAX}` +
    ` AND lon >= ${LON_MIN} AND lon <= ${LON_MAX}`;
  const rows = await soda<Array<{ class?: string; n?: string }>>(PARCEL_UNIVERSE_URL, {
    $select: "class, count(*) as n",
    $where: where,
    $group: "class",
    $limit: "5000",
  });
  let totalParcels = 0;
  let vacantCount = 0;
  for (const r of rows) {
    const n = Number(r.n ?? 0);
    totalParcels += n;
    if (isVacantClass(r.class ?? "")) vacantCount += n;
  }
  return {
    vacancyRate: totalParcels === 0 ? 0 : vacantCount / totalParcels,
    vacantCount,
    totalParcels,
  };
}

/* ── Metrics 3+4: ownership via owner-fields group-by ── */
interface OwnerGroupRow {
  owner_address_name?: string;
  mail_address_name?: string;
  mail_address_full?: string;
  mail_address_city_name?: string;
  mail_address_state?: string;
  mail_address_zipcode_1?: string;
  owner_address_full?: string;
  owner_address_city_name?: string;
  owner_address_state?: string;
  owner_address_zipcode_1?: string;
  n?: string;
}

const OWNER_FIELDS = [
  "owner_address_name",
  "mail_address_name",
  "mail_address_full",
  "mail_address_city_name",
  "mail_address_state",
  "mail_address_zipcode_1",
  "owner_address_full",
  "owner_address_city_name",
  "owner_address_state",
  "owner_address_zipcode_1",
];

function clean(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function joinAddr(parts: Array<string | undefined>): string | null {
  const text = parts
    .map((p) => clean(p))
    .filter((p): p is string => Boolean(p))
    .join(", ");
  return text || null;
}

async function ownershipForZip(zip: string, addressYear: string) {
  const groups: OwnerGroupRow[] = [];
  const pageSize = 5000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await soda<OwnerGroupRow[]>(PARCEL_ADDRESSES_URL, {
      $select: `${OWNER_FIELDS.join(",")}, count(*) as n`,
      $where: `year=${addressYear} AND prop_address_zipcode_1='${zip}'`,
      $group: OWNER_FIELDS.join(","),
      $order: OWNER_FIELDS.join(","),
      $limit: String(pageSize),
      $offset: String(offset),
    });
    groups.push(...page);
    if (page.length < pageSize) break;
  }

  // Same owner_name / mailing-address derivation as enrich-parcel-ownership,
  // but classifyOwner runs once per distinct owner combo, not once per parcel.
  const nameCounts = new Map<string, number>();
  let namedParcels = 0;
  let localCount = 0;
  let outsideCount = 0;
  let classifiedTotal = 0;

  for (const g of groups) {
    const n = Number(g.n ?? 0);
    const ownerName = clean(g.owner_address_name) ?? clean(g.mail_address_name);
    const mailing =
      joinAddr([g.mail_address_full, g.mail_address_city_name, g.mail_address_state, g.mail_address_zipcode_1]) ??
      joinAddr([g.owner_address_full, g.owner_address_city_name, g.owner_address_state, g.owner_address_zipcode_1]);

    if (ownerName) {
      namedParcels += n;
      const key = ownerName.trim().toUpperCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + n);
    }

    const type = classifyOwner(ownerName, mailing);
    if (type === "local_private") {
      localCount += n;
      classifiedTotal += n;
    } else if (type === "out_of_state" || type === "corporate_llc") {
      outsideCount += n;
      classifiedTotal += n;
    }
  }

  let hhi = 0;
  let maxCount = 0;
  for (const count of nameCounts.values()) {
    const share = count / namedParcels;
    hhi += share * share;
    if (count > maxCount) maxCount = count;
  }

  const concentration: OwnershipConcentrationMetric = namedParcels === 0
    ? { hhi: 0, topOwnerShare: 0, distinctOwners: 0, totalParcels: 0 }
    : {
        hhi,
        topOwnerShare: maxCount / namedParcels,
        distinctOwners: nameCounts.size,
        totalParcels: namedParcels,
      };

  const origin: OwnershipOriginMetric = {
    localShare: classifiedTotal === 0 ? 0 : localCount / classifiedTotal,
    outsideShare: classifiedTotal === 0 ? 0 : outsideCount / classifiedTotal,
    localCount,
    outsideCount,
    totalParcels: classifiedTotal,
  };

  return { concentration, origin };
}

/* ── Metric 2: turnover via three count() queries ── */
async function turnoverForZip(
  zip: string,
  startExclusive: string,
  endInclusive: string
): Promise<TurnoverMetric> {
  const statusList = CLOSED_STATUSES.map((s) => `'${s}'`).join(",");
  const [total, openings, closures] = await Promise.all([
    sodaCount(LICENSES_URL, `zip_code='${zip}'`),
    sodaCount(
      LICENSES_URL,
      `zip_code='${zip}' AND license_start_date > '${startExclusive}' AND license_start_date <= '${endInclusive}'`
    ),
    sodaCount(
      LICENSES_URL,
      `zip_code='${zip}' AND license_status in(${statusList})` +
        ` AND (expiration_date IS NULL OR (expiration_date > '${startExclusive}' AND expiration_date <= '${endInclusive}'))`
    ),
  ]);
  const turnoverRate = total === 0 ? 0 : Math.min(1, (openings + closures) / total);
  return { openings, closures, net: openings - closures, turnoverRate };
}

/* ── Metric 5: permits — windowed skinny pull + point-in-ZIP-polygon ── */
interface PermitSlim {
  permit_type?: string;
  issue_date?: string;
  reported_cost?: string;
  latitude?: string;
  longitude?: string;
}

type Ring = Array<[number, number]>;

interface ZipBoundary {
  zip: string;
  coords: Ring[][][]; // MultiPolygon coordinates
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
}

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInMultiPolygon(lon: number, lat: number, coords: Ring[][][]): boolean {
  for (const polygon of coords) {
    if (polygon.length === 0) continue;
    if (!pointInRing(lon, lat, polygon[0] as unknown as Ring)) continue;
    let inHole = false;
    for (let h = 1; h < polygon.length; h++) {
      if (pointInRing(lon, lat, polygon[h] as unknown as Ring)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

async function fetchZipBoundaries(zips: string[] | null): Promise<ZipBoundary[]> {
  const params: Record<string, string> = { $limit: "200" };
  if (zips) params.$where = `zip in(${zips.map((z) => `'${z}'`).join(",")})`;
  const rows = await soda<Array<{ zip?: string; the_geom?: { type: string; coordinates: unknown } }>>(
    ZIP_BOUNDARIES_URL,
    params
  );

  const merged = new Map<string, Ring[][][]>();
  for (const row of rows) {
    if (!row.zip || !row.the_geom) continue;
    const coords =
      row.the_geom.type === "Polygon"
        ? [row.the_geom.coordinates as Ring[][]]
        : (row.the_geom.coordinates as Ring[][][]);
    const existing = merged.get(row.zip);
    merged.set(row.zip, existing ? [...existing, ...coords] : coords);
  }

  return Array.from(merged.entries()).map(([zip, coords]) => {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const polygon of coords) {
      for (const [lon, lat] of polygon[0] as unknown as Ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    return { zip, coords, bbox: { minLon, maxLon, minLat, maxLat } };
  });
}

async function permitsByZip(
  boundaries: ZipBoundary[],
  startExclusive: string,
  endInclusive: string
): Promise<Map<string, PermitActivityMetric>> {
  const permits: PermitSlim[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await soda<PermitSlim[]>(PERMITS_URL, {
      $select: "permit_type,issue_date,reported_cost,latitude,longitude",
      $where: `issue_date > '${startExclusive}' AND issue_date <= '${endInclusive}'`,
      $order: "permit_",
      $limit: String(pageSize),
      $offset: String(offset),
    });
    permits.push(...page);
    if (page.length < pageSize) break;
  }

  const byZip = new Map<string, PermitActivityMetric>(
    boundaries.map((b) => [b.zip, { permitCount: 0, totalReportedCost: 0, demolitionCount: 0 }])
  );
  for (const p of permits) {
    const lat = Number(p.latitude);
    const lon = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) continue;
    if (lat < LAT_MIN || lat > LAT_MAX || lon < LON_MIN || lon > LON_MAX) continue;
    for (const b of boundaries) {
      if (lon < b.bbox.minLon || lon > b.bbox.maxLon || lat < b.bbox.minLat || lat > b.bbox.maxLat) continue;
      if (pointInMultiPolygon(lon, lat, b.coords)) {
        const m = byZip.get(b.zip)!;
        m.permitCount += 1;
        const cost = parseFloat(p.reported_cost ?? "");
        m.totalReportedCost += Number.isFinite(cost) ? cost : 0;
        if ((p.permit_type ?? "").toUpperCase().includes("DEMOLITION")) {
          m.demolitionCount += 1;
        }
        break;
      }
    }
  }
  return byZip;
}

/* ── data-year probes (same selection logic as the ingest adapters) ── */
async function probeUniverseYear(sampleZips: string[]): Promise<string> {
  const maxRow = await soda<Array<{ max_year?: string }>>(PARCEL_UNIVERSE_URL, {
    $select: "max(year)",
  });
  const maxYear = Math.trunc(Number(maxRow[0]?.max_year));
  const zipList = sampleZips.map((z) => `'${z}'`).join(",");
  for (let y = maxYear; y >= maxYear - 4; y--) {
    const n = await sodaCount(PARCEL_UNIVERSE_URL, `zip_code in(${zipList}) AND year='${y}'`);
    if (n >= 10000) return String(y);
  }
  throw new Error("no substantive parcel-universe year found");
}

async function probeAddressYear(): Promise<string> {
  const rows = await soda<Array<{ max_year?: string }>>(PARCEL_ADDRESSES_URL, {
    $select: "max(year)",
  });
  return String(Math.trunc(Number(rows[0]?.max_year)));
}

/* ── main ── */
async function main() {
  const started = Date.now();
  const citywide = process.argv.includes("--citywide");
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outPath = join(
    process.cwd(),
    outArg?.slice("--out=".length) ??
      (citywide
        ? "data/exports/corridor-metrics-citywide.json"
        : "data/exports/corridor-metrics-aggregate.json")
  );

  const asOf = new Date();
  const asOfIso = asOf.toISOString().slice(0, 10);
  const { startExclusive, endInclusive } = windowBounds(asOf);
  console.log(`asOf=${asOfIso} window=(${startExclusive}, ${endInclusive}] mode=${citywide ? "citywide" : "footprint"}`);

  const boundaries = await fetchZipBoundaries(citywide ? null : FOOTPRINT_ZIPS);
  boundaries.sort((a, b) => a.zip.localeCompare(b.zip));
  const zips = boundaries.map((b) => b.zip);
  console.log(`${zips.length} ZIPs`);

  const [universeYear, addressYear] = await Promise.all([
    probeUniverseYear(FOOTPRINT_ZIPS),
    probeAddressYear(),
  ]);
  console.log(`parcel-universe year=${universeYear}, parcel-addresses year=${addressYear}\n`);

  const permitsPerZip = await permitsByZip(boundaries, startExclusive, endInclusive);

  const out: Record<string, unknown> = {};
  let index = 0;
  const worker = async () => {
    for (;;) {
      const i = index++;
      if (i >= zips.length) return;
      const zip = zips[i];
      const [vacancy, ownership, turnover] = await Promise.all([
        vacancyForZip(zip, universeYear),
        ownershipForZip(zip, addressYear),
        turnoverForZip(zip, startExclusive, endInclusive),
      ]);
      if (vacancy.totalParcels === 0) {
        console.log(`${zip}: no parcels — skipped`);
        continue;
      }
      const permits =
        permitsPerZip.get(zip) ?? { permitCount: 0, totalReportedCost: 0, demolitionCount: 0 };
      const incentiveCoverage = computeIncentiveCoverage(vacancy.totalParcels, null);
      const healthScore = computeHealthScore({
        vacancy,
        turnover,
        ownershipConcentration: ownership.concentration,
        ownershipOrigin: ownership.origin,
        permits,
        incentiveCoverage,
      });

      out[zip] = {
        corridorType: "zip",
        corridorId: zip,
        asOf: asOfIso,
        vacancyRate: vacancy.vacancyRate,
        turnoverRate: turnover.turnoverRate,
        ownershipHHI: ownership.concentration.hhi,
        localOwnershipShare: ownership.origin.localShare,
        permitCount: permits.permitCount,
        incentiveCoverage: incentiveCoverage.coverageShare,
        healthScore,
        computedAt: new Date().toISOString(),
        details: {
          vacancy,
          turnover,
          ownershipConcentration: ownership.concentration,
          ownershipOrigin: ownership.origin,
          permits,
          incentiveCoverage,
          windowMonths: WINDOW_MONTHS,
          method: "socrata-aggregate",
        },
      };
      console.log(
        `${zip}: parcels=${vacancy.totalParcels} vacancy=${vacancy.vacancyRate.toFixed(3)} ` +
          `local=${ownership.origin.localShare.toFixed(3)} permits=${permits.permitCount} ` +
          `health=${healthScore}`
      );
    }
  };
  await Promise.all(Array.from({ length: ZIP_CONCURRENCY }, worker));

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(
    `\nWrote ${Object.keys(out).length} corridors → ${outPath}\n` +
      `${requestCount} Socrata requests, ${((Date.now() - started) / 1000).toFixed(1)}s total`
  );
}

main().catch((err) => {
  console.error("Compute failed:", err);
  process.exit(1);
});
