import { describe, it, expect, vi, beforeEach } from "vitest";

// The loader reads data/exports/corridor-metrics-citywide.json via node:fs.
// That file is produced by a background batch job and may legitimately be
// absent — so every test here drives the loader through node:fs mocks
// instead of depending on the real file's presence/content.
const existsSyncMock = vi.fn();
const readFileSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
}));

describe("corridor-citywide loader", () => {
  beforeEach(() => {
    vi.resetModules();
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
  });

  it("returns null (not a throw) when the export file does not exist yet", async () => {
    existsSyncMock.mockReturnValue(false);
    const {
      loadCorridorCitywideData,
      getCorridorCitywideZips,
      getCorridorCitywideMetric,
    } = await import("@/lib/corridor-citywide");

    expect(loadCorridorCitywideData()).toBeNull();
    expect(getCorridorCitywideZips()).toEqual([]);
    expect(getCorridorCitywideMetric("60617")).toBeNull();
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  it("parses the file and caches it, reading from disk only once", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        "60617": {
          corridorType: "zip",
          corridorId: "60617",
          vacancyRate: 0.05,
          details: { ownershipConcentration: { totalParcels: 100 } },
        },
      }),
    );

    const {
      loadCorridorCitywideData,
      getCorridorCitywideZips,
      getCorridorCitywideMetric,
    } = await import("@/lib/corridor-citywide");

    expect(getCorridorCitywideZips()).toEqual(["60617"]);
    expect(getCorridorCitywideMetric("60617")?.corridorId).toBe("60617");

    // Call the loader several more times — readFileSync should still have
    // fired exactly once thanks to the module-level cache.
    loadCorridorCitywideData();
    loadCorridorCitywideData();
    expect(readFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it("returns null on malformed JSON instead of throwing", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("{ not valid json");

    const { loadCorridorCitywideData } = await import("@/lib/corridor-citywide");

    expect(() => loadCorridorCitywideData()).not.toThrow();
    expect(loadCorridorCitywideData()).toBeNull();
  });

  it("returns null for a ZIP that is not present in the data", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        "60617": { corridorType: "zip", corridorId: "60617" },
      }),
    );

    const { getCorridorCitywideMetric } = await import("@/lib/corridor-citywide");

    expect(getCorridorCitywideMetric("99999")).toBeNull();
  });
});

describe("corridorConcentrationBand (re-exported for /corridors)", () => {
  it("bands HHI into the same plain-language thresholds used by the standard report", async () => {
    const { corridorConcentrationBand } = await import("@/lib/report-engine");
    expect(corridorConcentrationBand(0.01)).toBe("Low concentration");
    expect(corridorConcentrationBand(0.2)).toBe("Moderate concentration");
    expect(corridorConcentrationBand(0.3)).toBe("High concentration");
  });
});
