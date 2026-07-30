/**
 * PLACE-BASED INCENTIVE GEOGRAPHIES ON THE SITE CARD.
 *
 * Regression under test: the Property Map's site card read the export's stamped
 * `incentiveCount` as evidence of coverage. The reconciled VACANT LAND series
 * ships every dot with `incentiveCount: 0`, so the card printed
 *   "Zoning not recorded. Not inside a mapped incentive geography."
 * for 4048 W MADISON ST in West Garfield Park — a point that in fact sits
 * inside eight mapped geographies, several of them the Explorer's own.
 *
 * The end-to-end fixture below runs the SAME resolver the address report uses
 * (lib/zones-check.ts, static point-in-polygon path) against the SAME committed
 * GeoJSON the API serves, at the exact coordinate the committed vacancy export
 * carries for that address — so this is the real case, not a mock of it.
 */

import { describe, expect, it } from "vitest";
import { checkStaticZones } from "@/lib/zones-check";
import { ZONE_LABELS } from "@/lib/constants";
import {
  cachedSiteZones,
  fetchSiteZones,
  normalizeSiteZoneMatches,
  resetSiteZoneCache,
  siteReportHref,
  siteZoneCacheKey,
  siteZoneLine,
  siteZonesSummary,
} from "@/lib/vacancy-site-zones";

/** The first of the three PINs the 60624 edition carries at this address. */
const MADISON_4048 = { lat: 41.8811054031, lon: -87.7279171939 };

describe("normalizeSiteZoneMatches", () => {
  it("labels, orders, and keeps only real polygon zone layers", () => {
    const matches = normalizeSiteZoneMatches([
      { key: "qct", name: "Census Tract 2602" },
      { key: "ssa", name: "West Garfield Park (SSA #77)" },
      { key: "tif", name: "Madison/Austin Corridor TIF (T-75)" },
      { key: "brownfields", name: "a point layer, not a containing geography" },
      { key: "notAZoneKey", name: "junk" },
    ]);

    expect(matches.map((m) => m.key)).toEqual(["tif", "ssa", "qct"]);
    expect(matches[0].label).toBe(ZONE_LABELS.tif);
    expect(matches[1].label).toBe(ZONE_LABELS.ssa);
  });

  it("never throws on a malformed or error response — it reports no matches", () => {
    expect(normalizeSiteZoneMatches(null)).toEqual([]);
    expect(normalizeSiteZoneMatches({ error: "Zone check failed" })).toEqual([]);
    expect(normalizeSiteZoneMatches([null, 7, "x", {}, { key: 1 }])).toEqual([]);
  });

  it("dedupes a repeated key and prefers the entry that carries a name", () => {
    const matches = normalizeSiteZoneMatches([
      { key: "tif", name: "" },
      { key: "tif", name: "Madison/Austin Corridor TIF (T-75)" },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe("Madison/Austin Corridor TIF (T-75)");
  });
});

describe("siteZonesSummary / siteZoneLine", () => {
  it("claims 'not inside a mapped incentive geography' only for an empty match list", () => {
    expect(siteZonesSummary([])).toBe("Not inside a mapped incentive geography.");
  });

  it("counts coverage in plain language, singular and plural", () => {
    expect(siteZonesSummary([{ key: "tif", label: "TIF District", name: "X" }])).toBe(
      "Inside 1 mapped incentive geography:",
    );
    expect(
      siteZonesSummary([
        { key: "tif", label: "TIF District", name: "X" },
        { key: "ssa", label: "Special Service Area", name: "Y" },
      ]),
    ).toBe("Inside 2 mapped incentive geographies:");
  });

  it("never states eligibility, only containment", () => {
    const text = siteZonesSummary([{ key: "tif", label: "TIF District", name: "X" }]);
    expect(text.toLowerCase()).not.toContain("eligible");
    expect(text.toLowerCase()).not.toContain("qualifies");
    expect(text.toLowerCase()).not.toContain("you can");
  });

  it("renders layer + feature name, falling back to the layer alone when unnamed", () => {
    expect(
      siteZoneLine({ key: "tif", label: "TIF District", name: "Madison/Austin Corridor TIF (T-75)" }),
    ).toBe("TIF District — Madison/Austin Corridor TIF (T-75)");
    expect(siteZoneLine({ key: "tif", label: "TIF District", name: "" })).toBe("TIF District");
  });
});

describe("siteReportHref", () => {
  it("builds the canonical instant-report deep link the report itself uses", () => {
    expect(siteReportHref(41.8811054031, -87.7279171939, "4048 W MADISON ST")).toBe(
      "/report?instant=true&lat=41.88111&lon=-87.72792&addr=4048%20W%20MADISON%20ST",
    );
  });

  it("tolerates a record with no address", () => {
    expect(siteReportHref(41.88, -87.72, null)).toContain("addr=");
  });
});

describe("fetchSiteZones", () => {
  const originalFetch = globalThis.fetch;

  function stubFetch(impl: (url: string) => Promise<Response> | Response) {
    globalThis.fetch = ((input: RequestInfo | URL) =>
      Promise.resolve(impl(String(input)))) as typeof fetch;
  }

  function restore() {
    globalThis.fetch = originalFetch;
    resetSiteZoneCache();
  }

  it("resolves through /api/zones/check — the endpoint the address report calls", async () => {
    resetSiteZoneCache();
    let requested = "";
    stubFetch((url) => {
      requested = url;
      return new Response(JSON.stringify([{ key: "tif", name: "Madison/Austin Corridor TIF (T-75)" }]), {
        status: 200,
      });
    });

    const state = await fetchSiteZones(41.8811054031, -87.7279171939);
    expect(requested).toContain("/api/zones/check?lat=41.881105&lon=-87.727917");
    expect(state.status).toBe("loaded");
    restore();
  });

  it("reports an ERROR — never a false 'no coverage' — when the lookup fails", async () => {
    resetSiteZoneCache();
    stubFetch(() => new Response("nope", { status: 500 }));
    expect(await fetchSiteZones(41.88, -87.72)).toEqual({ status: "error" });

    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch;
    expect(await fetchSiteZones(41.87, -87.71)).toEqual({ status: "error" });
    restore();
  });

  it("memoizes a successful lookup but not a failed one, so a later click retries", async () => {
    resetSiteZoneCache();
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return new Response("boom", { status: 502 });
    });
    await fetchSiteZones(41.88, -87.72);
    await fetchSiteZones(41.88, -87.72);
    expect(calls).toBe(2);
    expect(cachedSiteZones(41.88, -87.72)).toBeNull();

    stubFetch(() => new Response(JSON.stringify([]), { status: 200 }));
    await fetchSiteZones(41.88, -87.72);
    const cached = cachedSiteZones(41.88, -87.72);
    expect(cached).toEqual({ status: "loaded", matches: [] });
    restore();
  });

  it("keys the cache on the point, collapsing sub-meter jitter into one lookup", () => {
    // Re-clicking the same dot must not re-query.
    expect(siteZoneCacheKey(41.8811054031, -87.7279171939)).toBe(
      siteZoneCacheKey(41.88110612, -87.72791688),
    );
    // Distinct PINs ~11m apart are distinct points and each resolve their own
    // coverage — the three parcels at 4048 W MADISON ST are not merged.
    expect(siteZoneCacheKey(41.8811054031, -87.7279171939)).not.toBe(
      siteZoneCacheKey(41.8811085789, -87.727639544),
    );
  });
});

describe("4048 W MADISON ST (West Garfield Park) — the reported defect", () => {
  it("is inside multiple mapped incentive geographies, so the card must not say otherwise", async () => {
    const matches = normalizeSiteZoneMatches(
      await checkStaticZones(MADISON_4048.lat, MADISON_4048.lon),
    );

    expect(matches.length).toBeGreaterThanOrEqual(6);
    expect(siteZonesSummary(matches)).not.toBe("Not inside a mapped incentive geography.");

    const keys = matches.map((m) => m.key);
    // The geographies the Explorer itself serves for this corridor.
    expect(keys).toContain("tif");
    expect(keys).toContain("ssa");
    expect(keys).toContain("enterprise");
    expect(keys).toContain("federalOZ");
  });

  it("names the TIF district rather than rendering a nameless row", async () => {
    const matches = normalizeSiteZoneMatches(
      await checkStaticZones(MADISON_4048.lat, MADISON_4048.lon),
    );
    const tif = matches.find((m) => m.key === "tif");
    expect(tif).toBeDefined();
    expect(tif!.name).toBe("Madison/Austin Corridor TIF (T-75)");
    expect(siteZoneLine(tif!)).toBe("TIF District — Madison/Austin Corridor TIF (T-75)");
  });

  it("names the SSA and the enterprise zone the way the address report does", async () => {
    const matches = normalizeSiteZoneMatches(
      await checkStaticZones(MADISON_4048.lat, MADISON_4048.lon),
    );
    expect(matches.find((m) => m.key === "ssa")!.name).toBe("West Garfield Park (SSA #77)");
    expect(matches.find((m) => m.key === "enterprise")!.name).toBe("Chicago Enterprise Zone V");
  });

  it("orders the corridor's own programs first (TIF, SSA, Enterprise, OZ)", async () => {
    const matches = normalizeSiteZoneMatches(
      await checkStaticZones(MADISON_4048.lat, MADISON_4048.lon),
    );
    expect(matches.slice(0, 4).map((m) => m.key)).toEqual([
      "tif",
      "ssa",
      "enterprise",
      "federalOZ",
    ]);
  });
});
