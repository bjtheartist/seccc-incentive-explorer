import { NextRequest, NextResponse } from "next/server";
import { cached, roundCoord } from "@/lib/redis";
import { socrataHeaders } from "@/lib/socrata";
import { lookupChicagoZba } from "@/lib/chicago-zba";
import type {
  CityZoning,
  ZoningAvailableResponse,
  ZoningLookupResponse,
  ZoningNotFoundResponse,
  ZoningSourceMetadata,
} from "@/lib/types";

const ARCGIS_LAYER_URL =
  "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1";
const SOCRATA_LAYER_URL =
  "https://data.cityofchicago.org/resource/dj47-wfun.geojson";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=21600",
};

const UNAVAILABLE_HEADERS = {
  "Cache-Control": "private, no-store",
};

type CacheableZoningResponse =
  | ZoningAvailableResponse
  | ZoningNotFoundResponse;

type SourceQueryResult =
  | { status: "found"; zoning: CityZoning; source: ZoningSourceMetadata }
  | { status: "empty"; source: ZoningSourceMetadata }
  | { status: "failed" };

class ZoningSourcesUnavailableError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sourceMetadata(
  id: ZoningSourceMetadata["id"],
  label: string,
  url: string,
  retrievedAt: string,
  recordUpdatedAt: string | null,
): ZoningSourceMetadata {
  return { id, label, url, retrievedAt, recordUpdatedAt };
}

function zoningFromRecord(
  source: ZoningSourceMetadata,
  field: (name: string) => unknown,
): CityZoning | null {
  const zoneClass = nullableString(field("ZONE_CLASS"));
  if (!zoneClass) return null;

  const zoneTypeCode = nullableNumber(field("ZONE_TYPE"));
  const recordUpdatedAt = nullableIsoDate(field("UPDATE_TIMESTAMP"));
  const resolvedSource = {
    ...source,
    recordUpdatedAt,
  };

  return {
    zoneClass,
    // The layer publishes a numeric code without an attached value-domain
    // label. Preserve the code and do not infer a user-facing category.
    zoneType: null,
    zoneTypeCode,
    pdNumber: nullableNumber(field("PD_NUM")),
    pmdSubArea: nullableString(field("PMD_SUB_AREA")),
    pedestrianStreetAreaName: nullableString(field("PEDSTREET_AREANAME")),
    ordinanceNumber: nullableString(field("ORDINANCE_NUM")),
    ordinanceDate: nullableIsoDate(field("ORDINANCE_DATE")),
    clerkDocumentNumber: nullableString(field("CLERK_DOCNO")),
    clerkUrl: nullableString(field("CLERK_URL")),
    recordUpdatedAt,
    source: resolvedSource,
  };
}

/** Fetch with retry and exponential backoff. */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 1,
  baseDelay = 250,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) return response;
      if (response.status >= 400 && response.status < 500) return response;
    } catch (error) {
      lastError = error;
    }

    if (attempt < retries) {
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelay * Math.pow(2, attempt)),
      );
    }
  }

  throw lastError || new Error("fetchWithRetry exhausted");
}

async function queryArcGis(lat: number, lon: number): Promise<SourceQueryResult> {
  const retrievedAt = new Date().toISOString();
  const source = sourceMetadata(
    "chicago-arcgis-zoning",
    "City of Chicago ArcGIS zoning boundaries",
    ARCGIS_LAYER_URL,
    retrievedAt,
    null,
  );

  try {
    const url = new URL(`${ARCGIS_LAYER_URL}/query`);
    url.searchParams.set("geometry", `${lon},${lat}`);
    url.searchParams.set("geometryType", "esriGeometryPoint");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set(
      "outFields",
      [
        "ZONE_CLASS",
        "ZONE_TYPE",
        "PD_NUM",
        "PMD_SUB_AREA",
        "PEDSTREET_AREANAME",
        "ORDINANCE_NUM",
        "ORDINANCE_DATE",
        "UPDATE_TIMESTAMP",
        "CLERK_DOCNO",
        "CLERK_URL",
      ].join(","),
    );
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("resultRecordCount", "1");
    url.searchParams.set("f", "json");

    const response = await fetchWithRetry(url.toString(), {});
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || isRecord(payload.error)) {
      return { status: "failed" };
    }

    const features = payload.features;
    if (!Array.isArray(features)) return { status: "failed" };
    if (features.length === 0) return { status: "empty", source };

    const first = features[0];
    if (!isRecord(first) || !isRecord(first.attributes)) {
      return { status: "failed" };
    }

    const attributes = first.attributes;
    const recordUpdatedAt = nullableIsoDate(attributes.UPDATE_TIMESTAMP);
    const recordSource = { ...source, recordUpdatedAt };
    const zoning = zoningFromRecord(
      recordSource,
      (name) => attributes[name],
    );
    return zoning
      ? { status: "found", zoning, source: zoning.source ?? recordSource }
      : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

async function querySocrata(lat: number, lon: number): Promise<SourceQueryResult> {
  const retrievedAt = new Date().toISOString();
  const source = sourceMetadata(
    "chicago-data-portal-zoning",
    "City of Chicago Data Portal zoning boundaries",
    "https://data.cityofchicago.org/d/dj47-wfun",
    retrievedAt,
    null,
  );

  try {
    const url = new URL(SOCRATA_LAYER_URL);
    url.searchParams.set(
      "$where",
      `intersects(the_geom,'POINT(${lon} ${lat})')`,
    );
    url.searchParams.set("$limit", "1");

    const response = await fetchWithRetry(url.toString(), {
      headers: {
        ...socrataHeaders(),
        Accept: "application/json",
      },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.features)) {
      return { status: "failed" };
    }
    if (payload.features.length === 0) return { status: "empty", source };

    const first = payload.features[0];
    if (!isRecord(first) || !isRecord(first.properties)) {
      return { status: "failed" };
    }

    const properties = first.properties;
    const socrataFields: Record<string, string> = {
      ZONE_CLASS: "zone_class",
      ZONE_TYPE: "zone_type",
      PD_NUM: "pd_num",
      PMD_SUB_AREA: "pmd_sub_ar",
      PEDSTREET_AREANAME: "pedstreet_",
      ORDINANCE_NUM: "ordinance",
      ORDINANCE_DATE: "ordinance_1",
      UPDATE_TIMESTAMP: "edit_date",
      CLERK_DOCNO: "clerk_docn",
      CLERK_URL: "clerk_url",
    };
    const recordUpdatedAt = nullableIsoDate(properties.edit_date);
    const recordSource = { ...source, recordUpdatedAt };
    const zoning = zoningFromRecord(
      recordSource,
      (name) => properties[socrataFields[name]],
    );
    return zoning
      ? { status: "found", zoning, source: zoning.source ?? recordSource }
      : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

async function lookupZoning(lat: number, lon: number): Promise<ZoningLookupResponse> {
  const arcgis = await queryArcGis(lat, lon);
  if (arcgis.status === "found") {
    return { status: "available", ...arcgis.zoning, source: arcgis.source };
  }

  const socrata = await querySocrata(lat, lon);
  if (socrata.status === "found") {
    return { status: "available", ...socrata.zoning, source: socrata.source };
  }

  const successfulEmpty =
    arcgis.status === "empty"
      ? arcgis
      : socrata.status === "empty"
        ? socrata
        : null;
  if (successfulEmpty) {
    return {
      status: "not_found",
      zoneClass: null,
      zoneType: null,
      source: successfulEmpty.source,
      message: "No published Chicago zoning district was returned for this location.",
    };
  }

  return {
    status: "unavailable",
    zoneClass: null,
    zoneType: null,
    source: null,
    message: "Published Chicago zoning data is temporarily unavailable.",
  };
}

export async function GET(request: NextRequest) {
  const rawLat = request.nextUrl.searchParams.get("lat");
  const rawLon = request.nextUrl.searchParams.get("lon");
  const lat = rawLat === null ? Number.NaN : Number(rawLat);
  const lon = rawLon === null ? Number.NaN : Number(rawLon);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return NextResponse.json(
      { error: "Valid lat and lon are required" },
      { status: 400 },
    );
  }

  const cacheKey = `zoning:v4:${roundCoord(lat, 5)}:${roundCoord(lon, 5)}`;
  const zbaPromise = lookupChicagoZba(lat, lon);

  try {
    const result = await cached<CacheableZoningResponse>(
      cacheKey,
      604800,
      async () => {
        const lookup = await lookupZoning(lat, lon);
        if (lookup.status === "unavailable") {
          throw new ZoningSourcesUnavailableError(lookup.message);
        }
        return lookup;
      },
    );

    const zba = await zbaPromise;
    return NextResponse.json(
      { ...result, zba },
      { headers: zba.status === "unavailable" ? UNAVAILABLE_HEADERS : CACHE_HEADERS },
    );
  } catch (error) {
    if (!(error instanceof ZoningSourcesUnavailableError)) {
      console.error("[zoning] lookup failed:", error);
    }
    const zba = await zbaPromise;
    return NextResponse.json(
      {
        status: "unavailable",
        zoneClass: null,
        zoneType: null,
        source: null,
        message: "Published Chicago zoning data is temporarily unavailable.",
        zba,
      },
      { status: 503, headers: UNAVAILABLE_HEADERS },
    );
  }
}
