import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSQLMock } = vi.hoisted(() => ({ getSQLMock: vi.fn() }));

vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));

import { GET } from "./route";

function healthRequest() {
  return new NextRequest("http://localhost/api/health", {
    headers: { "x-admin-key": "health-test-secret" },
  });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stubHealthFetch(zoningPayload: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/ExternalApps/Zoning/MapServer/1/query")) {
      return jsonResponse(zoningPayload);
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  getSQLMock.mockReset().mockReturnValue(null);
  vi.stubEnv("ADMIN_SECRET", "health-test-secret");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/health Chicago zoning probe", () => {
  it("queries feature layer 1 with a WGS84 point and validates ZONE_CLASS", async () => {
    const fetchMock = stubHealthFetch({
      features: [{ attributes: { ZONE_CLASS: "PD 677" } }],
    });

    const response = await GET(healthRequest());
    const body = await response.json();
    const zoningProbe = body.probes.find(
      (probe: { name: string }) => probe.name === "Chicago ArcGIS Zoning",
    );

    expect(zoningProbe).toMatchObject({
      status: "ok",
      details: { zoneClass: "PD 677" },
    });

    const zoningCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/ExternalApps/Zoning/MapServer/1/query"),
    );
    expect(zoningCall).toBeDefined();

    const probeUrl = new URL(String(zoningCall?.[0]));
    expect(probeUrl.pathname).toBe(
      "/arcgis/rest/services/ExternalApps/Zoning/MapServer/1/query",
    );
    expect(probeUrl.searchParams.get("where")).toBe("1=1");
    expect(probeUrl.searchParams.get("geometry")).toBe("-87.62318,41.88183");
    expect(probeUrl.searchParams.get("geometryType")).toBe("esriGeometryPoint");
    expect(probeUrl.searchParams.get("inSR")).toBe("4326");
    expect(probeUrl.searchParams.get("spatialRel")).toBe(
      "esriSpatialRelIntersects",
    );
    expect(probeUrl.searchParams.get("outFields")).toBe("ZONE_CLASS");
    expect(probeUrl.searchParams.get("returnGeometry")).toBe("false");
    expect(probeUrl.searchParams.get("resultRecordCount")).toBe("1");
    expect(probeUrl.searchParams.get("f")).toBe("json");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("MapServer/0"))).toBe(
      false,
    );
  });

  it("degrades when ArcGIS returns an error inside an HTTP 200 response", async () => {
    stubHealthFetch({
      error: { code: 400, message: "Unable to complete operation." },
    });

    const response = await GET(healthRequest());
    const body = await response.json();
    const zoningProbe = body.probes.find(
      (probe: { name: string }) => probe.name === "Chicago ArcGIS Zoning",
    );

    expect(zoningProbe).toMatchObject({
      status: "degraded",
      message: "ArcGIS query error 400: Unable to complete operation.",
    });
  });

  it("degrades when the probe point returns no usable zoning feature", async () => {
    stubHealthFetch({ features: [] });

    const response = await GET(healthRequest());
    const body = await response.json();
    const zoningProbe = body.probes.find(
      (probe: { name: string }) => probe.name === "Chicago ArcGIS Zoning",
    );

    expect(zoningProbe).toMatchObject({
      status: "degraded",
      message: "Zoning query returned no usable ZONE_CLASS",
    });
  });
});
