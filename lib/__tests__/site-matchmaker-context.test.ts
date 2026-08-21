import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// The committed-artifact suite below parses every site-matchmaker-context
// file plus vacancy-index.json (~17MB) with thousands of synchronous
// assertions. Wall time swings 2-3x under vitest worker CPU contention, so
// the 5s default timeout flakes it in full-suite runs even though every
// assertion passes. Sync tests cannot be interrupted mid-run — the timeout
// only retro-fails completed work — so a generous ceiling weakens nothing.
vi.setConfig({ testTimeout: 60_000 });
import { join } from "node:path";
import {
  aggregateEpaWalkabilityToTract,
  airportDistances,
  buildExpresswaySegments,
  buildExpresswaySpatialIndex,
  buildTractIndex,
  findContainingTract,
  nearestExpressway,
  normalizeSiteMatchmakerPin,
  populationDensityPerSqMi,
  siteMatchmakerContextKey,
  type GeoJsonFeatureCollection,
  type SiteMatchmakerContextMetric,
} from "@/lib/site-matchmaker-context";

// build-spec.md PR-A item 5/6 (F12) — normalizeSiteMatchmakerPin's accepted
// type dropped `number` (a PIN is an identifier, never a numeric quantity —
// see lib/cook-viewer.ts's normalizePin14, which this function agrees with
// but does not (yet) delegate to; unifying the two algorithms is PR-C's F9).
// Runtime string behavior is unchanged by the type-only fix.
describe("normalizeSiteMatchmakerPin — string-only input (F12)", () => {
  it("rejects a number PIN at COMPILE TIME — not just at runtime", () => {
    // @ts-expect-error — a number is no longer an accepted input type; only
    // `string | null | undefined` normalizes.
    normalizeSiteMatchmakerPin(20261090420000);
  });

  it("still normalizes a valid 14-digit string, preserving leading zeros", () => {
    expect(normalizeSiteMatchmakerPin("01234567890123")).toBe("01234567890123");
  });

  it("still strips non-digit characters from a dashed/spaced string PIN", () => {
    expect(normalizeSiteMatchmakerPin("20-26-109-042-0000")).toBe("20261090420000");
  });

  it("still returns null for null, undefined, and a malformed string", () => {
    expect(normalizeSiteMatchmakerPin(null)).toBeNull();
    expect(normalizeSiteMatchmakerPin(undefined)).toBeNull();
    expect(normalizeSiteMatchmakerPin("bad-pin")).toBeNull();
  });
});

describe("siteMatchmakerContextKey", () => {
  it("prefers a normalized 14-digit PIN over address and coordinate fallback", () => {
    expect(
      siteMatchmakerContextKey({
        pin: "20-26-109-042-0000",
        address: "7900 S South Chicago Ave",
        lat: 41.7542364,
        lon: -87.5907059,
      }),
    ).toBe("pin:20261090420000");
  });

  it("uses stable coordinate and normalized address fallback when PIN is unavailable", () => {
    const first = siteMatchmakerContextKey({
      pin: "bad-pin",
      address: " 7900 s. South-Chicago Ave ",
      lat: 41.7542364,
      lon: -87.5907059,
    });
    const second = siteMatchmakerContextKey({
      address: "7900 S South Chicago Ave",
      lat: "41.75423649",
      lon: "-87.59070591",
    });

    expect(first).toBe("coord:41.754236,-87.590706|addr:7900 S SOUTH CHICAGO AVE");
    expect(second).toBe(first);
  });
});

describe("population density", () => {
  it("rounds ACS population over TIGER AREALAND to people per square mile", () => {
    expect(populationDensityPerSqMi(10_000, 2_589_988.110336)).toBe(10_000);
    expect(populationDensityPerSqMi(5_000, 1_294_994.055168)).toBe(10_000);
  });

  it("keeps missing population and land area null instead of coercing to zero", () => {
    expect(populationDensityPerSqMi(null, 2_589_988.110336)).toBeNull();
    expect(populationDensityPerSqMi(10_000, null)).toBeNull();
    expect(populationDensityPerSqMi(10_000, 0)).toBeNull();
    expect(populationDensityPerSqMi(-1, 2_589_988.110336)).toBeNull();
  });
});

describe("EPA walkability aggregation", () => {
  it("population-weights block groups to tract and preserves one decimal", () => {
    const scores = aggregateEpaWalkabilityToTract([
      { GEOID20: "170310101001", NatWalkInd: 10.04, TotPop: 100 },
      { GEOID20: "170310101002", NatWalkInd: 14.04, TotPop: 300 },
      { GEOID20: "170310102001", NatWalkInd: 3.21, TotPop: 0 },
      { GEOID20: "170310102002", NatWalkInd: 4.29, TotPop: null },
    ]);

    expect(scores.get("17031010100")).toBe(13);
    expect(scores.get("17031010200")).toBe(3.8);
  });
});

describe("tract lookup", () => {
  const tracts: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { tractId: "outer" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-88, 41],
              [-87, 41],
              [-87, 42],
              [-88, 42],
              [-88, 41],
            ],
          ],
        },
      },
      {
        type: "Feature",
        properties: { tractId: "outside-bbox" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-86, 41],
              [-85, 41],
              [-85, 42],
              [-86, 42],
              [-86, 41],
            ],
          ],
        },
      },
    ],
  };

  it("finds containing tracts and treats boundary points as inside", () => {
    const index = buildTractIndex(tracts);

    expect(findContainingTract(index, 41.5, -87.5)).toBe("outer");
    expect(findContainingTract(index, 41.5, -88)).toBe("outer");
    expect(findContainingTract(index, 41.5, -88.5)).toBeNull();
  });
});

describe("transport and airports", () => {
  it("computes nearest straight-line expressway name and geodesic distance", () => {
    const transport: GeoJsonFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { kind: "expressway", name: "Test Expy" },
          geometry: {
            type: "LineString",
            coordinates: [
              [-87.7, 41.8],
              [-87.6, 41.8],
            ],
          },
        },
        {
          type: "Feature",
          properties: { kind: "rail", name: "Ignored Rail" },
          geometry: {
            type: "LineString",
            coordinates: [
              [-87.65, 41.79],
              [-87.65, 41.81],
            ],
          },
        },
      ],
    };

    const result = nearestExpressway(buildExpresswaySegments(transport), 41.81, -87.65);

    expect(result.name).toBe("Test Expy");
    expect(result.miles).toBeGreaterThan(0.68);
    expect(result.miles).toBeLessThan(0.7);
  });

  it("uses the spatial candidate index without changing the nearest result", () => {
    const transport: GeoJsonFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { kind: "expressway", name: "Near Expy" },
          geometry: {
            type: "LineString",
            coordinates: [
              [-87.7, 41.8],
              [-87.6, 41.8],
            ],
          },
        },
        {
          type: "Feature",
          properties: { kind: "expressway", name: "Far Expy" },
          geometry: {
            type: "LineString",
            coordinates: [
              [-88.1, 42.1],
              [-88, 42.1],
            ],
          },
        },
      ],
    };

    const bruteForce = nearestExpressway(buildExpresswaySegments(transport), 41.81, -87.65);
    const indexed = nearestExpressway(buildExpresswaySpatialIndex(transport, 0.02), 41.81, -87.65);

    expect(indexed).toEqual(bruteForce);
    expect(indexed.name).toBe("Near Expy");
  });

  it("keeps Chicago airport straight-line distances in expected ranges", () => {
    const distances = airportDistances(41.8781, -87.6298);

    expect(distances.midwayMiles).toBeGreaterThan(8);
    expect(distances.midwayMiles).toBeLessThan(10);
    expect(distances.ohareMiles).toBeGreaterThan(15);
    expect(distances.ohareMiles).toBeLessThan(16.5);
  });
});

describe("context metric contract", () => {
  it("does not include incentive score or projected dollar fields", () => {
    const metric: SiteMatchmakerContextMetric = {
      tractId: "17031010100",
      population: 1000,
      populationDensityPerSqMi: 9000,
      walkabilityIndex: 12.3,
      nearestExpresswayName: "Test Expy",
      nearestExpresswayMiles: 0.4,
      midwayMiles: 8.2,
      ohareMiles: 17.4,
    };

    expect(Object.keys(metric).sort()).toEqual([
      "midwayMiles",
      "nearestExpresswayMiles",
      "nearestExpresswayName",
      "ohareMiles",
      "population",
      "populationDensityPerSqMi",
      "tractId",
      "walkabilityIndex",
    ]);
    expect(JSON.stringify(metric)).not.toMatch(/score|projected|dollar|incentive/i);
  });
});

describe("committed Site Matchmaker context artifacts", () => {
  it("covers every plotted candidate key in every vacancy ZIP", () => {
    const vacancy = JSON.parse(
      readFileSync(join(process.cwd(), "public", "data", "vacancy-index.json"), "utf8"),
    ) as {
      editions: Record<
        string,
        {
          sitePoints?: Array<{ pin?: string | null; address?: string | null; lat: number; lon: number }>;
          landPoints?: Array<{ pin?: string | null; address?: string | null; lat: number; lon: number }>;
        }
      >;
    };
    const contextDir = join(process.cwd(), "public", "data", "site-matchmaker-context");
    const files = readdirSync(contextDir).filter((file) => file.endsWith(".json")).sort();

    expect(files).toEqual(Object.keys(vacancy.editions).sort().map((zip) => `${zip}.json`));

    for (const file of files) {
      const zip = file.replace(/\.json$/, "");
      const artifact = JSON.parse(readFileSync(join(contextDir, file), "utf8")) as {
        version: number;
        zip: string;
        sources: Record<string, unknown>;
        rows: Record<string, SiteMatchmakerContextMetric>;
      };
      const edition = vacancy.editions[zip];
      const expectedKeys = new Set(
        [...(edition.sitePoints ?? []), ...(edition.landPoints ?? [])].map((point) =>
          siteMatchmakerContextKey(point),
        ),
      );

      expect(artifact.version).toBe(1);
      expect(artifact.zip).toBe(zip);
      expect(new Set(Object.keys(artifact.rows))).toEqual(expectedKeys);
      expect(JSON.stringify(artifact.sources)).toMatch(/Census.*EPA.*straight-line/i);

      for (const metric of Object.values(artifact.rows)) {
        expect(metric.tractId).toMatch(/^17031\d{6}$/);
        expect(metric.population).toBeGreaterThanOrEqual(0);
        expect(metric.populationDensityPerSqMi).toBeGreaterThanOrEqual(0);
        if (metric.walkabilityIndex !== null) {
          expect(metric.walkabilityIndex).toBeGreaterThanOrEqual(1);
          expect(metric.walkabilityIndex).toBeLessThanOrEqual(20);
        }
        expect(metric.nearestExpresswayName).toBeTruthy();
        expect(metric.nearestExpresswayMiles).toBeGreaterThanOrEqual(0);
        expect(metric.midwayMiles).toBeGreaterThanOrEqual(0);
        expect(metric.ohareMiles).toBeGreaterThanOrEqual(0);
      }

      expect(JSON.stringify(artifact.rows)).not.toMatch(
        /matchScore|incentiveScore|projectedIncentive|estimatedDollars|ownerName/i,
      );
    }
  });
});
