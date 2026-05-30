import { readFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  MultiPolygon,
  Polygon,
} from "geojson";
import { socrataFetch } from "@/lib/socrata";
import {
  buildTifFinancialContext,
  normalizeTifNumber,
  type TifAnnualReportRow,
  type TifDistrictMatch,
} from "@/lib/tif-financials";

export const runtime = "nodejs";

const TIF_ANNUAL_REPORT_DATASET = "https://data.cityofchicago.org/resource/qm7s-3ctt.json";

let tifBoundaryCache: FeatureCollection | null = null;

async function loadTifBoundaries(): Promise<FeatureCollection> {
  if (tifBoundaryCache) return tifBoundaryCache;
  const filePath = path.join(process.cwd(), "public", "data", "zones", "tif-districts.geojson");
  const raw = await readFile(filePath, "utf8");
  tifBoundaryCache = JSON.parse(raw) as FeatureCollection;
  return tifBoundaryCache;
}

function getStringProp(props: GeoJsonProperties, keys: string[]): string | null {
  for (const key of keys) {
    const value = props?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

async function findTifDistrict(lat: number, lon: number): Promise<TifDistrictMatch | null> {
  const point = turf.point([lon, lat]);
  const collection = await loadTifBoundaries();
  const match = collection.features.find(
    (feature): feature is Feature<Polygon | MultiPolygon> =>
      Boolean(feature.geometry) &&
      turf.booleanPointInPolygon(point, feature as Feature<Polygon | MultiPolygon>)
  );

  if (!match) return null;

  const props = match.properties || {};
  const tifNumber = normalizeTifNumber(getStringProp(props, ["TIF Number", "ref", "tif_number"]));
  const districtName = getStringProp(props, ["District Name", "name", "tif_district"]);
  if (!tifNumber || !districtName) return null;

  return {
    tifNumber,
    districtName,
    wards: getStringProp(props, ["Wards", "wards"]),
    expirationDate: getStringProp(props, ["Expiration Date", "expiration"]),
  };
}

async function fetchLatestAnnualReport(tifNumber: string): Promise<TifAnnualReportRow | null> {
  const params = new URLSearchParams({
    $select:
      "tif_number,tif_district,report_year,property_tax_increment_current,total_expenditure,fund_balance,amount_designated_debt_obligations,amount_designated_project_costs,surplus_deficit",
    $where: `tif_number='${tifNumber}'`,
    $order: "report_year DESC",
    $limit: "1",
  });

  const rows = await socrataFetch<TifAnnualReportRow[]>(
    `${TIF_ANNUAL_REPORT_DATASET}?${params.toString()}`,
    8000
  );

  return rows?.[0] || null;
}

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lon = Number(request.nextUrl.searchParams.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Valid lat and lon are required" }, { status: 400 });
  }

  try {
    const district = await findTifDistrict(lat, lon);
    if (!district) {
      return NextResponse.json({ matched: false }, {
        headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
      });
    }

    const latestReport = await fetchLatestAnnualReport(district.tifNumber);
    const context = buildTifFinancialContext(district, latestReport);

    return NextResponse.json(
      { matched: true, context },
      {
        headers: {
          "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        },
      }
    );
  } catch (error) {
    console.error("tif financials API error:", error);
    return NextResponse.json({ error: "TIF financial lookup failed" }, { status: 500 });
  }
}
