import { NextRequest, NextResponse } from "next/server";
import { COOK_COUNTY_CURRENT_PARCELS_QUERY_URL, normalizePin14 } from "@/lib/cook-viewer";
import {
  PARCEL_RESOLUTION_METHOD,
  PARCEL_RESOLUTION_SOURCE,
  isChicagoParcelCoordinate,
  normalizedParcelStreetAddress,
  parcelAddressesMatch,
} from "@/lib/site-matchmaker-parcel-resolution";

const RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };
const UPSTREAM_TIMEOUT_MS = 10_000;
const UPSTREAM_ATTEMPTS = 2;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

async function fetchResolverSource(url: string): Promise<Response | null> {
  for (let attempt = 0; attempt < UPSTREAM_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (response.ok) return response;
      if (response.status >= 400 && response.status < 500) return response;
    } catch {
      // One bounded retry handles a transient County timeout; failures remain retryable by the UI.
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lon = Number(request.nextUrl.searchParams.get("lon"));
  const address = request.nextUrl.searchParams.get("address")?.trim().slice(0, 200) ?? "";

  if (!isChicagoParcelCoordinate(lat, lon) || normalizedParcelStreetAddress(address).length < 6) {
    return json(
      { status: "no_match", reason: "invalid_location", checkedAt: null },
      400,
    );
  }

  const checkedAt = new Date().toISOString();
  const upstreamUrl = new URL(COOK_COUNTY_CURRENT_PARCELS_QUERY_URL);
  upstreamUrl.searchParams.set("where", "1=1");
  upstreamUrl.searchParams.set(
    "geometry",
    JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
  );
  upstreamUrl.searchParams.set("geometryType", "esriGeometryPoint");
  upstreamUrl.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  upstreamUrl.searchParams.set("outFields", "PIN14,street_address,city_state_zip");
  upstreamUrl.searchParams.set("returnGeometry", "false");
  upstreamUrl.searchParams.set("resultRecordCount", "10");
  upstreamUrl.searchParams.set("f", "json");

  const response = await fetchResolverSource(upstreamUrl.toString());
  if (!response || !response.ok) return json({ status: "unavailable" }, 503);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return json({ status: "malformed" }, 502);
  }
  if (!isRecord(payload) || !Array.isArray(payload.features)) {
    return json({ status: "malformed" }, 502);
  }
  if (payload.exceededTransferLimit === true) {
    return json({ status: "unavailable" }, 503);
  }

  const unique = new Map<string, string>();
  for (const rawFeature of payload.features) {
    if (!isRecord(rawFeature) || !isRecord(rawFeature.attributes)) {
      return json({ status: "malformed" }, 502);
    }
    const rawPin = rawFeature.attributes.PIN14;
    const street = rawFeature.attributes.street_address;
    const cityStateZip = rawFeature.attributes.city_state_zip;
    if (typeof rawPin !== "string" || typeof street !== "string") {
      return json({ status: "malformed" }, 502);
    }
    const pin = normalizePin14(rawPin);
    if (!pin) return json({ status: "malformed" }, 502);
    const publishedAddress = [street, typeof cityStateZip === "string" ? cityStateZip : ""]
      .filter(Boolean)
      .join(", ");
    if (normalizedParcelStreetAddress(publishedAddress).length < 6) {
      return json({ status: "malformed" }, 502);
    }
    const previousAddress = unique.get(pin);
    if (
      previousAddress &&
      normalizedParcelStreetAddress(previousAddress) !== normalizedParcelStreetAddress(publishedAddress)
    ) {
      return json({ status: "malformed" }, 502);
    }
    unique.set(pin, publishedAddress);
  }

  if (unique.size === 0) {
    return json({
      status: "no_match",
      reason: "no_intersection",
      checkedAt,
      source: PARCEL_RESOLUTION_SOURCE,
      matchMethod: PARCEL_RESOLUTION_METHOD,
    }, 404);
  }
  if (unique.size > 1) {
    return json({
      status: "ambiguous",
      candidateCount: unique.size,
      checkedAt,
      source: PARCEL_RESOLUTION_SOURCE,
      matchMethod: PARCEL_RESOLUTION_METHOD,
    }, 409);
  }

  const [pin, publishedAddress] = [...unique.entries()][0];
  if (!parcelAddressesMatch(address, publishedAddress)) {
    return json({
      status: "no_match",
      reason: "address_mismatch",
      checkedAt,
      source: PARCEL_RESOLUTION_SOURCE,
      matchMethod: PARCEL_RESOLUTION_METHOD,
    }, 404);
  }

  return json({
    status: "resolved",
    pin,
    checkedAt,
    source: PARCEL_RESOLUTION_SOURCE,
    matchMethod: PARCEL_RESOLUTION_METHOD,
  });
}
