import { readFile } from "node:fs/promises";
import path from "node:path";
import * as turf from "@turf/turf";
import { strFromU8, unzipSync } from "fflate";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { memCached, roundCoord } from "@/lib/redis";
import { formatMiles } from "@/lib/transport-access";

export interface MobilityAccessPoint {
  name: string;
  category: "cta_rail" | "metra" | "bus_stop" | "airport";
  agency: string;
  miles: number;
  lat: number;
  lon: number;
  routes?: string[];
  url?: string;
  sourceId: string;
}

export interface MobilityAccessLine {
  name: string;
  category: "bike_route" | "expressway" | "freight_rail";
  miles: number;
  routeType?: string;
  sourceId: string;
}

export interface MobilityAccessSource {
  id: string;
  label: string;
  url?: string;
  retrievedAt: string;
}

export interface MobilityAccess {
  transitLabel: string;
  bikeLabel: string;
  driveLabel: string;
  freightLabel: string;
  ctaRailStations: MobilityAccessPoint[];
  metraStations: MobilityAccessPoint[];
  busStops: MobilityAccessPoint[];
  bikeRoutes: MobilityAccessLine[];
  airports: MobilityAccessPoint[];
  expressways: MobilityAccessLine[];
  freightRail: MobilityAccessLine[];
  sources: MobilityAccessSource[];
  caveats: string[];
  refreshedAt: string;
}

interface CsvRow {
  [key: string]: string | undefined;
}

interface RawPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  agency: string;
  routes?: string[];
  url?: string;
  sourceId: string;
}

interface TransportNetworkFeatureProps {
  kind?: string;
  name?: string;
}

interface ChicagoDataPointRow {
  public_nam?: string;
  routesstpg?: string;
  the_geom?: {
    type: "Point";
    coordinates: [number, number];
  };
  distance?: string;
}

interface ChicagoBikeRouteRow {
  street?: string;
  displayrou?: string;
  f_street?: string;
  t_street?: string;
  distance?: string;
}

const CTA_GTFS_URL = "https://www.transitchicago.com/downloads/sch_data/google_transit.zip";
const METRA_GTFS_URL = "https://schedules.metrarail.com/gtfs/schedule.zip";
const CTA_BUS_STOPS_URL = "https://data.cityofchicago.org/resource/qs84-j7wh.json";
const BIKE_ROUTES_URL = "https://data.cityofchicago.org/resource/hvv9-38ut.json";
const MOBILITY_CACHE_TTL_SECONDS = 60 * 60 * 24;
const GTFS_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const NEARBY_RADIUS_METERS = 8047; // 5 miles, enough to find context at most Chicago addresses.
const MAX_RESULTS = 5;

const AIRPORTS: RawPoint[] = [
  {
    id: "mdw",
    name: "Chicago Midway International",
    lat: 41.7868,
    lon: -87.7522,
    agency: "Airport",
    sourceId: "airports",
  },
  {
    id: "ord",
    name: "Chicago O'Hare International",
    lat: 41.9786,
    lon: -87.9048,
    agency: "Airport",
    sourceId: "airports",
  },
];

export function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...dataRows] = rows;
  if (!headers) return [];

  return dataRows
    .filter((values) => values.some((value) => value.trim() !== ""))
    .map((values) => {
      const parsed: CsvRow = {};
      headers.forEach((header, index) => {
        parsed[header.trim()] = values[index]?.trim() ?? "";
      });
      return parsed;
    });
}

function numberFrom(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pointDistanceMiles(lat: number, lon: number, point: RawPoint): number {
  return turf.distance(turf.point([lon, lat]), turf.point([point.lon, point.lat]), {
    units: "miles",
  });
}

function toAccessPoint(
  lat: number,
  lon: number,
  point: RawPoint,
  category: MobilityAccessPoint["category"],
): MobilityAccessPoint {
  return {
    name: point.name,
    category,
    agency: point.agency,
    miles: pointDistanceMiles(lat, lon, point),
    lat: point.lat,
    lon: point.lon,
    routes: point.routes,
    url: point.url,
    sourceId: point.sourceId,
  };
}

function nearestPoints(
  lat: number,
  lon: number,
  points: RawPoint[],
  category: MobilityAccessPoint["category"],
  limit = MAX_RESULTS,
): MobilityAccessPoint[] {
  return points
    .map((point) => toAccessPoint(lat, lon, point, category))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, limit);
}

async function fetchGtfsText(url: string, fileName: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Chicago Incentive Explorer mobility access lookup" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch GTFS feed: ${response.status}`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  const zip = unzipSync(buffer, {
    filter: (file) => file.name === fileName,
  });
  const file = zip[fileName];
  if (!file) throw new Error(`GTFS feed missing ${fileName}`);
  return strFromU8(file);
}

async function loadCtaRailStations(): Promise<RawPoint[]> {
  return memCached("mobility:cta-rail-stations:v1", GTFS_CACHE_TTL_SECONDS, async () => {
    const stopsText = await fetchGtfsText(CTA_GTFS_URL, "stops.txt");
    return parseCsv(stopsText)
      .filter((row) => row.location_type === "1")
      .map((row) => {
        const lat = numberFrom(row.stop_lat);
        const lon = numberFrom(row.stop_lon);
        if (lat == null || lon == null || !row.stop_name) return null;

        return {
          id: row.stop_id || row.stop_name,
          name: row.stop_name,
          lat,
          lon,
          agency: "CTA",
          sourceId: "cta-gtfs",
        };
      })
      .filter(Boolean) as RawPoint[];
  });
}

function metraLineFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = url.match(/train-lines\/([^/]+)/);
  return match?.[1];
}

async function loadMetraStations(): Promise<RawPoint[]> {
  return memCached("mobility:metra-stations:v1", GTFS_CACHE_TTL_SECONDS, async () => {
    const stopsText = await fetchGtfsText(METRA_GTFS_URL, "stops.txt");
    return parseCsv(stopsText)
      .map((row) => {
        const lat = numberFrom(row.stop_lat);
        const lon = numberFrom(row.stop_lon);
        if (lat == null || lon == null || !row.stop_name) return null;

        const line = metraLineFromUrl(row.stop_url);
        return {
          id: row.stop_id || row.stop_name,
          name: row.stop_name,
          lat,
          lon,
          agency: "Metra",
          routes: line ? [line] : undefined,
          url: row.stop_url?.trim(),
          sourceId: "metra-gtfs",
        };
      })
      .filter(Boolean) as RawPoint[];
  });
}

function milesFromMeters(value: string | undefined): number {
  const meters = numberFrom(value);
  return meters == null ? Number.POSITIVE_INFINITY : meters / 1609.344;
}

function uniqueRouteList(value: string | undefined): string[] | undefined {
  const routes = Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((route) => route.trim())
        .filter(Boolean),
    ),
  );
  return routes.length > 0 ? routes : undefined;
}

async function fetchNearbyBusStops(lat: number, lon: number): Promise<MobilityAccessPoint[]> {
  const params = new URLSearchParams({
    $select:
      `public_nam,routesstpg,the_geom,distance_in_meters(the_geom, 'POINT (${lon} ${lat})') as distance`,
    $where: `within_circle(the_geom, ${lat}, ${lon}, ${NEARBY_RADIUS_METERS})`,
    $order: "distance",
    $limit: "75",
  });

  const response = await fetch(`${CTA_BUS_STOPS_URL}?${params.toString()}`);
  if (!response.ok) return [];

  const rows = (await response.json()) as ChicagoDataPointRow[];
  const byName = new Map<string, MobilityAccessPoint>();

  for (const row of rows) {
    const coordinates = row.the_geom?.coordinates;
    if (!coordinates || !row.public_nam) continue;

    const miles = milesFromMeters(row.distance);
    const name = row.public_nam.trim();
    const existing = byName.get(name);
    const routes = uniqueRouteList(row.routesstpg);

    if (!existing || miles < existing.miles) {
      byName.set(name, {
        name,
        category: "bus_stop",
        agency: "CTA",
        miles,
        lat: coordinates[1],
        lon: coordinates[0],
        routes,
        sourceId: "cta-bus-stops",
      });
    } else if (routes?.length) {
      existing.routes = Array.from(new Set([...(existing.routes ?? []), ...routes])).sort();
    }
  }

  return Array.from(byName.values())
    .sort((a, b) => a.miles - b.miles)
    .slice(0, MAX_RESULTS);
}

async function fetchNearbyBikeRoutes(lat: number, lon: number): Promise<MobilityAccessLine[]> {
  const params = new URLSearchParams({
    $select:
      `street,displayrou,f_street,t_street,distance_in_meters(the_geom, 'POINT (${lon} ${lat})') as distance`,
    $where: `within_circle(the_geom, ${lat}, ${lon}, ${NEARBY_RADIUS_METERS})`,
    $order: "distance",
    $limit: "75",
  });

  const response = await fetch(`${BIKE_ROUTES_URL}?${params.toString()}`);
  if (!response.ok) return [];

  const rows = (await response.json()) as ChicagoBikeRouteRow[];
  const seen = new Set<string>();
  const routes: MobilityAccessLine[] = [];

  for (const row of rows) {
    const nameParts = [
      row.street?.trim(),
      row.f_street && row.t_street ? `${row.f_street.trim()} to ${row.t_street.trim()}` : null,
    ].filter(Boolean);
    const name = nameParts.join(" - ");
    if (!name) continue;

    const key = `${name}|${row.displayrou ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    routes.push({
      name,
      category: "bike_route",
      miles: milesFromMeters(row.distance),
      routeType: row.displayrou?.trim() || undefined,
      sourceId: "city-bike-routes",
    });
  }

  return routes.sort((a, b) => a.miles - b.miles).slice(0, MAX_RESULTS);
}

let transportNetworkPromise: Promise<FeatureCollection | null> | null = null;

async function loadTransportNetwork(): Promise<FeatureCollection | null> {
  if (!transportNetworkPromise) {
    transportNetworkPromise = readFile(
      path.join(process.cwd(), "public", "data", "transport-network.geojson"),
      "utf8",
    )
      .then((text) => JSON.parse(text) as FeatureCollection)
      .catch(() => null);
  }
  return transportNetworkPromise;
}

async function getNetworkAccess(
  lat: number,
  lon: number,
  kind: "expressway" | "rail",
  category: "expressway" | "freight_rail",
): Promise<MobilityAccessLine[]> {
  const network = await loadTransportNetwork();
  if (!network?.features?.length) return [];

  const pt = turf.point([lon, lat]);
  const lines: MobilityAccessLine[] = [];

  for (const feature of network.features) {
    if (feature.geometry?.type !== "LineString") continue;
    const props = feature.properties as TransportNetworkFeatureProps | null;
    if (props?.kind !== kind) continue;
    if (category === "freight_rail" && !isFreightRailName(props.name)) continue;

    const miles = turf.pointToLineDistance(pt, feature as Feature<LineString>, {
      units: "miles",
    });

    lines.push({
      name: props.name || (kind === "rail" ? "Freight rail" : "Expressway"),
      category,
      miles,
      sourceId: "transport-network",
    });
  }

  const seen = new Set<string>();
  return lines
    .sort((a, b) => a.miles - b.miles)
    .filter((line) => {
      if (seen.has(line.name)) return false;
      seen.add(line.name);
      return true;
    })
    .slice(0, MAX_RESULTS);
}

function isFreightRailName(name: string | undefined): boolean {
  if (!name) return true;
  const normalized = name.toLowerCase();
  return !["amtrak", "metra", "south shore line"].includes(normalized);
}

function labelTransit(access: {
  ctaRailStations: MobilityAccessPoint[];
  metraStations: MobilityAccessPoint[];
  busStops: MobilityAccessPoint[];
}): string {
  const nearestRail = Math.min(
    access.ctaRailStations[0]?.miles ?? Number.POSITIVE_INFINITY,
    access.metraStations[0]?.miles ?? Number.POSITIVE_INFINITY,
  );
  const nearestBus = access.busStops[0]?.miles ?? Number.POSITIVE_INFINITY;

  if (nearestRail <= 0.5 && nearestBus <= 0.25) return "Strong public transit access";
  if (nearestRail <= 1 || nearestBus <= 0.25) return "Good public transit access";
  if (nearestRail <= 1.5 || nearestBus <= 0.5) return "Moderate public transit access";
  return "Limited nearby transit context";
}

function labelBike(routes: MobilityAccessLine[]): string {
  const nearest = routes[0]?.miles ?? Number.POSITIVE_INFINITY;
  if (nearest <= 0.1) return "Bike route at or near the site";
  if (nearest <= 0.35) return "Nearby bike access";
  if (nearest <= 0.75) return "Some bike access nearby";
  return "Limited nearby bike-route context";
}

function labelDrive(expressways: MobilityAccessLine[], airports: MobilityAccessPoint[]): string {
  const nearestExpressway = expressways[0]?.miles ?? Number.POSITIVE_INFINITY;
  const nearestAirport = airports[0]?.miles ?? Number.POSITIVE_INFINITY;
  if (nearestExpressway <= 1 && nearestAirport <= 12) return "Strong drive and regional access";
  if (nearestExpressway <= 2.5) return "Good drive access";
  if (nearestExpressway <= 5) return "Moderate drive access";
  return "Limited expressway proximity";
}

function labelFreight(lines: MobilityAccessLine[]): string {
  const nearest = lines[0]?.miles ?? Number.POSITIVE_INFINITY;
  if (nearest <= 0.5) return "Freight rail nearby";
  if (nearest <= 2) return "Freight rail in the broader area";
  return "Limited nearby freight-rail context";
}

export function describeMobilityAccess(access: MobilityAccess): string[] {
  const lines: string[] = [];

  if (access.ctaRailStations.length) {
    lines.push(
      `CTA rail: ${access.ctaRailStations
        .slice(0, 3)
        .map((stop) => `${stop.name} (${formatMiles(stop.miles)})`)
        .join(" · ")}`,
    );
  }
  if (access.busStops.length) {
    lines.push(
      `CTA bus: ${access.busStops
        .slice(0, 3)
        .map((stop) => {
          const routes = stop.routes?.length ? ` routes ${stop.routes.slice(0, 4).join(", ")}` : "";
          return `${stop.name}${routes} (${formatMiles(stop.miles)})`;
        })
        .join(" · ")}`,
    );
  }
  if (access.metraStations.length) {
    lines.push(
      `Metra: ${access.metraStations
        .slice(0, 3)
        .map((stop) => {
          const routes = stop.routes?.length ? ` ${stop.routes.join("/")}` : "";
          return `${stop.name}${routes} (${formatMiles(stop.miles)})`;
        })
        .join(" · ")}`,
    );
  }
  if (access.bikeRoutes.length) {
    lines.push(
      `Bike routes: ${access.bikeRoutes
        .slice(0, 3)
        .map((route) => `${route.routeType ? `${route.routeType} on ` : ""}${route.name} (${formatMiles(route.miles)})`)
        .join(" · ")}`,
    );
  }
  if (access.expressways.length) {
    lines.push(
      `Drive access: ${access.expressways
        .slice(0, 3)
        .map((line) => `${line.name} (${formatMiles(line.miles)})`)
        .join(" · ")}`,
    );
  }
  if (access.airports.length) {
    lines.push(
      `Airports: ${access.airports
        .map((airport) => `${airport.name} (${formatMiles(airport.miles)})`)
        .join(" · ")}`,
    );
  }
  if (access.freightRail.length) {
    lines.push(
      `Freight rail: ${access.freightRail
        .slice(0, 3)
        .map((line) => `${line.name} (${formatMiles(line.miles)})`)
        .join(" · ")}`,
    );
  }

  return lines;
}

export async function getMobilityAccess(lat: number, lon: number): Promise<MobilityAccess> {
  const cacheKey = `mobility:v1:${roundCoord(lat)}:${roundCoord(lon)}`;

  return memCached(cacheKey, MOBILITY_CACHE_TTL_SECONDS, async () => {
    const retrievedAt = new Date().toISOString();
    const [
      ctaStationsResult,
      metraStationsResult,
      busStopsResult,
      bikeRoutesResult,
      expresswaysResult,
      freightRailResult,
    ] = await Promise.allSettled([
      loadCtaRailStations(),
      loadMetraStations(),
      fetchNearbyBusStops(lat, lon),
      fetchNearbyBikeRoutes(lat, lon),
      getNetworkAccess(lat, lon, "expressway", "expressway"),
      getNetworkAccess(lat, lon, "rail", "freight_rail"),
    ]);

    const ctaRailStations = nearestPoints(
      lat,
      lon,
      ctaStationsResult.status === "fulfilled" ? ctaStationsResult.value : [],
      "cta_rail",
    );
    const metraStations = nearestPoints(
      lat,
      lon,
      metraStationsResult.status === "fulfilled" ? metraStationsResult.value : [],
      "metra",
    );
    const busStops = busStopsResult.status === "fulfilled" ? busStopsResult.value : [];
    const bikeRoutes = bikeRoutesResult.status === "fulfilled" ? bikeRoutesResult.value : [];
    const airports = nearestPoints(lat, lon, AIRPORTS, "airport", AIRPORTS.length);
    const expressways = expresswaysResult.status === "fulfilled" ? expresswaysResult.value : [];
    const freightRail = freightRailResult.status === "fulfilled" ? freightRailResult.value : [];

    return {
      transitLabel: labelTransit({ ctaRailStations, metraStations, busStops }),
      bikeLabel: labelBike(bikeRoutes),
      driveLabel: labelDrive(expressways, airports),
      freightLabel: labelFreight(freightRail),
      ctaRailStations,
      metraStations,
      busStops,
      bikeRoutes,
      airports,
      expressways,
      freightRail,
      sources: [
        {
          id: "cta-gtfs",
          label: "CTA GTFS scheduled service data",
          url: "https://www.transitchicago.com/developers/gtfs/",
          retrievedAt,
        },
        {
          id: "metra-gtfs",
          label: "Metra GTFS scheduled service data",
          url: "https://metra.com/developers",
          retrievedAt,
        },
        {
          id: "cta-bus-stops",
          label: "City of Chicago CTA bus stops",
          url: "https://data.cityofchicago.org/Transportation/CTA_BusStops/qs84-j7wh",
          retrievedAt,
        },
        {
          id: "city-bike-routes",
          label: "City of Chicago bike routes",
          url: "https://data.cityofchicago.org/Transportation/Bike-Routes/hvv9-38ut",
          retrievedAt,
        },
        {
          id: "transport-network",
          label: "Explorer transport-network layer",
          retrievedAt,
        },
      ],
      caveats: [
        "Distances are straight-line proximity signals, not routed travel times.",
        "Transit, bike, freight, loading, and site-access conditions should be verified before lease, acquisition, financing, or incentive decisions.",
      ],
      refreshedAt: retrievedAt,
    };
  });
}
