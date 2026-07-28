/**
 * Point-in-polygon community-area assignment — the pure, testable core behind
 * the export script's CA stamping (scripts/export-community-investment.ts).
 *
 * Kept out of the script itself so a unit test can exercise the assignment
 * against the committed City boundary file with known coordinates, and so the
 * script's `main()` is not executed as a side effect of importing it.
 *
 * Server-only: loadCommunityAreaPolygons reads the boundary file with `node:fs`.
 * assignCommunityArea is pure (polygons in, name out) and needs no fs.
 */

import { readFileSync } from "node:fs";
import { bbox, booleanPointInPolygon } from "@turf/turf";
import { CHICAGO_COMMUNITY_AREAS } from "./community-areas";

/** One community-area polygon, keyed to its canonical title-case name, with a
 * cached bounding box for a cheap pre-filter before the ray-cast. */
export interface CommunityAreaPolygon {
  name: string;
  /** [minLng, minLat, maxLng, maxLat] */
  bounds: [number, number, number, number];
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
}

/** Canonical CA name by official area number (1..77). */
const CA_NAME_BY_NUMBER = new Map<number, string>(CHICAGO_COMMUNITY_AREAS.map((ca) => [ca.id, ca.name]));
/** Canonical CA name by UPPER-CASED name — a fallback if the area number is
 * ever unmapped (matches the boundary file's own `community` field). */
const CA_NAME_BY_UPPER = new Map<string, string>(
  CHICAGO_COMMUNITY_AREAS.map((ca) => [ca.name.toUpperCase(), ca.name]),
);

/**
 * Load Chicago's community-area polygons from a boundary GeoJSON file (the
 * committed public/data/community-areas.geojson, City dataset igwz-8jzy), each
 * mapped to the canonical title-case name via its official area number. Skips
 * any feature that carries neither a mappable number nor a known name.
 */
export function loadCommunityAreaPolygons(geojsonPath: string): CommunityAreaPolygon[] {
  const raw = JSON.parse(readFileSync(geojsonPath, "utf8")) as {
    features?: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>>;
  };
  const features = raw.features ?? [];
  const out: CommunityAreaPolygon[] = [];
  for (const feature of features) {
    const props = feature.properties ?? {};
    const num = Number(props.area_numbe ?? props.area_num_1);
    const upperName = typeof props.community === "string" ? props.community.trim().toUpperCase() : "";
    const name = CA_NAME_BY_NUMBER.get(num) ?? CA_NAME_BY_UPPER.get(upperName) ?? null;
    if (!name || !feature.geometry) continue;
    out.push({ name, bounds: bbox(feature) as [number, number, number, number], feature });
  }
  return out;
}

/**
 * Assign a point to its Chicago community area, or null when it falls outside
 * every one (a point on the lake, an inter-CA gap, a slightly-off geocode near
 * the city edge). A bbox pre-filter skips non-candidate polygons before the
 * point-in-polygon test. Pure / deterministic — first match in `polygons` order
 * wins (the boundaries do not overlap, so at most one matches).
 */
export function assignCommunityArea(
  lng: number,
  lat: number,
  polygons: readonly CommunityAreaPolygon[],
): string | null {
  for (const ca of polygons) {
    const [minLng, minLat, maxLng, maxLat] = ca.bounds;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    if (booleanPointInPolygon([lng, lat], ca.feature)) return ca.name;
  }
  return null;
}
