#!/usr/bin/env npx tsx
/**
 * Refresh public/data/grocery-points.json — grocery store locations for the
 * Site Shortlist map's infrastructure lens.
 *
 * PROVENANCE — AND THE STALENESS THAT GOVERNS THE LABEL
 *   City of Chicago Socrata dataset `3e26-zek2` ("Grocery Store Status -
 *   Historical"). The City stopped maintaining this table years ago: the most
 *   recent `last_updated` value in it predates this export by several years.
 *   Stores have opened and closed since, and the file cannot know which.
 *
 *   That is why the map legend labels the toggle "Grocery (city dataset, may
 *   lag)" rather than "Grocery stores", and why the newest `last_updated` in
 *   the source is carried into the output's `note`. A dot here means the City
 *   recorded a store at this point as of that vintage — not that a store is
 *   open there today. Do not relabel this layer without keeping that caveat.
 *
 *   Rows whose status is not OPEN as of the snapshot are dropped: a permanently
 *   closed store is a worse signal than no dot at all.
 *
 * Usage:
 *   npx tsx scripts/export-grocery-points.ts
 */

import {
  fetchSocrataRows,
  round5,
  tidyName,
  writeAmenityPoints,
  type AmenityPoint,
} from "./socrata-point-export";

const DATASET_ID = "3e26-zek2";
const OUTPUT_REL_PATH = "public/data/grocery-points.json";

interface GroceryRow {
  store_name?: string;
  new_status?: string;
  last_updated?: string;
  location?: { coordinates?: [number, number] };
}

async function main() {
  const rows = await fetchSocrataRows<GroceryRow>(
    DATASET_ID,
    "store_name,new_status,last_updated,location",
    500,
  );

  let points: AmenityPoint[] | null = null;
  let newestUpdate = "";
  if (rows) {
    const seen = new Set<string>();
    points = [];
    for (const row of rows) {
      const updated = (row.last_updated ?? "").toString().slice(0, 10);
      if (updated > newestUpdate) newestUpdate = updated;

      const status = (row.new_status ?? "").toString().trim().toUpperCase();
      if (status !== "OPEN") continue;

      const rawName = (row.store_name ?? "").toString().trim();
      const coords = row.location?.coordinates;
      const lon = Number(coords?.[0]);
      const lat = Number(coords?.[1]);
      if (!rawName || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const name = tidyName(rawName);
      const dedupeKey = `${name}@${lat.toFixed(4)},${lon.toFixed(4)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      points.push({ name, lat: round5(lat), lon: round5(lon) });
    }
    points.sort((a, b) => a.name.localeCompare(b.name));
  }

  process.exit(
    writeAmenityPoints(
      OUTPUT_REL_PATH,
      {
        source: `data.cityofchicago.org/${DATASET_ID}`,
        note:
          `Grocery stores the City recorded as OPEN in a dataset it no longer maintains` +
          `${newestUpdate ? ` (most recent record ${newestUpdate})` : ""}. ` +
          `Openings and closings since are not reflected — verify before relying on any dot.`,
        points,
      },
      "grocery-points",
    ),
  );
}

void main();
