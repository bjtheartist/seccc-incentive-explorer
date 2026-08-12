#!/usr/bin/env npx tsx
/**
 * Refresh public/data/park-points.json — one locator point per Chicago Park
 * District park, for the Site Shortlist map's infrastructure lens.
 *
 * PROVENANCE
 *   Chicago Park District parks — City of Chicago Socrata dataset `ejsh-fztr`
 *   ("CPD_Parks"). Each row is a park BOUNDARY (MultiPolygon) plus a name and
 *   an acreage. This export reduces each boundary to the area-weighted centroid
 *   of its largest ring and keeps only {name, acres, lat, lon}, which is what
 *   the overlay draws and all it is entitled to imply: a park is HERE, roughly.
 *   The dot is a locator, not an entrance, not a boundary, not an address.
 *
 * Usage:
 *   npx tsx scripts/export-park-points.ts
 *
 * A failed fetch keeps the committed file untouched (see socrata-point-export).
 */

import {
  fetchSocrataRows,
  polygonCentroid,
  round5,
  tidyName,
  writeAmenityPoints,
  type AmenityPoint,
} from "./socrata-point-export";

const DATASET_ID = "ejsh-fztr";
const OUTPUT_REL_PATH = "public/data/park-points.json";

interface ParkRow {
  park?: string;
  label?: string;
  acres?: string | number;
  the_geom?: unknown;
}

async function main() {
  const rows = await fetchSocrataRows<ParkRow>(DATASET_ID, "park,label,acres,the_geom", 500);

  let points: AmenityPoint[] | null = null;
  if (rows) {
    const seen = new Set<string>();
    points = [];
    for (const row of rows) {
      const rawName = (row.label ?? row.park ?? "").toString().trim();
      if (!rawName) continue;
      const centroid = polygonCentroid(row.the_geom);
      if (!centroid) continue;
      const name = tidyName(rawName);
      const dedupeKey = `${name}@${centroid.lat.toFixed(4)},${centroid.lon.toFixed(4)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      // Round FIRST, then test: a 0.04-acre sliver rounds to 0.0, and an
      // acreage of zero reads as a claim ("this park has no area") rather than
      // as the absence of a publishable figure. Omit it instead.
      const acres = Math.round(Number(row.acres) * 10) / 10;
      points.push({
        name,
        lat: round5(centroid.lat),
        lon: round5(centroid.lon),
        ...(Number.isFinite(acres) && acres > 0 ? { acres } : {}),
      });
    }
    points.sort((a, b) => a.name.localeCompare(b.name));
  }

  process.exit(
    writeAmenityPoints(
      OUTPUT_REL_PATH,
      {
        source: `data.cityofchicago.org/${DATASET_ID}`,
        note: "Chicago Park District parks, reduced to one locator point per park (area-weighted centroid of the park boundary). Not an entrance, address, or boundary.",
        points,
      },
      "park-points",
    ),
  );
}

void main();
