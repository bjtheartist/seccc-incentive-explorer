import type { SiteMatchCriteria } from "./site-matchmaker";
import type { ShortlistStation } from "./site-shortlist";
import { runEvidenceShortlist } from "./shortlist-evidence-engine";
import { decorateShortlistDisplayFacts, selectedTransitNetwork, SHORTLIST_TOP_N } from "./shortlist-engine";
import { loadShortlistAmenityPoints, loadShortlistExpresswayContext } from "./shortlist-display-context";
import { applyPrecomputedParcelIdentity, loadShortlistParcelIdentity } from "./shortlist-parcel-identity";
import "server-only";
import exceptions from "../data/curated/shortlist-screening-exceptions.json";
import { readFileSync } from "node:fs";
import path from "node:path";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { bbox } from "@turf/bbox";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { loadShortlistScreeningSidecar } from "./shortlist-parcel-identity";
import { consolidateScreeningRows, prepareShortlistScreeningRows, type ScreeningUniverseRow } from "./shortlist-screening-evidence";
import type { ShortlistUniverseFile } from "./shortlist-universe-schema";

export class ScreeningDataUnavailable extends Error {}

let communities: { feature: FeatureCollection<Polygon | MultiPolygon>["features"][number]; bounds: number[] }[] | null = null;
function communityAt(lat: number | null, lon: number | null): string | null {
  if (lat == null || lon == null) return null;
  if (!communities) {
    try {
      const data = JSON.parse(readFileSync(path.join(process.cwd(), "public/data/community-areas.geojson"), "utf8")) as FeatureCollection<Polygon | MultiPolygon>;
      communities = data.features.map((feature) => ({ feature, bounds: bbox(feature) }));
    } catch { throw new ScreeningDataUnavailable("Community boundary snapshot is unavailable"); }
  }
  const matches = communities.filter(({ feature, bounds: [west, south, east, north] }) =>
    lon >= west && lon <= east && lat >= south && lat <= north && booleanPointInPolygon([lon, lat], feature));
  return matches.length === 1 ? String(matches[0].feature.properties?.community ?? "").toUpperCase() || null : null;
}

const cache = new Map<string, ScreeningUniverseRow[]>();
/** Local, checksum-validated snapshot joins only; no external request in selection. */
export function loadScreeningRows(universe: ShortlistUniverseFile): ScreeningUniverseRow[] {
  const key = `${universe.buildId}:${universe.zip}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const sidecar = loadShortlistScreeningSidecar(universe.zip, universe.buildId);
  if (!sidecar.ok) throw new ScreeningDataUnavailable("Screening evidence snapshot failed validation");
  const rows = prepareShortlistScreeningRows(universe.rows, sidecar.entries, sidecar.facts);
  for (const row of rows) {
    row.screeningEvidence!.communityArea = communityAt(row.lat, row.lon);
    const conflict = exceptions.entries.find((entry) => entry.zip === universe.zip && entry.canonicalKey === row.canonicalKey);
    if (!conflict) continue;
    if (conflict.kind === "parcel-point-disagreement") {
      row.screeningEvidence = { ...row.screeningEvidence!, pin: null, identityStatus: "ambiguous",
        identityReviewReason: `Saved PIN and map-point parcel disagree (checked ${conflict.checkedAt}); verify parcel identity before using its facts.`,
        recordedType: "unknown", countyClass: null, sourceYear: null, checkedAt: null,
        measurements: { "assessor-building": null, lot: null, footprint: null, "available-interior": null } };
    } else if (conflict.kind === "land-building-disagreement") {
      row.screeningEvidence!.conflictingPropertyEvidence = true;
      row.screeningEvidence!.identityReviewReason = `The land record location has conflicting County building evidence (checked ${conflict.checkedAt}); verify the address and parcel before relying on its type.`;
    } else {
      row.zoning = { ...row.zoning, status: "ambiguous", district: null };
      row.screeningEvidence!.identityReviewReason = `Saved zoning ${conflict.savedDistrict} disagrees with the City layer ${conflict.observedDistricts.join(" / ")} (checked ${conflict.checkedAt}); district needs verification.`;
    }
  }
  // Bound retained versions. A new deployment normally holds just nine entries.
  if (cache.size >= 9) cache.clear();
  const consolidated = consolidateScreeningRows(rows);
  cache.set(key, consolidated);
  return consolidated;
}

// Eight recent briefs per worker, tied to immutable committed source versions.
// Cache only public-record calculations; access checks remain on every request.
const briefCache = new Map<string, {
  result: ReturnType<typeof runEvidenceShortlist>;
  displayed: ReturnType<typeof decorateShortlistDisplayFacts>;
}>();
export function loadPreparedEvidenceShortlist(universe: ShortlistUniverseFile, criteria: SiteMatchCriteria, stations: ShortlistStation[]) {
  const key = JSON.stringify([universe.buildId, universe.zip, criteria, stations]);
  const cached = briefCache.get(key);
  if (cached) return cached;
  const result = runEvidenceShortlist({ rows: loadScreeningRows(universe), criteria, stations, sourceRecordsByEvidenceType: universe.counts.sourceRecordsByEvidenceType });
  const displayed = applyPrecomputedParcelIdentity(decorateShortlistDisplayFacts(result.ranked.slice(0, SHORTLIST_TOP_N), {
    stations, network: selectedTransitNetwork(criteria, stations),
    expresswayContextByKey: loadShortlistExpresswayContext(universe.zip),
    schoolPoints: loadShortlistAmenityPoints("school-points.json"),
    libraryPoints: loadShortlistAmenityPoints("library-points.json"),
  }), loadShortlistParcelIdentity(universe.zip, universe.buildId));
  const prepared = { result, displayed };
  if (!result.railDataUnavailable && !result.dispatchCoverageBroken) {
    if (briefCache.size >= 8) briefCache.delete(briefCache.keys().next().value!);
    briefCache.set(key, prepared);
  }
  return prepared;
}
