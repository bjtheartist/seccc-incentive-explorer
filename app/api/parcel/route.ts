import { NextRequest, NextResponse } from "next/server";
import { cached, roundCoord } from "@/lib/redis";
import {
  describeClassCode,
  isCommercialClass,
  isIndustrialClass,
  isVacantClass,
} from "@/lib/parcel-classes";
import { socrataHeaders } from "@/lib/socrata";
import { classifyOwner } from "@/lib/owner-classify";
import type { ParcelData } from "@/lib/types";

/**
 * Queries Cook County parcel data at a given lat/lon.
 *
 * Strategy:
 * 1. Check Redis cache (if configured)
 * 2. Cook County ArcGIS MapServer Layer 44 (primary) — with retry
 * 3. Socrata Parcel Universe (fallback)
 *
 * GET /api/parcel?lat=41.75&lon=-87.58
 */

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
    // Source 1: Cook County ArcGIS MapServer Layer 44 (primary)
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

    // Source 2: Socrata Parcel Universe (fallback)
    try {
      const sodaUrl = `https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json?$where=within_circle(loc_property_location,${lat},${lon},50)&$limit=1`;
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
            address: r.prop_address || "",
            classCode,
            classDescription: describeClassCode(classCode),
            taxCode: r.tax_code || "",
            township: r.township_name || "",
            landSqft: r.land_square_footage != null ? Number(r.land_square_footage) : null,
            bldgSqft: r.building_square_footage != null ? Number(r.building_square_footage) : null,
            bldgAge: r.age != null ? Number(r.age) : null,
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
    return NextResponse.json(null, { status: 204 });
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
  }

  return NextResponse.json(enriched, { headers: CDN_HEADERS });
}
