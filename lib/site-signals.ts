import * as turf from "@turf/turf";
import type { FeatureCollection } from "geojson";

/**
 * Site signals — proximity intelligence from point-data layers (brownfields,
 * leaking USTs, NOF awards, county incentive parcels). These are discovery
 * and due-diligence context, not eligibility determinations: point data can
 * flag what is near a site, but program eligibility still belongs to the
 * administering agencies.
 */
export interface SiteSignals {
  /** Nearest EPA ACRES brownfield site. */
  brownfield: { name: string; miles: number } | null;
  /** Open (no NFR letter) leaking-UST incidents within a quarter mile. */
  openLustNearby: number;
  /** Nearest open LUST incident. */
  nearestOpenLust: { name: string; miles: number } | null;
  /** NOF grants awarded within a half mile — evidence the program pays out nearby. */
  nofAwardsNearby: number;
  /** Cook County incentive-classified parcels within a quarter mile. */
  incentiveParcelsNearby: number;
  /** Nearest county incentive parcel and its classification. */
  nearestIncentiveParcel: { name: string; miles: number } | null;
}

const SIGNAL_FILES = {
  brownfields: "/data/zones/brownfield-sites.geojson",
  lust: "/data/zones/lust-sites.geojson",
  nofProjects: "/data/zones/nof-funded-projects.geojson",
  countyParcels: "/data/zones/county-incentive-parcels.geojson",
} as const;

const cache = new Map<string, Promise<FeatureCollection | null>>();

function loadLayer(url: string): Promise<FeatureCollection | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

interface Nearest {
  name: string;
  miles: number;
}

function scan(
  fc: FeatureCollection | null,
  lon: number,
  lat: number,
  withinMiles: number,
  filter?: (props: Record<string, unknown>) => boolean
): { nearest: Nearest | null; withinCount: number } {
  if (!fc?.features?.length) return { nearest: null, withinCount: 0 };
  const from = turf.point([lon, lat]);
  let nearest: Nearest | null = null;
  let withinCount = 0;
  for (const f of fc.features) {
    if (f.geometry?.type !== "Point") continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    if (filter && !filter(props)) continue;
    const miles = turf.distance(from, turf.point(f.geometry.coordinates), { units: "miles" });
    if (miles <= withinMiles) withinCount++;
    if (!nearest || miles < nearest.miles) {
      nearest = { name: String(props.name ?? ""), miles };
    }
  }
  return { nearest, withinCount };
}

export async function getSiteSignals(lat: number, lon: number): Promise<SiteSignals | null> {
  const [brownfields, lust, nofProjects, countyParcels] = await Promise.all([
    loadLayer(SIGNAL_FILES.brownfields),
    loadLayer(SIGNAL_FILES.lust),
    loadLayer(SIGNAL_FILES.nofProjects),
    loadLayer(SIGNAL_FILES.countyParcels),
  ]);
  if (!brownfields && !lust && !nofProjects && !countyParcels) return null;

  const brownfieldScan = scan(brownfields, lon, lat, 0.25);
  const lustScan = scan(lust, lon, lat, 0.25, (p) => p.status !== undefined && String(p.status).startsWith("Open"));
  const nofScan = scan(nofProjects, lon, lat, 0.5);
  const parcelScan = scan(countyParcels, lon, lat, 0.25);

  return {
    brownfield: brownfieldScan.nearest,
    openLustNearby: lustScan.withinCount,
    nearestOpenLust: lustScan.nearest,
    nofAwardsNearby: nofScan.withinCount,
    incentiveParcelsNearby: parcelScan.withinCount,
    nearestIncentiveParcel: parcelScan.nearest,
  };
}
