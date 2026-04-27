#!/usr/bin/env npx tsx
/**
 * Fetch 2024 ACS 5-year tract data for Cook County and join it to
 * Census TIGERweb 2024 tract geometries.
 *
 * By default this writes a static GeoJSON fallback to:
 *   public/data/census-tracts-2024.geojson
 *
 * If DATABASE_URL is set, it also upserts the same records into
 * census_tracts for PostGIS lookup.
 *
 * Sources:
 *   ACS: https://api.census.gov/data/2024/acs/acs5
 *   TIGERweb: https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { neon } from "@neondatabase/serverless";

const ACS_YEAR = "2024";
const STATE = "17";
const COUNTY = "031";
const OUT_PATH = join(process.cwd(), "public", "data", "census-tracts-2024.geojson");

interface AcsRecord {
  tractId: string;
  name: string;
  population: number | null;
  medianIncome: number | null;
  medianHomeValue: number | null;
}

interface GeoJSONFeature {
  type: "Feature";
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
}

interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
  metadata?: Record<string, unknown>;
}

function parseNumber(value: unknown): number | null {
  if (typeof value !== "string" || value === "" || value.startsWith("-")) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchJson<T>(url: string, retries = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        throw new Error(`Fetch failed ${res.status}: ${url}`);
      }
      return res.json() as Promise<T>;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delayMs = 1000 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

async function fetchAcsData(): Promise<Map<string, AcsRecord>> {
  const url = new URL(`https://api.census.gov/data/${ACS_YEAR}/acs/acs5`);
  url.searchParams.set("get", "NAME,B01003_001E,B19013_001E,B25077_001E");
  url.searchParams.set("for", "tract:*");
  url.searchParams.set("in", `state:${STATE} county:${COUNTY}`);

  const rows = await fetchJson<string[][]>(url.toString());
  const [header, ...records] = rows;
  const idx = Object.fromEntries(header.map((key, i) => [key, i]));

  const byTract = new Map<string, AcsRecord>();
  for (const row of records) {
    const tractId = `${row[idx.state]}${row[idx.county]}${row[idx.tract]}`;
    byTract.set(tractId, {
      tractId,
      name: row[idx.NAME],
      population: parseNumber(row[idx.B01003_001E]),
      medianIncome: parseNumber(row[idx.B19013_001E]),
      medianHomeValue: parseNumber(row[idx.B25077_001E]),
    });
  }

  return byTract;
}

async function fetchTractGeometries(): Promise<GeoJSONFeature[]> {
  const all: GeoJSONFeature[] = [];
  const pageSize = 500;

  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(
      "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer/8/query"
    );
    url.searchParams.set("where", `STATE='${STATE}' AND COUNTY='${COUNTY}'`);
    url.searchParams.set("outFields", "GEOID,NAME,STATE,COUNTY,TRACT");
    url.searchParams.set("returnGeometry", "true");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("f", "geojson");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(pageSize));

    const page = await fetchJson<GeoJSONFeatureCollection>(url.toString());
    all.push(...page.features);
    if (page.features.length < pageSize) break;
  }

  return all;
}

function buildFeatureCollection(
  geometries: GeoJSONFeature[],
  acsByTract: Map<string, AcsRecord>
): GeoJSONFeatureCollection {
  const features: GeoJSONFeature[] = [];

  for (const feature of geometries) {
    const tractId = String(feature.properties.GEOID || "");
    const acs = acsByTract.get(tractId);
    if (!tractId || !acs) continue;

    features.push({
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        tractId,
        name: acs.name,
        acsYear: ACS_YEAR,
        medianIncome: acs.medianIncome,
        medianHomeValue: acs.medianHomeValue,
        population: acs.population,
      },
    });
  }

  return {
    type: "FeatureCollection",
    metadata: {
      acsYear: ACS_YEAR,
      geography: "Cook County, Illinois census tracts",
      sources: [
        "https://api.census.gov/data/2024/acs/acs5",
        "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer",
      ],
      variables: {
        B01003_001E: "Total population",
        B19013_001E: "Median household income",
        B25077_001E: "Median home value",
      },
    },
    features,
  };
}

async function upsertDatabase(collection: GeoJSONFeatureCollection) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("DATABASE_URL not set; wrote static file only.");
    return;
  }

  const sql = neon(databaseUrl);
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
  await sql`
    CREATE TABLE IF NOT EXISTS census_tracts (
      tract_id TEXT PRIMARY KEY,
      median_income INTEGER,
      median_home_value INTEGER,
      population INTEGER,
      walk_score INTEGER,
      acs_year TEXT,
      geom GEOGRAPHY,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE census_tracts ADD COLUMN IF NOT EXISTS acs_year TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_census_tracts_geom ON census_tracts USING GIST (geom)`;

  for (const feature of collection.features) {
    const p = feature.properties;
    await sql`
      INSERT INTO census_tracts (
        tract_id, median_income, median_home_value, population, acs_year, geom, updated_at
      )
      VALUES (
        ${p.tractId as string},
        ${p.medianIncome as number | null},
        ${p.medianHomeValue as number | null},
        ${p.population as number | null},
        ${ACS_YEAR},
        ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}), 4326)::geography,
        NOW()
      )
      ON CONFLICT (tract_id) DO UPDATE SET
        median_income = EXCLUDED.median_income,
        median_home_value = EXCLUDED.median_home_value,
        population = EXCLUDED.population,
        acs_year = EXCLUDED.acs_year,
        geom = EXCLUDED.geom,
        updated_at = NOW()
    `;
  }

  console.log(`Upserted ${collection.features.length} census tracts into census_tracts.`);
}

async function main() {
  console.log("Fetching 2024 ACS 5-year tract data...");
  const acsByTract = await fetchAcsData();
  console.log(`Fetched ${acsByTract.size} ACS tract records.`);

  console.log("Fetching 2024 TIGERweb tract geometries...");
  const geometries = await fetchTractGeometries();
  console.log(`Fetched ${geometries.length} tract geometries.`);

  const collection = buildFeatureCollection(geometries, acsByTract);
  mkdirSync(join(process.cwd(), "public", "data"), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(collection));
  console.log(`Wrote ${collection.features.length} joined features to ${OUT_PATH}.`);

  await upsertDatabase(collection);
}

main().catch((err) => {
  console.error("Census seed failed:", err);
  process.exit(1);
});
