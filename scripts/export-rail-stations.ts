#!/usr/bin/env npx tsx
/**
 * Refresh public/data/rail-stations.json — the committed CTA + Metra station
 * coordinates the /vacancy/[zip]/shortlist rail screen runs against.
 *
 * PROVENANCE (both halves, stated so the file is refreshable and auditable):
 *
 *   CTA 'L' stations — City of Chicago Socrata dataset `8pix-ypme`
 *     ("CTA - System Information - List of 'L' Stops"). Fetched live here.
 *     Each row carries a `location` point in WGS84 and an `ada` flag. The
 *     dataset is one row per STOP (two per platform direction, plus separate
 *     rows per entrance), so rows are deduplicated by station name.
 *
 *   Metra stations — City of Chicago Metra station shapefile, reprojected from
 *     EPSG:3435 (Illinois State Plane East, US feet) to WGS84. Socrata does not
 *     publish a Metra point dataset the City maintains, so this half is a
 *     COMMITTED SNAPSHOT carried in the existing rail-stations.json rather than
 *     refetched. This script preserves every `system` that is not "CTA" from
 *     the file already on disk, so a CTA refresh never silently drops Metra.
 *     To refresh the Metra half, re-export the shapefile and replace those
 *     rows; the `sources` block records which vintage is in the file.
 *
 * Usage:
 *   npx tsx scripts/export-rail-stations.ts
 *
 * Network failure is not fatal: the existing CTA rows are kept and the run
 * reports that it reused them. This file is a screening input, and a stale
 * station list is far better than an empty one.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUTPUT_PATH = path.join(process.cwd(), "public/data/rail-stations.json");

const CTA_SOURCE = "data.cityofchicago.org/8pix-ypme";
const METRA_SOURCE = "City of Chicago Metra station shapefile (EPSG:3435->WGS84)";

interface Station {
  name: string;
  system: string;
  lat: number;
  lon: number;
  ada: boolean | null;
}

interface RailStationsFile {
  generatedAt: string;
  sources: string[];
  stations: Station[];
}

interface CtaStopRow {
  station_name?: string;
  ada?: boolean | string;
  location?: { latitude?: string; longitude?: string };
}

function readExisting(): RailStationsFile | null {
  if (!existsSync(OUTPUT_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(OUTPUT_PATH, "utf8")) as RailStationsFile;
    return Array.isArray(parsed?.stations) ? parsed : null;
  } catch {
    return null;
  }
}

function socrataHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const keyId = process.env.SOCRATA_KEY_ID;
  const keySecret = process.env.SOCRATA_KEY_SECRET;
  if (keyId && keySecret) {
    headers.Authorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
    return headers;
  }
  if (process.env.SOCRATA_APP_TOKEN) {
    headers["X-App-Token"] = process.env.SOCRATA_APP_TOKEN;
  }
  return headers;
}

/** One row per station name, deduplicated across stop/entrance rows. */
async function fetchCtaStations(): Promise<Station[] | null> {
  const url =
    `https://${CTA_SOURCE.split("/")[0]}/resource/8pix-ypme.json` +
    `?$limit=400&$select=station_name,location,ada`;
  try {
    const res = await fetch(url, {
      headers: socrataHeaders(),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as CtaStopRow[];
    const seen = new Set<string>();
    const stations: Station[] = [];
    for (const row of rows) {
      const name = row.station_name?.trim();
      const lat = Number(row.location?.latitude);
      const lon = Number(row.location?.longitude);
      if (!name || seen.has(name) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      seen.add(name);
      stations.push({
        name,
        system: "CTA",
        lat,
        lon,
        ada: row.ada === true || row.ada === "true",
      });
    }
    return stations.length > 0 ? stations : null;
  } catch {
    return null;
  }
}

async function main() {
  const existing = readExisting();
  const existingCta = existing?.stations.filter((s) => s.system === "CTA") ?? [];
  const metra = existing?.stations.filter((s) => s.system !== "CTA") ?? [];

  const fetched = await fetchCtaStations();
  const cta = fetched ?? existingCta;
  if (!fetched) {
    console.warn(
      `[rail-stations] CTA fetch failed — reusing ${existingCta.length} committed CTA rows`,
    );
  }

  if (cta.length === 0 && metra.length === 0) {
    console.error(
      "[rail-stations] no stations available (network down and no committed file). Refusing to write an empty file.",
    );
    process.exit(1);
  }

  const output: RailStationsFile = {
    generatedAt: new Date().toISOString().slice(0, 10),
    sources: [CTA_SOURCE, METRA_SOURCE],
    stations: [...cta, ...metra],
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 1));
  console.log(
    `[rail-stations] wrote ${output.stations.length} stations (${cta.length} CTA, ${metra.length} Metra) -> ${OUTPUT_PATH}`,
  );
}

void main();
