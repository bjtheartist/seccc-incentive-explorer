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
import type { ParcelData } from "@/lib/types";

/**
 * Queries Cook County parcel data at a given lat/lon.
 *
 * Strategy:
 * 1. Check Redis cache (if configured)
 * 2. parcels table — nearest stored row within ~50m (if DB configured)
 * 3. Cook County ArcGIS MapServer Layer 44 — with retry
 * 4. Socrata Parcel Universe (fallback)
 *
 * GET /api/parcel?lat=41.75&lon=-87.58
 */

const fmtMoney = (v: number | null) =>
  v != null ? `$${Number(v).toLocaleString()}` : null;

const cleanZip = (zip: unknown) => {
  const value = typeof zip === "string" ? zip.trim() : "";
  return /^\d{5}$/.test(value) && value !== "00000" ? value : null;
};

/** Look up the nearest stored parcel within ~50m of the point, or null. */
async function dbParcel(lat: number, lon: number): Promise<ParcelData | null> {
  const sql = getSQL();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT pin, address, class_code, class_description, tax_code, township,
             land_sqft, bldg_sqft, bldg_age, land_value, bldg_value, total_value,
             parcel_type, is_commercial, is_industrial, is_vacant,
             owner_name, owner_mailing_address, owner_type, zip
      FROM parcels
      WHERE geom IS NOT NULL
        AND ST_DWithin(geom, ST_MakePoint(${lon}, ${lat})::geography, 50)
      ORDER BY geom <-> ST_MakePoint(${lon}, ${lat})::geography
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      pin: r.pin || "",
      address: r.address || "",
      zip: cleanZip(r.zip),
      classCode: r.class_code || "",
      classDescription: r.class_description || describeClassCode(r.class_code || ""),
      taxCode: r.tax_code || "",
      township: r.township || "",
      landSqft: r.land_sqft != null ? Number(r.land_sqft) : null,
      bldgSqft: r.bldg_sqft != null ? Number(r.bldg_sqft) : null,
      bldgAge: r.bldg_age != null ? Number(r.bldg_age) : null,
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

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=86400",
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
  const lat = request.nextUrl.searchParams.get("lat");
  const lon = request.nextUrl.searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json(
      { error: "lat and lon are required" },
      { status: 400 }
    );
  }

  const cacheKey = `parcel:${roundCoord(parseFloat(lat))}:${roundCoord(parseFloat(lon))}`;

  const result = await cached<ParcelData | null>(cacheKey, 2592000, async () => {
    // Source 1: persistent parcels store (DB-first)
    const stored = await dbParcel(parseFloat(lat!), parseFloat(lon!));
    if (stored) return stored;

    // Source 2: Cook County ArcGIS MapServer Layer 44
    try {
      const arcgisUrl = new URL(
        "https://gis.cookcountyil.gov/traditional/rest/services/cookVwrDynmc/MapServer/44/query"
      );
      arcgisUrl.searchParams.set(
        "geometry",
        JSON.stringify({ x: parseFloat(lon!), y: parseFloat(lat!), spatialReference: { wkid: 4326 } })
      );
      arcgisUrl.searchParams.set("geometryType", "esriGeometryPoint");
      arcgisUrl.searchParams.set("spatialRel", "esriSpatialRelIntersects");
      arcgisUrl.searchParams.set(
        "outFields",
        "PIN14,Address,City,Zip_Code,Town,BLDGClass,TaxCode,LandSqft,BldgSqft,BldgAge,TotalValue,LandValue,BldgValue,PARCELTYPE"
      );
      arcgisUrl.searchParams.set("returnGeometry", "false");
      arcgisUrl.searchParams.set("f", "json");

      const res = await fetchWithRetry(arcgisUrl.toString(), {});
      if (res.ok) {
        const data = await res.json();
        if (data.features && data.features.length > 0) {
          const a = data.features[0].attributes;
          const classCode = a.BLDGClass || "";
          return {
            pin: a.PIN14 || "",
            address: [a.Address, a.City, a.Zip_Code].filter(Boolean).join(", "),
            zip: cleanZip(a.Zip_Code),
            classCode,
            classDescription: describeClassCode(classCode),
            taxCode: a.TaxCode || "",
            township: a.Town || "",
            landSqft: a.LandSqft != null ? Number(a.LandSqft) : null,
            bldgSqft: a.BldgSqft != null ? Number(a.BldgSqft) : null,
            bldgAge: a.BldgAge != null ? Number(a.BldgAge) : null,
            landValue: a.LandValue != null ? `$${Number(a.LandValue).toLocaleString()}` : null,
            bldgValue: a.BldgValue != null ? `$${Number(a.BldgValue).toLocaleString()}` : null,
            totalValue: a.TotalValue != null ? `$${Number(a.TotalValue).toLocaleString()}` : null,
            parcelType: a.PARCELTYPE != null ? Number(a.PARCELTYPE) : null,
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
      const pointLat = parseFloat(lat!);
      const pointLon = parseFloat(lon!);
      const delta = 0.0008; // roughly 50-90m around Chicago, enough for a parcel fallback.
      const where = encodeURIComponent(
        `lat between ${pointLat - delta} and ${pointLat + delta} AND lon between ${pointLon - delta} and ${pointLon + delta}`
      );
      const sodaUrl = `https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json?$where=${where}&$limit=1&$order=year DESC`;
      const res = await fetchWithRetry(sodaUrl, {
        headers: socrataHeaders(),
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const r = data[0];
          const classCode = r.class || "";
          return {
            pin: r.pin || "",
            address: r.prop_address || r.address || "",
            zip: cleanZip(r.zip_code),
            classCode,
            classDescription: describeClassCode(classCode),
            taxCode: r.tax_code || "",
            township: r.township_name || "",
            landSqft: r.land_square_footage != null ? Number(r.land_square_footage) : null,
            bldgSqft: r.building_square_footage != null ? Number(r.building_square_footage) : null,
            bldgAge: r.age != null ? Number(r.age) : null,
            landValue: null,
            bldgValue: null,
            totalValue: null,
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
  enriched.zip = cleanZip(enriched.zip);

  // Non-blocking assessed-value enrichment.
  if (enriched.pin) {
    try {
      const assessorUrl = `https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json?pin=${enriched.pin}&$limit=1&$order=year DESC`;
      const res = await fetch(assessorUrl, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const a = data[0];
          enriched.assessedLand = a.certified_land != null ? Number(a.certified_land) : null;
          enriched.assessedBuilding = a.certified_bldg != null ? Number(a.certified_bldg) : null;
          enriched.assessedTotal =
            a.certified_tot != null
              ? Number(a.certified_tot)
              : enriched.assessedLand != null && enriched.assessedBuilding != null
                ? enriched.assessedLand + enriched.assessedBuilding
                : null;
          enriched.taxYear = a.year || null;
        }
      }
    } catch {
      // Assessment enrichment is non-blocking — failure is fine
    }
  }

  return NextResponse.json(enriched, { headers: CDN_HEADERS });
}
