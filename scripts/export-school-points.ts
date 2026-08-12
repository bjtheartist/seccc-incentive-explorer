#!/usr/bin/env npx tsx
/**
 * Refresh public/data/school-points.json — Chicago Public Schools locations
 * for the Site Shortlist map's infrastructure lens.
 *
 * PROVENANCE
 *   City of Chicago Socrata dataset `pb6d-zzuh` ("Chicago Public Schools -
 *   School Locations SY2526") — the most recent school-year edition the City
 *   publishes. CPS mints a NEW dataset id each school year rather than updating one
 *   in place, so refreshing this layer next year means changing DATASET_ID to
 *   the new SY id, not just re-running the script. The id is recorded in the
 *   output's `source` field so the vintage on disk is always auditable.
 *
 *   Only district-published CPS locations are here. Charter, private, and
 *   parochial schools the City does not publish in this table are absent, and
 *   the map legend says "public schools" for exactly that reason.
 *
 * Usage:
 *   npx tsx scripts/export-school-points.ts
 */

import {
  fetchSocrataRows,
  round5,
  tidyName,
  writeAmenityPoints,
  type AmenityPoint,
} from "./socrata-point-export";

const DATASET_ID = "pb6d-zzuh";
const OUTPUT_REL_PATH = "public/data/school-points.json";

interface SchoolRow {
  short_name?: string;
  lat?: string | number;
  long?: string | number;
}

async function main() {
  const rows = await fetchSocrataRows<SchoolRow>(DATASET_ID, "short_name,lat,long", 500);

  let points: AmenityPoint[] | null = null;
  if (rows) {
    const seen = new Set<string>();
    points = [];
    for (const row of rows) {
      const rawName = (row.short_name ?? "").toString().trim();
      const lat = Number(row.lat);
      const lon = Number(row.long);
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
        note: "Chicago Public Schools locations, school year 2025-26 edition. District-published locations only; charter, private, and parochial schools outside this table are not shown.",
        points,
      },
      "school-points",
    ),
  );
}

void main();
