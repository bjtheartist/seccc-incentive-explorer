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
  /**
   * R1 finding 4 (honest outage rendering): the ids of the upstream feeds
   * that could not be loaded for this lookup. A rejected feed means NOTHING
   * is known about what it would have contained — so the corresponding
   * label reports unavailability rather than the bottom "Limited nearby …"
   * rung, which is an authoritative negative finding this data cannot
   * support. Empty on a fully successful lookup.
   *
   * Optional because this value is fetched over the wire (/api/mobility-access)
   * and persisted inside saved reports: a payload minted before R1 simply has
   * no such field, and `undefined` there means "no outage was recorded", which
   * is exactly the pre-R1 shape. Read it as `?? []`.
   */
  unavailableSources?: MobilityAccessFeedId[];
}

export type MobilityAccessFeedId =
  | "cta_rail"
  | "metra"
  | "bus_stops"
  | "bike_routes"
  | "expressways"
  | "freight_rail";

/**
 * Unavailability copy. Each states what could not be checked; none asserts
 * an absence, and none is eligibility-shaped.
 */
export const MOBILITY_TRANSIT_UNAVAILABLE_LABEL = "Transit data temporarily unavailable";
export const MOBILITY_BIKE_UNAVAILABLE_LABEL = "Bike-route data temporarily unavailable";
export const MOBILITY_DRIVE_UNAVAILABLE_LABEL = "Drive-access data temporarily unavailable";
export const MOBILITY_FREIGHT_UNAVAILABLE_LABEL = "Freight-rail data temporarily unavailable";

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
/**
 * How long a DEGRADED mobility answer may be cached — one whose
 * `unavailableSources` is non-empty because a CTA/Metra/Socrata feed failed
 * during this lookup.
 *
 * The 24h TTL above is right for a real answer: the underlying station and
 * route data barely moves. It is wrong for an outage. A degraded result is not
 * a fact about this coordinate, it is a fact about one upstream's health five
 * seconds ago, and storing it for a day pins "Transit data temporarily
 * unavailable" to that coordinate — for every reader, and inside every report
 * generated from it — for 24 hours after the feed recovers. "Temporarily" then
 * describes the copy better than the outage.
 *
 * Five minutes keeps the stampede protection a cache is actually for (a
 * flapping upstream is not re-hammered once per request) while letting the
 * first lookup after recovery publish the real answer. This is the same
 * discipline lib/zoning-point-lookup.ts applies by refusing to cache a failed
 * point lookup at all; mobility keeps the degraded body because it is still
 * partially useful, so it needs a short TTL rather than none.
 */
const MOBILITY_OUTAGE_CACHE_TTL_SECONDS = 5 * 60;
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
  // R1 finding 4: an empty array here is indistinguishable from "no bus stops
  // within the radius", and that false absence is exactly what a 5xx used to
  // publish. Reject instead — getMobilityAccess's Promise.allSettled turns a
  // rejection into an explicit unavailability, and an empty array back into an
  // honest "none nearby".
  if (!response.ok) {
    throw new Error(`CTA bus stops lookup failed with status ${response.status}`);
  }

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
  // Same as the bus-stop lookup above: a failed request is not an absence.
  if (!response.ok) {
    throw new Error(`Bike routes lookup failed with status ${response.status}`);
  }

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
  // A network that could not be READ (null) is an outage; a network that
  // loaded and simply holds no features is a real, publishable emptiness.
  if (!network) {
    throw new Error("Transport network layer unavailable");
  }
  if (!network.features?.length) return [];

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

/**
 * R1 finding 4. Every label below grades proximity from what was actually
 * retrieved. A POSITIVE rung ("Strong public transit access") is safe even
 * from a partial view — the stations it names were really found. The bottom
 * rung is different: "Limited nearby transit context" is an authoritative
 * NEGATIVE finding, and it is exactly what a rejected feed used to render.
 * So when a feed that contributes to a label was unavailable, the bottom
 * rung is replaced by an explicit unavailability label; the positive rungs
 * are untouched.
 */
function degradeAbsenceClaim(
  label: string,
  bottomRung: string,
  unavailableLabel: string,
  degraded: boolean,
): string {
  return degraded && label === bottomRung ? unavailableLabel : label;
}

function labelTransit(
  access: {
    ctaRailStations: MobilityAccessPoint[];
    metraStations: MobilityAccessPoint[];
    busStops: MobilityAccessPoint[];
  },
  degraded = false,
): string {
  const nearestRail = Math.min(
    access.ctaRailStations[0]?.miles ?? Number.POSITIVE_INFINITY,
    access.metraStations[0]?.miles ?? Number.POSITIVE_INFINITY,
  );
  const nearestBus = access.busStops[0]?.miles ?? Number.POSITIVE_INFINITY;

  const label =
    nearestRail <= 0.5 && nearestBus <= 0.25
      ? "Strong public transit access"
      : nearestRail <= 1 || nearestBus <= 0.25
        ? "Good public transit access"
        : nearestRail <= 1.5 || nearestBus <= 0.5
          ? "Moderate public transit access"
          : "Limited nearby transit context";
  return degradeAbsenceClaim(
    label,
    "Limited nearby transit context",
    MOBILITY_TRANSIT_UNAVAILABLE_LABEL,
    degraded,
  );
}

function labelBike(routes: MobilityAccessLine[], degraded = false): string {
  const nearest = routes[0]?.miles ?? Number.POSITIVE_INFINITY;
  const label =
    nearest <= 0.1
      ? "Bike route at or near the site"
      : nearest <= 0.35
        ? "Nearby bike access"
        : nearest <= 0.75
          ? "Some bike access nearby"
          : "Limited nearby bike-route context";
  return degradeAbsenceClaim(
    label,
    "Limited nearby bike-route context",
    MOBILITY_BIKE_UNAVAILABLE_LABEL,
    degraded,
  );
}

function labelDrive(
  expressways: MobilityAccessLine[],
  airports: MobilityAccessPoint[],
  degraded = false,
): string {
  const nearestExpressway = expressways[0]?.miles ?? Number.POSITIVE_INFINITY;
  const nearestAirport = airports[0]?.miles ?? Number.POSITIVE_INFINITY;
  const label =
    nearestExpressway <= 1 && nearestAirport <= 12
      ? "Strong drive and regional access"
      : nearestExpressway <= 2.5
        ? "Good drive access"
        : nearestExpressway <= 5
          ? "Moderate drive access"
          : "Limited expressway proximity";
  return degradeAbsenceClaim(
    label,
    "Limited expressway proximity",
    MOBILITY_DRIVE_UNAVAILABLE_LABEL,
    degraded,
  );
}

function labelFreight(lines: MobilityAccessLine[], degraded = false): string {
  const nearest = lines[0]?.miles ?? Number.POSITIVE_INFINITY;
  const label =
    nearest <= 0.5
      ? "Freight rail nearby"
      : nearest <= 2
        ? "Freight rail in the broader area"
        : "Limited nearby freight-rail context";
  return degradeAbsenceClaim(
    label,
    "Limited nearby freight-rail context",
    MOBILITY_FREIGHT_UNAVAILABLE_LABEL,
    degraded,
  );
}

const MOBILITY_FEED_LABELS: Record<MobilityAccessFeedId, string> = {
  cta_rail: "CTA rail stations",
  metra: "Metra stations",
  bus_stops: "CTA bus stops",
  bike_routes: "City bike routes",
  expressways: "the expressway network",
  freight_rail: "the freight-rail network",
};

/** Human list of the feeds that failed, for the caveat sentence. */
function describeUnavailableFeeds(ids: readonly MobilityAccessFeedId[]): string {
  const labels = ids.map((id) => MOBILITY_FEED_LABELS[id]);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function describeMobilityAccess(access: MobilityAccess): string[] {
  const lines: string[] = [];

  // R1 finding 4: this list only ever names what WAS found, so an outage
  // used to render as a shorter list — visually identical to a genuinely
  // quiet site. Lead with what could not be checked.
  const unavailable = access.unavailableSources ?? [];
  if (unavailable.length > 0) {
    lines.push(
      `Temporarily unavailable: ${describeUnavailableFeeds(unavailable)} could not be loaded, so this list does not describe ${unavailable.length === 1 ? "it" : "them"}.`,
    );
  }

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

/**
 * The TTL a given mobility result has earned: a full day for a complete
 * answer, minutes for one computed while an upstream feed was down. Exported
 * so the cache policy is testable without a Redis instance.
 */
export function mobilityCacheTTLSeconds(result: MobilityAccess): number {
  return (result.unavailableSources?.length ?? 0) > 0
    ? MOBILITY_OUTAGE_CACHE_TTL_SECONDS
    : MOBILITY_CACHE_TTL_SECONDS;
}

export async function getMobilityAccess(lat: number, lon: number): Promise<MobilityAccess> {
  const cacheKey = `mobility:v1:${roundCoord(lat)}:${roundCoord(lon)}`;

  return memCached(cacheKey, mobilityCacheTTLSeconds, async () => {
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

    // R1 finding 4: a REJECTED source was previously indistinguishable from an
    // empty one — both fell through to `[]`, and the labels then published
    // "Limited nearby transit context" as if the area had been checked and
    // found wanting. Record which feeds failed so each label can report
    // unavailability instead of that false absence.
    const unavailableSources: MobilityAccessFeedId[] = [];
    if (ctaStationsResult.status === "rejected") unavailableSources.push("cta_rail");
    if (metraStationsResult.status === "rejected") unavailableSources.push("metra");
    if (busStopsResult.status === "rejected") unavailableSources.push("bus_stops");
    if (bikeRoutesResult.status === "rejected") unavailableSources.push("bike_routes");
    if (expresswaysResult.status === "rejected") unavailableSources.push("expressways");
    if (freightRailResult.status === "rejected") unavailableSources.push("freight_rail");
    const failed = new Set(unavailableSources);

    return {
      transitLabel: labelTransit(
        { ctaRailStations, metraStations, busStops },
        failed.has("cta_rail") || failed.has("metra") || failed.has("bus_stops"),
      ),
      bikeLabel: labelBike(bikeRoutes, failed.has("bike_routes")),
      driveLabel: labelDrive(expressways, airports, failed.has("expressways")),
      freightLabel: labelFreight(freightRail, failed.has("freight_rail")),
      unavailableSources,
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
        // Named explicitly so a reader can tell a checked-and-quiet area from
        // one the app could not check at all (R1 finding 4).
        ...(unavailableSources.length > 0
          ? [
              `${describeUnavailableFeeds(unavailableSources)} could not be loaded for this lookup, so nothing below reports on ${unavailableSources.length === 1 ? "it" : "them"} either way.`,
            ]
          : []),
      ],
      refreshedAt: retrievedAt,
    };
  });
}
