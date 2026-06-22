import { NextRequest, NextResponse } from "next/server";

const MAX_ADDRESS_LENGTH = 260;

type GeocodeResult = {
  lat?: number;
  lon?: number;
  displayName?: string;
  display_name?: string;
};

function cleanAddress(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_ADDRESS_LENGTH);
}

function reportUrl(origin: string, params: Record<string, string | number>) {
  const url = new URL("/report", origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

function instantReportUrl(origin: string, address: string, geocode: GeocodeResult) {
  const displayAddress = cleanAddress(geocode.displayName ?? geocode.display_name ?? address);
  return reportUrl(origin, {
    instant: "true",
    lat: Number(geocode.lat).toFixed(5),
    lon: Number(geocode.lon).toFixed(5),
    addr: displayAddress,
  });
}

async function geocodeAddress(origin: string, address: string): Promise<GeocodeResult | null> {
  const url = new URL("/api/geocode", origin);
  url.searchParams.set("address", address);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const payload = (await response.json()) as GeocodeResult;
  if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lon)) return null;
  return payload;
}

export async function GET(request: NextRequest) {
  const address = cleanAddress(
    request.nextUrl.searchParams.get("addr") ?? request.nextUrl.searchParams.get("address")
  );

  if (!address) {
    return NextResponse.redirect(new URL("/?lookup=missing-address", request.nextUrl.origin));
  }

  try {
    const geocode = await geocodeAddress(request.nextUrl.origin, address);
    if (!geocode) {
      return NextResponse.redirect(
        reportUrl(request.nextUrl.origin, {
          addr: address,
          lookup: "not-found",
        })
      );
    }

    return NextResponse.redirect(instantReportUrl(request.nextUrl.origin, address, geocode));
  } catch {
    return NextResponse.redirect(
      reportUrl(request.nextUrl.origin, {
        addr: address,
        lookup: "geocode-unavailable",
      })
    );
  }
}
