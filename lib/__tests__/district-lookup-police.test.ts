import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Structural coverage for the police-district addition to
 * lib/district-lookup.ts (spec v2 civic-representation data input). No
 * network mocking here — see lib/__tests__/representatives.test.ts for the
 * roster/officials-building coverage this pairs with, and
 * lib/__tests__/police-districts.test.ts for the district-name map and the
 * verified 22-district count.
 */
describe("district-lookup — police district query", () => {
  const source = readFileSync(join(process.cwd(), "lib/district-lookup.ts"), "utf8");

  it("queries the City's live boundary layer the same way queryWard does — no committed boundary file", () => {
    expect(source).toContain("data.cityofchicago.org/resource/9vmg-9p8p.json");
    expect(source).toContain("intersects(the_geom");
  });

  it("excludes DIST_NUM 31 (not a geographic patrol district) at the query level", () => {
    expect(source).toContain("DIST_NUM != '31'");
  });

  it("wires policeDistrict into the same Promise.allSettled batch as the other district lookups", () => {
    expect(source).toContain("queryPoliceDistrict(lat, lon)");
    expect(source).toContain("policeDistrict:");
  });

  it("bumped the cache key version alongside the shape change (v3 -> v4)", () => {
    expect(source).toContain("`districts:v4:");
    expect(source).not.toContain("`districts:v3:");
  });
});
