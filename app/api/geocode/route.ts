import { NextRequest, NextResponse } from "next/server";
import { cached } from "@/lib/redis";

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=86400",
};

const GEOCODE_CACHE_VERSION = "v2";
const CHICAGO_BOUNDS = {
  south: 41.6445,
  west: -87.9401,
  north: 42.0231,
  east: -87.5237,
};
const CHICAGO_VIEWBOX = [
  CHICAGO_BOUNDS.west,
  CHICAGO_BOUNDS.north,
  CHICAGO_BOUNDS.east,
  CHICAGO_BOUNDS.south,
].join(",");

/**
 * R1 finding 3 (geocoder hardening). Nominatim is a free community service
 * with no SLA: before this, a hung connection had NO timeout at all, so the
 * route could sit on a request until the platform killed it, and the reader
 * saw an indefinite spinner. Every upstream call now gets a hard 5s deadline
 * and exactly one retry (two attempts total, never more — the Nominatim usage
 * policy asks for restraint, and the identifying User-Agent stays set).
 */
const UPSTREAM_TIMEOUT_MS = 5000;
const UPSTREAM_ATTEMPTS = 2;
const NOMINATIM_USER_AGENT = "Chicago-Site-Incentive-Map/1.0";

/**
 * The distinct machine-readable marker the client maps to service-failure
 * copy ("The address service is temporarily unavailable…") rather than
 * blame-the-user "could not find that address" copy. Mirrors /api/zoning's
 * own `status: "unavailable"` convention.
 */
const GEOCODE_UNAVAILABLE_STATUS = "unavailable";

/** Thrown when every attempt against every configured provider failed. */
class GeocodeServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocodeServiceUnavailableError";
  }
}

/**
 * Fetch with a hard deadline and one retry. Retries a transport failure, a
 * timeout, and a 5xx — never a 4xx, which is a real answer from the service
 * (retrying it would just spend the reader's time on the same reply).
 * Throws `GeocodeServiceUnavailableError` when the last attempt fails.
 */
async function fetchUpstreamWithRetry(url: string, label: string): Promise<Response> {
  let lastDetail = "unknown error";
  for (let attempt = 1; attempt <= UPSTREAM_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": NOMINATIM_USER_AGENT },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (res.status >= 500) {
        lastDetail = `HTTP ${res.status}`;
        continue;
      }
      return res;
    } catch (err) {
      lastDetail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  }
  throw new GeocodeServiceUnavailableError(`${label} unavailable after ${UPSTREAM_ATTEMPTS} attempts (${lastDetail})`);
}

/**
 * Optional Mapbox forward-geocoding fallback. Feature-detected from whatever
 * token the runtime already has — this adds NO new required configuration, and
 * with no token present the route's behavior is exactly timeout + retry +
 * honest error. The public token is accepted because the app already ships it
 * to the browser for the map, so using it server-side leaks nothing new.
 */
function mapboxToken(): string | null {
  const token =
    process.env.MAPBOX_TOKEN ||
    process.env.MAPBOX_ACCESS_TOKEN ||
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  return token && token.trim() ? token.trim() : null;
}

interface MapboxFeature {
  center?: [number, number];
  place_name?: string;
  address?: string;
  text?: string;
  place_type?: string[];
}

/**
 * Ask Mapbox for the same query, bounded to the Chicago viewbox, and shape the
 * answer like a Nominatim candidate so `selectCandidate`'s house-number rules —
 * including its refusal to substitute a street centroid for a house number —
 * apply identically to both providers. Returns `null` (never throws) when the
 * fallback is not configured or cannot answer, so a Mapbox outage degrades to
 * the Nominatim-only error rather than replacing it.
 */
async function mapboxForwardCandidates(query: string): Promise<NominatimCandidate[] | null> {
  const token = mapboxToken();
  if (!token) return null;

  const params = new URLSearchParams({
    access_token: token,
    limit: "8",
    country: "us",
    types: "address,poi,place",
    bbox: [
      CHICAGO_BOUNDS.west,
      CHICAGO_BOUNDS.south,
      CHICAGO_BOUNDS.east,
      CHICAGO_BOUNDS.north,
    ].join(","),
  });
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params.toString()}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const features = (body as { features?: unknown })?.features;
    if (!Array.isArray(features)) return null;

    return (features as MapboxFeature[])
      .filter((feature) => Array.isArray(feature.center) && feature.center.length === 2)
      .map((feature) => {
        const [lon, lat] = feature.center as [number, number];
        return {
          lat: String(lat),
          lon: String(lon),
          display_name: feature.place_name,
          address: {
            house_number: feature.address,
            road: feature.text,
            country_code: "us",
          },
        } satisfies NominatimCandidate;
      });
  } catch {
    return null;
  }
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  residential?: string;
  footway?: string;
  path?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  country_code?: string;
}

interface NominatimCandidate {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: NominatimAddress;
}

const STREET_TOKEN_ALIASES: Record<string, string> = {
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
  street: "st",
  avenue: "ave",
  boulevard: "blvd",
  road: "rd",
  drive: "dr",
  place: "pl",
  court: "ct",
  parkway: "pkwy",
  highway: "hwy",
  lane: "ln",
  terrace: "ter",
  circle: "cir",
};

const STREET_SUFFIXES = new Set([
  "st",
  "ave",
  "blvd",
  "rd",
  "dr",
  "pl",
  "ct",
  "pkwy",
  "hwy",
  "ln",
  "ter",
  "cir",
]);

function normalizeStreet(value: string): string {
  const tokens = value
    .toLowerCase()
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => STREET_TOKEN_ALIASES[token] ?? token);

  while (tokens.length > 0 && STREET_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens.join(" ");
}

function normalizeHouseNumber(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return normalized || null;
}

function requestedAddressParts(address: string): {
  houseNumber: string | null;
  street: string | null;
} {
  let streetLine = address.split(",", 1)[0].trim();
  streetLine = streetLine
    .replace(/\s+(?:apt|apartment|unit|suite|ste|#)\s*.*$/i, "")
    .replace(/\s+\d{5}(?:-\d{4})?$/i, "")
    .replace(/\s+chicago(?:\s+(?:il|illinois))?$/i, "")
    .replace(/\s+(?:il|illinois)$/i, "")
    .trim();

  const match = streetLine.match(/^(\d+(?:-\d+)?[a-z]?)\s+(.+)$/i);
  if (!match) return { houseNumber: null, street: null };

  const street = normalizeStreet(match[2]);
  return {
    houseNumber: normalizeHouseNumber(match[1]),
    street: street || null,
  };
}

function candidateStreet(candidate: NominatimCandidate): string | null {
  const address = candidate.address;
  const street =
    address?.road ??
    address?.pedestrian ??
    address?.residential ??
    address?.footway ??
    address?.path;
  if (!street) return null;
  const normalized = normalizeStreet(street);
  return normalized || null;
}

function isChicagoCandidate(candidate: NominatimCandidate): boolean {
  const lat = Number(candidate.lat);
  const lon = Number(candidate.lon);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < CHICAGO_BOUNDS.south ||
    lat > CHICAGO_BOUNDS.north ||
    lon < CHICAGO_BOUNDS.west ||
    lon > CHICAGO_BOUNDS.east
  ) {
    return false;
  }

  if (!candidate.display_name?.trim()) return false;
  if (candidate.address?.country_code && candidate.address.country_code !== "us") {
    return false;
  }

  const locality = [
    candidate.address?.city,
    candidate.address?.town,
    candidate.address?.village,
  ].filter((value): value is string => Boolean(value));
  if (locality.length > 0) {
    return locality.some((value) => value.trim().toLowerCase() === "chicago");
  }

  if (candidate.address?.municipality?.trim().toLowerCase() === "chicago") {
    return true;
  }

  return candidate.display_name
    .split(",")
    .some((part) => part.trim().toLowerCase() === "chicago");
}

function selectCandidate(
  candidates: NominatimCandidate[],
  address: string,
): { candidate: NominatimCandidate; matchQuality: "exact" | "street" | "place" } | null {
  const chicagoCandidates = candidates.filter(isChicagoCandidate);
  if (chicagoCandidates.length === 0) return null;

  const requested = requestedAddressParts(address);
  if (!requested.street) {
    return { candidate: chicagoCandidates[0], matchQuality: "place" };
  }

  const streetMatches = chicagoCandidates.filter(
    (candidate) => candidateStreet(candidate) === requested.street,
  );
  if (streetMatches.length === 0) return null;

  if (requested.houseNumber) {
    const exact = streetMatches.find(
      (candidate) =>
        normalizeHouseNumber(candidate.address?.house_number) === requested.houseNumber,
    );
    if (exact) return { candidate: exact, matchQuality: "exact" };
    // Current consumers act on the coordinates immediately and do not prompt
    // for confirmation. Never substitute a street centroid for a house number.
    return null;
  }

  return { candidate: streetMatches[0], matchQuality: "street" };
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const latParam = request.nextUrl.searchParams.get("lat");
  const lonParam = request.nextUrl.searchParams.get("lon");

  // Reverse geocode: lat/lon -> { zip } (used to attach ZIP economic context
  // when the address string has no parseable ZIP).
  if (!address && latParam != null && lonParam != null) {
    const lat = Number(latParam);
    const lon = Number(lonParam);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: "Invalid lat/lon" }, { status: 400 });
    }
    try {
      const cacheKey = `revgeo:${lat.toFixed(4)},${lon.toFixed(4)}`;
      const result = await cached(cacheKey, 2592000, async () => {
        const res = await fetchUpstreamWithRetry(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
          "Nominatim reverse geocode",
        );
        if (!res.ok) {
          throw new GeocodeServiceUnavailableError(
            `Nominatim reverse geocode returned ${res.status}`,
          );
        }
        const data = await res.json();
        const postcode: string | undefined = data?.address?.postcode;
        const zip = postcode ? (postcode.match(/\b(\d{5})\b/)?.[1] ?? null) : null;
        return { zip, displayName: data?.display_name ?? null };
      });
      return NextResponse.json(result ?? { zip: null }, { headers: CDN_HEADERS });
    } catch {
      // The reverse path only ATTACHES optional ZIP context, so a failure here
      // has always degraded to `{ zip: null }` rather than failing the caller.
      // It now says so explicitly — a null ZIP from an outage must not be read
      // as "this point has no ZIP" (R1 findings 3 + 4).
      return NextResponse.json(
        { zip: null, status: GEOCODE_UNAVAILABLE_STATUS },
        { status: 200, headers: CDN_HEADERS },
      );
    }
  }

  if (!address) {
    return NextResponse.json({ error: "Address is required" }, { status: 400 });
  }

  try {
    const normalizedAddress = address.toLowerCase().trim().replace(/\s+/g, " ");
    const cacheKey = `geocode:${GEOCODE_CACHE_VERSION}:${normalizedAddress}`;
    const result = await cached(cacheKey, 2592000, async () => {
      const query = /\bchicago\b/i.test(address)
        ? address
        : `${address}, Chicago, IL`;
      const params = new URLSearchParams({
        q: query,
        format: "jsonv2",
        addressdetails: "1",
        limit: "8",
        countrycodes: "us",
        viewbox: CHICAGO_VIEWBOX,
        bounded: "1",
      });
      let candidates: NominatimCandidate[] | null = null;
      let nominatimFailure: unknown = null;
      try {
        const res = await fetchUpstreamWithRetry(
          `https://nominatim.openstreetmap.org/search?${params.toString()}`,
          "Nominatim forward geocode",
        );
        if (!res.ok) {
          throw new GeocodeServiceUnavailableError(
            `Nominatim request failed with status ${res.status}`,
          );
        }
        const data: unknown = await res.json();
        if (!Array.isArray(data)) {
          throw new GeocodeServiceUnavailableError("Nominatim returned an unexpected payload shape");
        }
        candidates = data as NominatimCandidate[];
      } catch (err) {
        nominatimFailure = err;
      }

      // Mapbox fallback (feature-detected). Only reached when Nominatim could
      // not answer AT ALL — never to second-guess an answer it did give, so a
      // genuine "not in Chicago" stays a 404 rather than becoming a fuzzy
      // second-provider match.
      if (candidates === null) {
        candidates = await mapboxForwardCandidates(query);
      }

      if (candidates === null) {
        throw nominatimFailure instanceof Error
          ? nominatimFailure
          : new GeocodeServiceUnavailableError("Geocoding providers unavailable");
      }

      const selected = selectCandidate(candidates, address);
      if (!selected) return null;

      const lat = Number(selected.candidate.lat);
      const lon = Number(selected.candidate.lon);

      return {
        lat,
        lon,
        displayName: selected.candidate.display_name,
        matchQuality: selected.matchQuality,
      };
    });

    if (!result) {
      // A GENUINE not-found: a provider answered, and nothing it returned was
      // a Chicago match for this address. Distinct from the 503 below, which
      // means nobody answered at all (R1 finding 1 — the client must not blame
      // the reader's typing for an outage).
      return NextResponse.json(
        { error: "Address not found", status: "not_found" },
        { status: 404, headers: CDN_HEADERS }
      );
    }

    return NextResponse.json(result, { headers: CDN_HEADERS });
  } catch {
    // 503 + `status: "unavailable"`, matching /api/zoning's convention. Not
    // cached: an outage must not be pinned into the CDN for a month.
    return NextResponse.json(
      { error: "Geocoding service unavailable", status: GEOCODE_UNAVAILABLE_STATUS },
      { status: 503 }
    );
  }
}
