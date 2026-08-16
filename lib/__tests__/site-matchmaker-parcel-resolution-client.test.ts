import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCandidateParcelResolutionCacheForTests,
  resolveCandidateParcelIdentity,
} from "../site-matchmaker-parcel-resolution-client";

const candidate = {
  key: "coord:41.837760,-87.709980|addr:3040 S HOMAN AVE",
  pin: null,
  address: "3040 S HOMAN AVE",
  lat: 41.83776,
  lon: -87.70998,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => clearCandidateParcelResolutionCacheForTests());
afterEach(() => vi.unstubAllGlobals());

describe("resolveCandidateParcelIdentity", () => {
  it("skips coordinate lookup for an existing valid PIN", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveCandidateParcelIdentity("build-a", { ...candidate, pin: "16-26-427-040-0000" })).resolves.toMatchObject({
      status: "resolved", pin: "16264270400000", pinSource: "saved_snapshot",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("issues no request for invalid or out-of-Chicago coordinates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveCandidateParcelIdentity("build-a", { ...candidate, lat: 0, lon: 0 })).resolves.toMatchObject({
      status: "no_match", reason: "invalid_location",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses exact six-decimal coordinates and shares concurrent and cached success", async () => {
    let release!: (value: Response) => void;
    const fetchMock = vi.fn((_input: RequestInfo | URL) => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const first = resolveCandidateParcelIdentity("build-a", candidate);
    const second = resolveCandidateParcelIdentity("build-a", candidate);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("lat=41.837760&lon=-87.709980");
    release(response({
      status: "resolved",
      pin: "16264270400000",
      source: "cook_county_current_parcels",
      matchMethod: "exact_intersection",
      checkedAt: "2026-08-15T20:00:00.000Z",
      ownerName: "must be discarded",
      ownerMailingAddress: "must be discarded",
      url: "https://attacker.invalid",
    }));
    await expect(first).resolves.toMatchObject({ status: "resolved", pin: "16264270400000" });
    await expect(second).resolves.toMatchObject({ status: "resolved", pin: "16264270400000" });
    await resolveCandidateParcelIdentity("build-a", candidate);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache unavailable or malformed responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ status: "unavailable" }, 503))
      .mockResolvedValueOnce(response({ status: "resolved", pin: 16264270400000 }))
      .mockResolvedValueOnce(response({
        status: "resolved",
        pin: "16264270400000",
        source: "cook_county_current_parcels",
        matchMethod: "exact_intersection",
        checkedAt: "2026-08-15T20:00:00.000Z",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveCandidateParcelIdentity("build-a", candidate)).resolves.toEqual({ status: "unavailable" });
    await expect(resolveCandidateParcelIdentity("build-a", candidate)).resolves.toEqual({ status: "malformed" });
    await expect(resolveCandidateParcelIdentity("build-a", candidate)).resolves.toMatchObject({ status: "resolved" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("preserves the route's distinct ambiguous state even though it uses HTTP 409", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      status: "ambiguous",
      candidateCount: 2,
      checkedAt: "2026-08-15T20:00:00.000Z",
      source: "cook_county_current_parcels",
      matchMethod: "exact_intersection",
    }, 409));
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveCandidateParcelIdentity("build-a", candidate)).resolves.toEqual({
      status: "ambiguous",
      candidateCount: 2,
      checkedAt: "2026-08-15T20:00:00.000Z",
      source: "cook_county_current_parcels",
      matchMethod: "exact_intersection",
    });
  });
});
