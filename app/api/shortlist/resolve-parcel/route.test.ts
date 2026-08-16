import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const BASE = "http://localhost/api/shortlist/resolve-parcel?lat=41.837760&lon=-87.709980&address=3040%20S%20HOMAN%20AVE";

function countyResponse(features: unknown[], extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ features, ...extra }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function feature(pin: unknown, address = "3040 S HOMAN AVE") {
  return { attributes: { PIN14: pin, street_address: address, city_state_zip: "CHICAGO, IL 60623" } };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/shortlist/resolve-parcel", () => {
  it("resolves exactly one address-matched intersecting parcel with provenance", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(countyResponse([
      { ...feature("16-26-427-040-0000"), ownerName: "discard", taxpayer: "discard" },
    ]));
    const response = await GET(new NextRequest(BASE));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toMatchObject({
      status: "resolved",
      pin: "16264270400000",
      source: "cook_county_current_parcels",
      matchMethod: "exact_intersection",
    });
    expect(body).not.toHaveProperty("ownerName");
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("spatialRel")).toBe("esriSpatialRelIntersects");
    expect(url.searchParams.get("geometryType")).toBe("esriGeometryPoint");
    expect(url.searchParams.get("outFields")).toBe("PIN14,street_address,city_state_zip");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("within_circle");
  });

  it("returns no exact match instead of accepting a nearby address", async () => {
    vi.mocked(fetch).mockResolvedValue(countyResponse([feature("16264270400000", "3042 S HOMAN AVE")]));
    const response = await GET(new NextRequest(BASE));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ status: "no_match", reason: "address_mismatch" });
  });

  it("resolves when the candidate record omits the street suffix the County publishes", async () => {
    vi.mocked(fetch).mockResolvedValue(countyResponse([
      { attributes: { PIN14: "25034310240000", street_address: "9410 S CHAMPLAIN AVE", city_state_zip: "CHICAGO, IL 60619" } },
    ]));
    const response = await GET(new NextRequest(
      "http://localhost/api/shortlist/resolve-parcel?lat=41.723586&lon=-87.608399&address=9410+S+CHAMPLAIN",
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "resolved", pin: "25034310240000" });
  });

  it("resolves a County-published unit tag on the same lot but rejects a different named street", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(countyResponse([feature("16264270400000", "4320 W CERMAK RD 2")]))
      .mockResolvedValueOnce(countyResponse([feature("16264270400000", "4320 W CERMAK RD EAST 2")]));
    const url = "http://localhost/api/shortlist/resolve-parcel?lat=41.837760&lon=-87.709980&address=4320+W+CERMAK+RD";
    const ok = await GET(new NextRequest(url));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "resolved", pin: "16264270400000" });
    const rejected = await GET(new NextRequest(url));
    expect(rejected.status).toBe(404);
    expect(await rejected.json()).toMatchObject({ status: "no_match", reason: "address_mismatch" });
  });

  it("keeps zero and multiple intersections distinct", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(countyResponse([]))
      .mockResolvedValueOnce(countyResponse([
        feature("16264270400000"),
        feature("16264270410000"),
      ]));
    const noMatch = await GET(new NextRequest(BASE));
    const ambiguous = await GET(new NextRequest(BASE));
    expect(noMatch.status).toBe(404);
    expect(ambiguous.status).toBe(409);
    expect(await noMatch.json()).toMatchObject({ status: "no_match", reason: "no_intersection" });
    expect(await ambiguous.json()).toMatchObject({ status: "ambiguous", candidateCount: 2 });
  });

  it("fails closed on numeric, malformed, or truncated source rows", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(countyResponse([feature(16264270400000)]))
      .mockResolvedValueOnce(countyResponse([{ attributes: null }]))
      .mockResolvedValueOnce(countyResponse([feature("16264270400000")], { exceededTransferLimit: true }));
    expect((await GET(new NextRequest(BASE))).status).toBe(502);
    expect((await GET(new NextRequest(BASE))).status).toBe(502);
    expect((await GET(new NextRequest(BASE))).status).toBe(503);
  });

  it("fails closed when duplicate source rows assign conflicting addresses to one PIN", async () => {
    vi.mocked(fetch).mockResolvedValue(countyResponse([
      feature("16264270400000", "3040 S HOMAN AVE"),
      feature("16264270400000", "3042 S HOMAN AVE"),
    ]));
    const response = await GET(new NextRequest(BASE));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ status: "malformed" });
  });

  it("does not call the source for missing, nonfinite, zero, or out-of-Chicago coordinates", async () => {
    const fetchMock = vi.mocked(fetch);
    for (const url of [
      "http://localhost/api/shortlist/resolve-parcel?address=3040%20S%20HOMAN%20AVE",
      "http://localhost/api/shortlist/resolve-parcel?lat=NaN&lon=-87.7&address=3040%20S%20HOMAN%20AVE",
      "http://localhost/api/shortlist/resolve-parcel?lat=0&lon=0&address=3040%20S%20HOMAN%20AVE",
      "http://localhost/api/shortlist/resolve-parcel?lat=41.8&lon=-88.4&address=3040%20S%20HOMAN%20AVE",
    ]) {
      expect((await GET(new NextRequest(url))).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds retries and reports source failure honestly", async () => {
    const fetchMock = vi.mocked(fetch).mockRejectedValue(new Error("timeout"));
    const response = await GET(new NextRequest(BASE));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
