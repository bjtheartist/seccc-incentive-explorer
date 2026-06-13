import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, LineString } from "geojson";

/**
 * Logistics access uses straight-line distances from a point to the nearest
 * expressway, nearest freight rail main line, and both Chicago airports.
 */
export interface TransportAccess {
  expressway: { name: string; miles: number } | null;
  rail: { name: string; miles: number } | null;
  midwayMiles: number;
  ohareMiles: number;
}

const MIDWAY: [number, number] = [-87.7522, 41.7868];
const OHARE: [number, number] = [-87.9048, 41.9786];

let networkPromise: Promise<FeatureCollection | null> | null = null;

function loadNetwork(): Promise<FeatureCollection | null> {
  if (!networkPromise) {
    networkPromise = fetch("/data/transport-network.geojson")
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return networkPromise;
}

export async function getTransportAccess(
  lat: number,
  lon: number
): Promise<TransportAccess | null> {
  const network = await loadNetwork();
  if (!network?.features?.length) return null;

  const pt = turf.point([lon, lat]);
  let expressway: TransportAccess["expressway"] = null;
  let rail: TransportAccess["rail"] = null;

  for (const feature of network.features) {
    if (feature.geometry?.type !== "LineString") continue;

    const miles = turf.pointToLineDistance(pt, feature as Feature<LineString>, {
      units: "miles",
    });
    const kind = feature.properties?.kind;
    const name = feature.properties?.name || "";

    if (kind === "expressway") {
      if (!expressway || miles < expressway.miles) expressway = { name, miles };
    } else if (kind === "rail") {
      if (!rail || miles < rail.miles) rail = { name, miles };
    }
  }

  return {
    expressway,
    rail,
    midwayMiles: turf.distance(pt, turf.point(MIDWAY), { units: "miles" }),
    ohareMiles: turf.distance(pt, turf.point(OHARE), { units: "miles" }),
  };
}

export function formatMiles(miles: number): string {
  if (miles < 0.1) return "<0.1 mi";
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}
