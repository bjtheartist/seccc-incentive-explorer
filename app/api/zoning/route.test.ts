import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { cachedMock } = vi.hoisted(() => ({ cachedMock: vi.fn() }));

vi.mock("@/lib/redis", () => ({
  cached: cachedMock,
  roundCoord: (value: number, decimals = 4) => value.toFixed(decimals),
}));

vi.mock("@/lib/socrata", () => ({
  socrataHeaders: () => ({ "X-App-Token": "test-token" }),
}));

import { GET } from "./route";

function request(query = "lat=41.73035&lon=-87.55024"): NextRequest {
  return new NextRequest(`http://localhost/api/zoning?${query}`);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The vintage entry for one mirror, by published source id. */
function mirror(
  body: { vintage: { mirrors: { id: string }[] } },
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const found = body.vintage.mirrors.find((entry) => entry.id === id);
  if (!found) throw new Error(`no vintage mirror published for ${id}`);
  return found;
}

function zbaFeature() {
  return {
    attributes: {
      OBJECTID: 71,
      ORDINANCE: "71-25-Z",
      ORD_YEAR: "71",
      ORD_CASE: "2025",
      ORD_TYPE: "Z",
      ADDRESS: "118 S CLINTON ST",
      JUDGMENT: "Granted with Conditions",
      DESC_: "Published variation description.",
      PIN10: "1716101001",
      ID: "71-25-Z",
      GLOBALID: "zba-g-1",
      PIN_ACCURACY: "MATCHED",
    },
  };
}

beforeEach(() => {
  cachedMock.mockReset().mockImplementation(
    async (_key: string, _ttl: number, loader: () => Promise<unknown>) =>
      loader(),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/zoning", () => {
  it("queries ArcGIS feature layer 1 in WGS84 and returns official fields", async () => {
    const updatedAt = Date.UTC(2026, 5, 16);
    const ordinanceDate = Date.UTC(2024, 1, 21);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/MapServer/16/query")) {
        return jsonResponse({ features: [zbaFeature()] });
      }
      return jsonResponse({
        features: [
          {
            attributes: {
              ZONE_CLASS: "PD 1376",
              ZONE_TYPE: 1,
              PD_NUM: 1376,
              PMD_SUB_AREA: null,
              PEDSTREET_AREANAME: "Commercial Avenue",
              ORDINANCE_NUM: "O2024-1000",
              ORDINANCE_DATE: ordinanceDate,
              UPDATE_TIMESTAMP: updatedAt,
              CLERK_DOCNO: "O2024-1000",
              CLERK_URL: "https://example.test/clerk/O2024-1000",
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "available",
      zoneClass: "PD 1376",
      zoneType: null,
      zoneTypeCode: 1,
      pdNumber: 1376,
      pedestrianStreetAreaName: "Commercial Avenue",
      ordinanceNumber: "O2024-1000",
      ordinanceDate: new Date(ordinanceDate).toISOString(),
      clerkDocumentNumber: "O2024-1000",
      clerkUrl: "https://example.test/clerk/O2024-1000",
      recordUpdatedAt: new Date(updatedAt).toISOString(),
      source: {
        id: "chicago-arcgis-zoning",
        recordUpdatedAt: new Date(updatedAt).toISOString(),
      },
      zba: {
        status: "available",
        returnedCount: 1,
        coverage: "complete",
        cases: [{ caseReference: "71-25-Z", judgment: "Granted with Conditions" }],
      },
    });

    const upstreamCall = fetchMock.mock.calls.find(
      ([input]) => String(input).includes("/MapServer/1/query"),
    );
    const upstreamUrl = new URL(String(upstreamCall?.[0]));
    expect(upstreamUrl.pathname.endsWith("/MapServer/1/query")).toBe(true);
    expect(upstreamUrl.searchParams.get("inSR")).toBe("4326");
    expect(upstreamUrl.searchParams.get("geometry")).toBe(
      "-87.55024,41.73035",
    );
    expect(upstreamUrl.searchParams.get("returnGeometry")).toBe("false");
    expect(upstreamUrl.searchParams.get("resultRecordCount")).toBe("1");
    expect(upstreamUrl.searchParams.get("outFields")).toContain("CLERK_URL");
    // The cache key must move whenever the response shape does. A stale v4
    // entry would serve a payload with no vintage at all for the whole 7-day
    // TTL on every already-warm coordinate.
    expect(cachedMock).toHaveBeenCalledWith(
      "zoning:v5:41.73035:-87.55024",
      604800,
      expect.any(Function),
    );
  });

  it("detects an ArcGIS error inside HTTP 200 and uses intersects fallback", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/MapServer/16/query")) {
        return jsonResponse({ features: [] });
      }
      if (url.includes("/MapServer/1/query")) {
        return jsonResponse({ error: { code: 400, message: "Unable to complete operation" } });
      }
      return jsonResponse({
          type: "FeatureCollection",
          features: [
            {
              properties: {
                zone_class: "B3-2",
                zone_type: "1",
                pd_num: "0",
                edit_date: "2026-06-16T00:00:00.000",
              },
            },
          ],
        });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "available",
      zoneClass: "B3-2",
      zoneType: null,
      source: { id: "chicago-data-portal-zoning" },
    });
    const fallbackCall = fetchMock.mock.calls.find(
      ([input]) => String(input).includes("dj47-wfun.geojson"),
    );
    const fallbackUrl = new URL(String(fallbackCall?.[0]));
    expect(fallbackUrl.searchParams.get("$where")).toBe(
      "intersects(the_geom,'POINT(-87.55024 41.73035)')",
    );
    expect(fallbackUrl.toString()).not.toContain("within_circle");
  });

  it("returns a typed not_found result after a successful empty lookup", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("data.cityofchicago.org")
        ? jsonResponse({ type: "FeatureCollection", features: [] })
        : jsonResponse({ features: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request("lat=42.5&lon=-88.5"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "not_found",
      zoneClass: null,
      zoneType: null,
      source: { id: "chicago-arcgis-zoning" },
      zba: { status: "not_found", returnedCount: 0 },
    });
    expect(response.headers.get("Cache-Control")).toContain("s-maxage");
  });

  it("returns an uncached 503 when both authoritative sources fail", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/MapServer/16/query")) {
        return jsonResponse({ features: [zbaFeature()] });
      }
      return jsonResponse(
        { error: url.includes("data.cityofchicago.org") ? "Socrata unavailable" : "ArcGIS unavailable" },
        400,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "unavailable",
      zoneClass: null,
      zoneType: null,
      source: null,
      message: "Published Chicago zoning data is temporarily unavailable.",
      zba: { status: "available", returnedCount: 1 },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps current zoning available but does not cache a transient ZBA failure", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/MapServer/16/query")) {
        return jsonResponse({ error: { code: 500 } }, 500);
      }
      return jsonResponse({
        features: [{ attributes: { ZONE_CLASS: "B3-2", ZONE_TYPE: 1 } }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "available",
      zoneClass: "B3-2",
      zba: { status: "unavailable" },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("never queries the ArcGIS group layer (layer 0 errors inside HTTP 200)", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("/MapServer/16/query")
        ? jsonResponse({ features: [] })
        : jsonResponse({
            features: [{ attributes: { ZONE_CLASS: "B3-2", ZONE_TYPE: 1 } }],
          }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await GET(request());

    const zoningLayerCalls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/ExternalApps/Zoning/MapServer/"));
    expect(zoningLayerCalls.length).toBeGreaterThan(0);
    for (const url of zoningLayerCalls) {
      expect(url).toContain("/MapServer/1/query");
      expect(url).not.toContain("/MapServer/0/query");
    }
  });

  it.each([
    ["C1-1.5", 1],
    ["DX-10", 3],
  ])(
    "accepts the published classification %s rather than treating it as malformed",
    async (zoneClass, zoneTypeCode) => {
      const fetchMock = vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/MapServer/16/query")
          ? jsonResponse({ features: [] })
          : jsonResponse({
              features: [
                { attributes: { ZONE_CLASS: zoneClass, ZONE_TYPE: zoneTypeCode } },
              ],
            }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const response = await GET(request());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: "available",
        zoneClass,
        zoneTypeCode,
        // The raw published class is the fact; no local label replaces it.
        zoneType: null,
      });
    },
  );

  it("preserves the PD fields the union predicate needs, including the zone_type=1 PD outlier", async () => {
    // Live counts on dj47-wfun: pd_num>0 = 1456, zone_class LIKE 'PD%' = 1457,
    // zone_type=5 = 1459, union = 1461. "PD 1376" is the polygon classed PD
    // while carrying zone_type 1, so a zone_type-only predicate would miss it
    // and a pd_num-only predicate would miss PD polygons with pd_num 0.
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("/MapServer/16/query")
        ? jsonResponse({ features: [] })
        : jsonResponse({
            features: [
              {
                attributes: { ZONE_CLASS: "PD 1376", ZONE_TYPE: 1, PD_NUM: 1376 },
              },
            ],
          }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const body = await (await GET(request())).json();

    // All three union inputs survive to the consumer, so no single predicate
    // is baked into the payload.
    expect(body.zoneClass).toBe("PD 1376");
    expect(body.zoneTypeCode).toBe(1);
    expect(body.pdNumber).toBe(1376);
    // No derived PD boolean is published; the union is the consumer's to apply.
    expect(body).not.toHaveProperty("isPlannedDevelopment");
  });

  it("reports both mirrors' freshness on their own terms instead of picking one", async () => {
    const polygonUpdatedAt = Date.UTC(2023, 1, 3);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/MapServer/16/query")) return jsonResponse({ features: [] });
      if (url.includes("/api/views/dj47-wfun.json")) {
        return jsonResponse({
          // Socrata publishes rowsUpdatedAt in epoch SECONDS.
          rowsUpdatedAt: 1785338469,
          metadata: {
            custom_fields: {
              Metadata: { "Time Period": "Current as of June 2026" },
            },
          },
        });
      }
      return jsonResponse({
        features: [
          {
            attributes: {
              ZONE_CLASS: "PD 677",
              ZONE_TYPE: 5,
              PD_NUM: 677,
              UPDATE_TIMESTAMP: polygonUpdatedAt,
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const body = await (await GET(request())).json();

    expect(body.vintage.answeredBy).toBe("chicago-arcgis-zoning");
    expect(body.vintage.answerKind).toBe("zoning");
    expect(typeof body.vintage.retrievedAt).toBe("string");

    const arcgis = mirror(body, "chicago-arcgis-zoning");
    const socrata = mirror(body, "chicago-data-portal-zoning");

    // Record scope: describes the returned polygon only.
    expect(arcgis).toMatchObject({
      queryOutcome: "answered",
      record: {
        field: "UPDATE_TIMESTAMP",
        scope: "record",
        updatedAt: new Date(polygonUpdatedAt).toISOString(),
      },
      // The feature layer exposes no service-level edit date at all.
      dataset: null,
      datasetOutcome: "not_published",
    });

    // Dataset scope: describes the whole table, and disagrees with ArcGIS.
    expect(socrata).toMatchObject({
      // ArcGIS answered first, so this mirror was never asked about the point.
      queryOutcome: "not_queried",
      record: null,
      dataset: {
        field: "rowsUpdatedAt",
        scope: "dataset",
        updatedAt: new Date(1785338469 * 1000).toISOString(),
      },
      statedTimePeriod: "Current as of June 2026",
    });

    // The disagreement is stated, not resolved.
    expect(arcgis.record.updatedAt).not.toBe(socrata.dataset.updatedAt);
    expect(body.vintage.comparabilityNote).toMatch(/different scopes/i);
  });

  it("reports an unreachable mirror as unknown rather than as never-updated", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/MapServer/16/query")) return jsonResponse({ features: [] });
      if (url.includes("/api/views/dj47-wfun.json")) {
        return jsonResponse({ error: "metadata unavailable" }, 500);
      }
      return jsonResponse({
        features: [{ attributes: { ZONE_CLASS: "B3-2", ZONE_TYPE: 1 } }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const body = await (await GET(request())).json();
    const socrata = mirror(body, "chicago-data-portal-zoning");

    expect(socrata.dataset).toBeNull();
    expect(socrata.datasetOutcome).toBe("unreachable");
    expect(socrata.note).toMatch(/could not be reached/i);
  });

  /**
   * Defect 1. When ArcGIS returns `features: []` nothing came back, so the
   * mirror must not be described as a record that arrived without a timestamp.
   * Before the fix the note read "No UPDATE_TIMESTAMP was published on the
   * returned record" for a query that returned no record at all.
   */
  it("says an empty ArcGIS mirror returned no polygon, not that a record lacked a timestamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/MapServer/16/query")) return jsonResponse({ features: [] });
        if (url.includes("/api/views/")) return jsonResponse({ rowsUpdatedAt: 1785338469 });
        if (url.includes("/MapServer/1/query")) return jsonResponse({ features: [] });
        return jsonResponse({
          type: "FeatureCollection",
          features: [{ properties: { zone_class: "B3-2", edit_date: "2024-05-05T00:00:00.000" } }],
        });
      }),
    );

    const arcgis = mirror(await (await GET(request())).json(), "chicago-arcgis-zoning");

    expect(arcgis.queryOutcome).toBe("empty");
    expect(arcgis.record).toBeNull();
    expect(arcgis.note).toMatch(/returned no polygon/i);
    // Nothing came back, so nothing can be said about what came back.
    expect(arcgis.note).not.toMatch(/returned record/i);
  });

  /**
   * Defect 2. An absence is only a determination when every mirror could
   * speak. ArcGIS empty + a Socrata point query that hard-failed previously
   * answered HTTP 200 not_found: "No published Chicago zoning district was
   * returned for this location" — with one mirror never able to answer.
   */
  it("refuses to publish not_found when the other mirror could not be checked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/MapServer/16/query")) return jsonResponse({ features: [] });
        if (url.includes("/api/views/")) return jsonResponse({ rowsUpdatedAt: 1785338469 });
        if (url.includes("/MapServer/1/query")) return jsonResponse({ features: [] });
        return jsonResponse({ error: "Socrata point query failed" }, 400);
      }),
    );

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("unavailable");
    expect(body.status).not.toBe("not_found");
    expect(body.message).toMatch(/unconfirmed/i);
    expect(body.vintage.answeredBy).toBeNull();
    expect(body.vintage.answerKind).toBeNull();
    expect(mirror(body, "chicago-arcgis-zoning").queryOutcome).toBe("empty");
    expect(mirror(body, "chicago-data-portal-zoning").queryOutcome).toBe("failed");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  /**
   * Defect 3. A mirror's reachability is its POINT QUERY's, not its metadata
   * endpoint's. Previously a healthy /api/views response made a mirror whose
   * point query returned HTTP 400 look like it had been consulted.
   */
  it("reports the point query's outcome separately from metadata retrieval", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/MapServer/16/query")) return jsonResponse({ features: [] });
        if (url.includes("/api/views/")) return jsonResponse({ rowsUpdatedAt: 1785338469 });
        if (url.includes("/MapServer/1/query")) {
          return jsonResponse({ error: { code: 500, message: "boom" } });
        }
        return jsonResponse({ error: "Socrata point query failed" }, 400);
      }),
    );

    const body = await (await GET(request())).json();
    const socrata = mirror(body, "chicago-data-portal-zoning");

    // The point query failed even though the dataset metadata came back fine.
    expect(socrata.queryOutcome).toBe("failed");
    expect(socrata.datasetOutcome).toBe("published");
    expect(socrata.record).toBeNull();
    expect(socrata.note).toMatch(/could not be answered/i);
    expect(socrata.note).toMatch(/not evidence/i);
    // "not queried", "queried and empty" and "queried and failed" are distinct.
    expect(socrata.queryOutcome).not.toBe("not_queried");
    expect(socrata.queryOutcome).not.toBe("empty");
  });

  /**
   * Defect 4. A not_found payload used to name a source while reporting that
   * no mirror answered. The mirror that authoritatively returned nothing IS
   * the one that answered, and `answerKind` says what it established.
   */
  it("keeps the not_found payload consistent about which mirror answered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/MapServer/16/query")) return jsonResponse({ features: [] });
        if (url.includes("/api/views/")) return jsonResponse({ rowsUpdatedAt: 1785338469 });
        if (url.includes("/MapServer/1/query")) return jsonResponse({ features: [] });
        return jsonResponse({ type: "FeatureCollection", features: [] });
      }),
    );

    const response = await GET(request("lat=42.5&lon=-88.5"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("not_found");
    expect(body.vintage.answeredBy).toBe(body.source.id);
    // Answered "no zoning here", which is not the same as returning a polygon.
    expect(body.vintage.answerKind).toBe("no_zoning");
    // Both mirrors agreed there is nothing here; neither was left unasked.
    expect(mirror(body, "chicago-arcgis-zoning").queryOutcome).toBe("empty");
    expect(mirror(body, "chicago-data-portal-zoning").queryOutcome).toBe("empty");
  });

  /**
   * Defect 5. The answering record's freshness belongs to the mirror that
   * produced the record. Previously buildVintage only ever received ArcGIS's
   * record timestamp, so a Socrata-answered lookup published a top-level
   * recordUpdatedAt that appeared on neither mirror.
   */
  it("puts the answering record's timestamp on the mirror that actually answered", async () => {
    const recordIso = new Date("2024-05-05T00:00:00.000").toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/MapServer/16/query")) return jsonResponse({ features: [] });
        if (url.includes("/api/views/")) return jsonResponse({ rowsUpdatedAt: 1785338469 });
        if (url.includes("/MapServer/1/query")) {
          return jsonResponse({ error: { code: 500, message: "boom" } });
        }
        return jsonResponse({
          type: "FeatureCollection",
          features: [{ properties: { zone_class: "B3-2", edit_date: "2024-05-05T00:00:00.000" } }],
        });
      }),
    );

    const body = await (await GET(request())).json();
    const arcgis = mirror(body, "chicago-arcgis-zoning");
    const socrata = mirror(body, "chicago-data-portal-zoning");

    expect(body.recordUpdatedAt).toBe(recordIso);
    expect(body.vintage.answeredBy).toBe("chicago-data-portal-zoning");

    // The record timestamp rides on the mirror that returned the record.
    expect(socrata.record).toEqual({
      field: "edit_date",
      updatedAt: recordIso,
      scope: "record",
    });
    // ...and never on the mirror that produced nothing.
    expect(arcgis.record).toBeNull();
    expect(arcgis.queryOutcome).toBe("failed");
    // The dataset-level value stays a separate, differently scoped fact.
    expect(socrata.dataset.updatedAt).not.toBe(recordIso);
  });

  /**
   * Defect 9. Provenance is best effort and must never delay an answer a
   * mirror already gave. Before the fix a stalled metadata endpoint added its
   * full timeout to every cache miss.
   */
  it("does not let a stalled metadata endpoint delay an answer ArcGIS already gave", async () => {
    const metadataStallMs = 1200;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/api/views/")) {
          await new Promise((resolve) => setTimeout(resolve, metadataStallMs));
          return jsonResponse({ rowsUpdatedAt: 1785338469 });
        }
        if (url.includes("/MapServer/16/query")) return jsonResponse({ features: [] });
        return jsonResponse({ features: [{ attributes: { ZONE_CLASS: "B3-2" } }] });
      }),
    );

    const startedAt = Date.now();
    const body = await (await GET(request())).json();
    const elapsed = Date.now() - startedAt;

    expect(body.status).toBe("available");
    expect(elapsed).toBeLessThan(metadataStallMs - 300);

    // The mirror block is still there, and still says what it does not know.
    const socrata = mirror(body, "chicago-data-portal-zoning");
    expect(socrata.datasetOutcome).toBe("not_waited");
    expect(socrata.dataset).toBeNull();
    expect(socrata.note).toMatch(/not waited on/i);
    // Not waiting is not a finding that the endpoint publishes nothing.
    expect(socrata.note).toMatch(/not a finding/i);
  });

  it("still carries provenance on the 503 when both sources fail", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/MapServer/16/query")) return jsonResponse({ features: [] });
      if (url.includes("/api/views/dj47-wfun.json")) {
        return jsonResponse({ rowsUpdatedAt: 1785338469 });
      }
      return jsonResponse({ error: "upstream unavailable" }, 400);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("unavailable");
    expect(body.vintage.answeredBy).toBeNull();
    expect(body.vintage.mirrors).toHaveLength(2);
  });

  it.each([
    "",
    "lat=abc&lon=-87.6",
    "lat=41.8&lon=not-a-number",
    "lat=91&lon=-87.6",
    "lat=41.8&lon=-181",
  ])("rejects invalid coordinates without contacting upstream: %s", async (query) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request(query));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cachedMock).not.toHaveBeenCalled();
  });
});
