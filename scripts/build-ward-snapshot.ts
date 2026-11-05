/**
 * scripts/build-ward-snapshot.ts
 *
 * Builds public/data/ward-snapshot.json: four comparable measures for each
 * of Chicago's 50 wards (2023 ward map), each with its raw value and the
 * source it came from. Tiers and ranks are NOT stored here; lib/ward-snapshot.ts
 * derives them from the values at render time so the method lives in code.
 *
 * Measures:
 *   - vacantLots         Cook County Assessor class 1-00 (vacant land) parcels
 *                        plus City-Owned Land Inventory parcels owned by the
 *                        City, de-duplicated by PIN.
 *   - avPerResident      Assessed value (Board of Review, else certified, else
 *                        mailed) of every parcel in the ward / ward residents.
 *   - youthPovertyRate   ACS 5-year under-18 poverty (S1701), allocated from
 *                        tracts to wards.
 *   - tifSpending        City TIF Annual Report total expenditures for the
 *                        latest report year, split across wards by each ward's
 *                        share of the district's assessed value. Transit TIFs
 *                        (CTA rail construction) are excluded and reported.
 *
 * Tract → ward allocation uses each tract's residential parcels (Assessor
 * class 2xx, excluding 200/201/241 land/garage classes) as the weight, so a
 * tract that is 70% in one ward by housing counts 70% there. Tracts that
 * straddle the city line are weighted against their full residential count,
 * so the suburban share is not pushed into a Chicago ward.
 *
 * Clerk TIF agency numbers (parcel `tax_tif_district_num`) are matched to the
 * City's T-numbers by locating a sample of each agency's parcels inside the
 * City's TIF boundary polygons and taking the majority.
 *
 * Usage:
 *   npx tsx --env-file=<path to .env.local> scripts/build-ward-snapshot.ts
 * Requires CENSUS_API_KEY. SOCRATA_KEY_ID/SOCRATA_KEY_SECRET or
 * SOCRATA_APP_TOKEN are optional but strongly recommended (~900k parcel rows).
 * Raw pulls are cached under $TMPDIR/cie-ward-snapshot; pass --refresh to refetch.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { socrataHeaders } from "../lib/socrata";
import type { WardSnapshotFile, WardSnapshotWard } from "../lib/ward-snapshot";

const PARCEL_YEAR = "2025";
const ACS_YEAR = "2024";
const CACHE_DIR = join(tmpdir(), "cie-ward-snapshot");
const REFRESH = process.argv.includes("--refresh");
const OUT_PATH = join(process.cwd(), "public/data/ward-snapshot.json");

const PARCEL_UNIVERSE = "https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json";
const ASSESSED_VALUES = "https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json";
const CITY_OWNED_LAND = "https://data.cityofchicago.org/resource/aksk-kvfp.json";
const TIF_ANNUAL = "https://data.cityofchicago.org/resource/qm7s-3ctt.json";
// The repo's copy of the City TIF boundary layer (jkpc-3pjb); its live JSON
// endpoint returns attribute-less rows, so the shipped GeoJSON is the source.
const TIF_BOUNDARIES_PATH = join(process.cwd(), "public/data/zones/tif-districts.geojson");
const CHICAGO_TOWNSHIP_CODES = ["70", "71", "72", "73", "74", "75", "76", "77"];
const NON_DWELLING_RES_CLASSES = new Set(["200", "201", "241"]);
const PAGE = 50_000;

type ParcelRow = {
  pin: string;
  class?: string;
  ward_num?: string;
  census_tract_geoid?: string;
  chicago_community_area_name?: string;
  tax_tif_district_num?: string;
  tax_tif_district_name?: string;
  lat?: string;
  lon?: string;
};
type ValueRow = { pin: string; board_tot?: string; certified_tot?: string; mailed_tot?: string };
type CityLandRow = { pin?: string; ward?: string };
type TifRow = { tif_number?: string; tif_district?: string; report_year?: string; total_expenditure?: string };

async function fetchWithRetry(url: string, headers: Record<string, string> = {}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(180_000) });
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
  throw lastError;
}

async function cached<T>(name: string, load: () => Promise<T>): Promise<T> {
  const path = join(CACHE_DIR, `${name}.json`);
  if (!REFRESH && existsSync(path)) return JSON.parse(await readFile(path, "utf8")) as T;
  const value = await load();
  await writeFile(path, JSON.stringify(value));
  return value;
}

async function socrataAll<T>(base: string, params: Record<string, string>, label: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = new URL(base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("$limit", String(PAGE));
    url.searchParams.set("$offset", String(offset));
    const page = (await (await fetchWithRetry(url.toString(), socrataHeaders())).json()) as T[];
    rows.push(...page);
    console.log(`  ${label}: ${rows.length.toLocaleString()} rows`);
    if (page.length < PAGE) return rows;
  }
}

const num = (v: string | undefined | null): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const normalizePin = (pin: string) => pin.replace(/\D/g, "").padEnd(14, "0");
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  if (!process.env.CENSUS_API_KEY) throw new Error("CENSUS_API_KEY is required");

  console.log("Parcels (Assessor parcel universe, Chicago)…");
  const parcels = await cached("parcels", () =>
    socrataAll<ParcelRow>(PARCEL_UNIVERSE, {
      $select: "pin,class,ward_num,census_tract_geoid,chicago_community_area_name,tax_tif_district_num,tax_tif_district_name,lat,lon",
      $where: `year='${PARCEL_YEAR}' AND ward_chicago_data_year IS NOT NULL AND ward_num IS NOT NULL`,
      $order: ":id",
    }, "parcels"),
  );

  console.log("Assessed values (Chicago townships)…");
  const values = await cached("values", () =>
    socrataAll<ValueRow>(ASSESSED_VALUES, {
      $select: "pin,board_tot,certified_tot,mailed_tot",
      $where: `year='${PARCEL_YEAR}' AND township_code IN (${CHICAGO_TOWNSHIP_CODES.map((c) => `'${c}'`).join(",")})`,
      $order: ":id",
    }, "values"),
  );

  console.log("City-Owned Land Inventory…");
  const cityLand = await cached("city-land", () =>
    socrataAll<CityLandRow>(CITY_OWNED_LAND, {
      $select: "pin,ward",
      $where: "property_status='Owned by City'",
      $order: "id",
    }, "city land"),
  );

  console.log("TIF annual report…");
  const tifRows = await cached("tif-annual", () =>
    socrataAll<TifRow>(TIF_ANNUAL, { $select: "tif_number,tif_district,report_year,total_expenditure" }, "tif rows"),
  );

  const tifBoundaries = JSON.parse(await readFile(TIF_BOUNDARIES_PATH, "utf8")) as FeatureCollection<Polygon | MultiPolygon>;

  console.log("ACS youth poverty + population…");
  const acs = await cached(`acs-${ACS_YEAR}`, async () => {
    const key = process.env.CENSUS_API_KEY!;
    const subject = new URL(`https://api.census.gov/data/${ACS_YEAR}/acs/acs5/subject`);
    subject.searchParams.set("get", "S1701_C01_002E,S1701_C02_002E");
    subject.searchParams.set("for", "tract:*");
    subject.searchParams.set("in", "state:17 county:031");
    subject.searchParams.set("key", key);
    const detail = new URL(`https://api.census.gov/data/${ACS_YEAR}/acs/acs5`);
    detail.searchParams.set("get", "B01003_001E");
    detail.searchParams.set("for", "tract:*");
    detail.searchParams.set("in", "state:17 county:031");
    detail.searchParams.set("key", key);
    const [s, d] = await Promise.all([
      (await fetchWithRetry(subject.toString())).json() as Promise<string[][]>,
      (await fetchWithRetry(detail.toString())).json() as Promise<string[][]>,
    ]);
    const byTract: Record<string, { pop: number; youth: number; youthPoor: number }> = {};
    const geo = (h: string[], r: string[]) => `${r[h.indexOf("state")]}${r[h.indexOf("county")]}${r[h.indexOf("tract")]}`;
    const [sh, ...sr] = s;
    for (const r of sr) {
      byTract[geo(sh, r)] = {
        pop: 0,
        youth: Math.max(0, num(r[sh.indexOf("S1701_C01_002E")]) ?? 0),
        youthPoor: Math.max(0, num(r[sh.indexOf("S1701_C02_002E")]) ?? 0),
      };
    }
    const [dh, ...dr] = d;
    for (const r of dr) {
      const t = byTract[geo(dh, r)] ?? (byTract[geo(dh, r)] = { pop: 0, youth: 0, youthPoor: 0 });
      t.pop = Math.max(0, num(r[dh.indexOf("B01003_001E")]) ?? 0);
    }
    return byTract;
  });

  // ── Residential crosswalk: tract → ward weights ────────────────────────
  const isDwelling = (cls?: string) => !!cls && cls.startsWith("2") && !NON_DWELLING_RES_CLASSES.has(cls);
  const tractWard = new Map<string, Map<string, number>>();
  for (const p of parcels) {
    if (!isDwelling(p.class) || !p.census_tract_geoid || !p.ward_num) continue;
    const m = tractWard.get(p.census_tract_geoid) ?? new Map<string, number>();
    m.set(p.ward_num, (m.get(p.ward_num) ?? 0) + 1);
    tractWard.set(p.census_tract_geoid, m);
  }

  // Denominator includes the tract's residential parcels OUTSIDE Chicago, so a
  // straddling tract only contributes its in-city share.
  console.log("Out-of-city residential counts for straddling tracts…");
  const tractIds = [...tractWard.keys()];
  const outside = await cached("tract-outside", async () => {
    const out: Record<string, number> = {};
    for (let i = 0; i < tractIds.length; i += 80) {
      const chunk = tractIds.slice(i, i + 80);
      const url = new URL(PARCEL_UNIVERSE);
      url.searchParams.set("$select", "census_tract_geoid,count(*) AS n");
      url.searchParams.set(
        "$where",
        `year='${PARCEL_YEAR}' AND ward_chicago_data_year IS NULL AND starts_with(class,'2') AND class NOT IN ('200','201','241') AND census_tract_geoid IN (${chunk.map((t) => `'${t}'`).join(",")})`,
      );
      url.searchParams.set("$group", "census_tract_geoid");
      url.searchParams.set("$limit", "1000");
      const rows = (await (await fetchWithRetry(url.toString(), socrataHeaders())).json()) as { census_tract_geoid: string; n: string }[];
      for (const r of rows) out[r.census_tract_geoid] = Number(r.n);
    }
    return out;
  });

  type Acc = { pop: number; youth: number; youthPoor: number; av: number; parcels: number; vacantPrivate: number; vacantCity: number; tif: number; areaCounts: Map<string, number> };
  const wards = new Map<string, Acc>();
  for (let w = 1; w <= 50; w++) {
    wards.set(String(w), { pop: 0, youth: 0, youthPoor: 0, av: 0, parcels: 0, vacantPrivate: 0, vacantCity: 0, tif: 0, areaCounts: new Map() });
  }

  let unmatchedTracts = 0;
  for (const [tract, m] of tractWard) {
    const a = acs[tract];
    if (!a) { unmatchedTracts++; continue; }
    const inCity = [...m.values()].reduce((s, n) => s + n, 0);
    const total = inCity + (outside[tract] ?? 0);
    for (const [ward, n] of m) {
      const w = n / total;
      const acc = wards.get(ward);
      if (!acc) continue;
      acc.pop += a.pop * w;
      acc.youth += a.youth * w;
      acc.youthPoor += a.youthPoor * w;
    }
  }

  // ── Assessed value + vacant land ────────────────────────────────────────
  const avByPin = new Map<string, number>();
  for (const v of values) {
    const av = num(v.board_tot) ?? num(v.certified_tot) ?? num(v.mailed_tot);
    if (av != null) avByPin.set(normalizePin(v.pin), av);
  }
  const wardByPin = new Map<string, string>();
  const vacantPins = new Set<string>();
  let parcelsWithValue = 0;
  for (const p of parcels) {
    const pin = normalizePin(p.pin);
    const acc = p.ward_num ? wards.get(p.ward_num) : undefined;
    if (!acc) continue;
    wardByPin.set(pin, p.ward_num!);
    acc.parcels++;
    const av = avByPin.get(pin);
    if (av != null) { acc.av += av; parcelsWithValue++; }
    if (p.class === "100") { acc.vacantPrivate++; vacantPins.add(pin); }
    if (isDwelling(p.class) && p.chicago_community_area_name) {
      acc.areaCounts.set(p.chicago_community_area_name, (acc.areaCounts.get(p.chicago_community_area_name) ?? 0) + 1);
    }
  }
  let cityLandUnplaced = 0;
  for (const c of cityLand) {
    const pin = c.pin ? normalizePin(c.pin) : null;
    if (pin && vacantPins.has(pin)) continue;
    const ward = (pin && wardByPin.get(pin)) || c.ward;
    const acc = ward ? wards.get(String(Number(ward))) : undefined;
    if (!acc) { cityLandUnplaced++; continue; }
    acc.vacantCity++;
    if (pin) vacantPins.add(pin);
  }

  // ── TIF: clerk agency number → City T-number, then AV-share allocation ─
  // The shipped layer is simplified and some rings are left open; close them
  // so point-in-polygon accepts every district.
  const closeRing = (ring: number[][]) => {
    const [first, last] = [ring[0], ring[ring.length - 1]];
    return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
  };
  const tifFeatures = (tifBoundaries.features as Feature<Polygon | MultiPolygon, Record<string, unknown>>[])
    .filter((f) => f.geometry)
    .map((f) => {
      const g = f.geometry;
      const geometry: Polygon | MultiPolygon =
        g.type === "Polygon"
          ? { ...g, coordinates: g.coordinates.map(closeRing) }
          : { ...g, coordinates: g.coordinates.map((poly) => poly.map(closeRing)) };
      return { ...f, geometry };
    });
  const tNumberOf = (f: Feature<Polygon | MultiPolygon, Record<string, unknown>>) => {
    const raw = String(f.properties?.TIF_Number ?? "");
    const digits = raw.match(/\d+/g)?.join("");
    return digits ? `T-${digits.padStart(3, "0")}` : null;
  };
  const byAgency = new Map<string, ParcelRow[]>();
  for (const p of parcels) {
    if (!p.tax_tif_district_num) continue;
    const list = byAgency.get(p.tax_tif_district_num) ?? [];
    list.push(p);
    byAgency.set(p.tax_tif_district_num, list);
  }
  // Name fallback for districts missing from the boundary layer: compare the
  // Clerk name ("TIF - CHICAGO - 79TH / SW HWY") with the City report name
  // ("79th/Southwest Highway") after expanding common abbreviations.
  const ABBREV: Record<string, string> = { st: "street", ave: "avenue", av: "avenue", sw: "southwest", hwy: "highway", n: "north", s: "south", e: "east", w: "west", rd: "road", blvd: "boulevard", dr: "drive" };
  const nameTokens = (name: string) =>
    name
      .toLowerCase()
      .replace(/^tif\s*-\s*chicago\s*-\s*/, "")
      .replace(/\([^)]*\)/g, " ")
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((t) => ABBREV[t] ?? t);
  const reportNames = new Map<string, string>();
  for (const r of tifRows) {
    const digits = r.tif_number?.match(/\d+/g)?.join("");
    if (digits && r.tif_district) reportNames.set(`T-${digits.padStart(3, "0")}`, r.tif_district);
  }
  const matchByName = (clerkName: string): string | null => {
    const a = new Set(nameTokens(clerkName));
    let best: { t: string; score: number } | null = null;
    for (const [t, name] of reportNames) {
      const b = new Set(nameTokens(name));
      const inter = [...a].filter((x) => b.has(x)).length;
      const score = inter / new Set([...a, ...b]).size;
      if (!best || score > best.score) best = { t, score };
    }
    return best && best.score >= 0.6 ? best.t : null;
  };

  const agencyToT = new Map<string, string>();
  const unmatchedAgencies: string[] = [];
  const nameMatchedAgencies: string[] = [];
  for (const [agency, list] of byAgency) {
    const votes = new Map<string, number>();
    let sampled = 0;
    const step = Math.max(1, Math.floor(list.length / 150));
    for (let i = 0; i < list.length; i += step) {
      const lat = num(list[i].lat), lon = num(list[i].lon);
      if (lat == null || lon == null) continue;
      sampled++;
      const pt = turf.point([lon, lat]);
      for (const f of tifFeatures) {
        if (turf.booleanPointInPolygon(pt, f)) {
          const t = tNumberOf(f);
          if (t) votes.set(t, (votes.get(t) ?? 0) + 1);
        }
      }
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    const clerkName = list[0].tax_tif_district_name ?? "";
    if (best && best[1] / Math.max(1, sampled) >= 0.5) {
      agencyToT.set(agency, best[0]);
      continue;
    }
    const byName = matchByName(clerkName);
    if (byName) {
      agencyToT.set(agency, byName);
      nameMatchedAgencies.push(`${clerkName} → ${byName} ${reportNames.get(byName)}`);
    } else {
      unmatchedAgencies.push(`${agency} ${clerkName}`.trim());
    }
  }
  console.log("Matched by name:\n  " + nameMatchedAgencies.join("\n  "));

  const tifAvByWard = new Map<string, Map<string, number>>();
  for (const p of parcels) {
    const t = p.tax_tif_district_num ? agencyToT.get(p.tax_tif_district_num) : undefined;
    if (!t || !p.ward_num) continue;
    const av = avByPin.get(normalizePin(p.pin)) ?? 0;
    const m = tifAvByWard.get(t) ?? new Map<string, number>();
    m.set(p.ward_num, (m.get(p.ward_num) ?? 0) + av);
    tifAvByWard.set(t, m);
  }

  const reportYear = String(Math.max(...tifRows.map((r) => Number(r.report_year)).filter(Number.isFinite)));
  let tifTotal = 0, tifAllocated = 0, transitExcluded = 0;
  const transitDistricts: string[] = [];
  const tifUnallocated: string[] = [];
  for (const r of tifRows) {
    if (r.report_year !== reportYear) continue;
    const exp = num(r.total_expenditure) ?? 0;
    if (exp <= 0) continue;
    // Transit TIFs fund CTA construction along a rail line, not neighborhood
    // development; booking them to every ward on the line distorts the measure.
    if (/transit tif/i.test(r.tif_district ?? "")) { transitExcluded += exp; transitDistricts.push(`${r.tif_number} ${r.tif_district}`); continue; }
    tifTotal += exp;
    const digits = r.tif_number?.match(/\d+/g)?.join("");
    const t = digits ? `T-${digits.padStart(3, "0")}` : null;
    const m = t ? tifAvByWard.get(t) : undefined;
    const sum = m ? [...m.values()].reduce((s, n) => s + n, 0) : 0;
    if (!m || sum <= 0) { tifUnallocated.push(`${r.tif_number} ${r.tif_district}`); continue; }
    for (const [ward, av] of m) {
      const acc = wards.get(ward);
      if (acc) acc.tif += exp * (av / sum);
    }
    tifAllocated += exp;
  }

  // ── Assemble ────────────────────────────────────────────────────────────
  const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
  const out: WardSnapshotWard[] = [...wards.entries()].map(([ward, a]) => {
    const totalRes = [...a.areaCounts.values()].reduce((s, n) => s + n, 0);
    const areas = [...a.areaCounts.entries()]
      .sort((x, y) => y[1] - x[1])
      .filter(([, n], i) => i === 0 || n / totalRes >= 0.2)
      .slice(0, 3)
      .map(([name]) => titleCase(name));
    return {
      ward: Number(ward),
      areas,
      population: round(a.pop),
      values: {
        vacantLots: a.vacantPrivate + a.vacantCity,
        avPerResident: a.pop > 0 ? round(a.av / a.pop) : null,
        youthPovertyRate: a.youth > 0 ? round((a.youthPoor / a.youth) * 100, 1) : null,
        tifSpending: round(a.tif),
      },
      detail: {
        vacantPrivate: a.vacantPrivate,
        vacantCityOwned: a.vacantCity,
        assessedValue: round(a.av),
        youthInPoverty: round(a.youthPoor),
        youthPopulation: round(a.youth),
      },
    };
  });

  const file: WardSnapshotFile = {
    generatedAt: new Date().toISOString(),
    wardMap: "2023",
    vintages: { parcels: PARCEL_YEAR, assessedValues: PARCEL_YEAR, acs: `${Number(ACS_YEAR) - 4}–${ACS_YEAR}`, tifReportYear: reportYear },
    coverage: {
      parcels: parcels.length,
      parcelsWithAssessedValue: parcelsWithValue,
      tractsAllocated: tractWard.size - unmatchedTracts,
      cityOwnedUnplaced: cityLandUnplaced,
      tifExpenditureTotal: round(tifTotal),
      tifExpenditureAllocated: round(tifAllocated),
      tifDistrictsUnallocated: tifUnallocated,
      tifTransitExcluded: round(transitExcluded),
      tifTransitDistricts: transitDistricts,
      clerkTifAgenciesUnmatched: unmatchedAgencies,
    },
    wards: out.sort((a, b) => a.ward - b.ward),
  };
  await writeFile(OUT_PATH, JSON.stringify(file, null, 2) + "\n");
  console.log(`Wrote ${OUT_PATH}`);
  console.log(JSON.stringify(file.coverage, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
