#!/usr/bin/env node
/**
 * Fetch Neighborhood Opportunity Fund (NOF) funded project awards from the
 * Chicago data portal and write public/data/zones/nof-funded-projects.geojson
 * for the map's NOF funded projects point layer.
 *
 * Sources (SODA):
 * - rym7-49n8 — Financial Incentive Projects - NOF Small
 * - j7ew-b73u — Financial Incentive Projects - NOF Large
 *
 * Usage: node scripts/sync-nof-projects.mjs
 */
import { writeFileSync } from "fs";
import { resolve } from "path";

const DATASETS = [
  { id: "rym7-49n8", grantType: "small" },
  { id: "j7ew-b73u", grantType: "large" },
];

// Chicago bounding box (matches CHI_BOUNDS in components/map/map-helpers.ts)
const CHI_BBOX = { west: -88.0, south: 41.6, east: -87.4, north: 42.1 };

const OUT_FILE = resolve(
  process.cwd(),
  "public/data/zones/nof-funded-projects.geojson"
);

const FIELDS = [
  "project_name",
  "applicant_name",
  "address_number",
  "address_number_high",
  "street_direction",
  "street_name",
  "street_type",
  "ward",
  "community_area",
  "approval_date",
  "completion_date",
  "incentive_amount",
  "total_project_cost",
  "location",
].join(",");

function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}

function buildAddress(r) {
  const number = r.address_number_high
    ? `${r.address_number}-${r.address_number_high}`
    : r.address_number;
  return [number, r.street_direction, r.street_name, r.street_type]
    .filter(Boolean)
    .join(" ");
}

async function fetchDataset({ id, grantType }) {
  const params = new URLSearchParams({
    $select: FIELDS,
    $limit: "5000",
  });
  if (process.env.SOCRATA_APP_TOKEN) {
    params.set("$$app_token", process.env.SOCRATA_APP_TOKEN);
  }
  const res = await fetch(
    `https://data.cityofchicago.org/resource/${id}.json?${params}`
  );
  if (!res.ok) throw new Error(`SODA query failed for ${id}: HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) {
    throw new Error(`SODA query error for ${id}: ${JSON.stringify(rows)}`);
  }
  return rows.map((r) => ({ ...r, grantType }));
}

const results = await Promise.all(DATASETS.map(fetchDataset));
const rows = results.flat();

let skipped = 0;
const features = [];
for (const r of rows) {
  const coords = r.location?.coordinates;
  if (
    !Array.isArray(coords) ||
    typeof coords[0] !== "number" ||
    typeof coords[1] !== "number"
  ) {
    skipped++;
    continue;
  }
  const [lon, lat] = coords;
  if (
    lon < CHI_BBOX.west ||
    lon > CHI_BBOX.east ||
    lat < CHI_BBOX.south ||
    lat > CHI_BBOX.north
  ) {
    skipped++;
    continue;
  }

  features.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: [round5(lon), round5(lat)] },
    properties: {
      name: r.project_name || r.applicant_name || "NOF Project",
      address: buildAddress(r),
      grantAmount: r.incentive_amount ? Number(r.incentive_amount) : null,
      grantType: r.grantType,
      status: r.completion_date ? "completed" : "approved",
      applicant: r.applicant_name || "",
      communityArea: r.community_area || "",
      ward: r.ward || "",
      approvalDate: r.approval_date ? r.approval_date.slice(0, 10) : "",
      completionDate: r.completion_date ? r.completion_date.slice(0, 10) : "",
      totalProjectCost: r.total_project_cost ? Number(r.total_project_cost) : null,
    },
  });
}

const fc = { type: "FeatureCollection", features };
writeFileSync(OUT_FILE, JSON.stringify(fc));
console.log(
  `Wrote ${features.length} NOF funded projects (${skipped} skipped) → ${OUT_FILE}`
);
