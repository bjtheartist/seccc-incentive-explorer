import { afterEach, describe, expect, it } from "vitest";
import { SITE_ACTIVITY_SOURCES } from "../site-activity";
import {
  cachedSiteActivity,
  fetchSiteActivity,
  normalizeSiteActivityPayload,
  resetSiteActivityCache,
  siteActivityCacheKey,
} from "../site-activity-client";

/**
 * The client resolution path for /api/site-activity. The behavior under test is
 * the one that keeps a network problem from becoming a false statement about a
 * neighborhood: anything short of a clean, complete payload is an ERROR, which
 * every surface renders as "could not check" — never as an absence of activity.
 */

const GOOD_PAYLOAD = {
  context: {
    arterial: {
      roadName: "S COMMERCIAL AVE",
      aadt: 18500,
      aadtYear: "2025",
      stationId: "s1",
      distanceMi: 0.04,
    },
    rail: [
      {
        name: "87th",
        lines: ["Red"],
        avgWeekdayEntries: 3210.4,
        month: "2026-05",
        priorYearAvgWeekdayEntries: null,
        distanceMi: 0.21,
      },
    ],
    catchment: {
      population: 4712,
      jobs: 1180,
      blockGroups: 9,
      acsVintage: "ACS 2020-2024 5-year",
      lodesVintage: "LODES8 2023",
    },
    licenses: { total: 3, byCategory: [{ category: "grocery", count: 3 }] },
    radii: { arterialMi: 0.15, railMi: 0.5, catchmentMi: 0.5, licenseMi: 0.25 },
  },
  sources: SITE_ACTIVITY_SOURCES,
};

const originalFetch = globalThis.fetch;

function stubFetch(impl: (url: string) => Response) {
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.resolve(impl(String(input)))) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetSiteActivityCache();
});

describe("normalizeSiteActivityPayload", () => {
  it("accepts the route's own payload shape", () => {
    const payload = normalizeSiteActivityPayload(GOOD_PAYLOAD);
    expect(payload?.context.arterial?.aadt).toBe(18500);
    expect(payload?.context.rail[0].lines).toEqual(["Red"]);
    expect(payload?.context.radii.railMi).toBe(0.5);
    expect(payload?.sources.aadt.url).toContain("dot.illinois.gov");
  });

  it("keeps a genuine null measure as an absence", () => {
    const payload = normalizeSiteActivityPayload({
      ...GOOD_PAYLOAD,
      context: { ...GOOD_PAYLOAD.context, arterial: null, catchment: null, licenses: null, rail: [] },
    });
    expect(payload).not.toBeNull();
    expect(payload?.context.arterial).toBeNull();
    expect(payload?.context.rail).toEqual([]);
  });

  it("REJECTS a present-but-malformed measure instead of degrading it to an absence", () => {
    // The whole point: a truncated arterial object must not be able to print
    // "No IDOT count station within 0.15 mi" over a road that has one.
    const broken = normalizeSiteActivityPayload({
      ...GOOD_PAYLOAD,
      context: {
        ...GOOD_PAYLOAD.context,
        arterial: { roadName: "S COMMERCIAL AVE", aadtYear: "2025" },
      },
    });
    expect(broken).toBeNull();
  });

  it("rejects a body missing the disclosed radii the absence sentences quote", () => {
    const { radii: _radii, ...withoutRadii } = GOOD_PAYLOAD.context;
    expect(
      normalizeSiteActivityPayload({ ...GOOD_PAYLOAD, context: withoutRadii }),
    ).toBeNull();
  });

  it("rejects a body missing a source register entry", () => {
    const { aadt: _aadt, ...withoutAadt } = SITE_ACTIVITY_SOURCES;
    expect(normalizeSiteActivityPayload({ ...GOOD_PAYLOAD, sources: withoutAadt })).toBeNull();
  });

  it("rejects an error object, a string, and null without throwing", () => {
    for (const raw of [{ error: "site activity data unavailable" }, "nope", null, []]) {
      expect(normalizeSiteActivityPayload(raw)).toBeNull();
    }
  });
});

describe("fetchSiteActivity", () => {
  it("resolves through the public /api/site-activity route", async () => {
    let requested = "";
    stubFetch((url) => {
      requested = url;
      return new Response(JSON.stringify(GOOD_PAYLOAD), { status: 200 });
    });
    const state = await fetchSiteActivity(41.7419, -87.5503);
    expect(requested).toBe("/api/site-activity?lat=41.741900&lon=-87.550300");
    expect(state.status).toBe("loaded");
  });

  it("reports an ERROR — never a false absence — when the lookup fails", async () => {
    stubFetch(() => new Response("boom", { status: 503 }));
    expect(await fetchSiteActivity(41.74, -87.55)).toEqual({ status: "error" });

    resetSiteActivityCache();
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch;
    expect(await fetchSiteActivity(41.73, -87.54)).toEqual({ status: "error" });
  });

  it("treats an unparseable body as an error, not as an empty context", async () => {
    stubFetch(() => new Response("<html>gateway</html>", { status: 200 }));
    expect(await fetchSiteActivity(41.72, -87.53)).toEqual({ status: "error" });
  });

  it("memoizes a success but not a failure, so a later click retries", async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return new Response("boom", { status: 502 });
    });
    await fetchSiteActivity(41.74, -87.55);
    await fetchSiteActivity(41.74, -87.55);
    expect(calls).toBe(2);
    expect(cachedSiteActivity(41.74, -87.55)).toBeNull();

    stubFetch(() => new Response(JSON.stringify(GOOD_PAYLOAD), { status: 200 }));
    await fetchSiteActivity(41.74, -87.55);
    await fetchSiteActivity(41.74, -87.55);
    expect(calls).toBe(2); // the two failures only
    expect(cachedSiteActivity(41.74, -87.55)?.status).toBe("loaded");
  });

  it("keys the memo on the point, collapsing sub-meter jitter into one lookup", () => {
    expect(siteActivityCacheKey(41.7419123, -87.5503456)).toBe(
      siteActivityCacheKey(41.7419456, -87.5503111),
    );
    expect(siteActivityCacheKey(41.7419, -87.5503)).not.toBe(
      siteActivityCacheKey(41.7519, -87.5503),
    );
  });
});
