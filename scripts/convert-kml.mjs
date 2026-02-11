#!/usr/bin/env node
/**
 * Convert KML incentive zone files to GeoJSON, clipped to SSA #50 bounding box.
 * Usage: node scripts/convert-kml.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { DOMParser } from "xmldom";
import * as tj from "@tmcw/togeojson";
import * as turf from "@turf/turf";

// SSA #50 bounding box (Calumet Heights / Avalon Park area)
const SSA50_BBOX = [-87.615, 41.718, -87.540, 41.770];
const bboxPoly = turf.bboxPolygon(SSA50_BBOX);

const KML_DIR = "/Users/billyndizeye/Downloads/Maps/2026/January";

const KML_FILES = [
  { file: "Chicago_TIF_Districts.kml", output: "tif-districts.geojson", name: "TIF Districts" },
  { file: "Chicago_Federal_Opportunity_Zones.kml", output: "federal-oz.geojson", name: "Federal Opportunity Zones" },
  { file: "Chicago_Enterprise_Zones.kml", output: "enterprise-zones.geojson", name: "Enterprise Zones" },
  { file: "Chicago_EDGE_100_Percent_Zones.kml", output: "edge-zones.geojson", name: "EDGE 100% Zones" },
  { file: "Chicago_REV_Illinois_Bonus_Zones.kml", output: "rev-zones.geojson", name: "REV Illinois Bonus Zones" },
  { file: "Chicago_MICRO_100_Percent_Zones.kml", output: "micro-zones.geojson", name: "MICRO 100% Zones" },
  { file: "Chicago_Data_Center_Bonus_Zones.kml", output: "data-center-zones.geojson", name: "Data Center Bonus Zones" },
  { file: "Chicago_Special_Service_Areas.kml", output: "special-service-areas.geojson", name: "Special Service Areas" },
  { file: "Chicago_Triple_Benefit_Zones.kml", output: "triple-benefit-zones.geojson", name: "Triple Benefit Zones" },
  { file: "Chicago_High_Unemployment_Incentive_Zones.kml", output: "high-unemployment.geojson", name: "High Unemployment Zones" },
  { file: "Illinois_Opportunity_Zones.kml", output: "illinois-oz.geojson", name: "Illinois Opportunity Zones" },
];

const OUT_DIR = "public/data/zones";
mkdirSync(OUT_DIR, { recursive: true });

for (const { file, output, name } of KML_FILES) {
  const path = `${KML_DIR}/${file}`;
  console.log(`Processing: ${file}`);

  try {
    const kmlStr = readFileSync(path, "utf-8");
    const doc = new DOMParser().parseFromString(kmlStr, "text/xml");
    const geojson = tj.kml(doc);

    // Clip features to SSA #50 bbox
    const clipped = {
      type: "FeatureCollection",
      features: [],
    };

    for (const feature of geojson.features) {
      if (!feature.geometry) continue;

      try {
        const geomType = feature.geometry.type;

        // For points, just check if within bbox
        if (geomType === "Point") {
          const pt = turf.point(feature.geometry.coordinates);
          if (turf.booleanPointInPolygon(pt, bboxPoly)) {
            clipped.features.push(feature);
          }
          continue;
        }

        // For polygons/multipolygons, check intersection
        if (geomType === "Polygon" || geomType === "MultiPolygon") {
          const intersection = turf.intersect(
            turf.featureCollection([bboxPoly, feature])
          );
          if (intersection) {
            // Keep original properties, use clipped geometry
            clipped.features.push({
              ...feature,
              geometry: intersection.geometry,
            });
          }
        }
      } catch (e) {
        // Some geometries may be invalid; skip
      }
    }

    // Simplify geometries to reduce file size
    const simplified = {
      ...clipped,
      features: clipped.features.map((f) => {
        try {
          if (f.geometry.type === "Point") return f;
          const s = turf.simplify(f, { tolerance: 0.0001, highQuality: true });
          return { ...f, geometry: s.geometry };
        } catch {
          return f;
        }
      }),
    };

    writeFileSync(
      `${OUT_DIR}/${output}`,
      JSON.stringify(simplified, null, 0)
    );
    console.log(`  → ${output}: ${simplified.features.length} features`);
  } catch (e) {
    console.error(`  ✗ Error processing ${file}: ${e.message}`);
  }
}

// Also handle SBIF Projects (point data with dollar amounts)
console.log("\nProcessing: Chicago_SBIF_Projects.kml");
try {
  const kmlStr = readFileSync(`${KML_DIR}/Chicago_SBIF_Projects.kml`, "utf-8");
  const doc = new DOMParser().parseFromString(kmlStr, "text/xml");
  const geojson = tj.kml(doc);

  const clipped = {
    type: "FeatureCollection",
    features: geojson.features.filter((f) => {
      if (!f.geometry || f.geometry.type !== "Point") return false;
      const pt = turf.point(f.geometry.coordinates);
      return turf.booleanPointInPolygon(pt, bboxPoly);
    }),
  };

  writeFileSync(
    `${OUT_DIR}/sbif-projects.geojson`,
    JSON.stringify(clipped, null, 0)
  );
  console.log(`  → sbif-projects.geojson: ${clipped.features.length} features`);
} catch (e) {
  console.error(`  ✗ Error processing SBIF: ${e.message}`);
}

console.log("\nDone! GeoJSON files written to", OUT_DIR);
