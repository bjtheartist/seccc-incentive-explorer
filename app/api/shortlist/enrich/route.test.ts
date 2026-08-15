import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Re-review Finding 4: this route previously had NO dedicated test file at
 * all. The re-review named three specific, testable properties:
 *   1. A missing/empty buildId is REJECTED with 400 (the client always
 *      sends one — see components/vacancy/SiteShortlistResults.tsx — so
 *      this is only reachable by a caller that was never sending one
 *      honestly, and the route must not quietly accept "" as a valid, if
 *      degraded, cache partition for it).
 *   2. Cache entries are PARTITIONED by buildId — the same PIN under two
 *      different buildIds must be fetched independently, never cross-served
 *      from a prior universe regeneration's cache entry.
 *   3. A result where every upstream lookup succeeded but returned NOTHING
 *      affirmative (no class, no assessed value, no licenses) is NEVER
 *      cached — a repeat call must re-fetch, not serve a stale "found
 *      nothing" hit.
 * Every test below proves one of these via the ONE observable signal the
 * route exposes for it: how many times the mocked `socrataFetch` was
 * actually called.
 */

const { countyFetchMock, socrataFetchMock } = vi.hoisted(() => ({
  countyFetchMock: vi.fn(),
  socrataFetchMock: vi.fn(),
}));

vi.mock("@/lib/socrata", () => ({ socrataFetch: socrataFetchMock }));

import { POST } from "./route";

const PIN = "20363230080000";
const ADDRESS = "8000 S COTTAGE GROVE AVE";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/shortlist/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawBodyRequest(body: string): Request {
  return new Request("http://localhost/api/shortlist/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

/** Routes the current CookViewer request plus the assessment/license Socrata
 *  requests without depending on route-internal helpers. */
function mockSocrataResponses(responses: {
  classRows?: Record<string, unknown>[];
  valueRows?: Record<string, unknown>[];
  licenseRows?: Record<string, unknown>[];
}) {
  countyFetchMock.mockImplementation(async () =>
    new Response(
      JSON.stringify({
        features: (responses.classRows ?? []).map((row) => ({
          attributes: {
            BCLASS: row.class,
            TAXYR: row.year,
            LANDSF: row.land_square_footage,
            BLDGSQFT: row.building_square_footage,
          },
        })),
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", countyFetchMock);
  socrataFetchMock.mockImplementation(async (url: string) => {
    if (url.includes("uzyt-m557")) return responses.valueRows ?? [];
    if (url.includes("r5kz-chrr")) return responses.licenseRows ?? [];
    return [];
  });
}

/** An AFFIRMATIVE result on every upstream — enough to be cache-eligible. */
function mockAffirmativeSocrataResponses() {
  mockSocrataResponses({
    classRows: [{
      class: "203",
      year: "2024",
      land_square_footage: "3125",
      building_square_footage: "1800",
    }],
    valueRows: [{ board_tot: 120_000, year: "2024" }],
    licenseRows: [{ doing_business_as_name: "Chatham Cafe", license_description: "Retail Food", expiration_date: "2099-01-01T00:00:00.000" }],
  });
}

/** Every upstream succeeds but returns NOTHING — the negative-result case
 *  Finding 4 says must never be cached. */
function mockEmptySocrataResponses() {
  mockSocrataResponses({ classRows: [], valueRows: [], licenseRows: [] });
}

beforeEach(() => {
  countyFetchMock.mockReset();
  socrataFetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/shortlist/enrich — buildId is required (Finding 4)", () => {
  it("rejects a request with NO buildId field at all with 400, and never calls any upstream", async () => {
    const res = await POST(postRequest({ items: [{ key: "a", pin: PIN, address: ADDRESS }] }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("buildId is required");
    expect(socrataFetchMock).not.toHaveBeenCalled();
  });

  it("rejects an EMPTY-STRING buildId with 400 — the pre-fix version treated \"\" as a valid degraded partition", async () => {
    const res = await POST(postRequest({ buildId: "", items: [{ key: "a", pin: PIN, address: ADDRESS }] }));
    expect(res.status).toBe(400);
    expect(socrataFetchMock).not.toHaveBeenCalled();
  });

  it("rejects a WHITESPACE-ONLY buildId with 400 — trimmed to empty, same as omitting it", async () => {
    const res = await POST(postRequest({ buildId: "   ", items: [{ key: "a", pin: PIN, address: ADDRESS }] }));
    expect(res.status).toBe(400);
  });

  it("accepts a request with a real buildId and a real item, and calls the upstreams", async () => {
    mockAffirmativeSocrataResponses();
    const res = await POST(postRequest({ buildId: "build-basic", items: [{ key: "a", pin: PIN, address: ADDRESS }] }));
    expect(res.status).toBe(200);
    expect(socrataFetchMock).toHaveBeenCalled();
  });

  it("a request with an unparseable JSON body still returns 200 with empty items (the route's own 'never 500' contract) — NOT the 400 buildId rejection, since buildId can't even be read", async () => {
    const res = await POST(rawBodyRequest("this is not json"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
    expect(socrataFetchMock).not.toHaveBeenCalled();
  });

  it("an empty items array short-circuits to a 200 with items: [] regardless of buildId presence", async () => {
    const res = await POST(postRequest({ buildId: "build-1", items: [] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });
});

// NOTE: the route's enrichment cache is a MODULE-LEVEL singleton (`cache`
// in app/api/shortlist/enrich/route.ts), which persists across every test
// in this file — the module is imported once for the whole run. Every test
// below therefore uses its OWN buildId, never reused across tests, so a
// cache entry populated by an earlier test can never leak into a later
// one's call-count assertions.

describe("POST /api/shortlist/enrich — cache is PARTITIONED by buildId (Finding 4)", () => {
  it("the SAME pin under the SAME buildId is served from cache on the second call — socrataFetch is not called again", async () => {
    mockAffirmativeSocrataResponses();

    const first = await POST(
      postRequest({ buildId: "build-same-cache", items: [{ key: "a", pin: PIN, address: null }] }),
    );
    expect(first.status).toBe(200);
    const callsAfterFirst = socrataFetchMock.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await POST(
      postRequest({ buildId: "build-same-cache", items: [{ key: "a", pin: PIN, address: null }] }),
    );
    expect(second.status).toBe(200);
    // Cache hit: no ADDITIONAL upstream calls for the identical (buildId, pin).
    expect(socrataFetchMock.mock.calls.length).toBe(callsAfterFirst);

    const secondBody = (await second.json()) as { items: { countyClass: string | null }[] };
    expect(secondBody.items[0].countyClass).toBe("203");
  });

  it("the SAME pin under a DIFFERENT buildId is fetched INDEPENDENTLY — never cross-served from the prior build's cache entry", async () => {
    mockAffirmativeSocrataResponses();

    const buildOneFirst = await POST(
      postRequest({ buildId: "build-partition-a", items: [{ key: "a", pin: PIN, address: null }] }),
    );
    expect(buildOneFirst.status).toBe(200);
    const callsAfterBuildOne = socrataFetchMock.mock.calls.length;
    expect(callsAfterBuildOne).toBeGreaterThan(0);

    // Cache-hit confirmation for build-partition-a itself (same buildId, no growth).
    await POST(postRequest({ buildId: "build-partition-a", items: [{ key: "a", pin: PIN, address: null }] }));
    expect(socrataFetchMock.mock.calls.length).toBe(callsAfterBuildOne);

    // A DIFFERENT buildId, same PIN: must NOT be served from
    // build-partition-a's cache entry — the upstreams are called again,
    // growing the call count.
    const buildTwoFirst = await POST(
      postRequest({ buildId: "build-partition-b", items: [{ key: "a", pin: PIN, address: null }] }),
    );
    expect(buildTwoFirst.status).toBe(200);
    expect(socrataFetchMock.mock.calls.length).toBeGreaterThan(callsAfterBuildOne);

    // build-partition-b's OWN cache now holds it — a second call under it
    // does not grow the count further.
    const callsAfterBuildTwo = socrataFetchMock.mock.calls.length;
    await POST(postRequest({ buildId: "build-partition-b", items: [{ key: "a", pin: PIN, address: null }] }));
    expect(socrataFetchMock.mock.calls.length).toBe(callsAfterBuildTwo);
  });
});

describe("POST /api/shortlist/enrich — a negative (empty) result is NEVER cached (Finding 4)", () => {
  it("a PIN whose upstreams all succeed but return NOTHING is re-fetched on every call under the SAME buildId — never served a stale 'found nothing' cache hit", async () => {
    mockEmptySocrataResponses();

    const first = await POST(
      postRequest({ buildId: "build-negative", items: [{ key: "a", pin: PIN, address: null }] }),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      items: { countyClass: string | null; assessedValue: number | null; activeLicenses: unknown[]; enrichmentUnavailable: boolean }[];
    };
    expect(firstBody.items[0].countyClass).toBeNull();
    expect(firstBody.items[0].assessedValue).toBeNull();
    expect(firstBody.items[0].activeLicenses).toEqual([]);
    expect(firstBody.items[0].enrichmentUnavailable).toBe(false); // a genuine negative, not a failure
    const callsAfterFirst = socrataFetchMock.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second call, SAME buildId, SAME pin: if the negative result had been
    // cached, this would add ZERO calls. It must instead re-fetch.
    const second = await POST(
      postRequest({ buildId: "build-negative", items: [{ key: "a", pin: PIN, address: null }] }),
    );
    expect(second.status).toBe(200);
    expect(socrataFetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("contrast: an AFFIRMATIVE result for the SAME pin/buildId IS cached — proving the no-cache behavior above is specific to negative results, not a general cache bypass", async () => {
    mockAffirmativeSocrataResponses();
    await POST(postRequest({ buildId: "build-affirmative-contrast", items: [{ key: "a", pin: PIN, address: null }] }));
    const callsAfterFirst = socrataFetchMock.mock.calls.length;

    await POST(postRequest({ buildId: "build-affirmative-contrast", items: [{ key: "a", pin: PIN, address: null }] }));
    expect(socrataFetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("a PARTIAL affirmative result (license found, but no class or assessed value) IS still cache-eligible — 'affirmative' means ANY fact, not all three", async () => {
    mockSocrataResponses({
      classRows: [],
      valueRows: [],
      licenseRows: [{ doing_business_as_name: "Corner Store", license_description: "Retail Food", expiration_date: "2099-01-01T00:00:00.000" }],
    });
    const first = await POST(
      postRequest({ buildId: "build-partial-affirmative", items: [{ key: "a", pin: PIN, address: ADDRESS }] }),
    );
    const firstBody = (await first.json()) as { items: { activeLicenses: { name: string }[] }[] };
    expect(firstBody.items[0].activeLicenses).toEqual([{ name: "Corner Store", description: "Retail Food" }]);
    const callsAfterFirst = socrataFetchMock.mock.calls.length;

    await POST(postRequest({ buildId: "build-partial-affirmative", items: [{ key: "a", pin: PIN, address: ADDRESS }] }));
    expect(socrataFetchMock.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("POST /api/shortlist/enrich — parcel dossier semantics and bounds", () => {
  it("reports Board/certified/mailed precedence, field states, and exact tax year", async () => {
    mockSocrataResponses({
      classRows: [{
        class: "517",
        year: "2025",
        land_square_footage: "3125",
        building_square_footage: "1800",
      }],
      valueRows: [{ board_tot: "6900", certified_tot: "6500", mailed_tot: "6000", year: "2025" }],
      licenseRows: [],
    });
    const res = await POST(
      postRequest({ buildId: "build-stage", items: [{ key: "parcel", pin: PIN, address: null }] }),
    );
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    expect(body.items[0]).toMatchObject({
      countyClass: "517",
      countyClassStatus: "available",
      lotAreaSqft: 3125,
      lotAreaStatus: "available",
      assessorBuildingSqft: 1800,
      assessorBuildingYear: "2025",
      assessorBuildingAreaStatus: "available",
      assessedValue: 6900,
      assessedYear: "2025",
      assessedStage: "board",
      assessedValueStatus: "available",
      activeLicenseStatus: "not_requested",
      enrichmentUnavailable: false,
    });
    const parcelUrl = countyFetchMock.mock.calls.map(([url]) => String(url))[0];
    const outFields = new URL(parcelUrl).searchParams.get("outFields") ?? "";
    expect(parcelUrl).toContain("parcel_current_beta/FeatureServer/0/query");
    expect(outFields).toContain("LANDSF");
    expect(outFields).toContain("BLDGSQFT");
  });

  it("preserves a successful assessed value when the independent class source fails", async () => {
    countyFetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", countyFetchMock);
    socrataFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("uzyt-m557")) return [{ certified_tot: "6500", year: "2025" }];
      return [];
    });
    const res = await POST(
      postRequest({ buildId: "build-partial-fields", items: [{ key: "parcel", pin: PIN, address: null }] }),
    );
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    expect(body.items[0]).toMatchObject({
      countyClass: null,
      countyClassStatus: "unavailable",
      lotAreaSqft: null,
      lotAreaStatus: "unavailable",
      assessorBuildingSqft: null,
      assessorBuildingYear: null,
      assessorBuildingAreaStatus: "unavailable",
      assessedValue: 6500,
      assessedYear: "2025",
      assessedStage: "certified",
      assessedValueStatus: "available",
      enrichmentUnavailable: true,
    });
  });

  it("treats zero and negative parcel dimensions as unpublished, never as real zero-area facts", async () => {
    mockSocrataResponses({
      classRows: [{
        class: "517",
        year: "2025",
        land_square_footage: "0",
        building_square_footage: "-25",
      }],
      valueRows: [],
      licenseRows: [],
    });
    const res = await POST(
      postRequest({ buildId: "build-nonpositive-area", items: [{ key: "parcel", pin: PIN, address: null }] }),
    );
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    expect(body.items[0]).toMatchObject({
      lotAreaSqft: null,
      lotAreaStatus: "not_published",
      assessorBuildingSqft: null,
      assessorBuildingAreaStatus: "not_published",
    });
  });

  it("deduplicates concurrent identical PIN/address lookups within one request", async () => {
    mockAffirmativeSocrataResponses();
    const res = await POST(
      postRequest({
        buildId: "build-dedupe",
        items: [
          { key: "tracked", pin: PIN, address: ADDRESS },
          { key: "land", pin: `20-36-323-008-0000`, address: ADDRESS },
        ],
      }),
    );
    const body = (await res.json()) as { items: { key: string }[] };
    expect(body.items.map((item) => item.key)).toEqual(["tracked", "land"]);
    expect(countyFetchMock).toHaveBeenCalledTimes(1);
    expect(socrataFetchMock).toHaveBeenCalledTimes(2);
  });

  it("discloses requested, accepted, and truncated counts at the hard cap", async () => {
    mockEmptySocrataResponses();
    const items = Array.from({ length: 30 }, (_, index) => ({
      key: `item-${index}`,
      pin: null,
      address: null,
    }));
    const res = await POST(postRequest({ buildId: "build-cap", items }));
    const body = (await res.json()) as {
      items: unknown[];
      request: { requested: number; accepted: number; truncated: number };
    };
    expect(body.items).toHaveLength(25);
    expect(body.request).toEqual({ requested: 30, accepted: 25, truncated: 5 });
    expect(socrataFetchMock).not.toHaveBeenCalled();
  });

  it("queries only issued AAI licenses after the Chicago calendar day", async () => {
    mockAffirmativeSocrataResponses();
    await POST(
      postRequest({ buildId: "build-license-query", items: [{ key: "a", pin: PIN, address: ADDRESS }] }),
    );
    const licenseUrl = socrataFetchMock.mock.calls
      .map(([url]) => String(url))
      .find((url) => url.includes("r5kz-chrr"));
    expect(licenseUrl).toBeDefined();
    const where = new URL(licenseUrl!).searchParams.get("$where") ?? "";
    expect(where).toContain("license_status='AAI'");
    expect(where).toContain("expiration_date>");
  });
});
