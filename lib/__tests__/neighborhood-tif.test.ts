import { describe, it, expect, vi, beforeEach } from "vitest";

// lib/neighborhood-tif.ts reads data/exports/community-area-tif.json via
// node:fs directly. Mock it so we can drive the happy path, the empty-list
// path, and the missing-file null-safety case without touching real data.
const existsSyncMock = vi.fn();
const readFileSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
}));

const CA_TIF_FIXTURE = {
  // Washington Park (CA 40): really covered by the Washington Park TIF.
  "40": [
    { tifNumber: "T-178", districtName: "Washington Park", expirationYear: 2038, overlapPct: 75.8 },
    { tifNumber: "T-999", districtName: "Some Smaller TIF", expirationYear: 2035, overlapPct: 6.2 },
  ],
  _meta: { method: "polygon overlap", communityAreasWithTif: 67 },
};

function setupFs(opts: { exists?: boolean; content?: unknown }) {
  existsSyncMock.mockImplementation((p: string) =>
    String(p).includes("community-area-tif.json") ? opts.exists ?? true : false,
  );
  readFileSyncMock.mockImplementation((p: string) => {
    if (String(p).includes("community-area-tif.json")) {
      return JSON.stringify(opts.content ?? CA_TIF_FIXTURE);
    }
    throw new Error(`unexpected read: ${p}`);
  });
}

beforeEach(() => {
  vi.resetModules();
  existsSyncMock.mockReset();
  readFileSyncMock.mockReset();
});

describe("getTifDistrictsForCommunityArea", () => {
  it("returns overlapping TIF districts, largest coverage first", async () => {
    setupFs({});
    const { getTifDistrictsForCommunityArea } = await import("@/lib/neighborhood-tif");
    const hits = getTifDistrictsForCommunityArea(40);
    expect(hits).toHaveLength(2);
    expect(hits[0].districtName).toBe("Washington Park");
    expect(hits[0].tifNumber).toBe("T-178");
    expect(hits[0].overlapPct).toBeGreaterThan(hits[1].overlapPct);
  });

  it("returns [] for a community area with no overlapping TIF", async () => {
    setupFs({});
    const { getTifDistrictsForCommunityArea } = await import("@/lib/neighborhood-tif");
    expect(getTifDistrictsForCommunityArea(41)).toEqual([]);
  });

  it("returns [] (not a throw) when the map file is missing", async () => {
    setupFs({ exists: false });
    const { getTifDistrictsForCommunityArea } = await import("@/lib/neighborhood-tif");
    expect(getTifDistrictsForCommunityArea(40)).toEqual([]);
  });

  it("returns [] when the map JSON is malformed", async () => {
    setupFs({ content: "not json{" });
    const { getTifDistrictsForCommunityArea } = await import("@/lib/neighborhood-tif");
    expect(getTifDistrictsForCommunityArea(40)).toEqual([]);
  });
});
