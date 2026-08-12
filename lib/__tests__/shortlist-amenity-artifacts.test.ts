/**
 * Committed-artifact guards for the four amenity point exports that back the
 * Site Shortlist map's infrastructure lens:
 *
 *   public/data/park-points.json     <- data.cityofchicago.org/ejsh-fztr
 *   public/data/library-points.json  <- data.cityofchicago.org/x8fc-8rcq
 *   public/data/school-points.json   <- data.cityofchicago.org/pb6d-zzuh
 *   public/data/grocery-points.json  <- data.cityofchicago.org/3e26-zek2
 *
 * Read with node:fs rather than through any loader, so a regenerated file that
 * drifts — an empty export, a coordinate outside Chicago, a lost provenance
 * line, a file that quietly grew past what a lazily-fetched overlay should
 * cost — trips a test instead of shipping.
 *
 * The size ceiling is the one worth being loud about. These files are fetched
 * in the browser on toggle-on; PR #106 trimmed this app's map payload
 * deliberately, and an unbounded export would hand that back one refresh at a
 * time.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INFRASTRUCTURE_LAYERS_BY_ID, amenityPointFeatures } from "../shortlist-map-layers";

/** Generous bounds around the city and its airports. */
const CHICAGO_BOUNDS = { west: -87.95, east: -87.5, south: 41.6, north: 42.05 };

/** Per-file ceiling for a lazily-fetched overlay, in bytes. */
const MAX_BYTES = 300 * 1024;

interface AmenityArtifact {
  layerId: "parks" | "libraries" | "schools" | "grocery";
  file: string;
  datasetId: string;
  minPoints: number;
}

const ARTIFACTS: AmenityArtifact[] = [
  { layerId: "parks", file: "park-points.json", datasetId: "ejsh-fztr", minPoints: 400 },
  { layerId: "libraries", file: "library-points.json", datasetId: "x8fc-8rcq", minPoints: 50 },
  { layerId: "schools", file: "school-points.json", datasetId: "pb6d-zzuh", minPoints: 400 },
  { layerId: "grocery", file: "grocery-points.json", datasetId: "3e26-zek2", minPoints: 100 },
];

function artifactPath(file: string): string {
  return path.join(process.cwd(), "public/data", file);
}

describe.each(ARTIFACTS)("$file", ({ layerId, file, datasetId, minPoints }) => {
  const fullPath = artifactPath(file);
  const exists = existsSync(fullPath);

  it("is committed", () => {
    expect(exists).toBe(true);
  });

  if (!exists) return;

  const raw = readFileSync(fullPath, "utf8");
  const parsed = JSON.parse(raw) as {
    generatedAt?: string;
    source?: string;
    note?: string;
    points?: { name: string; lat: number; lon: number; acres?: number }[];
  };

  it("records the Socrata dataset it was reduced from", () => {
    expect(parsed.source).toBe(`data.cityofchicago.org/${datasetId}`);
    expect(parsed.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof parsed.note).toBe("string");
    expect((parsed.note ?? "").length).toBeGreaterThan(20);
  });

  it("is the file the layer catalog points at", () => {
    expect(INFRASTRUCTURE_LAYERS_BY_ID[layerId].dataUrl).toBe(`/data/${file}`);
  });

  it("carries a plausible number of points", () => {
    expect(Array.isArray(parsed.points)).toBe(true);
    expect(parsed.points!.length).toBeGreaterThanOrEqual(minPoints);
  });

  it("stays inside the lazily-fetched overlay budget", () => {
    expect(statSync(fullPath).size).toBeLessThan(MAX_BYTES);
  });

  it("places every point inside Chicago, with a name", () => {
    for (const point of parsed.points ?? []) {
      expect(typeof point.name).toBe("string");
      expect(point.name.trim().length).toBeGreaterThan(0);
      expect(Number.isFinite(point.lat)).toBe(true);
      expect(Number.isFinite(point.lon)).toBe(true);
      expect(point.lat).toBeGreaterThan(CHICAGO_BOUNDS.south);
      expect(point.lat).toBeLessThan(CHICAGO_BOUNDS.north);
      expect(point.lon).toBeGreaterThan(CHICAGO_BOUNDS.west);
      expect(point.lon).toBeLessThan(CHICAGO_BOUNDS.east);
    }
  });

  it("carries only the fields the overlay draws", () => {
    const allowed = new Set(["name", "lat", "lon", "acres"]);
    for (const point of parsed.points ?? []) {
      for (const key of Object.keys(point)) expect(allowed.has(key)).toBe(true);
    }
  });

  it("survives the transform the map actually runs on it", () => {
    const features = amenityPointFeatures(parsed);
    expect(features.length).toBe(parsed.points!.length);
    expect(features[0].geometry.type).toBe("Point");
  });
});

describe("park-points.json acreage", () => {
  const fullPath = artifactPath("park-points.json");

  it("carries positive acreage where the source publishes it", () => {
    if (!existsSync(fullPath)) return;
    const parsed = JSON.parse(readFileSync(fullPath, "utf8")) as {
      points: { name: string; acres?: number }[];
    };
    const withAcres = parsed.points.filter((point) => point.acres != null);
    expect(withAcres.length).toBeGreaterThan(parsed.points.length / 2);
    for (const point of withAcres) expect(point.acres!).toBeGreaterThan(0);
  });
});

describe("grocery-points.json staleness disclosure", () => {
  const fullPath = artifactPath("grocery-points.json");

  it("says in the file itself that the source is no longer maintained", () => {
    if (!existsSync(fullPath)) return;
    const parsed = JSON.parse(readFileSync(fullPath, "utf8")) as { note: string };
    // The legend label and this note are the two places a reader can learn the
    // layer lags reality. Neither may quietly lose the caveat.
    expect(parsed.note).toMatch(/no longer maintains/i);
    expect(parsed.note).toMatch(/verify/i);
  });
});
