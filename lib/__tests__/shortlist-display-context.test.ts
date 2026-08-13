import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadShortlistAmenityPoints, loadShortlistExpresswayContext } from "../shortlist-display-context";

/**
 * These loaders read committed files (public/data/school-points.json,
 * library-points.json, public/data/site-matchmaker-context/<zip>.json) —
 * the same ones lib/shortlist-amenity-artifacts.test.ts and the existing
 * Site Matchmaker Results Table already validate the SHAPE of. This suite
 * checks the LOADER contract: real data comes back usable, and a missing or
 * malformed file degrades to an empty result rather than throwing.
 */

describe("loadShortlistAmenityPoints", () => {
  it("reads the committed school points file into usable {name, lat, lon} points", () => {
    const path_ = path.join(process.cwd(), "public/data/school-points.json");
    if (!existsSync(path_)) return;
    const points = loadShortlistAmenityPoints("school-points.json");
    expect(points.length).toBeGreaterThan(100);
    for (const point of points.slice(0, 5)) {
      expect(typeof point.name).toBe("string");
      expect(Number.isFinite(point.lat)).toBe(true);
      expect(Number.isFinite(point.lon)).toBe(true);
    }
  });

  it("reads the committed library points file", () => {
    const path_ = path.join(process.cwd(), "public/data/library-points.json");
    if (!existsSync(path_)) return;
    expect(loadShortlistAmenityPoints("library-points.json").length).toBeGreaterThan(10);
  });

  it("returns [] rather than throwing for a file that does not exist", () => {
    expect(loadShortlistAmenityPoints("does-not-exist.json")).toEqual([]);
  });
});

describe("loadShortlistExpresswayContext", () => {
  it("returns a keyed map of expressway facts for a ZIP with a committed snapshot", () => {
    const zipFile = path.join(process.cwd(), "public/data/site-matchmaker-context/60619.json");
    if (!existsSync(zipFile)) return;
    const byKey = loadShortlistExpresswayContext("60619");
    expect(byKey.size).toBeGreaterThan(0);
    const [, fact] = [...byKey.entries()][0];
    expect(fact).toHaveProperty("name");
    expect(fact).toHaveProperty("miles");
  });

  it("returns an empty map (never throws) for a ZIP with no committed snapshot", () => {
    expect(loadShortlistExpresswayContext("00000").size).toBe(0);
  });
});
