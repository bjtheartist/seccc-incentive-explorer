import { describe, it, expect, vi, beforeEach } from "vitest";

// Both lib/neighborhood-corridor.ts (the CA -> ZIP map) and
// lib/corridor-citywide.ts (the ZIP -> metrics export) read node:fs
// directly. Route each path to its own fixture so we can drive both the
// happy path and the "one of the two files is missing" null-safety cases
// without touching real data files.
const existsSyncMock = vi.fn();
const readFileSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
}));

const CA_ZIP_FIXTURE = {
  "71": "60620", // Auburn Gresham
  "54": undefined, // Riverdale — intentionally unmapped, mirrors real output
  _meta: { generatedAt: "2026-07-03T00:00:00.000Z", method: "centroid point-in-polygon" },
};

const CITYWIDE_FIXTURE = {
  "60620": {
    corridorType: "zip",
    corridorId: "60620",
    healthScore: 42,
    details: {
      vacancy: { vacancyRate: 0.08, vacantCount: 40, totalParcels: 500 },
      turnover: { openings: 30, closures: 12, net: 18, turnoverRate: 0.1 },
      permits: { permitCount: 15, totalReportedCost: 100000, demolitionCount: 2 },
      windowMonths: 24,
    },
  },
  "60666": {
    corridorType: "zip",
    corridorId: "60666",
    details: {
      vacancy: { vacancyRate: 0.5, vacantCount: 9, totalParcels: 18 },
      turnover: { openings: 1, closures: 0, net: 1, turnoverRate: 0.05 },
      permits: { permitCount: 2, totalReportedCost: 5000, demolitionCount: 0 },
      windowMonths: 24,
    },
  },
};

function setupFs(opts: {
  caZipExists?: boolean;
  caZipContent?: unknown;
  citywideExists?: boolean;
  citywideContent?: unknown;
}) {
  existsSyncMock.mockImplementation((p: string) => {
    if (String(p).includes("community-area-zip.json")) return opts.caZipExists ?? true;
    if (String(p).includes("corridor-metrics-citywide.json")) return opts.citywideExists ?? true;
    return false;
  });
  readFileSyncMock.mockImplementation((p: string) => {
    if (String(p).includes("community-area-zip.json")) {
      return JSON.stringify(opts.caZipContent ?? CA_ZIP_FIXTURE);
    }
    if (String(p).includes("corridor-metrics-citywide.json")) {
      return JSON.stringify(opts.citywideContent ?? CITYWIDE_FIXTURE);
    }
    throw new Error(`unexpected read: ${p}`);
  });
}

describe("neighborhood-corridor loader", () => {
  beforeEach(() => {
    vi.resetModules();
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
  });

  it("maps a known community area (Auburn Gresham, CA 71) to a plausible Chicago ZIP", async () => {
    setupFs({});
    const { getZipForCommunityArea } = await import("@/lib/neighborhood-corridor");
    const zip = getZipForCommunityArea(71);
    expect(zip).toMatch(/^606\d\d$/);
    expect(zip).toBe("60620");
  });

  it("returns null for a community area with no ZIP mapping (e.g. Riverdale, CA 54)", async () => {
    setupFs({});
    const { getZipForCommunityArea } = await import("@/lib/neighborhood-corridor");
    expect(getZipForCommunityArea(54)).toBeNull();
  });

  it("returns full corridor signals for a mapped community area with metrics", async () => {
    setupFs({});
    const { getCorridorSignalsForCommunityArea } = await import("@/lib/neighborhood-corridor");
    const signals = getCorridorSignalsForCommunityArea(71);
    expect(signals).not.toBeNull();
    expect(signals?.zip).toBe("60620");
    expect(signals?.vacancy.vacancyRate).toBe(0.08);
    expect(signals?.turnover.openings).toBe(30);
    expect(signals?.turnover.closures).toBe(12);
    expect(signals?.permits.permitCount).toBe(15);
    expect(signals?.permits.demolitionCount).toBe(2);
    expect(signals?.windowMonths).toBe(24);
  });

  it("never returns healthScore or ownership fields on the signals object", async () => {
    setupFs({});
    const { getCorridorSignalsForCommunityArea } = await import("@/lib/neighborhood-corridor");
    const signals = getCorridorSignalsForCommunityArea(71);
    expect(signals).not.toHaveProperty("healthScore");
    expect(signals).not.toHaveProperty("ownershipConcentration");
    expect(signals).not.toHaveProperty("ownershipOrigin");
  });

  it("is null-safe when the CA -> ZIP map file is missing", async () => {
    setupFs({ caZipExists: false });
    const { getCorridorSignalsForCommunityArea, getZipForCommunityArea } = await import(
      "@/lib/neighborhood-corridor"
    );
    expect(getZipForCommunityArea(71)).toBeNull();
    expect(getCorridorSignalsForCommunityArea(71)).toBeNull();
  });

  it("is null-safe when the citywide metrics export is missing", async () => {
    setupFs({ citywideExists: false });
    const { getCorridorSignalsForCommunityArea } = await import("@/lib/neighborhood-corridor");
    expect(getCorridorSignalsForCommunityArea(71)).toBeNull();
  });

  it("is null-safe when the mapped ZIP has no entry in the citywide export", async () => {
    setupFs({ caZipContent: { "71": "60699" } });
    const { getCorridorSignalsForCommunityArea } = await import("@/lib/neighborhood-corridor");
    expect(getCorridorSignalsForCommunityArea(71)).toBeNull();
  });

  it("excludes ZIP 60666 (O'Hare artifact) even if it is mapped and has metrics", async () => {
    setupFs({ caZipContent: { "76": "60666" } });
    const { getCorridorSignalsForCommunityArea } = await import("@/lib/neighborhood-corridor");
    expect(getCorridorSignalsForCommunityArea(76)).toBeNull();
  });
});
