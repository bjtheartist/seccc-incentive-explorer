import { NextRequest, NextResponse } from "next/server";
import { cached, roundCoord } from "@/lib/redis";
import { socrataHeaders } from "@/lib/socrata";
import { lookupChicagoZba } from "@/lib/chicago-zba";
import type {
  CityZoning,
  ZoningAnswerKind,
  ZoningAvailableResponse,
  ZoningLookupResponse,
  ZoningMirrorDatasetOutcome,
  ZoningMirrorQueryOutcome,
  ZoningMirrorVintage,
  ZoningNotFoundResponse,
  ZoningSourceMetadata,
  ZoningTimestamp,
  ZoningVintage,
} from "@/lib/types";

// Layer 1 is the queryable "Zoning Boundaries" feature layer. Layer 0 is the
// "Map Layers" GROUP layer: querying it returns ArcGIS error 400 "Invalid or
// missing input parameters" inside an HTTP 200 body.
const ARCGIS_LAYER_URL =
  "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1";
const SOCRATA_LAYER_URL =
  "https://data.cityofchicago.org/resource/dj47-wfun.geojson";
const SOCRATA_DATASET_URL = "https://data.cityofchicago.org/d/dj47-wfun";
const SOCRATA_METADATA_URL =
  "https://data.cityofchicago.org/api/views/dj47-wfun.json";

const ARCGIS_LABEL = "City of Chicago ArcGIS zoning boundaries";
const SOCRATA_LABEL = "City of Chicago Data Portal zoning boundaries";

/**
 * The two mirrors publish freshness at different scopes and neither is a
 * substitute for the other, so both are reported verbatim and the difference
 * is stated rather than resolved.
 */
const VINTAGE_COMPARABILITY_NOTE =
  "The two City mirrors publish freshness at different scopes and disagree. The ArcGIS layer publishes UPDATE_TIMESTAMP on each polygon and exposes no service-level edit date, so its timestamp covers only the returned polygon. The Data Portal publishes a dataset-level rowsUpdatedAt covering the whole table and says nothing about an individual polygon. Neither is the other's equivalent, and neither is presented here as the single zoning vintage.";

const ARCGIS_NO_DATASET_VINTAGE_NOTE =
  "This layer publishes UPDATE_TIMESTAMP per polygon and exposes no service-level editing timestamp, so no dataset-wide vintage is available from this mirror.";

/**
 * How long the response will wait on dataset-level provenance before reporting
 * it as not-waited-on. Provenance gathering must never delay an answer a mirror
 * has already given; an unwaited mirror still says so rather than going quiet.
 */
const DATASET_VINTAGE_WAIT_MS = 400;

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

/**
 * Signals total source failure out of the cache loader so the unavailable
 * state is never written to cache, while still carrying the provenance we
 * gathered so the caller can report which mirrors were tried.
 */
class ZoningSourcesUnavailableError extends Error {
  readonly vintage: ZoningVintage | undefined;

  constructor(message: string, vintage?: ZoningVintage) {
    super(message);
    this.vintage = vintage;
  }
}

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

interface SocrataDatasetVintage {
  rowsUpdatedAt: string | null;
  statedTimePeriod: string | null;
  outcome: ZoningMirrorDatasetOutcome;
}

/**
 * Read the Data Portal's self-reported dataset freshness: `rowsUpdatedAt` and
 * the curated "Time Period" custom field (currently the verbatim string
 * "Current as of June 2026"). Best effort only — a failure here reports an
 * explicit unknown and never affects whether zoning itself resolves.
 *
 * This describes the DATASET only. It says nothing about whether the Data
 * Portal's point query could be answered, which is tracked separately.
 */
async function fetchSocrataDatasetVintage(): Promise<SocrataDatasetVintage> {
  const unknown: SocrataDatasetVintage = {
    rowsUpdatedAt: null,
    statedTimePeriod: null,
    outcome: "unreachable",
  };

  try {
    const response = await fetch(SOCRATA_METADATA_URL, {
      headers: { ...socrataHeaders(), Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return unknown;

    const payload: unknown = await response.json();
    if (!isRecord(payload)) return unknown;

    // Socrata publishes rowsUpdatedAt as epoch SECONDS.
    const rawRowsUpdatedAt = payload.rowsUpdatedAt;
    const rowsUpdatedAt =
      typeof rawRowsUpdatedAt === "number" && Number.isFinite(rawRowsUpdatedAt)
        ? nullableIsoDate(rawRowsUpdatedAt * 1000)
        : null;

    const metadata = isRecord(payload.metadata) ? payload.metadata : null;
    const customFields =
      metadata && isRecord(metadata.custom_fields) ? metadata.custom_fields : null;
    const metadataGroup =
      customFields && isRecord(customFields.Metadata) ? customFields.Metadata : null;
    const statedTimePeriod = metadataGroup
      ? nullableString(metadataGroup["Time Period"])
      : null;

    return {
      rowsUpdatedAt,
      statedTimePeriod,
      outcome: rowsUpdatedAt ? "published" : "not_published",
    };
  } catch {
    return unknown;
  }
}

/**
 * Cap how long the response waits on dataset provenance. A mirror that has not
 * answered by the deadline is reported as not-waited-on, which is distinct from
 * unreachable: we stopped asking, so we cannot say the endpoint failed.
 */
function withDatasetVintageDeadline(
  pending: Promise<SocrataDatasetVintage>,
  waitMs = DATASET_VINTAGE_WAIT_MS,
): Promise<SocrataDatasetVintage> {
  const notWaited: SocrataDatasetVintage = {
    rowsUpdatedAt: null,
    statedTimePeriod: null,
    outcome: "not_waited",
  };

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(notWaited), waitMs);
    const settle = (value: SocrataDatasetVintage) => {
      clearTimeout(timer);
      resolve(value);
    };
    pending.then(settle, () => settle(notWaited));
  });
}

/**
 * What a mirror's point query did. A mirror that was never asked and a mirror
 * that answered "nothing here" are different facts and are never merged.
 */
function queryOutcomeOf(
  result: SourceQueryResult | null,
): ZoningMirrorQueryOutcome {
  if (!result) return "not_queried";
  if (result.status === "failed") return "failed";
  if (result.status === "empty") return "empty";
  return "answered";
}

/**
 * The timestamp of the polygon THIS mirror returned, or null when it returned
 * none. A record timestamp is never attributed to a mirror that did not
 * produce the record.
 */
function recordTimestampOf(
  result: SourceQueryResult | null,
  field: string,
): ZoningTimestamp | null {
  if (!result || result.status !== "found") return null;
  return {
    field,
    updatedAt: result.zoning.recordUpdatedAt ?? null,
    scope: "record",
  };
}

/** How this mirror's point query went, in plain language. */
function queryNote(
  outcome: ZoningMirrorQueryOutcome,
  field: string,
  hasRecordTimestamp: boolean,
): string {
  switch (outcome) {
    case "answered":
      return hasRecordTimestamp
        ? `${field} as published on the polygon this mirror returned. It describes that polygon only, not the dataset.`
        : `This mirror returned the polygon published here, but that polygon carried no ${field}.`;
    case "empty":
      return "This mirror was queried and returned no polygon for this point, so it published no record timestamp. Nothing was returned to carry one.";
    case "failed":
      return "This mirror's point query could not be answered for this lookup, so it reported nothing about this point either way. Its silence is not evidence that no polygon exists here.";
    case "not_queried":
      return "This mirror was not queried for this point, because the other mirror had already answered. It reported nothing about this point either way.";
  }
}

/** What this mirror could establish about its own dataset-wide freshness. */
function datasetNote(outcome: ZoningMirrorDatasetOutcome): string {
  switch (outcome) {
    case "published":
      return "Separately, rowsUpdatedAt is published for the whole dj47-wfun dataset and does not describe any individual polygon.";
    case "not_published":
      return "The dataset metadata was retrieved but published no rowsUpdatedAt value.";
    case "unreachable":
      return "The dataset metadata endpoint could not be reached for this lookup, so no dataset-wide freshness is reported from this mirror.";
    case "not_waited":
      return "The dataset metadata endpoint had not answered within the provenance deadline, so it was not waited on. It was not consulted for this lookup, which is not a finding that it publishes nothing.";
  }
}

/**
 * Report both mirrors' freshness side by side, each carrying what its own point
 * query did, what the polygon it returned (if any) was stamped with, and what
 * it publishes dataset-wide. Nothing a mirror did not establish is reported as
 * something it established.
 */
function buildVintage(
  retrievedAt: string,
  answeredBy: ZoningSourceMetadata["id"] | null,
  answerKind: ZoningAnswerKind | null,
  arcgis: SourceQueryResult | null,
  socrata: SourceQueryResult | null,
  datasetVintage: SocrataDatasetVintage,
): ZoningVintage {
  const arcgisOutcome = queryOutcomeOf(arcgis);
  const arcgisRecord = recordTimestampOf(arcgis, "UPDATE_TIMESTAMP");
  const arcgisMirror: ZoningMirrorVintage = {
    id: "chicago-arcgis-zoning",
    label: ARCGIS_LABEL,
    queryOutcome: arcgisOutcome,
    // The feature layer exposes no service-level editingInfo, so there is no
    // dataset-wide vintage to retrieve or to fail at retrieving.
    datasetOutcome: "not_published",
    record: arcgisRecord,
    dataset: null,
    note: `${queryNote(arcgisOutcome, "UPDATE_TIMESTAMP", Boolean(arcgisRecord?.updatedAt))} ${ARCGIS_NO_DATASET_VINTAGE_NOTE}`,
  };

  const socrataOutcome = queryOutcomeOf(socrata);
  const socrataRecord = recordTimestampOf(socrata, "edit_date");
  const socrataMirror: ZoningMirrorVintage = {
    id: "chicago-data-portal-zoning",
    label: SOCRATA_LABEL,
    queryOutcome: socrataOutcome,
    datasetOutcome: datasetVintage.outcome,
    record: socrataRecord,
    dataset:
      datasetVintage.outcome === "published"
        ? {
            field: "rowsUpdatedAt",
            updatedAt: datasetVintage.rowsUpdatedAt,
            scope: "dataset",
          }
        : null,
    note: `${queryNote(socrataOutcome, "edit_date", Boolean(socrataRecord?.updatedAt))} ${datasetNote(datasetVintage.outcome)}`,
    statedTimePeriod: datasetVintage.statedTimePeriod,
  };

  return {
    retrievedAt,
    answeredBy,
    answerKind,
    mirrors: [arcgisMirror, socrataMirror],
    comparabilityNote: VINTAGE_COMPARABILITY_NOTE,
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
    ARCGIS_LABEL,
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
    SOCRATA_LABEL,
    SOCRATA_DATASET_URL,
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
  const retrievedAt = new Date().toISOString();
  // Dataset-level freshness is independent of the point query, so it runs
  // alongside rather than adding a serial hop, and it is never waited on past
  // its deadline: provenance must not delay an answer a mirror already gave.
  const datasetVintagePromise = fetchSocrataDatasetVintage();

  const arcgis = await queryArcGis(lat, lon);
  const socrata =
    arcgis.status === "found" ? null : await querySocrata(lat, lon);

  const answered =
    arcgis.status === "found"
      ? arcgis
      : socrata?.status === "found"
        ? socrata
        : null;

  const buildVintageFor = async (
    answeredBy: ZoningSourceMetadata["id"] | null,
    answerKind: ZoningAnswerKind | null,
  ): Promise<ZoningVintage> =>
    buildVintage(
      retrievedAt,
      answeredBy,
      answerKind,
      arcgis,
      socrata,
      await withDatasetVintageDeadline(datasetVintagePromise),
    );

  if (answered) {
    return {
      status: "available",
      ...answered.zoning,
      source: answered.source,
      vintage: await buildVintageFor(answered.source.id, "zoning"),
    };
  }

  const emptyResult =
    arcgis.status === "empty"
      ? arcgis
      : socrata?.status === "empty"
        ? socrata
        : null;
  // An absence is only publishable as a determination when nothing was left
  // unasked. If the mirror that did NOT report empty could not answer, one
  // source was never able to speak and "no zoning here" would be reporting a
  // gap in our knowledge as a fact about the parcel.
  const someMirrorFailed =
    arcgis.status === "failed" || socrata?.status === "failed";

  if (emptyResult && !someMirrorFailed) {
    return {
      status: "not_found",
      zoneClass: null,
      zoneType: null,
      source: emptyResult.source,
      vintage: await buildVintageFor(emptyResult.source.id, "no_zoning"),
      message: "No published Chicago zoning district was returned for this location.",
    };
  }

  return {
    status: "unavailable",
    zoneClass: null,
    zoneType: null,
    source: null,
    vintage: await buildVintageFor(null, null),
    message: emptyResult
      ? "One City zoning mirror returned no district for this location and the other could not be reached, so the absence of a published district here is unconfirmed."
      : "Published Chicago zoning data is temporarily unavailable.",
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

  // v5: the response shape changed (per-mirror query outcome, record/dataset
  // split, answerKind). Serving a v4 entry would hand back a payload with no
  // vintage at all for the life of the TTL.
  const cacheKey = `zoning:v5:${roundCoord(lat, 5)}:${roundCoord(lon, 5)}`;
  const zbaPromise = lookupChicagoZba(lat, lon);

  try {
    const result = await cached<CacheableZoningResponse>(
      cacheKey,
      604800,
      async () => {
        const lookup = await lookupZoning(lat, lon);
        if (lookup.status === "unavailable") {
          throw new ZoningSourcesUnavailableError(lookup.message, lookup.vintage);
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
        ...(error instanceof ZoningSourcesUnavailableError && error.vintage
          ? { vintage: error.vintage }
          : {}),
        // Keep the specific reason when we have one. "One mirror said nothing
        // is here and the other could not be reached" is a different fact from
        // a plain outage, and the caller is entitled to it.
        message:
          error instanceof ZoningSourcesUnavailableError
            ? error.message
            : "Published Chicago zoning data is temporarily unavailable.",
        zba,
      },
      { status: 503, headers: UNAVAILABLE_HEADERS },
    );
  }
}
