/**
 * Shared plumbing for the committed AMENITY POINT exports that back the Site
 * Shortlist map's infrastructure lens (parks, libraries, public schools,
 * grocery stores).
 *
 * Every one of those layers is the same shape — a small Socrata table reduced
 * to a point per place — so the fetch, the auth headers, the "never write an
 * empty file over a good one" rule, and the output envelope live here once.
 * The per-dataset scripts stay thin: a dataset id, a row mapper, and a name.
 *
 * DOCTRINE (mirrors scripts/export-rail-stations.ts):
 *   - Network failure is NOT fatal and NEVER destructive. When a fetch fails
 *     the existing committed file is kept as-is and the run says so. A stale
 *     screening input beats an empty one, and an empty one beats a fabricated
 *     one — these scripts never synthesize a row.
 *   - The output records its own provenance (`source` = the Socrata dataset
 *     id) so a reader can audit exactly which table a dot came from.
 *   - Coordinates are rounded to 5 decimals (~1 m). These are locator points
 *     for a neighborhood-context overlay, not survey positions, and the
 *     rounding is what keeps every file comfortably small.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SOCRATA_DOMAIN = "data.cityofchicago.org";

/** One committed amenity point. `acres` is carried only where the source
 *  publishes it (parks); every other layer is name/lat/lon only. */
export interface AmenityPoint {
  name: string;
  lat: number;
  lon: number;
  acres?: number;
}

export interface AmenityPointsFile {
  generatedAt: string;
  /** The Socrata dataset id this file was reduced from, e.g. "ejsh-fztr". */
  source: string;
  /** Plain-language note about what the points are and are not. */
  note: string;
  points: AmenityPoint[];
}

export function socrataHeaders(): Record<string, string> {
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

/** Fetch every row of a Socrata resource, paging until the table runs out. */
export async function fetchSocrataRows<T>(
  datasetId: string,
  select: string,
  pageSize = 1000,
): Promise<T[] | null> {
  const rows: T[] = [];
  for (let offset = 0; offset < 20_000; offset += pageSize) {
    const url =
      `https://${SOCRATA_DOMAIN}/resource/${datasetId}.json` +
      `?$select=${encodeURIComponent(select)}&$limit=${pageSize}&$offset=${offset}`;
    try {
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) return null;
      const page = (await res.json()) as T[];
      if (!Array.isArray(page)) return null;
      rows.push(...page);
      if (page.length < pageSize) break;
    } catch {
      return null;
    }
  }
  return rows;
}

/** ~1 m precision. Enough for a context dot, small enough to keep files tiny. */
export function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

/**
 * Write the export, or keep what is already committed when the fetch produced
 * nothing. Returns a process exit code: 0 on any outcome that leaves a usable
 * file on disk, 1 only when there is neither fresh data nor a committed file.
 */
export function writeAmenityPoints(
  outputRelPath: string,
  file: Omit<AmenityPointsFile, "generatedAt" | "points"> & { points: AmenityPoint[] | null },
  label: string,
): number {
  const outputPath = path.join(process.cwd(), outputRelPath);

  if (file.points === null || file.points.length === 0) {
    if (existsSync(outputPath)) {
      let existingCount = 0;
      try {
        const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as AmenityPointsFile;
        existingCount = Array.isArray(parsed?.points) ? parsed.points.length : 0;
      } catch {
        existingCount = 0;
      }
      console.warn(
        `[${label}] fetch produced no rows — keeping the ${existingCount} committed points already on disk`,
      );
      return 0;
    }
    console.error(
      `[${label}] fetch produced no rows and no committed file exists. Refusing to write an empty file.`,
    );
    return 1;
  }

  const output: AmenityPointsFile = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: file.source,
    note: file.note,
    points: file.points,
  };
  writeFileSync(outputPath, JSON.stringify(output));
  const kb = Math.round(Buffer.byteLength(JSON.stringify(output)) / 1024);
  console.log(`[${label}] wrote ${output.points.length} points (${kb} KB) -> ${outputPath}`);
  return 0;
}

/**
 * Area-weighted centroid of a GeoJSON Polygon/MultiPolygon, used to reduce a
 * park BOUNDARY to one locator dot. The shoelace centroid of the largest ring
 * is deliberate: a park's outer ring is what a reader recognizes, and averaging
 * across a MultiPolygon's disjoint parts can land the dot outside every part.
 *
 * Returns null for geometry that is missing, degenerate, or zero-area.
 */
export function polygonCentroid(geometry: unknown): { lat: number; lon: number } | null {
  const geom = geometry as { type?: string; coordinates?: unknown };
  if (!geom || typeof geom.type !== "string") return null;

  const rings: [number, number][][] = [];
  if (geom.type === "Polygon") {
    const coords = geom.coordinates as [number, number][][] | undefined;
    if (Array.isArray(coords) && Array.isArray(coords[0])) rings.push(coords[0]);
  } else if (geom.type === "MultiPolygon") {
    const coords = geom.coordinates as [number, number][][][] | undefined;
    for (const polygon of coords ?? []) {
      if (Array.isArray(polygon) && Array.isArray(polygon[0])) rings.push(polygon[0]);
    }
  } else {
    return null;
  }

  let best: { area: number; lat: number; lon: number } | null = null;
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    let twiceArea = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % ring.length];
      if (![x0, y0, x1, y1].every((n) => Number.isFinite(n))) return null;
      const cross = x0 * y1 - x1 * y0;
      twiceArea += cross;
      x += (x0 + x1) * cross;
      y += (y0 + y1) * cross;
    }
    if (twiceArea === 0) continue;
    const area = Math.abs(twiceArea / 2);
    const candidate = { area, lon: x / (3 * twiceArea), lat: y / (3 * twiceArea) };
    if (!best || candidate.area > best.area) best = candidate;
  }

  if (!best || !Number.isFinite(best.lat) || !Number.isFinite(best.lon)) return null;
  return { lat: best.lat, lon: best.lon };
}

/** "MCGUANE (JOHN)" -> "McGuane (John)"; leaves already-cased names alone. */
export function tidyName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!/[a-z]/.test(trimmed)) {
    return trimmed
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase())
      .replace(/\b(Hs|Es|Cps|Ii|Iii|Iv|Jr|Sr|Mlk|Ymca|Nw|Ne|Sw|Se)\b/g, (m) => m.toUpperCase());
  }
  return trimmed;
}
