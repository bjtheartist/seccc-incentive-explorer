/**
 * scripts/preview-vacancy-index-pdf.ts
 *
 * Visual-iteration tool for the five-sheet Vacancy Opportunity Index PDF
 * (lib/vacancy-index-pdf.ts): COVER, 01 Executive Brief, 02 System Overview,
 * 03 Property Network Map, 04 Site Index. Renders through the exact builder the
 * live app uses (generateVacancyIndexPdfBase64), so what you read here is what a
 * downloader gets.
 *
 * Two modes, because the real export (public/data/vacancy-index.json) does not
 * exist yet:
 *   (a) Real-ish editions assembled from the shipped bulk data —
 *       public/data/vacant-properties.json (communityArea filtered
 *       CASE-INSENSITIVELY: "ENGLEWOOD" and "Englewood" both occur) plus the
 *       ZIP-shaped boundary borrowed from public/data/community-areas.geojson
 *       (largest ring, decimated to <=300 points) and the clipped
 *       public/data/transport-network.geojson. Density stress = Englewood
 *       (~700 pts); sparse = South Chicago (~91 pts).
 *   (b) A synthetic stress fixture: null sqft/zoning, null matrix cells, null
 *       ownerTypeDistribution, truncated-points copy, very long addresses,
 *       boundary: null (dot-field silhouette fallback).
 *
 * NOTE: these editions are a DEV APPROXIMATION for layout iteration only. The
 * boundary here is a community-area ring, not the ZIP polygon the real export
 * PIP-assigns, and ownerTypeDistribution is stood in from the same tracked rows
 * rather than the parcels dataset. The committed export is the source of truth.
 *
 * Run:  npx tsx scripts/preview-vacancy-index-pdf.ts [neighborhood]
 * Or:   npm run vacancy:preview
 *
 * Output: output/pdf/vacancy-index-preview.pdf (+ -sparse / -stress variants),
 * gitignored — regenerate anytime.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  generateVacancyIndexPdfBase64,
  type VacancyIndexInput,
  type VacancyIndexMatrixRow,
  type VacancyIndexTopSite,
  type VacancyIndexTransportLine,
  type VacancyPriorityTier,
} from "@/lib/vacancy-index-pdf";
import { PILOT_ZIPS } from "@/lib/pilot-zips";
import { normalizeOwnerType, type OwnerType } from "@/lib/owner-classify";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "public", "data");

const METRIC_LABELS = [
  "Tracked Vacant",
  "Vacancy Rate",
  "Local Ownership",
  "Incentive Coverage",
  "City-Owned Share",
];

const SOURCES = [
  "Cook County Assessor (city-owned land inventory)",
  "Chicago 311 vacant/abandoned reports",
  "Chicago ZIP boundaries",
  "Chicago transportation network",
];

type Feature = {
  geometry: { type: string; coordinates: [number, number] };
  properties: {
    id: string;
    source: string;
    address: string;
    propertyType: "vacant_land" | "vacant_building";
    communityArea: string;
    zoningClass: string | null;
    squareFeet: number | null;
    status: string;
    incentiveCount: number;
    ownerType: string | null;
  };
};

/* ── Priority rubric (mirrors the export/adapter — preview stand-in) ── */

function priorityScore(p: Feature["properties"]): number {
  let score = Math.min(p.incentiveCount ?? 0, 4);
  const sqft = p.squareFeet ?? 0;
  if (sqft >= 10000) score += 2;
  else if (sqft >= 5000) score += 1;
  if (p.ownerType === "city_public" || p.status === "city_owned") score += 2;
  if (p.propertyType === "vacant_building" && p.status === "reported_open") score += 1;
  return score;
}

function tierOf(score: number): VacancyPriorityTier {
  if (score >= 6) return "high";
  if (score >= 3) return "medium";
  return "low";
}

function nextStepFor(ownerType: OwnerType, propertyType: string): string {
  switch (ownerType) {
    case "city_public":
      return "City/CCLBA disposition inquiry";
    case "corporate_llc":
      return "Entity outreach — open the admin Owner File";
    case "out_of_state":
      return "Entity outreach — open the admin Owner File; identify local agent";
    case "local_private":
      return "Direct owner contact (individual owner — no automated letter)";
    default:
      return propertyType === "vacant_building"
        ? "Verify ownership via Assessor/Recorder; check 311 case status"
        : "Verify ownership via Cook County Assessor";
  }
}

/* ── Geometry helpers ── */

function bboxOf(points: [number, number][], pad = 0.01): [number, number, number, number] {
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const lonPad = (maxLon - minLon) * pad;
  const latPad = (maxLat - minLat) * pad;
  return [minLon - lonPad, minLat - latPad, maxLon + lonPad, maxLat + latPad];
}

function decimate<T>(arr: T[], maxLen: number): T[] {
  if (arr.length <= maxLen) return arr;
  const step = Math.ceil(arr.length / maxLen);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

/** Community-area outer boundary ring for the neighborhood, decimated to <=300. */
function loadBoundary(neighborhood: string): [number, number][] | null {
  const geo = JSON.parse(readFileSync(path.join(DATA, "community-areas.geojson"), "utf8"));
  const feat = geo.features.find(
    (f: { properties: { community: string } }) =>
      f.properties.community.toUpperCase() === neighborhood.toUpperCase()
  );
  if (!feat) return null;
  // MultiPolygon -> pick the ring with the most points (largest lobe outer ring).
  let best: [number, number][] = [];
  const polygons = feat.geometry.type === "MultiPolygon" ? feat.geometry.coordinates : [feat.geometry.coordinates];
  for (const poly of polygons) {
    const outer = poly[0] as [number, number][];
    if (outer.length > best.length) best = outer;
  }
  return decimate(best, 300);
}

/** Clip transport LineStrings to the bbox, keeping inside runs (>=2 pts). */
function loadTransport(bbox: [number, number, number, number]): VacancyIndexTransportLine[] {
  const geo = JSON.parse(readFileSync(path.join(DATA, "transport-network.geojson"), "utf8"));
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const inside = ([lon, lat]: [number, number]) =>
    lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
  const lines: VacancyIndexTransportLine[] = [];
  for (const f of geo.features as {
    geometry: { type: string; coordinates: [number, number][] };
    properties: { kind: string };
  }[]) {
    if (f.geometry.type !== "LineString") continue;
    const kind = f.properties.kind === "rail" ? "rail" : "expressway";
    let run: [number, number][] = [];
    for (const pt of f.geometry.coordinates) {
      if (inside(pt)) run.push(pt);
      else {
        if (run.length >= 2) lines.push({ kind, points: decimate(run, 60) });
        run = [];
      }
    }
    if (run.length >= 2) lines.push({ kind, points: decimate(run, 60) });
  }
  return lines;
}

/* ── Assemble a real-ish edition ── */

function assembleEdition(neighborhood: string): VacancyIndexInput {
  const entry = PILOT_ZIPS.find(
    (e) => e.primaryNeighborhood.toUpperCase() === neighborhood.toUpperCase()
  );
  const zipCode = entry?.zip ?? "60636";
  const editionNumber =
    PILOT_ZIPS.findIndex((e) => e.zip === zipCode) + 1 || 1;

  const raw = JSON.parse(readFileSync(path.join(DATA, "vacant-properties.json"), "utf8"));
  const features: Feature[] = raw.features.filter(
    (f: Feature) => f.properties.communityArea.toUpperCase() === neighborhood.toUpperCase()
  );

  // Priority-order once: sitePoints[i] aligns with topSites[i] (builder contract).
  const ranked = [...features].sort((a, b) => {
    const sa = priorityScore(a.properties);
    const sb = priorityScore(b.properties);
    if (sb !== sa) return sb - sa;
    if ((b.properties.incentiveCount ?? 0) !== (a.properties.incentiveCount ?? 0))
      return (b.properties.incentiveCount ?? 0) - (a.properties.incentiveCount ?? 0);
    return (b.properties.squareFeet ?? 0) - (a.properties.squareFeet ?? 0);
  });

  const sitePoints = ranked.map((f) => ({
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    ownerType: f.properties.ownerType,
  }));

  const topSites: VacancyIndexTopSite[] = ranked.slice(0, 15).map((f) => {
    const ot = normalizeOwnerType(f.properties.ownerType);
    return {
      address: f.properties.address,
      ownerType: f.properties.ownerType,
      propertyType: f.properties.propertyType,
      zoning: f.properties.zoningClass,
      sqft: f.properties.squareFeet && f.properties.squareFeet > 0 ? f.properties.squareFeet : null,
      priority: tierOf(priorityScore(f.properties)),
      nextStep: nextStepFor(ot, f.properties.propertyType),
    };
  });

  const total = features.length;
  const cityOwned = features.filter(
    (f) => f.properties.status === "city_owned" || f.properties.ownerType === "city_public"
  ).length;
  const inIncentiveZones = features.filter((f) => (f.properties.incentiveCount ?? 0) > 0).length;

  const trackedInventoryByOwnerType: Partial<Record<OwnerType, number>> = {};
  const landOwnerType: Partial<Record<OwnerType, number>> = {};
  let vacantLand = 0;
  let vacantBuilding = 0;
  const priorityDistribution = { high: 0, medium: 0, low: 0 };
  for (const f of features) {
    const ot = normalizeOwnerType(f.properties.ownerType);
    trackedInventoryByOwnerType[ot] = (trackedInventoryByOwnerType[ot] ?? 0) + 1;
    if (f.properties.propertyType === "vacant_building") vacantBuilding += 1;
    else {
      vacantLand += 1;
      landOwnerType[ot] = (landOwnerType[ot] ?? 0) + 1;
    }
    priorityDistribution[tierOf(priorityScore(f.properties))] += 1;
  }

  const boundary = loadBoundary(neighborhood);
  const ringForBbox: [number, number][] =
    boundary ?? sitePoints.map((p) => [p.lon, p.lat] as [number, number]);
  const bbox = bboxOf(ringForBbox, 0.05);
  const transport = loadTransport(bbox);

  const centroid = boundary
    ? {
        lat: boundary.reduce((s, p) => s + p[1], 0) / boundary.length,
        lon: boundary.reduce((s, p) => s + p[0], 0) / boundary.length,
      }
    : {
        lat: sitePoints.reduce((s, p) => s + p.lat, 0) / Math.max(1, sitePoints.length),
        lon: sitePoints.reduce((s, p) => s + p.lon, 0) / Math.max(1, sitePoints.length),
      };

  const matrixRows = buildMatrix(zipCode);

  const brief =
    `${neighborhood} carries ${total} tracked vacant properties across ZIP ${zipCode}. ` +
    `${cityOwned} are City/Public-owned and ${total - cityOwned} are privately held; ` +
    `${inIncentiveZones} sit inside at least one mapped incentive zone. The site index ranks the ` +
    `highest-opportunity parcels by incentive coverage, size, and owner type so a corridor manager ` +
    `can start with the clearest next contact.`;

  const largestBloc = (Object.entries(trackedInventoryByOwnerType).sort((a, b) => b[1] - a[1])[0] ?? [
    "unknown",
    0,
  ]) as [string, number];

  return {
    neighborhood,
    zipCode,
    editionNumber,
    asOf: "July 19, 2026",
    counts: { total, cityOwned, privatelyHeld: total - cityOwned, inIncentiveZones },
    brief,
    decisions: [
      {
        title: "Target the largest owner bloc",
        body: `${largestBloc[1]} tracked properties share the ${largestBloc[0].replace(/_/g, " ")} owner type — the widest single outreach lane.`,
      },
      {
        title: "Move city-owned land toward disposition",
        body: `${cityOwned} City/Public parcels can enter a CCLBA/City disposition inquiry without an owner-outreach letter.`,
      },
      {
        title: "Run a verification sweep on the priority sites",
        body: `${priorityDistribution.high} high-priority sites warrant an ownership/status verification pass before any letter.`,
      },
    ],
    ownerTypeDistribution: vacantLand > 0 ? landOwnerType : null,
    trackedInventoryByOwnerType,
    propertyTypeBreakdown: { vacantLand, vacantBuilding },
    priorityDistribution,
    matrixRows,
    boundary,
    centroid,
    sitePoints,
    transport,
    topSites,
    sources: SOURCES,
  };
}

/** Nine-edition matrix with synthesized quintile dots (real dots come from the
 *  export). One cell is nulled per row-offset to exercise the "—" state. */
function buildMatrix(subjectZip: string): VacancyIndexMatrixRow[] {
  return PILOT_ZIPS.map((entry, ri) => ({
    area: entry.primaryNeighborhood,
    zip: entry.zip,
    isSubject: entry.zip === subjectZip,
    cells: METRIC_LABELS.map((label, ci) => {
      const dots = ((ri + ci) % 5) + 1;
      // Null out one cell in the 4th column of one non-subject row.
      const isNull = ci === 3 && ri === 5;
      return { label, value: isNull ? null : String(dots), dots: isNull ? null : dots };
    }),
  }));
}

/* ── Synthetic stress fixture ── */

function stressFixture(): VacancyIndexInput {
  const longAddress =
    "12345 SOUTH DR MARTIN LUTHER KING JR DRIVE AND EAST 123RD STREET REAR PARCEL";
  const sitePoints = Array.from({ length: 40 }, (_, i) => ({
    lat: 41.77 + (i % 8) * 0.004,
    lon: -87.66 + Math.floor(i / 8) * 0.004,
    ownerType: [null, "unknown", "city_public", "corporate_llc", "out_of_state"][i % 5],
  }));
  const topSites: VacancyIndexTopSite[] = Array.from({ length: 15 }, (_, i) => ({
    address: i % 3 === 0 ? longAddress : `${100 + i} W EXAMPLE VERY LONG STREET NAME AVENUE`,
    ownerType: [null, "unknown", "local_private", "corporate_llc", "out_of_state"][i % 5],
    propertyType: i % 2 === 0 ? "vacant_building" : "vacant_land",
    zoning: i % 2 === 0 ? null : "B3-2",
    sqft: i % 2 === 0 ? null : 12000,
    priority: (["high", "medium", "low"] as VacancyPriorityTier[])[i % 3],
    nextStep:
      i % 2 === 0
        ? "Verify ownership via Assessor/Recorder; check 311 case status and confirm the parcel is genuinely vacant before any outreach"
        : "Entity outreach — open the admin Owner File",
  }));
  const matrixRows: VacancyIndexMatrixRow[] = PILOT_ZIPS.map((entry, ri) => ({
    area: entry.primaryNeighborhood,
    zip: entry.zip,
    isSubject: ri === 0,
    // All cells null on several rows -> every column can render "—".
    cells: METRIC_LABELS.map((label, ci) => {
      const isNull = ri % 2 === 0 || ci === 2;
      const dots = ((ri + ci) % 5) + 1;
      return { label, value: isNull ? null : String(dots), dots: isNull ? null : dots };
    }),
  }));
  return {
    neighborhood: "Stress Test Neighborhood With A Very Long Name",
    zipCode: "60000",
    editionNumber: 1,
    asOf: "July 19, 2026",
    counts: { total: 1287, cityOwned: 402, privatelyHeld: 885, inIncentiveZones: 1190 },
    brief:
      "This synthetic edition stress-tests the null and overflow paths: null square footage and zoning, " +
      "nulled matrix cells, a missing complete-ownership series, truncated site points, and addresses long " +
      "enough to force two-line clamping in the site index. Nothing here is real data.",
    decisions: [
      { title: "Decision one with a deliberately long title that must clamp cleanly to a single line", body: "A long body line that should wrap to at most two lines and then ellipsize without overrunning the band or colliding with the next decision numeral below it." },
      { title: "Decision two", body: "Short body." },
      { title: "Decision three", body: "Another body to fill the third 28mm band and confirm the hairline separators line up." },
    ],
    ownerTypeDistribution: null, // exercises the NOT-YET-AVAILABLE state
    trackedInventoryByOwnerType: { unknown: 900, city_public: 402, corporate_llc: 3 },
    propertyTypeBreakdown: { vacantLand: 402, vacantBuilding: 885 },
    priorityDistribution: { high: 40, medium: 900, low: 347 },
    matrixRows,
    boundary: null, // exercises the dot-field silhouette fallback
    centroid: { lat: 41.784, lon: -87.648 },
    sitePoints,
    transport: [],
    topSites,
    sources: SOURCES,
  };
}

/* ── Render ── */

function write(input: VacancyIndexInput, name: string) {
  const { base64 } = generateVacancyIndexPdfBase64(input);
  const outDir = path.join(ROOT, "output", "pdf");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, name);
  writeFileSync(outPath, Buffer.from(base64, "base64"));
  console.log(
    `Wrote ${outPath}  (${input.neighborhood}, ${input.sitePoints.length} pts, ${input.topSites.length} sites)`
  );
}

function main() {
  // CLI arg = neighborhood for the main (dense) edition; default Englewood.
  // A non-pilot neighborhood is allowed — assembleEdition defaults the ZIP.
  const primary = process.argv.slice(2).join(" ").trim() || "Englewood";
  write(assembleEdition(primary), "vacancy-index-preview.pdf");
  write(assembleEdition("South Chicago"), "vacancy-index-preview-sparse.pdf");
  write(stressFixture(), "vacancy-index-preview-stress.pdf");
}

main();
