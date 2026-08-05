#!/usr/bin/env npx tsx

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  aggregateEpaWalkabilityToTract,
  airportDistances,
  buildExpresswaySpatialIndex,
  buildTractIndex,
  findContainingTract,
  nearestExpressway,
  populationDensityPerSqMi,
  siteMatchmakerContextKey,
  type EpaWalkabilityBlockGroup,
  type GeoJsonFeatureCollection,
  type SiteMatchmakerContextFile,
  type SiteMatchmakerContextMetric,
  type TractAttribute,
} from "../lib/site-matchmaker-context";

const ACS_YEAR = "2024";
const STATE = "17";
const COUNTY = "031";
const EPA_BASE_URL =
  "https://geodata.epa.gov/arcgis/rest/services/OA/WalkabilityIndex/MapServer/0/query";
const TIGER_TRACT_ATTRIBUTES_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer/8/query";
const ACS_POPULATION_URL = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5`;
const OUT_DIR = join(process.cwd(), "public", "data", "site-matchmaker-context");
const CENSUS_API_KEY = process.env.CENSUS_API_KEY;

interface VacancyPoint {
  lat?: number | string | null;
  lon?: number | string | null;
  address?: string | null;
  pin?: string | number | null;
}

interface VacancyEdition {
  zip: string;
  sitePoints?: VacancyPoint[];
  landPoints?: VacancyPoint[];
}

interface VacancyIndexFile {
  generatedAt?: string;
  editions: Record<string, VacancyEdition>;
}

interface ArcGisAttributesResponse {
  features?: Array<{ attributes?: Record<string, unknown> }>;
  exceededTransferLimit?: boolean;
  error?: { message?: string; details?: string[] };
}

async function fetchJson<T>(url: string, retries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      const source = new URL(url);
      const sourceLabel = `${source.origin}${source.pathname}`;
      if (!res.ok) throw new Error(`Fetch failed ${res.status} from ${sourceLabel}`);
      const body = await res.text();
      try {
        return JSON.parse(body) as T;
      } catch {
        throw new Error(`Expected JSON from ${sourceLabel}, received ${res.headers.get("content-type") ?? "an unknown content type"}`);
      }
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

async function fetchAcsPopulation(): Promise<Map<string, number | null>> {
  const url = new URL(ACS_POPULATION_URL);
  url.searchParams.set("get", "B01003_001E");
  url.searchParams.set("for", "tract:*");
  url.searchParams.set("in", `state:${STATE} county:${COUNTY}`);
  if (CENSUS_API_KEY) url.searchParams.set("key", CENSUS_API_KEY);

  const rows = await fetchJson<string[][]>(url.toString());
  const [header, ...records] = rows;
  const idx = Object.fromEntries(header.map((key, i) => [key, i]));
  const result = new Map<string, number | null>();

  for (const row of records) {
    const tractId = `${row[idx.state]}${row[idx.county]}${row[idx.tract]}`;
    result.set(tractId, parseCensusNumber(row[idx.B01003_001E]));
  }

  return result;
}

async function fetchTigerLandArea(): Promise<Map<string, number | null>> {
  const rows = await fetchPagedArcGis(TIGER_TRACT_ATTRIBUTES_URL, {
    where: `STATE='${STATE}' AND COUNTY='${COUNTY}'`,
    outFields: "GEOID,AREALAND",
    returnGeometry: "false",
    orderByFields: "GEOID ASC",
    f: "json",
  });

  const result = new Map<string, number | null>();
  for (const attrs of rows) {
    const tractId = String(attrs.GEOID ?? "");
    if (!tractId) continue;
    result.set(tractId, parseNullableNumber(attrs.AREALAND));
  }
  return result;
}

async function fetchEpaWalkabilityBlockGroups(): Promise<EpaWalkabilityBlockGroup[]> {
  const rows = await fetchPagedArcGis(EPA_BASE_URL, {
    where: "STATEFP='17' AND COUNTYFP='031'",
    outFields: "GEOID20,NatWalkInd,TotPop",
    returnGeometry: "false",
    orderByFields: "GEOID20 ASC",
    f: "json",
  });

  return rows.map((attrs) => ({
    GEOID20: String(attrs.GEOID20 ?? ""),
    NatWalkInd: parseNullableNumber(attrs.NatWalkInd),
    TotPop: parseNullableNumber(attrs.TotPop),
  }));
}

async function fetchPagedArcGis(
  baseUrl: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("resultRecordCount", String(pageSize));
    url.searchParams.set("resultOffset", String(offset));

    const page = await fetchJson<ArcGisAttributesResponse>(url.toString());
    if (page.error) {
      const detail = page.error.details?.join("; ") ?? "";
      throw new Error(`ArcGIS query failed: ${page.error.message ?? "Unknown error"}${detail ? ` (${detail})` : ""}`);
    }
    const features = page.features ?? [];
    for (const feature of features) {
      if (feature.attributes) all.push(feature.attributes);
    }
    if (!page.exceededTransferLimit && features.length < pageSize) break;
    if (features.length === 0) break;
  }

  return all;
}

function buildTractAttributes(
  populationByTract: Map<string, number | null>,
  landAreaByTract: Map<string, number | null>,
): Map<string, TractAttribute> {
  const tractIds = new Set([...populationByTract.keys(), ...landAreaByTract.keys()]);
  const result = new Map<string, TractAttribute>();
  for (const tractId of tractIds) {
    result.set(tractId, {
      tractId,
      population: populationByTract.get(tractId) ?? null,
      areaLandSqMeters: landAreaByTract.get(tractId) ?? null,
    });
  }
  return result;
}

function contextForPoint(
  point: VacancyPoint,
  tractIndex: ReturnType<typeof buildTractIndex>,
  tractAttributes: Map<string, TractAttribute>,
  walkabilityByTract: Map<string, number>,
  expresswayIndex: ReturnType<typeof buildExpresswaySpatialIndex>,
): SiteMatchmakerContextMetric {
  const lat = parseNullableNumber(point.lat);
  const lon = parseNullableNumber(point.lon);
  if (lat == null || lon == null) {
    throw new Error(`Vacancy point is missing usable coordinates for key ${siteMatchmakerContextKey(point)}`);
  }

  const tractId = findContainingTract(tractIndex, lat, lon);
  const attrs = tractId ? tractAttributes.get(tractId) : undefined;
  const nearest = nearestExpressway(expresswayIndex, lat, lon);
  const airports = airportDistances(lat, lon);

  return {
    tractId,
    population: attrs?.population ?? null,
    populationDensityPerSqMi: populationDensityPerSqMi(
      attrs?.population ?? null,
      attrs?.areaLandSqMeters ?? null,
    ),
    walkabilityIndex: tractId ? walkabilityByTract.get(tractId) ?? null : null,
    nearestExpresswayName: nearest.name,
    nearestExpresswayMiles: nearest.miles,
    midwayMiles: airports.midwayMiles,
    ohareMiles: airports.ohareMiles,
  };
}

function sources(): SiteMatchmakerContextFile["sources"] {
  return {
    population: {
      label: "U.S. Census Bureau ACS 2024 5-year total population (B01003_001E)",
      year: ACS_YEAR,
      url: ACS_POPULATION_URL,
    },
    landArea: {
      label: "U.S. Census Bureau TIGERweb ACS2024 census tract AREALAND",
      vintage: "ACS2024 TIGERweb layer 8",
      url: TIGER_TRACT_ATTRIBUTES_URL,
    },
    walkability: {
      label: "EPA National Walkability Index 2021 release using 2018 block-group inputs",
      vintage: "2021 release; GEOID20, NatWalkInd, and TotPop are 2018 block-group input fields",
      url: EPA_BASE_URL,
      method:
        "Population-weighted tract aggregation of block-group NatWalkInd, rounded to one decimal; simple mean when a tract's published block groups have no positive population weight.",
    },
    transport: {
      label: "Explorer Chicago transportation network expressway segments",
      url: "/data/transport-network.geojson",
      method:
        "Straight-line nearest expressway; local grid-indexed planar point-to-segment candidate search with geodesic final distance. No routed travel time.",
    },
    airports: {
      label: "Chicago Midway International Airport and O'Hare International Airport reference points",
      method: "Straight-line geodesic distance to airport reference coordinates.",
    },
  };
}

async function main() {
  const vacancy = readJson<VacancyIndexFile>(join(process.cwd(), "public", "data", "vacancy-index.json"));
  const tracts = readJson<GeoJsonFeatureCollection>(
    join(process.cwd(), "public", "data", "census-tracts-2024.geojson"),
  );
  const transport = readJson<GeoJsonFeatureCollection>(
    join(process.cwd(), "public", "data", "transport-network.geojson"),
  );

  console.log("Fetching ACS population, TIGER land area, and EPA walkability attributes...");
  const [populationByTract, landAreaByTract, epaBlockGroups] = await Promise.all([
    fetchAcsPopulation(),
    fetchTigerLandArea(),
    fetchEpaWalkabilityBlockGroups(),
  ]);

  const tractAttributes = buildTractAttributes(populationByTract, landAreaByTract);
  const walkabilityByTract = aggregateEpaWalkabilityToTract(epaBlockGroups);
  const tractIndex = buildTractIndex(tracts);
  const expresswayIndex = buildExpresswaySpatialIndex(transport);
  const generatedAt = new Date().toISOString();

  mkdirSync(OUT_DIR, { recursive: true });

  for (const zip of Object.keys(vacancy.editions).sort()) {
    const edition = vacancy.editions[zip];
    const points = [...(edition.sitePoints ?? []), ...(edition.landPoints ?? [])];
    const byKey = new Map<string, VacancyPoint>();
    for (const point of points) {
      byKey.set(siteMatchmakerContextKey(point), point);
    }

    const rows: Record<string, SiteMatchmakerContextMetric> = {};
    let unresolvedTractCount = 0;
    for (const key of [...byKey.keys()].sort()) {
      rows[key] = contextForPoint(
        byKey.get(key) as VacancyPoint,
        tractIndex,
        tractAttributes,
        walkabilityByTract,
        expresswayIndex,
      );
      if (rows[key].tractId === null) unresolvedTractCount += 1;
    }

    if (unresolvedTractCount > 0) {
      console.warn(
        `ZIP ${zip}: preserved ${unresolvedTractCount} rows with unresolved Census tract joins; Census and EPA fields remain null.`,
      );
    }

    const file: SiteMatchmakerContextFile = {
      version: 1,
      generatedAt,
      zip,
      sources: sources(),
      rows,
    };

    const outPath = join(OUT_DIR, `${zip}.json`);
    writeFileSync(outPath, `${JSON.stringify(file)}\n`);
    console.log(`Wrote ${Object.keys(rows).length} rows to ${outPath}`);
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function parseCensusNumber(value: unknown): number | null {
  if (typeof value !== "string" || value === "" || value.startsWith("-")) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

main().catch((error) => {
  console.error("Site Matchmaker context export failed:", error);
  process.exit(1);
});
