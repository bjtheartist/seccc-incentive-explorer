#!/usr/bin/env npx tsx
/**
 * Builds a community-area -> TIF-districts lookup by ACTUAL polygon overlap
 * between the TIF district boundaries and the community-area boundaries.
 *
 * Why not the TIF file's Community_Areas property: that list over-claims —
 * e.g. Washington Park TIF (T-178) lists 7 CAs but geometrically covers only
 * CA 40 (76%), clips two others at 5-6%, and is 0% in four of them. And why
 * not the CA centroid (the old neighborhood-page method): it under-claims —
 * a CA can be largely TIF-covered while its single centroid misses every
 * polygon. Real polygon overlap is the ground truth for "TIFs in this area".
 *
 * Output: data/exports/community-area-tif.json
 *   { "<caId>": [{ tifNumber, districtName, expirationYear, overlapPct }], _meta }
 *   TIFs with < MIN_OVERLAP_PCT of the CA's area are dropped as boundary
 *   clips; the rest are sorted by coverage, largest first.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as turf from "@turf/turf";

const MIN_OVERLAP_PCT = 2; // below this a TIF only grazes the CA boundary

function expirationYear(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

function main() {
  const tif = JSON.parse(readFileSync(join(process.cwd(), "public/data/zones/tif-districts.geojson"), "utf8"));
  const ca = JSON.parse(readFileSync(join(process.cwd(), "public/data/community-areas.geojson"), "utf8"));

  const out: Record<string, unknown> = {};
  let pairsKept = 0;
  const covered = new Set<string>();

  for (const caF of ca.features) {
    const caId = String(caF.properties.area_numbe).split(".")[0];
    let caArea = 0;
    try { caArea = turf.area(caF); } catch { caArea = 0; }
    if (!caArea) continue;

    const hits: Array<{ tifNumber: string; districtName: string; expirationYear: number | null; overlapPct: number }> = [];
    for (const tf of tif.features) {
      let interArea = 0;
      try {
        const i = turf.intersect(turf.featureCollection([tf, caF]));
        interArea = i ? turf.area(i) : 0;
      } catch { interArea = 0; }
      if (!interArea) continue;
      const overlapPct = (100 * interArea) / caArea;
      if (overlapPct < MIN_OVERLAP_PCT) continue;
      hits.push({
        tifNumber: String(tf.properties.TIF_Number).replace(/\s+/g, ""),
        districtName: tf.properties.District_Name,
        expirationYear: expirationYear(tf.properties.Expiration_Date),
        overlapPct: Math.round(overlapPct * 10) / 10,
      });
    }
    hits.sort((a, b) => b.overlapPct - a.overlapPct);
    if (hits.length) { out[caId] = hits; pairsKept += hits.length; covered.add(caId); }
  }

  out._meta = {
    method: `polygon overlap of TIF districts vs community-area boundaries; TIFs covering < ${MIN_OVERLAP_PCT}% of a CA's area dropped as boundary clips; sorted by coverage desc`,
    communityAreasWithTif: covered.size,
    tifCaPairs: pairsKept,
  };
  const outPath = join(process.cwd(), "data/exports/community-area-tif.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}: ${covered.size}/77 CAs have >=1 TIF, ${pairsKept} CA-TIF pairs`);
}
main();
