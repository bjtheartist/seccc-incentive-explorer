#!/usr/bin/env npx tsx
/**
 * Builds a Chicago community-area -> ZIP lookup by point-in-polygon testing
 * each community area's centroid (lib/community-areas.ts) against Chicago
 * ZIP boundaries.
 *
 * IMPORTANT — this is a many-to-one, centroid-only mapping. A community area
 * can span several ZIPs; this script only records the ZIP that CONTAINS the
 * centroid point. It exists to give the neighborhood pages a single
 * representative ZIP to key into the citywide corridor-metrics export
 * (lib/corridor-citywide.ts), not to model corridor/ZIP boundaries exactly.
 *
 * The point-in-ring / point-in-multipolygon helpers below are copied
 * verbatim from scripts/compute-corridor-aggregate.ts (intentionally
 * duplicated, not imported/refactored, per that script's own standalone
 * design).
 *
 * Usage:
 *   npx tsx scripts/build-ca-zip-map.ts
 *
 * Output: data/exports/community-area-zip.json
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { socrataHeaders } from "../lib/socrata";
import { CHICAGO_COMMUNITY_AREAS } from "../lib/community-areas";

const ZIP_BOUNDARIES_URL =
  "https://data.cityofchicago.org/resource/unjd-c2ca.json";

type Ring = Array<[number, number]>;

interface ZipBoundary {
  zip: string;
  coords: Ring[][][]; // MultiPolygon coordinates
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
}

// ── copied verbatim from scripts/compute-corridor-aggregate.ts ──
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
// ── end copied block ──

async function soda<T>(base: string, params: Record<string, string>): Promise<T> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `${base}?${qs}`;
  const res = await fetch(url, {
    headers: socrataHeaders(),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function fetchZipBoundaries(): Promise<ZipBoundary[]> {
  const rows = await soda<Array<{ zip?: string; the_geom?: { type: string; coordinates: unknown } }>>(
    ZIP_BOUNDARIES_URL,
    { $limit: "200" },
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

function zipForPoint(lat: number, lon: number, boundaries: ZipBoundary[]): string | null {
  for (const b of boundaries) {
    if (lon < b.bbox.minLon || lon > b.bbox.maxLon || lat < b.bbox.minLat || lat > b.bbox.maxLat) continue;
    if (pointInMultiPolygon(lon, lat, b.coords)) return b.zip;
  }
  return null;
}

/** Max distance a centroid may sit outside every ZIP polygon and still be
 * assigned to the nearest one. Riverdale's centroid lands in an industrial
 * gap the city ZIP boundaries don't cover; beyond ~3km a match would be
 * meaningless rather than merely approximate. */
const NEAREST_FALLBACK_MAX_KM = 3;

/** Curated assignments that beat geometry. Riverdale (CA 54): the nearest
 * polygons are a coin flip (60628 at 0.76km vs 60827 at 0.81km), but the
 * community area's residential core — Altgeld Gardens / Eden Green — is
 * 60827; 60628 is Roseland, the neighboring area. */
const MANUAL_OVERRIDES: Record<number, string> = {
  54: "60827",
};

function nearestZip(
  lat: number,
  lon: number,
  boundaries: ZipBoundary[]
): { zip: string; distanceKm: number } | null {
  const lonScale = Math.cos((lat * Math.PI) / 180);
  let best: { zip: string; distanceKm: number } | null = null;
  for (const b of boundaries) {
    for (const polygon of b.coords) {
      for (const [vLon, vLat] of polygon[0] as unknown as Ring) {
        const dx = (vLon - lon) * lonScale * 111.32;
        const dy = (vLat - lat) * 110.57;
        const distanceKm = Math.sqrt(dx * dx + dy * dy);
        if (!best || distanceKm < best.distanceKm) {
          best = { zip: b.zip, distanceKm };
        }
      }
    }
  }
  return best && best.distanceKm <= NEAREST_FALLBACK_MAX_KM ? best : null;
}

async function main() {
  const outPath = join(process.cwd(), "data/exports/community-area-zip.json");

  console.log("Fetching Chicago ZIP boundaries...");
  const boundaries = await fetchZipBoundaries();
  console.log(`${boundaries.length} ZIP boundaries loaded`);

  const out: Record<string, unknown> = {};
  const unmapped: string[] = [];
  const nearestFallbacks: string[] = [];

  const overridden: string[] = [];

  for (const ca of CHICAGO_COMMUNITY_AREAS) {
    const override = MANUAL_OVERRIDES[ca.id];
    if (override) {
      out[String(ca.id)] = override;
      overridden.push(`CA ${ca.id} (${ca.name}) -> ${override} via manual override`);
      console.log(`  ${overridden[overridden.length - 1]}`);
      continue;
    }
    const zip = zipForPoint(ca.lat, ca.lon, boundaries);
    if (zip) {
      out[String(ca.id)] = zip;
      continue;
    }
    const nearest = nearestZip(ca.lat, ca.lon, boundaries);
    if (nearest) {
      out[String(ca.id)] = nearest.zip;
      nearestFallbacks.push(
        `CA ${ca.id} (${ca.name}) -> ${nearest.zip} via nearest polygon, ${nearest.distanceKm.toFixed(2)}km`,
      );
      console.log(`  ${nearestFallbacks[nearestFallbacks.length - 1]}`);
    } else {
      unmapped.push(`${ca.id} (${ca.name})`);
      console.log(`  no ZIP match for CA ${ca.id} (${ca.name}) at ${ca.lat},${ca.lon}`);
    }
  }

  out._meta = {
    generatedAt: new Date().toISOString(),
    method:
      "centroid point-in-polygon; a community area can span multiple ZIPs — this is the centroid's ZIP only. Centroids outside every polygon fall back to the nearest polygon within " +
      `${NEAREST_FALLBACK_MAX_KM}km. Manual overrides beat geometry where the nearest polygon misrepresents the area.`,
    nearestFallbacks,
    manualOverrides: overridden,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(
    `\nWrote ${CHICAGO_COMMUNITY_AREAS.length - unmapped.length}/${CHICAGO_COMMUNITY_AREAS.length} community areas -> ${outPath}`,
  );
  if (unmapped.length > 0) {
    console.log(`Unmapped: ${unmapped.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("build-ca-zip-map failed:", err);
  process.exit(1);
});
