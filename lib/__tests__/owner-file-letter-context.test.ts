import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Program } from "@/lib/types";

const { geocodeGETMock, zonesCheckV2GETMock, getProgramsSyncMock } = vi.hoisted(() => ({
  geocodeGETMock: vi.fn(),
  zonesCheckV2GETMock: vi.fn(),
  getProgramsSyncMock: vi.fn(),
}));

vi.mock("@/app/api/geocode/route", () => ({ GET: geocodeGETMock }));
// review5 S2: this file now calls the v2 in-process route, not v1.
vi.mock("@/app/api/zones/check/v2/route", () => ({ GET: zonesCheckV2GETMock }));
vi.mock("@/lib/programs-data", () => ({ getProgramsSync: getProgramsSyncMock }));

import { resolveParcelProgramContext } from "../owner-file-letter-context";

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function v2Body(layers: Record<string, { state: "matched" | "not_matched" | "unknown"; name?: string; reason?: string }>) {
  return {
    schemaVersion: 2,
    dataRevision: "test-revision",
    checkedAt: "2026-08-13T00:00:00.000Z",
    requestedLayers: Object.keys(layers),
    layers,
  };
}

const nofProgram = {
  id: "nof",
  name: "Neighborhood Opportunity Fund (NOF)",
  level: "City",
  zoneKey: "nof",
  summary: "Commercial/industrial building rehab grant.",
  url: "https://www.chicago.gov/nof",
} as unknown as Program;

const tifProgram = {
  id: "tif",
  name: "Universal TIF Incentive",
  level: "City",
  zoneKey: "tif",
  summary: "TIF-district financing.",
  url: "https://www.chicago.gov/tif",
} as unknown as Program;

beforeEach(() => {
  geocodeGETMock.mockReset();
  zonesCheckV2GETMock.mockReset();
  getProgramsSyncMock.mockReset().mockReturnValue([nofProgram]);
});

describe("resolveParcelProgramContext", () => {
  it("resolves a matched program for a geocodable address inside a mapped zone", async () => {
    geocodeGETMock.mockResolvedValue(jsonResponse(200, { lat: 41.74, lon: -87.55 }));
    zonesCheckV2GETMock.mockResolvedValue(
      jsonResponse(200, v2Body({ nof: { state: "matched", name: "NOF Zone" } })),
    );

    const results = await resolveParcelProgramContext(["8232 S BURLEY AVE"]);
    expect(results).toHaveLength(1);
    expect(results[0].address).toBe("8232 S BURLEY AVE");
    expect(results[0].lat).toBe(41.74);
    expect(results[0].programs.map((p) => p.id)).toContain("nof");
    expect(results[0].resolutionNote).toBeNull();
  });

  it("degrades to a resolution note when geocoding fails, without throwing", async () => {
    geocodeGETMock.mockResolvedValue(jsonResponse(404, { error: "Address not found" }));

    const results = await resolveParcelProgramContext(["NOT A REAL ADDRESS"]);
    expect(results).toHaveLength(1);
    expect(results[0].programs).toEqual([]);
    expect(results[0].resolutionNote).toMatch(/could not be located/i);
  });

  it("degrades to a resolution note when every requested layer genuinely resolved not_matched (a real, confirmed zero)", async () => {
    geocodeGETMock.mockResolvedValue(jsonResponse(200, { lat: 41.9, lon: -87.7 }));
    zonesCheckV2GETMock.mockResolvedValue(
      jsonResponse(200, v2Body({ nof: { state: "not_matched" } })),
    );

    const results = await resolveParcelProgramContext(["1 UNMAPPED AVE"]);
    expect(results[0].programs).toEqual([]);
    expect(results[0].resolutionNote).toMatch(/no mapped incentive zones/i);
  });

  it("review5 S2: NEVER claims 'no mapped incentive zones matched' when the empty result is because a layer FAILED to resolve, not because it genuinely didn't match", async () => {
    geocodeGETMock.mockResolvedValue(jsonResponse(200, { lat: 41.9, lon: -87.7 }));
    zonesCheckV2GETMock.mockResolvedValue(
      jsonResponse(200, v2Body({ nof: { state: "unknown", reason: "source_unavailable" } })),
    );

    const results = await resolveParcelProgramContext(["1 UNCHECKABLE AVE"]);
    expect(results[0].programs).toEqual([]);
    expect(results[0].resolutionNote).not.toMatch(/no mapped incentive zones matched/i);
    expect(results[0].resolutionNote).toMatch(/could not be verified/i);
  });

  it("review5 S2: a known positive on one layer is preserved even when a DIFFERENT layer for the same address is unknown — no negative rendered for the failed layer, the match still surfaces", async () => {
    getProgramsSyncMock.mockReturnValue([nofProgram, tifProgram]);
    geocodeGETMock.mockResolvedValue(jsonResponse(200, { lat: 41.74, lon: -87.55 }));
    zonesCheckV2GETMock.mockResolvedValue(
      jsonResponse(
        200,
        v2Body({
          tif: { state: "matched", name: "Some TIF District" },
          nof: { state: "unknown", reason: "source_unavailable" },
        }),
      ),
    );

    const results = await resolveParcelProgramContext(["8232 S BURLEY AVE"]);
    expect(results[0].programs.map((p) => p.id)).toContain("tif");
    // The unknown NOF layer must not produce a negative claim that
    // overrides or hides the confirmed TIF match.
    expect(results[0].resolutionNote).toBeNull();
  });

  it("isolates a per-address failure — one bad address never sinks the rest", async () => {
    geocodeGETMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse(200, { lat: 41.74, lon: -87.55 }));
    zonesCheckV2GETMock.mockResolvedValue(
      jsonResponse(200, v2Body({ nof: { state: "matched", name: "NOF Zone" } })),
    );

    const results = await resolveParcelProgramContext(["BAD ADDRESS", "8232 S BURLEY AVE"]);
    expect(results).toHaveLength(2);
    expect(results[0].resolutionNote).toMatch(/program lookup failed/i);
    expect(results[1].programs.map((p) => p.id)).toContain("nof");
  });

  it("returns an empty array for an empty address list", async () => {
    expect(await resolveParcelProgramContext([])).toEqual([]);
    expect(geocodeGETMock).not.toHaveBeenCalled();
  });
});
