import { NextRequest, NextResponse } from "next/server";
import { cached, roundCoord } from "@/lib/redis";
import { getSQL } from "@/lib/db";
import {
  describeClassCode,
  isCommercialClass,
  isIndustrialClass,
  isVacantClass,
} from "@/lib/parcel-classes";
import { classifyOwner } from "@/lib/owner-classify";
import {
  COOK_COUNTY_CURRENT_PARCELS_QUERY_URL,
  normalizePin14,
} from "@/lib/cook-viewer";
import { parcelAddressesMatch } from "@/lib/site-matchmaker-parcel-resolution";
import {
  CITY_BUILDING_FOOTPRINTS_VINTAGE,
  availableSpaceSourceLabel,
  compactParcelSpaceFacts,
  type ParcelSpaceFacts,
} from "@/lib/parcel-space";
import { socrataHeaders } from "@/lib/socrata";
import type { ParcelData, ParcelAddressMatch } from "@/lib/types";

/**
 * Queries Cook County parcel data for a PIN or a lat/lon point.
 *
 * Strategy:
 * 1. Check Redis cache (if configured)
 * 2. parcels table — exact PIN, or nearest stored row within ~50m (if DB configured)
 * 3. Cook County current CookViewer parcel service — exact PIN, or point-in-polygon
 * 4. When the caller supplies the address it is trying to resolve
 *    (`address=`), a small-radius CookViewer buffer search runs so the
 *    County-published street address can be compared against the request.
 *
 * The former Socrata Parcel Universe fallback (nj4t-kc8j) was removed: the
 * dataset was restructured into a geography crosswalk and no longer carries
 * `loc_property_location`, `prop_address`, square footage, or certified
 * values — coordinate queries 400 and PIN queries return rows without any of
 * the fields this endpoint needs.
 *
 * Address guard: every response carries `addressMatch` + `requestedAddress`.
 * A parcel resolved from a point can be the WRONG parcel for the address the
 * user typed (geocoded points land in the street right-of-way; city vacancy
 * records carry coordinates inside neighboring parcels), so consumers must
 * not present `mismatch`/`point` results as records for the searched address.
 *
 * GET /api/parcel?lat=41.75&lon=-87.58
 * GET /api/parcel?lat=41.75&lon=-87.58&address=9300%20S%20Drexel%20Ave
 * GET /api/parcel?pin=20123456789012
 */

const fmtMoney = (v: number | null) =>
  v != null ? `$${Number(v).toLocaleString()}` : null;

/** Log a swallowed source failure once per source per process, not per request. */
const loggedSourceFailures = new Set<string>();
function logSourceFailure(source: string, err: unknown) {
  if (loggedSourceFailures.has(source)) return;
  loggedSourceFailures.add(source);
  console.warn(`[parcel] ${source} lookup failing (logged once):`, err);
}

/**
 * Reduce a raw requested address (user input or a geocoder display name like
 * "9300, South Drexel Avenue, Burnside, Chicago, …") to the street line that
 * parcelAddressesMatch() expects.
 */
function requestedStreetLine(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const segments = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  // Nominatim display names split the house number into its own segment.
  if (segments.length > 1 && /^\d+[a-z]?$/i.test(segments[0])) {
    return `${segments[0]} ${segments[1]}`;
  }
  return segments[0];
}

/** Prefer an exact PIN; coordinates are only the fallback for address/map-point lookups. */
async function dbParcel(
  lat: number | null,
  lon: number | null,
  pin: string | null,
): Promise<ParcelData | null> {
  // Production intentionally keeps the parcels table empty. A configured
  // DATABASE_URL alone therefore must not trigger a guaranteed miss (or an
  // old-schema error) before every CookViewer lookup. Refresh/dev branches
  // with a migrated, populated parcels table opt in explicitly.
  if (process.env.PARCEL_DB_LOOKUPS_ENABLED !== "true") return null;

  const sql = getSQL();
  if (!sql) return null;
  try {
    const rows = pin
      ? await sql`
          SELECT pin, address, zip, class_code, class_description, tax_code, township,
                 land_sqft, bldg_sqft, bldg_age, land_value, bldg_value, total_value,
                 parcel_type, is_commercial, is_industrial, is_vacant,
                 owner_name, owner_mailing_address, owner_type
          FROM parcels
          WHERE pin = ${pin}
          LIMIT 1
        `
      : await sql`
          SELECT pin, address, zip, class_code, class_description, tax_code, township,
                 land_sqft, bldg_sqft, bldg_age, land_value, bldg_value, total_value,
                 parcel_type, is_commercial, is_industrial, is_vacant,
                 owner_name, owner_mailing_address, owner_type
          FROM parcels
          WHERE geom IS NOT NULL
            AND ST_DWithin(geom, ST_MakePoint(${lon}, ${lat})::geography, 50)
          ORDER BY geom <-> ST_MakePoint(${lon}, ${lat})::geography
          LIMIT 1
        `;
    if (rows.length === 0) return null;
    const r = rows[0];
    const landSqft = r.land_sqft != null ? Number(r.land_sqft) : null;
    const bldgSqft = r.bldg_sqft != null ? Number(r.bldg_sqft) : null;
    return {
      pin: r.pin || "",
      address: r.address || "",
      zip: r.zip || null,
      classCode: r.class_code || "",
      classDescription: r.class_description || describeClassCode(r.class_code || ""),
      taxCode: r.tax_code || "",
      township: r.township || "",
      landSqft,
      bldgSqft,
      bldgAge: r.bldg_age != null ? Number(r.bldg_age) : null,
      space: compactParcelSpaceFacts({
        lotAreaSqft: landSqft ?? undefined,
        assessorBuildingSqft: bldgSqft ?? undefined,
      }),
      landValue: fmtMoney(r.land_value != null ? Number(r.land_value) : null),
      bldgValue: fmtMoney(r.bldg_value != null ? Number(r.bldg_value) : null),
      totalValue: fmtMoney(r.total_value != null ? Number(r.total_value) : null),
      parcelType: r.parcel_type != null ? Number(r.parcel_type) : null,
      isCommercial: Boolean(r.is_commercial),
      isIndustrial: Boolean(r.is_industrial),
      isVacant: Boolean(r.is_vacant),
      ownerName: r.owner_name ?? null,
      ownerMailingAddress: r.owner_mailing_address ?? null,
      ownerType: r.owner_type ?? null,
    } satisfies ParcelData;
  } catch (err) {
    // Schema drift here (e.g. a prod table missing a column) previously made
    // the DB source vanish with no trace — keep the null fallthrough but say so.
    logSourceFailure("parcels-db", err);
    return null;
  }
}

async function dbParcelSpace(pin: string): Promise<ParcelSpaceFacts | undefined> {
  const sql = getSQL();
  const normalizedPin = pin.replace(/\D/g, "");
  if (!sql || normalizedPin.length !== 14) return undefined;
  try {
    const rows = await sql`
      SELECT metric, sqft, source_key, source_year, source_updated_at,
             fetched_at, verification_status, measurement_scope, is_active,
             verified_at, reconfirm_after
      FROM parcel_space_measurements
      WHERE pin = ${normalizedPin} AND is_current IS TRUE
      ORDER BY metric
    `;
    const facts: ParcelSpaceFacts = {};
    for (const row of rows) {
      const sqft = Number(row.sqft);
      if (!Number.isFinite(sqft) || sqft <= 0) continue;
      if (row.metric === "lot_area") {
        facts.lotAreaSqft = Math.round(sqft);
      } else if (row.metric === "assessor_building_area") {
        facts.assessorBuildingSqft = Math.round(sqft);
        const year = Number(row.source_year);
        if (Number.isInteger(year) && year > 1800) facts.assessorBuildingYear = year;
      } else if (row.metric === "city_ground_footprint") {
        facts.cityGroundFootprintSqft = Math.round(sqft);
        facts.cityGroundFootprintVintage = CITY_BUILDING_FOOTPRINTS_VINTAGE;
      } else if (
        row.metric === "available_space" &&
        row.verification_status === "verified" &&
        row.measurement_scope === "largest_contiguous_usable_interior_space" &&
        row.is_active === true &&
        row.verified_at &&
        row.reconfirm_after &&
        new Date(row.reconfirm_after).getTime() > Date.now()
      ) {
        facts.availableSpaceSqft = Math.round(sqft);
        facts.availableSpaceSource = availableSpaceSourceLabel(String(row.source_key ?? ""));
        facts.availableSpaceVerifiedAt = new Date(row.verified_at).toISOString();
        facts.availableSpaceReconfirmAfter = new Date(row.reconfirm_after).toISOString();
      }
    }
    return compactParcelSpaceFacts(facts);
  } catch {
    return undefined;
  }
}

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=300",
};

/** Fetch with retry and exponential backoff. */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  baseDelay = 1000
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return res;
      if (res.status >= 400 && res.status < 500) return res;
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt)));
    }
  }
  throw lastError || new Error("fetchWithRetry exhausted");
}

const COOK_VIEWER_OUT_FIELDS =
  "PIN14,street_address,city_state_zip,township_name,BCLASS,TAXDIST,LANDSF,BLDGSQFT,BLDGAGE,CURRENTVALUE_TOTAL,CURRENTVALUE_LAND,CURRENTVALUE_BLDG,TAXYR";

interface CookViewerFeature {
  attributes: Record<string, unknown>;
  geometry?: { rings?: number[][][] };
}

/** Run one CookViewer parcel query; throws on transport or ArcGIS-level error. */
async function cookViewerQuery(
  params: Record<string, string>,
): Promise<CookViewerFeature[]> {
  const url = new URL(COOK_COUNTY_CURRENT_PARCELS_QUERY_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("outFields", COOK_VIEWER_OUT_FIELDS);
  url.searchParams.set("f", "json");
  const res = await fetchWithRetry(url.toString(), {});
  if (!res.ok) throw new Error(`CookViewer HTTP ${res.status}`);
  const data = await res.json();
  // ArcGIS reports query errors inside a 200 body.
  if (data?.error) throw new Error(`CookViewer error ${JSON.stringify(data.error)}`);
  return Array.isArray(data?.features) ? data.features : [];
}

function pointGeometryParam(lat: number, lon: number): string {
  return JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } });
}

function parcelFromCookViewer(a: Record<string, unknown>): ParcelData {
  const classCode = typeof a.BCLASS === "string" ? a.BCLASS : "";
  const landSqft = a.LANDSF != null ? Number(a.LANDSF) : null;
  const bldgSqft = a.BLDGSQFT != null ? Number(a.BLDGSQFT) : null;
  return {
    pin: typeof a.PIN14 === "string" ? a.PIN14 : "",
    address: [a.street_address, a.city_state_zip]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join(", "),
    classCode,
    classDescription: describeClassCode(classCode),
    taxCode: typeof a.TAXDIST === "string" ? a.TAXDIST : "",
    township: typeof a.township_name === "string" ? a.township_name : "",
    landSqft,
    bldgSqft,
    bldgAge: a.BLDGAGE != null ? Number(a.BLDGAGE) : null,
    space: compactParcelSpaceFacts({
      lotAreaSqft: landSqft ?? undefined,
      assessorBuildingSqft: bldgSqft ?? undefined,
      assessorBuildingYear: a.TAXYR != null ? Number(a.TAXYR) : undefined,
    }),
    landValue: a.CURRENTVALUE_LAND != null ? `$${Number(a.CURRENTVALUE_LAND).toLocaleString()}` : null,
    bldgValue: a.CURRENTVALUE_BLDG != null ? `$${Number(a.CURRENTVALUE_BLDG).toLocaleString()}` : null,
    totalValue: a.CURRENTVALUE_TOTAL != null ? `$${Number(a.CURRENTVALUE_TOTAL).toLocaleString()}` : null,
    parcelType: null,
    isCommercial: isCommercialClass(classCode),
    isIndustrial: isIndustrialClass(classCode),
    isVacant: isVacantClass(classCode),
  } satisfies ParcelData;
}

/** The parcel's published street address (without the city/state tail). */
function parcelStreetAddress(parcel: ParcelData): string {
  return parcel.address.split(",")[0]?.trim() ?? "";
}

/** Squared planar distance from a point to a feature's nearest ring vertex. */
function featureDistanceSq(
  feature: CookViewerFeature,
  lat: number,
  lon: number,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const ring of feature.geometry?.rings ?? []) {
    for (const vertex of ring) {
      const dx = vertex[0] - lon;
      const dy = vertex[1] - lat;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return best;
}

interface ResolvedParcel {
  parcel: ParcelData;
  addressMatch: ParcelAddressMatch;
}

/**
 * Resolve a parcel for a coordinate lookup.
 *
 * `requested` is the street line the caller is trying to resolve (already
 * reduced from user input / geocoder display name), or null for pure map
 * points. The rules:
 * - A candidate whose County-published street address matches `requested`
 *   is returned as "verified".
 * - Otherwise the parcel CONTAINING the point (or the stored nearest-50m DB
 *   row) is returned, flagged "mismatch" when a requested address exists and
 *   disagrees, or "point" when the caller never named an address.
 * - Buffer-search candidates (within ~30m, for geocoded points that fall in
 *   the street right-of-way) are only ever returned when address-verified —
 *   a nearest unverified neighbor is exactly the wrong-parcel bug this
 *   endpoint exists to prevent.
 */
async function resolveByPoint(
  lat: number,
  lon: number,
  requested: string | null,
): Promise<ResolvedParcel | null> {
  const stored = await dbParcel(lat, lon, null);

  let containing: ParcelData | null = null;
  try {
    const features = await cookViewerQuery({
      geometry: pointGeometryParam(lat, lon),
      geometryType: "esriGeometryPoint",
      spatialRel: "esriSpatialRelIntersects",
      returnGeometry: "false",
    });
    if (features.length > 0) containing = parcelFromCookViewer(features[0].attributes);
  } catch (err) {
    logSourceFailure("cookviewer-point", err);
  }

  const primary = stored ?? containing;

  if (!requested) {
    return primary ? { parcel: primary, addressMatch: "point" } : null;
  }

  for (const candidate of [stored, containing]) {
    if (candidate && parcelAddressesMatch(requested, parcelStreetAddress(candidate))) {
      return { parcel: candidate, addressMatch: "verified" };
    }
  }

  // Geocoded street points often sit in the right-of-way and intersect no
  // parcel. Search a small buffer for a parcel whose published address matches
  // the requested one; take the closest match when several (condo splits).
  try {
    const features = await cookViewerQuery({
      geometry: pointGeometryParam(lat, lon),
      geometryType: "esriGeometryPoint",
      spatialRel: "esriSpatialRelIntersects",
      distance: "30",
      units: "esriSRUnit_Meter",
      // Distance-buffered queries IGNORE the geometry's embedded
      // spatialReference on this service and silently return zero features
      // without an explicit inSR (verified live 2026-08-20). Plain
      // point-intersect honors the embedded wkid; buffered does not.
      inSR: "4326",
      returnGeometry: "true",
      outSR: "4326",
    });
    const matches = features
      .map((feature) => ({
        feature,
        parcel: parcelFromCookViewer(feature.attributes),
      }))
      .filter(({ parcel }) => parcelAddressesMatch(requested, parcelStreetAddress(parcel)))
      .sort(
        (a, b) => featureDistanceSq(a.feature, lat, lon) - featureDistanceSq(b.feature, lat, lon),
      );
    if (matches.length > 0) {
      return { parcel: matches[0].parcel, addressMatch: "verified" };
    }
  } catch (err) {
    logSourceFailure("cookviewer-buffer", err);
  }

  return primary ? { parcel: primary, addressMatch: "mismatch" } : null;
}

async function resolveByPin(pin: string): Promise<ResolvedParcel | null> {
  const stored = await dbParcel(null, null, pin);
  if (stored) return { parcel: stored, addressMatch: "pin" };
  try {
    const features = await cookViewerQuery({
      where: `PIN14='${pin}'`,
      returnGeometry: "false",
    });
    if (features.length > 0) {
      return { parcel: parcelFromCookViewer(features[0].attributes), addressMatch: "pin" };
    }
  } catch (err) {
    logSourceFailure("cookviewer-pin", err);
  }
  return null;
}

export async function GET(request: NextRequest) {
  const rawPin = request.nextUrl.searchParams.get("pin");
  const pin = rawPin === null ? null : normalizePin14(rawPin);
  const latRaw = request.nextUrl.searchParams.get("lat");
  const lonRaw = request.nextUrl.searchParams.get("lon");
  const requested = requestedStreetLine(request.nextUrl.searchParams.get("address"));
  const lat = latRaw === null ? null : Number(latRaw);
  const lon = lonRaw === null ? null : Number(lonRaw);
  const hasCoordinates =
    lat !== null &&
    lon !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180;

  if ((rawPin !== null && pin === null) || (!pin && !hasCoordinates)) {
    return NextResponse.json(
      { error: "A valid 14-digit pin or valid lat and lon are required" },
      { status: 400 }
    );
  }

  // v5: keep DB-first and CookViewer-only caches separate so opting a
  // populated refresh/dev branch into the parcels table cannot consume a
  // CookViewer result cached by the default production source mode. v4
  // entries also predate this explicit source contract.
  const requestedKeyPart = requested
    ? `:a:${requested.toUpperCase().replace(/\s+/g, " ")}`
    : "";
  const parcelSourceMode =
    process.env.PARCEL_DB_LOOKUPS_ENABLED === "true" ? "db-first" : "cookviewer";
  const cacheKey = pin
    ? `parcel:v5:${parcelSourceMode}:pin:${pin}`
    : `parcel:v5:${parcelSourceMode}:${roundCoord(lat!)}:${roundCoord(lon!)}${requestedKeyPart}`;

  const result = await cached<ResolvedParcel | null>(cacheKey, 2592000, async () =>
    pin ? resolveByPin(pin) : resolveByPoint(lat!, lon!, requested),
  );

  if (!result) {
    return new NextResponse(null, { status: 204 });
  }

  // Mutable copy for enrichment
  const enriched: ParcelData = {
    ...result.parcel,
    addressMatch: result.addressMatch,
    requestedAddress: requested,
  };

  // Non-blocking Cook County Assessor enrichment (assessment + ownership)
  if (enriched.pin) {
    try {
      const assessorUrl = `https://datacatalog.cookcountyassessor.com/resource/uzyt-m557.json?pin=${enriched.pin}&$limit=1`;
      const res = await fetch(assessorUrl, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const a = data[0];
          enriched.assessedLand = a.certified_tot_land != null ? Number(a.certified_tot_land) : null;
          enriched.assessedBuilding = a.certified_tot_bldg != null ? Number(a.certified_tot_bldg) : null;
          enriched.assessedTotal =
            enriched.assessedLand != null && enriched.assessedBuilding != null
              ? enriched.assessedLand + enriched.assessedBuilding
              : null;
          enriched.taxYear = a.tax_year || null;
          enriched.priorYearTax = a.total_billed != null ? Number(a.total_billed) : null;
          // Ownership data
          enriched.ownerName = a.tax_bill_name || a.taxpayer_name || null;
          const mailingParts = [a.tax_bill_mailing_address, a.tax_bill_city, a.tax_bill_state, a.tax_bill_zip].filter(Boolean);
          enriched.ownerMailingAddress = mailingParts.length > 0 ? mailingParts.join(", ") : null;
          enriched.ownerType = classifyOwner(enriched.ownerName, enriched.ownerMailingAddress);
        }
      }
    } catch {
      // Assessment enrichment is non-blocking — failure is fine
    }

    const storedSpace = await dbParcelSpace(enriched.pin);
    enriched.space = compactParcelSpaceFacts({
      lotAreaSqft: enriched.landSqft ?? undefined,
      assessorBuildingSqft: enriched.bldgSqft ?? undefined,
      ...enriched.space,
      ...storedSpace,
    });
    enriched.landSqft = enriched.space?.lotAreaSqft ?? enriched.landSqft;
    enriched.bldgSqft = enriched.space?.assessorBuildingSqft ?? enriched.bldgSqft;
  }

  return NextResponse.json(enriched, { headers: CDN_HEADERS });
}
