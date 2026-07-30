/**
 * The STARRED demarcation on the Property Map — pure feature/paint construction,
 * kept out of VacancyReportMap so it is testable without the mapbox runtime.
 *
 * Visual language: a gold ANNULUS drawn BENEATH the dots, wide enough that the
 * dot's own fill and its distress ring stay fully readable inside it. That is
 * what keeps it from colliding with anything already on the map:
 *   • owner-type FILLS (blue / purple / orange / green / gray) are inside it;
 *   • the tax-sale DISTRESS ring (#DC2626) hugs the dot at r≈7–9, while the
 *     halo sits at r=12 (dots) / r=16 (numbered featured discs), so a starred
 *     tax-sale site reads as "red ring, then gold halo", not as one muddled
 *     ring;
 *   • the halo color (STARRED_RING, amber-700) is in neither palette.
 */

import { STARRED_RING, siteStarKey } from "@/lib/vacancy-starred";

/** Halo radius for an ordinary owner-type dot (dot r=7 + stroke ≤2). */
export const STARRED_HALO_RADIUS = 12;
/** Halo radius for a numbered featured-site disc (disc r=11 + stroke 2). */
export const STARRED_MARKER_HALO_RADIUS = 16;
/** Fill opacity of the halo disc — a tint, never enough to mute the basemap. */
export const STARRED_HALO_FILL_OPACITY = 0.16;

/**
 * Build the halo features for the currently PLOTTED dots that are starred.
 *
 * `plotted` is the exact filtered set on the map, so a starred site hidden by an
 * owner-type or distress filter shows no orphan halo. `markers` are the numbered
 * featured discs (tracked view only), which get the larger radius; when a marker
 * and a dot share a coordinate the marker wins, so a starred featured site gets
 * ONE halo sized to the disc rather than two stacked rings.
 */
export function starredHaloFeatures(
  plotted: readonly GeoJSON.Feature[],
  markers: readonly GeoJSON.Feature[],
  starredKeys: ReadonlySet<string>,
  includeMarkers: boolean,
): GeoJSON.Feature[] {
  if (starredKeys.size === 0) return [];

  const byCoordinate = new Map<string, GeoJSON.Feature>();

  const add = (feature: GeoJSON.Feature, isMarker: boolean) => {
    const geometry = feature.geometry;
    if (!geometry || geometry.type !== "Point") return;
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const key = siteStarKey({
      pin: typeof props.pin === "string" ? props.pin : null,
      address: typeof props.address === "string" ? props.address : null,
    });
    if (!key || !starredKeys.has(key)) return;

    const [lon, lat] = geometry.coordinates as [number, number];
    const coordinateKey = `${lon.toFixed(6)},${lat.toFixed(6)}`;
    const existing = byCoordinate.get(coordinateKey);
    // A marker upgrades a dot at the same spot; a dot never downgrades a marker.
    if (existing && !isMarker) return;
    byCoordinate.set(coordinateKey, {
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { isMarker },
    });
  };

  for (const feature of plotted) add(feature, false);
  if (includeMarkers) for (const feature of markers) add(feature, true);

  return Array.from(byCoordinate.values());
}

/** The halo circle layer's paint — one place so the test can assert the palette. */
export function starredHaloPaint() {
  return {
    "circle-color": STARRED_RING,
    "circle-opacity": STARRED_HALO_FILL_OPACITY,
    "circle-radius": [
      "case",
      ["==", ["get", "isMarker"], true],
      STARRED_MARKER_HALO_RADIUS,
      STARRED_HALO_RADIUS,
    ],
    "circle-stroke-width": 2,
    "circle-stroke-color": STARRED_RING,
    "circle-stroke-opacity": 0.95,
  } as const;
}
