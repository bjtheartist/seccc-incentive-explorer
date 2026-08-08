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
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
          { headers: { "User-Agent": "Chicago-Site-Incentive-Map/1.0" } }
        );
        const data = await res.json();
        const postcode: string | undefined = data?.address?.postcode;
        const zip = postcode ? (postcode.match(/\b(\d{5})\b/)?.[1] ?? null) : null;
        return { zip, displayName: data?.display_name ?? null };
      });
      return NextResponse.json(result ?? { zip: null }, { headers: CDN_HEADERS });
    } catch {
      return NextResponse.json({ zip: null }, { status: 200, headers: CDN_HEADERS });
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
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        {
          headers: {
            "User-Agent": "Chicago-Site-Incentive-Map/1.0",
          },
        }
      );

      if (!res.ok) {
        throw new Error(`Nominatim request failed with status ${res.status}`);
      }

      const data: unknown = await res.json();
      if (!Array.isArray(data)) return null;

      const selected = selectCandidate(data as NominatimCandidate[], address);
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
      return NextResponse.json(
        { error: "Address not found" },
        { status: 404, headers: CDN_HEADERS }
      );
    }

    return NextResponse.json(result, { headers: CDN_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Geocoding service unavailable" },
      { status: 500 }
    );
  }
}
