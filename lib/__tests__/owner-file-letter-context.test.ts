import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Program } from "@/lib/types";

const { geocodeGETMock, zonesCheckGETMock, getProgramsSyncMock } = vi.hoisted(() => ({
  geocodeGETMock: vi.fn(),
  zonesCheckGETMock: vi.fn(),
  getProgramsSyncMock: vi.fn(),
}));

vi.mock("@/app/api/geocode/route", () => ({ GET: geocodeGETMock }));
vi.mock("@/app/api/zones/check/route", () => ({ GET: zonesCheckGETMock }));
vi.mock("@/lib/programs-data", () => ({ getProgramsSync: getProgramsSyncMock }));

import { resolveParcelProgramContext } from "../owner-file-letter-context";

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const nofProgram = {
  id: "nof",
  name: "Neighborhood Opportunity Fund (NOF)",
  level: "City",
  zoneKey: "nof",
  summary: "Commercial/industrial building rehab grant.",
  url: "https://www.chicago.gov/nof",
} as unknown as Program;

beforeEach(() => {
  geocodeGETMock.mockReset();
  zonesCheckGETMock.mockReset();
  getProgramsSyncMock.mockReset().mockReturnValue([nofProgram]);
});

describe("resolveParcelProgramContext", () => {
  it("resolves a matched program for a geocodable address inside a mapped zone", async () => {
    geocodeGETMock.mockResolvedValue(jsonResponse(200, { lat: 41.74, lon: -87.55 }));
    zonesCheckGETMock.mockResolvedValue(
      jsonResponse(200, { zones: { nof: true }, zoneNames: { nof: "NOF Zone" } })
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

  it("degrades to a resolution note when no zones match", async () => {
    geocodeGETMock.mockResolvedValue(jsonResponse(200, { lat: 41.9, lon: -87.7 }));
    zonesCheckGETMock.mockResolvedValue(jsonResponse(200, { zones: {}, zoneNames: {} }));

    const results = await resolveParcelProgramContext(["1 UNMAPPED AVE"]);
    expect(results[0].programs).toEqual([]);
    expect(results[0].resolutionNote).toMatch(/no mapped incentive zones/i);
  });

  it("isolates a per-address failure — one bad address never sinks the rest", async () => {
    geocodeGETMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse(200, { lat: 41.74, lon: -87.55 }));
    zonesCheckGETMock.mockResolvedValue(
      jsonResponse(200, { zones: { nof: true }, zoneNames: { nof: "NOF Zone" } })
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
