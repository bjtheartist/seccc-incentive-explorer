import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MOBILITY_BIKE_UNAVAILABLE_LABEL,
  MOBILITY_TRANSIT_UNAVAILABLE_LABEL,
  describeMobilityAccess,
  getMobilityAccess,
  mobilityCacheTTLSeconds,
  type MobilityAccess,
} from "../mobility-access";

/**
 * R1 finding 4 — the false-claims class, mobility surface.
 *
 * `getMobilityAccess` gathers six upstream feeds through `Promise.allSettled`
 * and then mapped every REJECTED one to `[]`, exactly as it maps a feed that
 * answered with nothing. The labels graded that `[]` and published "Limited
 * nearby transit context" — an authoritative negative finding about a site,
 * produced by an outage. These tests pin that a rejected feed now surfaces as
 * unavailable, and that a feed which really did answer empty still gets the
 * honest "limited" reading (the fix must not over-correct).
 */

// Distinct coordinates per test: getMobilityAccess memoizes on a rounded
// coordinate key, so reusing a pin would serve the previous test's answer.
const OUTAGE_PIN = { lat: 41.7511, lon: -87.6249 };
const EMPTY_PIN = { lat: 41.7311, lon: -87.6049 };
const TTL_PIN = { lat: 41.7911, lon: -87.6449 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getMobilityAccess: a rejected feed is an outage, not an absence", () => {
  it("every transit + bike feed failing reports unavailability, never 'Limited nearby transit context'", async () => {
    // Reject every network call: the GTFS zips and both Socrata lookups.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));

    const access = await getMobilityAccess(OUTAGE_PIN.lat, OUTAGE_PIN.lon);

    expect(access.transitLabel).toBe(MOBILITY_TRANSIT_UNAVAILABLE_LABEL);
    expect(access.bikeLabel).toBe(MOBILITY_BIKE_UNAVAILABLE_LABEL);

    // The exact false absences this finding exists to remove.
    expect(access.transitLabel).not.toBe("Limited nearby transit context");
    expect(access.bikeLabel).not.toBe("Limited nearby bike-route context");
    expect(access.transitLabel).not.toMatch(/no rail stations|none nearby/i);

    // The failed feeds are named, so a reader can tell what was not checked.
    expect(access.unavailableSources).toEqual(
      expect.arrayContaining(["cta_rail", "metra", "bus_stops", "bike_routes"]),
    );

    // And the caveat list says so in words, without asserting an absence.
    const outageCaveat = access.caveats.find((line) => line.includes("could not be loaded"));
    expect(outageCaveat).toBeTruthy();
    expect(outageCaveat).not.toMatch(/eligib|qualif/i);

    // No station is invented to fill the gap.
    expect(access.ctaRailStations).toEqual([]);
    expect(access.busStops).toEqual([]);
  });

  it("a feed that ANSWERS with nothing keeps the honest 'limited' reading — the fix does not over-correct", async () => {
    // 200s that carry no rows: a real answer, so a real (publishable) absence.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("data.cityofchicago.org")) {
          return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
        }
        // GTFS zips are not exercised in this case; make them answer emptily
        // through the same non-throwing path the loaders already tolerate.
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );

    const access = await getMobilityAccess(EMPTY_PIN.lat, EMPTY_PIN.lon);

    // The bus/bike lookups genuinely answered "nothing here", so their own
    // feeds are NOT reported as unavailable.
    expect(access.unavailableSources).not.toContain("bus_stops");
    expect(access.unavailableSources).not.toContain("bike_routes");
    expect(access.bikeLabel).toBe("Limited nearby bike-route context");
  });
});

describe("describeMobilityAccess: an outage is stated, not silently shorter", () => {
  const base: MobilityAccess = {
    transitLabel: MOBILITY_TRANSIT_UNAVAILABLE_LABEL,
    bikeLabel: "Nearby bike access",
    driveLabel: "Good drive access",
    freightLabel: "Freight rail nearby",
    ctaRailStations: [],
    metraStations: [],
    busStops: [],
    bikeRoutes: [],
    airports: [],
    expressways: [],
    freightRail: [],
    sources: [],
    caveats: [],
    refreshedAt: "2026-01-01T00:00:00.000Z",
    unavailableSources: ["cta_rail", "metra", "bus_stops"],
  };

  it("leads with what could not be checked, so an outage does not read as a quiet site", () => {
    const lines = describeMobilityAccess(base);
    expect(lines[0]).toContain("Temporarily unavailable");
    expect(lines[0]).toContain("CTA rail stations");
    expect(lines[0]).not.toMatch(/no rail stations nearby/i);
  });

  it("says nothing about availability when every feed loaded", () => {
    const lines = describeMobilityAccess({ ...base, unavailableSources: [] });
    expect(lines.some((line) => line.includes("Temporarily unavailable"))).toBe(false);
  });

  it("treats a pre-R1 payload with no unavailableSources field as 'no outage recorded'", () => {
    const legacy = { ...base } as MobilityAccess;
    delete legacy.unavailableSources;
    const lines = describeMobilityAccess(legacy);
    expect(lines.some((line) => line.includes("Temporarily unavailable"))).toBe(false);
  });
});

/**
 * R1 finding 3 — a mobility outage was frozen into a 24-hour cache.
 *
 * `getMobilityAccess` wrapped its WHOLE result — `unavailableSources` and the
 * degraded "Transit data temporarily unavailable" labels included — in
 * `memCached(..., 86400)`. One transient CTA/Socrata 5xx therefore pinned the
 * unavailability copy to that coordinate for a day, for every reader and
 * inside every report generated from it, long after the feed recovered.
 * "Temporarily" ended up describing the sentence rather than the outage.
 *
 * lib/zoning-point-lookup.ts already applies the opposite discipline two files
 * over: a failed point lookup is THROWN so it cannot be stored, because
 * caching it "would freeze a transient outage". Mobility keeps the degraded
 * body — it is still partly useful — so it needs the short-TTL form of the
 * same rule.
 */
describe("getMobilityAccess cache policy: an outage is held for minutes, not a day", () => {
  const HEALTHY = { unavailableSources: [] } as unknown as MobilityAccess;

  it("a complete answer keeps the full 24-hour TTL", () => {
    expect(mobilityCacheTTLSeconds(HEALTHY)).toBe(60 * 60 * 24);
  });

  it("a degraded answer is cached in MINUTES — never for the healthy TTL", () => {
    const degraded = {
      unavailableSources: ["cta_rail"],
    } as unknown as MobilityAccess;

    const ttl = mobilityCacheTTLSeconds(degraded);
    expect(ttl).toBeLessThanOrEqual(15 * 60);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).not.toBe(mobilityCacheTTLSeconds(HEALTHY));
  });

  it("one failed feed out of six is enough — a partial outage is still an outage", () => {
    for (const source of ["cta_rail", "metra", "bus_stops", "bike_routes", "expressways", "freight_rail"]) {
      const degraded = { unavailableSources: [source] } as unknown as MobilityAccess;
      expect(mobilityCacheTTLSeconds(degraded)).toBeLessThan(mobilityCacheTTLSeconds(HEALTHY));
    }
  });

  it("a pre-R1 payload with no unavailableSources field is treated as complete, not degraded", () => {
    const legacy = {} as MobilityAccess;
    expect(mobilityCacheTTLSeconds(legacy)).toBe(60 * 60 * 24);
  });

  it("the live outage path really does produce a short-TTL result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));

    const access = await getMobilityAccess(TTL_PIN.lat, TTL_PIN.lon);

    expect(access.unavailableSources?.length ?? 0).toBeGreaterThan(0);
    expect(mobilityCacheTTLSeconds(access)).toBeLessThanOrEqual(15 * 60);
  });
});
