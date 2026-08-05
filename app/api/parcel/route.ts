import { NextRequest, NextResponse } from "next/server";
import { cached, roundCoord } from "@/lib/redis";
import { getSQL } from "@/lib/db";
import {
  describeClassCode,
  isCommercialClass,
  isIndustrialClass,
  isVacantClass,
} from "@/lib/parcel-classes";
import { socrataHeaders } from "@/lib/socrata";
import { classifyOwner } from "@/lib/owner-classify";
import {
  COOK_COUNTY_CURRENT_PARCELS_QUERY_URL,
  normalizePin14,
} from "@/lib/cook-viewer";
import {
  CITY_BUILDING_FOOTPRINTS_VINTAGE,
  availableSpaceSourceLabel,
  compactParcelSpaceFacts,
  type ParcelSpaceFacts,
} from "@/lib/parcel-space";
import type { ParcelData } from "@/lib/types";

/**
 * Queries Cook County parcel data at a given lat/lon.
 *
 * Strategy:
 * 1. Check Redis cache (if configured)
 * 2. parcels table — nearest stored row within ~50m (if DB configured)
 * 3. Cook County current CookViewer parcel service — with retry
 * 4. Socrata Parcel Universe (fallback)
 *
 * GET /api/parcel?lat=41.75&lon=-87.58
 * GET /api/parcel?pin=20123456789012
 */

const fmtMoney = (v: number | null) =>
  v != null ? `$${Number(v).toLocaleString()}` : null;

/** Prefer an exact PIN; coordinates are only the fallback for address/map-point lookups. */
async function dbParcel(
  lat: number | null,
  lon: number | null,
  pin: string | null,
): Promise<ParcelData | null> {
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
  } catch {
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

export async function GET(request: NextRequest) {
  const rawPin = request.nextUrl.searchParams.get("pin");
  const pin = rawPin === null ? null : normalizePin14(rawPin);
  const latRaw = request.nextUrl.searchParams.get("lat");
  const lonRaw = request.nextUrl.searchParams.get("lon");
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

  const cacheKey = pin
    ? `parcel:v3:pin:${pin}`
    : `parcel:v3:${roundCoord(lat!)}:${roundCoord(lon!)}`;

  const result = await cached<ParcelData | null>(cacheKey, 2592000, async () => {
    // Source 1: persistent parcels store (DB-first)
    const stored = await dbParcel(lat, lon, pin);
    if (stored) return stored;

    // Source 2: Cook County current CookViewer parcel service
    try {
      const arcgisUrl = new URL(COOK_COUNTY_CURRENT_PARCELS_QUERY_URL);
      if (pin) {
        arcgisUrl.searchParams.set("where", `PIN14='${pin}'`);
      } else {
        arcgisUrl.searchParams.set(
          "geometry",
          JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } })
        );
        arcgisUrl.searchParams.set("geometryType", "esriGeometryPoint");
        arcgisUrl.searchParams.set("spatialRel", "esriSpatialRelIntersects");
      }
      arcgisUrl.searchParams.set(
        "outFields",
        "PIN14,street_address,city_state_zip,township_name,BCLASS,TAXDIST,LANDSF,BLDGSQFT,BLDGAGE,CURRENTVALUE_TOTAL,CURRENTVALUE_LAND,CURRENTVALUE_BLDG,TAXYR"
      );
      arcgisUrl.searchParams.set("returnGeometry", "false");
      arcgisUrl.searchParams.set("f", "json");

      const res = await fetchWithRetry(arcgisUrl.toString(), {});
      if (res.ok) {
        const data = await res.json();
        if (data.features && data.features.length > 0) {
          const a = data.features[0].attributes;
          const classCode = a.BCLASS || "";
          const landSqft = a.LANDSF != null ? Number(a.LANDSF) : null;
          const bldgSqft = a.BLDGSQFT != null ? Number(a.BLDGSQFT) : null;
          return {
            pin: a.PIN14 || "",
            address: [a.street_address, a.city_state_zip].filter(Boolean).join(", "),
            classCode,
            classDescription: describeClassCode(classCode),
            taxCode: a.TAXDIST || "",
            township: a.township_name || "",
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
      }
    } catch {
      // Fall through to Socrata
    }

    // Source 3: Socrata Parcel Universe (fallback)
    try {
      const where = pin
        ? `pin='${pin}'`
        : `within_circle(loc_property_location,${lat},${lon},50)`;
      const sodaUrl = `https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json?$where=${encodeURIComponent(where)}&$limit=1`;
      const res = await fetchWithRetry(sodaUrl, {
        headers: socrataHeaders(),
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const r = data[0];
          const classCode = r.class || "";
          const landSqft = r.land_square_footage != null ? Number(r.land_square_footage) : null;
          const bldgSqft =
            r.building_square_footage != null ? Number(r.building_square_footage) : null;
          return {
            pin: r.pin || "",
            address: r.prop_address || "",
            classCode,
            classDescription: describeClassCode(classCode),
            taxCode: r.tax_code || "",
            township: r.township_name || "",
            landSqft,
            bldgSqft,
            bldgAge: r.age != null ? Number(r.age) : null,
            space: compactParcelSpaceFacts({
              lotAreaSqft: landSqft ?? undefined,
              assessorBuildingSqft: bldgSqft ?? undefined,
            }),
            landValue: r.certified_land != null ? `$${Number(r.certified_land).toLocaleString()}` : null,
            bldgValue: r.certified_building != null ? `$${Number(r.certified_building).toLocaleString()}` : null,
            totalValue: r.certified_total != null ? `$${Number(r.certified_total).toLocaleString()}` : null,
            parcelType: r.property_type != null ? Number(r.property_type) : null,
            isCommercial: isCommercialClass(classCode),
            isIndustrial: isIndustrialClass(classCode),
            isVacant: isVacantClass(classCode),
          } satisfies ParcelData;
        }
      }
    } catch {
      // All sources failed
    }

    return null;
  });

  if (!result) {
    return new NextResponse(null, { status: 204 });
  }

  // Mutable copy for enrichment
  const enriched: ParcelData = { ...result };

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
