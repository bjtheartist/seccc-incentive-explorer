import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildTifFundingPicture,
  compareTifNumbers,
  computeTifContiguity,
  countPointsInDistrict,
  districtIntersectsZip,
  latestFinanceByTif,
  normalizeTifNumber,
  pointInTifPolygons,
  tifExpirationYear,
  TIF_PORTING_NOTE,
  TIF_RELATION_LABELS,
  type TifAnnualReportRow,
  type TifBriefsExport,
  type TifContiguityInput,
  type TifDistrictBrief,
  type TifPolygon,
  type TifRing,
} from "../tif-briefs";

// ── normalizeTifNumber ───────────────────────────────────────────────────────

describe("normalizeTifNumber", () => {
  it("strips the embedded space the geojson carries", () => {
    expect(normalizeTifNumber("T- 87")).toBe("T-87");
    expect(normalizeTifNumber("T-186")).toBe("T-186");
  });

  it("strips all whitespace and upper-cases", () => {
    expect(normalizeTifNumber("  t - 12 ")).toBe("T-12");
    expect(normalizeTifNumber("t-9")).toBe("T-9");
  });

  it("returns an empty string for null/blank", () => {
    expect(normalizeTifNumber(null)).toBe("");
    expect(normalizeTifNumber(undefined)).toBe("");
    expect(normalizeTifNumber("   ")).toBe("");
  });
});

describe("compareTifNumbers", () => {
  it("orders by the numeric portion ascending, not lexically", () => {
    const sorted = ["T-87", "T-178", "T-9", "T-125"].sort(compareTifNumbers);
    expect(sorted).toEqual(["T-9", "T-87", "T-125", "T-178"]);
  });

  it("is a stable total order (equal ⇒ 0)", () => {
    expect(compareTifNumbers("T-5", "T-5")).toBe(0);
  });
});

// ── Contiguity geometry ──────────────────────────────────────────────────────

// A metres-to-degrees helper so the fixtures read in metres. Uses the same
// reference latitude the library projects with, so a "50 m apart" square really
// is ~50 m from its neighbour under the library's projection.
const REF_LAT = 41.85;
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos((REF_LAT * Math.PI) / 180);
const BASE_LON = -87.65;
const BASE_LAT = REF_LAT;

/** A closed square whose SW corner is (offsetXm, offsetYm) metres from the base
 * point, with side `sideM` metres. */
function square(offsetXm: number, offsetYm: number, sideM: number): TifPolygon {
  const lon0 = BASE_LON + offsetXm / M_PER_DEG_LON;
  const lat0 = BASE_LAT + offsetYm / M_PER_DEG_LAT;
  const dLon = sideM / M_PER_DEG_LON;
  const dLat = sideM / M_PER_DEG_LAT;
  const ring: TifRing = [
    [lon0, lat0],
    [lon0 + dLon, lat0],
    [lon0 + dLon, lat0 + dLat],
    [lon0, lat0 + dLat],
    [lon0, lat0],
  ];
  return [ring];
}

function input(number: string, polygon: TifPolygon): TifContiguityInput {
  return { number, polygons: [polygon] };
}

describe("computeTifContiguity", () => {
  it("labels two edge-sharing squares as touching", () => {
    // A: [0,100]×[0,100]; B: [100,200]×[0,100] — they share the x=100 edge.
    const g = computeTifContiguity([
      input("T-1", square(0, 0, 100)),
      input("T-2", square(100, 0, 100)),
    ]);
    expect(g.get("T-1")).toEqual([{ number: "T-2", relation: "touching" }]);
    expect(g.get("T-2")).toEqual([{ number: "T-1", relation: "touching" }]);
  });

  it("labels squares ~50 m apart as near (public-way separation)", () => {
    // A right edge at x=100; B left edge at x=150 → a 50 m gap.
    const g = computeTifContiguity([
      input("T-1", square(0, 0, 100)),
      input("T-2", square(150, 0, 100)),
    ]);
    expect(g.get("T-1")).toEqual([{ number: "T-2", relation: "near" }]);
    expect(g.get("T-2")).toEqual([{ number: "T-1", relation: "near" }]);
  });

  it("does not link squares ~200 m apart", () => {
    const g = computeTifContiguity([
      input("T-1", square(0, 0, 100)),
      input("T-2", square(300, 0, 100)),
    ]);
    expect(g.get("T-1")).toEqual([]);
    expect(g.get("T-2")).toEqual([]);
  });

  it("is deterministic and canonically sorted regardless of input order", () => {
    const a = input("T-9", square(0, 0, 100)); // x: 0–100
    const b = input("T-2", square(100, 0, 100)); // x: 100–200, touches T-9 at x=100
    const c = input("T-125", square(250, 0, 100)); // x: 250–350, 50 m gap from T-2
    const g1 = computeTifContiguity([a, b, c]);
    const g2 = computeTifContiguity([c, a, b]); // shuffled
    // Same neighbor sets, canonically sorted by number (T-2 before T-125).
    expect(g1.get("T-9")).toEqual(g2.get("T-9"));
    expect(g1.get("T-2")).toEqual([
      { number: "T-9", relation: "touching" },
      { number: "T-125", relation: "near" },
    ]);
    for (const list of g1.values()) {
      const numbers = list.map((n) => n.number);
      expect([...numbers].sort(compareTifNumbers)).toEqual(numbers);
    }
  });
});

// ── Point-in-polygon + ZIP membership + counts ──────────────────────────────

describe("pointInTifPolygons / districtIntersectsZip / countPointsInDistrict", () => {
  const box = square(0, 0, 1000); // 1 km square around the base point

  it("point-in-polygon respects the interior and exterior", () => {
    const inside: [number, number] = [BASE_LON + 500 / M_PER_DEG_LON, BASE_LAT + 500 / M_PER_DEG_LAT];
    const outside: [number, number] = [BASE_LON - 500 / M_PER_DEG_LON, BASE_LAT];
    expect(pointInTifPolygons(inside[0], inside[1], [box])).toBe(true);
    expect(pointInTifPolygons(outside[0], outside[1], [box])).toBe(false);
  });

  it("respects a hole in the polygon", () => {
    const outer = square(0, 0, 1000)[0];
    const hole = square(400, 400, 200)[0];
    const withHole: TifPolygon = [outer, hole];
    const inHole: [number, number] = [BASE_LON + 500 / M_PER_DEG_LON, BASE_LAT + 500 / M_PER_DEG_LAT];
    expect(pointInTifPolygons(inHole[0], inHole[1], [withHole])).toBe(false);
  });

  it("districtIntersectsZip is true for an overlapping ZIP ring and false for a disjoint one", () => {
    const overlappingZip: TifRing = square(500, 0, 1000)[0]; // overlaps box on the right
    const disjointZip: TifRing = square(5000, 0, 1000)[0]; // far east
    expect(districtIntersectsZip([box], [overlappingZip])).toBe(true);
    expect(districtIntersectsZip([box], [disjointZip])).toBe(false);
  });

  it("districtIntersectsZip catches a fully-contained district (no shared vertex)", () => {
    const smallDistrict = square(400, 400, 100); // inside the big ZIP
    const bigZip: TifRing = square(0, 0, 1000)[0];
    expect(districtIntersectsZip([smallDistrict], [bigZip])).toBe(true);
  });

  it("counts points inside the polygon (honest zero when none land inside)", () => {
    const pts = [
      { lat: BASE_LAT + 500 / M_PER_DEG_LAT, lon: BASE_LON + 500 / M_PER_DEG_LON }, // inside
      { lat: BASE_LAT + 100 / M_PER_DEG_LAT, lon: BASE_LON + 100 / M_PER_DEG_LON }, // inside
      { lat: BASE_LAT, lon: BASE_LON - 900 / M_PER_DEG_LON }, // outside
    ];
    expect(countPointsInDistrict(pts, [box])).toBe(2);
    expect(countPointsInDistrict([], [box])).toBe(0);
  });
});

// ── Finance join ─────────────────────────────────────────────────────────────

describe("latestFinanceByTif", () => {
  const row = (over: Partial<TifAnnualReportRow> & { tifNumber: string; reportYear: number }): TifAnnualReportRow => ({
    fundBalance: null,
    taxAllocationFundBalance: null,
    incrementCurrent: null,
    surplusDistributed: null,
    ...over,
  });

  it("keeps the latest report year per normalized number", () => {
    const map = latestFinanceByTif([
      row({ tifNumber: "T- 87", reportYear: 2022, fundBalance: 100 }),
      row({ tifNumber: "T-87", reportYear: 2024, fundBalance: 300 }),
      row({ tifNumber: "T-87", reportYear: 2023, fundBalance: 200 }),
    ]);
    expect(map.size).toBe(1);
    expect(map.get("T-87")).toEqual({
      reportYear: 2024,
      fundBalance: 300,
      taxAllocationFundBalance: null,
      incrementCurrent: null,
      surplusDistributed: null,
    });
  });

  it("drops rows with an unusable number and preserves null figures (never 0)", () => {
    const map = latestFinanceByTif([
      row({ tifNumber: "", reportYear: 2024, fundBalance: 5 }),
      row({ tifNumber: "T-12", reportYear: 2024, fundBalance: null }),
    ]);
    expect(map.has("")).toBe(false);
    expect(map.get("T-12")!.fundBalance).toBeNull();
  });
});

// ── View model ───────────────────────────────────────────────────────────────

describe("tifExpirationYear", () => {
  it("extracts the year, tolerating null", () => {
    expect(tifExpirationYear("2027-12-31")).toBe(2027);
    expect(tifExpirationYear(null)).toBeNull();
    expect(tifExpirationYear("")).toBeNull();
  });
});

describe("buildTifFundingPicture", () => {
  function district(over: Partial<TifDistrictBrief> & { number: string }): TifDistrictBrief {
    return {
      name: over.number,
      approvalDate: null,
      expirationDate: null,
      sbif: false,
      wards: "",
      status: "Active",
      finance: null,
      neighbors: [],
      ...over,
    };
  }

  const briefs: TifBriefsExport = {
    generatedAt: "2026-07-23T00:00:00.000Z",
    sources: { tifBoundaries: "", tifAnnualReport: "", vacancyIndex: "", asOf: "2026-07-23" },
    districts: {
      "T-1": district({
        number: "T-1",
        name: "Alpha",
        expirationDate: "2030-12-31",
        sbif: true,
        finance: { reportYear: 2024, fundBalance: 1000, taxAllocationFundBalance: 900, incrementCurrent: 200, surplusDistributed: 0 },
        neighbors: [
          { number: "T-2", relation: "touching" },
          { number: "T-3", relation: "near" },
        ],
      }),
      "T-2": district({
        number: "T-2",
        name: "Beta",
        expirationDate: "2028-12-31",
        finance: { reportYear: 2024, fundBalance: 5000, taxAllocationFundBalance: 4000, incrementCurrent: 500, surplusDistributed: 100 },
      }),
      // T-3 has NO finance row → renders "not yet available".
      "T-3": district({ number: "T-3", name: "Gamma", expirationDate: "2035-12-31", finance: null }),
    },
    zips: {
      "60617": {
        districtNumbers: ["T-1", "T-3"],
        vacantSiteCounts: { "T-1": 4, "T-3": 9 },
      },
      "60649": { districtNumbers: [], vacantSiteCounts: {} },
    },
  };

  it("returns null for a ZIP absent from the export or with no districts", () => {
    expect(buildTifFundingPicture("99999", briefs, 2026)).toBeNull();
    expect(buildTifFundingPicture("60649", briefs, 2026)).toBeNull();
  });

  it("orders districts by vacant-site count desc and carries the null-finance path", () => {
    const views = buildTifFundingPicture("60617", briefs, 2026)!;
    expect(views.map((v) => v.number)).toEqual(["T-3", "T-1"]); // 9 sites before 4
    const gamma = views[0];
    expect(gamma.finance).toBeNull(); // → "not yet available" on the page
    expect(gamma.vacantSiteCount).toBe(9);
    expect(gamma.yearsToExpiration).toBe(9); // 2035 − 2026
  });

  it("resolves neighbor balances/expirations and sorts them by balance desc", () => {
    const views = buildTifFundingPicture("60617", briefs, 2026)!;
    const alpha = views.find((v) => v.number === "T-1")!;
    // Alpha's neighbors T-2 (balance 5000) and T-3 (null) → T-2 first, null last.
    expect(alpha.neighbors.map((n) => n.number)).toEqual(["T-2", "T-3"]);
    expect(alpha.neighbors[0]).toEqual({
      number: "T-2",
      name: "Beta",
      relation: "touching",
      fundBalance: 5000,
      expirationYear: 2028,
    });
    expect(alpha.neighbors[1].fundBalance).toBeNull();
    expect(alpha.sbif).toBe(true);
  });
});

describe("printed-copy constants", () => {
  it("the porting note names the DPD/CDC/City Council process and the verify caveat", () => {
    expect(TIF_PORTING_NOTE).toContain("Department of Planning and Development");
    expect(TIF_PORTING_NOTE).toContain("Community Development Commission");
    expect(TIF_PORTING_NOTE).toContain("City Council");
    expect(TIF_PORTING_NOTE).toContain("legally possible, not what is likely");
  });
  it("relation labels distinguish contiguous from ROW-adjacent", () => {
    expect(TIF_RELATION_LABELS.touching).toBe("contiguous");
    expect(TIF_RELATION_LABELS.near).toContain("public way");
  });
});

// ── Committed-file guard ─────────────────────────────────────────────────────
// Mirrors lib/__tests__/vacancy-index.test.ts's committed-export guard: skipped
// until scripts/export-tif-briefs.ts is run and public/data/tif-briefs.json is
// committed; then it hard-runs.

const EXPORT_PATH = path.join(process.cwd(), "public/data/tif-briefs.json");
const EXPORT_EXISTS = existsSync(EXPORT_PATH);

const PILOT_ZIP_KEYS = ["60617", "60619", "60649", "60624", "60623", "60644", "60651", "60621", "60636"];

describe.skipIf(!EXPORT_EXISTS)("committed tif-briefs.json", () => {
  const data = (EXPORT_EXISTS ? JSON.parse(readFileSync(EXPORT_PATH, "utf8")) : null) as TifBriefsExport;

  it("carries the top-level shape + all nine pilot ZIP keys", () => {
    expect(typeof data.generatedAt).toBe("string");
    expect(data.sources.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(data.districts).length).toBeGreaterThan(0);
    for (const zip of PILOT_ZIP_KEYS) {
      expect(data.zips[zip], `zip ${zip} present`).toBeDefined();
    }
  });

  it("keys every district by its own normalized number", () => {
    for (const [key, d] of Object.entries(data.districts)) {
      expect(d.number).toBe(key);
      expect(normalizeTifNumber(key)).toBe(key);
    }
  });

  it("every neighbors array is canonically sorted and references real districts", () => {
    for (const d of Object.values(data.districts)) {
      const numbers = d.neighbors.map((n) => n.number);
      expect([...numbers].sort(compareTifNumbers)).toEqual(numbers);
      for (const n of d.neighbors) {
        expect(data.districts[n.number], `neighbor ${n.number} exists`).toBeDefined();
        expect(["touching", "near"]).toContain(n.relation);
      }
    }
  });

  it("adjacency is symmetric (A↔B)", () => {
    for (const d of Object.values(data.districts)) {
      for (const n of d.neighbors) {
        const back = data.districts[n.number].neighbors.find((m) => m.number === d.number);
        expect(back, `${n.number} lists ${d.number} back`).toBeDefined();
        expect(back!.relation).toBe(n.relation);
      }
    }
  });

  it("finance is a full snapshot or null, never a partial/zero fiction", () => {
    for (const d of Object.values(data.districts)) {
      if (d.finance === null) continue;
      expect(typeof d.finance.reportYear).toBe("number");
      // Each dollar field is a number or null — never undefined.
      for (const k of ["fundBalance", "taxAllocationFundBalance", "incrementCurrent", "surplusDistributed"] as const) {
        const v = d.finance[k];
        expect(v === null || typeof v === "number", `${d.number}.${k}`).toBe(true);
      }
    }
  });

  it("60617 intersects real districts, each with a sorted neighbor list", () => {
    const brief = data.zips["60617"];
    expect(brief.districtNumbers.length).toBeGreaterThan(0);
    expect([...brief.districtNumbers].sort(compareTifNumbers)).toEqual(brief.districtNumbers);
    for (const number of brief.districtNumbers) {
      expect(data.districts[number], `district ${number} exists`).toBeDefined();
      expect(typeof brief.vacantSiteCounts[number]).toBe("number");
    }
  });

  it("the view builder produces an ordered picture for 60617", () => {
    const views = buildTifFundingPicture("60617", data, 2026);
    expect(views).not.toBeNull();
    expect(views!.length).toBe(data.zips["60617"].districtNumbers.length);
    // Non-increasing vacant-site counts (the primary sort key).
    for (let i = 1; i < views!.length; i++) {
      expect(views![i - 1].vacantSiteCount).toBeGreaterThanOrEqual(views![i].vacantSiteCount);
    }
  });
});
