#!/usr/bin/env npx tsx
/**
 * Refresh public/data/library-points.json — Chicago Public Library branch
 * locations for the Site Shortlist map's infrastructure lens.
 *
 * PROVENANCE
 *   City of Chicago Socrata dataset `x8fc-8rcq` ("Libraries - Locations,
 *   Contact Information, and Usual Hours of Operation"). One row per branch,
 *   carrying a WGS84 `location` point. Only {name, lat, lon} is exported —
 *   hours and phone numbers go stale far faster than the map would be
 *   refreshed, and publishing them here would invite a reader to rely on them.
 *
 * Usage:
 *   npx tsx scripts/export-library-points.ts
 */

import {
  fetchSocrataRows,
  round5,
  tidyName,
  writeAmenityPoints,
  type AmenityPoint,
} from "./socrata-point-export";

const DATASET_ID = "x8fc-8rcq";
const OUTPUT_REL_PATH = "public/data/library-points.json";

interface LibraryRow {
  branch_?: string;
  location?: { latitude?: string; longitude?: string };
}

async function main() {
  const rows = await fetchSocrataRows<LibraryRow>(DATASET_ID, "branch_,location", 500);

  let points: AmenityPoint[] | null = null;
  if (rows) {
    const seen = new Set<string>();
    points = [];
    for (const row of rows) {
      const rawName = (row.branch_ ?? "").toString().trim();
      const lat = Number(row.location?.latitude);
      const lon = Number(row.location?.longitude);
      if (!rawName || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const name = `${tidyName(rawName)} Branch`;
      if (seen.has(name)) continue;
      seen.add(name);
      points.push({ name, lat: round5(lat), lon: round5(lon) });
    }
    points.sort((a, b) => a.name.localeCompare(b.name));
  }

  process.exit(
    writeAmenityPoints(
      OUTPUT_REL_PATH,
      {
        source: `data.cityofchicago.org/${DATASET_ID}`,
        note: "Chicago Public Library branch locations. Names and coordinates only — hours and contact details are deliberately not carried here.",
        points,
      },
      "library-points",
    ),
  );
}

void main();
