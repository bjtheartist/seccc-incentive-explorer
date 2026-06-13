#!/usr/bin/env node
/**
 * Fetch Cook County property tax incentive parcels in the City of Chicago and
 * write public/data/zones/county-incentive-parcels.geojson for the map's
 * county incentive parcels layer.
 *
 * Source: Cook County Data Portal (Socrata)
 * - Assessor - Parcel Universe (Current Year Only): pabr-t5kh
 *   https://datacatalog.cookcountyil.gov/d/pabr-t5kh
 * - Assessor - Parcel Addresses (joined by PIN): 3723-97qp
 *   https://datacatalog.cookcountyil.gov/d/3723-97qp
 *
 * Cook County assessment classes 6xx/7xx/8xx/9xx are incentive
 * classifications (reduced assessment levels granted by the Assessor):
 *   6a/6b industrial, 6c "Class C" contamination remediation, 7a/7b
 *   commercial, 8 industrial/commercial in distressed areas, and 9
 *   affordable multifamily. Regular commercial/industrial is class 5, so
 *   every 6/7/8/9-prefixed class in the parcel universe is an incentive
 *   parcel. Code-to-program mapping follows the CCAO class dictionary
 *   (github.com/ccao-data/data-architecture, dbt/seeds/ccao/ccao.class_dict.csv).
 *
 * Usage: node scripts/sync-county-incentives.mjs
 * Optional: SOCRATA_APP_TOKEN env var for higher rate limits.
 */
import { writeFileSync } from "fs";
import { resolve } from "path";

const PARCEL_UNIVERSE_URL = "https://datacatalog.cookcountyil.gov/resource/pabr-t5kh.json";
const PARCEL_ADDRESSES_URL = "https://datacatalog.cookcountyil.gov/resource/3723-97qp.json";

// Chicago bounding box (matches CHI_BOUNDS in components/map/map-helpers.ts)
const CHI_BBOX = { minLon: -88.0, minLat: 41.6, maxLon: -87.4, maxLat: 42.1 };

const OUT_FILE = resolve(process.cwd(), "public/data/zones/county-incentive-parcels.geojson");

/**
 * Base class code (suffix letters stripped) → incentive program, per the
 * CCAO class dictionary. Any unlisted 6/7/8/9 code falls back by prefix.
 */
const CLASS_6A = new Set(["650", "680", "681", "683", "687", "689", "693"]);
const CLASS_6B = new Set(["651", "663", "670", "671", "673", "677", "679"]);
const CLASS_6C = new Set(["637", "638", "654", "655", "666", "668", "669"]);
const CLASS_7A = new Set([
  "700", "701", "716", "717", "722", "723", "726", "727", "728", "729",
  "730", "731", "732", "733", "735", "790", "791", "792", "797", "799",
]);
const CLASS_7B = new Set([
  "742", "743", "745", "746", "747", "748", "752", "753", "756", "757",
  "758", "760", "761", "762", "764", "765", "767", "772", "774", "798",
]);

function incentiveLabel(classCode) {
  const base = String(classCode).replace(/[A-Z]+$/, "");
  if (CLASS_6C.has(base)) return "Class C Contamination Remediation";
  if (CLASS_6B.has(base)) return "Class 6b Industrial";
  if (CLASS_6A.has(base)) return "Class 6a Industrial";
  if (CLASS_7A.has(base)) return "Class 7a Commercial";
  if (CLASS_7B.has(base)) return "Class 7b Commercial";
  switch (base[0]) {
    case "6": return "Class 6 Industrial";
    case "7": return "Class 7 Commercial";
    case "8": return "Class 8 Industrial/Commercial";
    case "9": return "Class 9 Multifamily";
    default: return `Class ${base}`;
  }
}

function titleCase(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(N|S|E|W|Ne|Nw|Se|Sw)\b\.?/g, (m) => m.toUpperCase());
}

function socrataHeaders() {
  return process.env.SOCRATA_APP_TOKEN
    ? { "X-App-Token": process.env.SOCRATA_APP_TOKEN }
    : {};
}

async function socrataQuery(url, params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${url}?${qs}`, { headers: socrataHeaders() });
  if (!res.ok) throw new Error(`Socrata query failed: HTTP ${res.status} (${url})`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Socrata query error: ${JSON.stringify(data)}`);
  return data;
}

/** All current-year City of Chicago parcels holding an incentive class. */
async function fetchIncentiveParcels() {
  const where =
    "cook_municipality_name='CITY OF CHICAGO' AND " +
    "(starts_with(class,'6') OR starts_with(class,'7') OR starts_with(class,'8') OR starts_with(class,'9'))";
  const rows = [];
  const pageSize = 5000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await socrataQuery(PARCEL_UNIVERSE_URL, {
      $select: "pin,class,lat,lon,year,chicago_community_area_name",
      $where: where,
      $order: "pin",
      $limit: String(pageSize),
      $offset: String(offset),
    });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

/** Property addresses for a set of PINs, newest assessment year wins. */
async function fetchAddresses(pins) {
  const byPin = new Map();
  const batchSize = 100;
  for (let i = 0; i < pins.length; i += batchSize) {
    const batch = pins.slice(i, i + batchSize);
    const inList = batch.map((p) => `'${p}'`).join(",");
    const rows = await socrataQuery(PARCEL_ADDRESSES_URL, {
      $select: "pin,year,prop_address_full,prop_address_zipcode_1",
      $where: `pin in(${inList}) AND year >= 2020`,
      $order: "year DESC",
      $limit: "50000",
    });
    for (const r of rows) {
      if (!byPin.has(r.pin) && r.prop_address_full) {
        byPin.set(r.pin, {
          address: titleCase(r.prop_address_full.trim()),
          zip: r.prop_address_zipcode_1 || "",
        });
      }
    }
    console.log(`  addresses: ${Math.min(i + batchSize, pins.length)}/${pins.length} PINs`);
  }
  return byPin;
}

function formatPin(pin) {
  // 14-digit PIN → 12-345-678-901-2345 style used by the Assessor
  return pin.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3-$4-$5");
}

console.log("Fetching Chicago incentive-class parcels from Cook County Parcel Universe...");
const parcels = await fetchIncentiveParcels();
console.log(`  ${parcels.length} incentive-class parcels returned.`);

const valid = parcels.filter((p) => {
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  return (
    /^\d{14}$/.test(p.pin || "") &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lon >= CHI_BBOX.minLon && lon <= CHI_BBOX.maxLon &&
    lat >= CHI_BBOX.minLat && lat <= CHI_BBOX.maxLat
  );
});
console.log(`  ${valid.length} parcels with clean PINs and in-bbox coordinates.`);

console.log("Joining property addresses from Assessor Parcel Addresses...");
const addresses = await fetchAddresses([...new Set(valid.map((p) => p.pin))]);

const features = valid.map((p) => {
  const label = incentiveLabel(p.class);
  const addr = addresses.get(p.pin);
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [
        Math.round(Number(p.lon) * 1e5) / 1e5,
        Math.round(Number(p.lat) * 1e5) / 1e5,
      ],
    },
    properties: {
      name: addr?.address ? `${label} - ${addr.address}` : `${label} - PIN ${formatPin(p.pin)}`,
      incentiveClass: label,
      classCode: p.class,
      pin: p.pin,
      address: addr?.address || "",
      zip: addr?.zip || "",
      communityArea: titleCase(p.chicago_community_area_name || ""),
      // cookcountyassessor.com 301s to the .gov domain; link canonical
      reportUrl: `https://www.cookcountyassessoril.gov/pin/${p.pin}`,
    },
  };
});

const fc = { type: "FeatureCollection", features };
writeFileSync(OUT_FILE, JSON.stringify(fc));
console.log(`Wrote ${features.length} county incentive parcels → ${OUT_FILE}`);
