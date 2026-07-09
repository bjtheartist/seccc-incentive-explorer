import { describe, expect, it } from "vitest";
import {
  assessTifExpiration,
  assessWatchedArea,
  buildDigestEmailHtml,
  parsePointAreaId,
  programDeadlineSlims,
  TIF_URGENT_WITHIN_DAYS,
  type AreaResolvers,
} from "../watchlist-digest";
import type { TifBoundaryContext } from "../tif-boundary";
import type { Program } from "../types";

const TODAY = new Date("2026-07-08T00:00:00Z");

function isoInDays(days: number): string {
  return new Date(TODAY.getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function boundary(expirationDate: string | null): TifBoundaryContext {
  return {
    districtId: "T-999",
    rawDistrictId: "T-999",
    districtName: "Test District",
    expirationDate,
    boundaryWards: null,
  };
}

describe("parsePointAreaId", () => {
  it("parses a rounded lat,lon pair", () => {
    expect(parsePointAreaId("41.7355,-87.5512")).toEqual({
      lat: 41.7355,
      lon: -87.5512,
    });
  });

  it("rejects malformed and out-of-range ids", () => {
    expect(parsePointAreaId("not-a-point")).toBeNull();
    expect(parsePointAreaId("41.7")).toBeNull();
    expect(parsePointAreaId("41.7,abc")).toBeNull();
    expect(parsePointAreaId("941.7,-87.5")).toBeNull();
  });
});

describe("assessTifExpiration", () => {
  it("returns null without a boundary or expiration date", () => {
    expect(assessTifExpiration(null, TODAY)).toBeNull();
    expect(assessTifExpiration(boundary(null), TODAY)).toBeNull();
  });

  it("ignores districts expiring beyond 12 months or already expired", () => {
    expect(assessTifExpiration(boundary(isoInDays(400)), TODAY)).toBeNull();
    expect(assessTifExpiration(boundary(isoInDays(-10)), TODAY)).toBeNull();
  });

  it("flags districts expiring within 12 months", () => {
    const finding = assessTifExpiration(boundary(isoInDays(300)), TODAY);
    expect(finding).toMatchObject({
      districtId: "T-999",
      daysRemaining: 300,
      urgent: false,
    });
  });

  it("marks expirations within 120 days as urgent", () => {
    const finding = assessTifExpiration(
      boundary(isoInDays(TIF_URGENT_WITHIN_DAYS - 1)),
      TODAY
    );
    expect(finding?.urgent).toBe(true);
  });
});

describe("programDeadlineSlims", () => {
  it("flattens deadlines[] arrays and legacy flat deadline fields", () => {
    const programs = [
      {
        id: "p1",
        name: "Program One",
        deadlines: [
          { label: "Round 2 closes", date: "2026-08-01" },
          { date: "2026-09-01" },
        ],
      },
      { id: "p2", name: "Program Two", deadline: "2026-08-15" },
      { id: "p3", name: "No Deadline" },
    ] as unknown as Program[];

    const slims = programDeadlineSlims(programs);
    expect(slims).toHaveLength(3);
    expect(slims[0]).toMatchObject({
      id: "p1",
      name: "Program One — Round 2 closes",
      deadline: "2026-08-01",
    });
    expect(slims[2]).toMatchObject({ id: "p2", deadline: "2026-08-15" });
  });
});

describe("assessWatchedArea", () => {
  const zoneProgram = {
    id: "tif-program",
    name: "TIF Improvement Fund",
    zoneKey: "tif",
    deadline: isoInDays(30),
    summary: "Test program",
  } as unknown as Program;

  const resolvers: AreaResolvers = {
    findTifBoundary: async () => boundary(isoInDays(90)),
    checkZones: async () => [{ key: "tif", name: "Test District" }],
    programs: [zoneProgram],
    tifFinancials: null,
    sbifRollout: null,
  };

  it("returns null for non-point area ids", async () => {
    const result = await assessWatchedArea(
      { areaType: "corridor", areaId: "some-corridor", areaLabel: null },
      resolvers,
      TODAY
    );
    expect(result).toBeNull();
  });

  it("combines the TIF flag with 90-day program deadlines", async () => {
    const result = await assessWatchedArea(
      { areaType: "point", areaId: "41.7355,-87.5512", areaLabel: "Commercial Ave" },
      resolvers,
      TODAY
    );

    expect(result).not.toBeNull();
    expect(result?.notable).toBe(true);
    expect(result?.areaLabel).toBe("Commercial Ave");
    expect(result?.tif).toMatchObject({ districtId: "T-999", urgent: true });
    expect(result?.deadlines).toHaveLength(1);
    expect(result?.deadlines[0]).toMatchObject({
      kind: "program_deadline",
      programId: "tif-program",
      date: isoInDays(30),
    });
  });

  it("degrades to no findings when the area's lookups fail", async () => {
    const result = await assessWatchedArea(
      { areaType: "point", areaId: "41.7355,-87.5512", areaLabel: "Bad geometry" },
      {
        ...resolvers,
        findTifBoundary: async () => {
          throw new Error("First and last coordinates in a ring must be the same");
        },
        checkZones: async () => {
          throw new Error("zone lookup failed");
        },
      },
      TODAY
    );

    // The failure degrades to an empty assessment — it never throws.
    expect(result).toMatchObject({
      areaLabel: "Bad geometry",
      tif: null,
      deadlines: [],
      notable: false,
    });
  });

  it("is not notable when nothing expires and no deadlines are near", async () => {
    const result = await assessWatchedArea(
      { areaType: "point", areaId: "41.7355,-87.5512", areaLabel: null },
      {
        ...resolvers,
        findTifBoundary: async () => null,
        checkZones: async () => [],
        programs: [],
      },
      TODAY
    );

    expect(result?.notable).toBe(false);
    expect(result?.tif).toBeNull();
    expect(result?.deadlines).toHaveLength(0);
  });
});

describe("buildDigestEmailHtml", () => {
  it("renders one email covering all notable areas with a workspace footer link", async () => {
    const assessment = await assessWatchedArea(
      { areaType: "point", areaId: "41.7355,-87.5512", areaLabel: "Commercial Ave" },
      {
        findTifBoundary: async () => boundary(isoInDays(60)),
        checkZones: async () => [],
        programs: [],
        tifFinancials: null,
        sbifRollout: null,
      },
      TODAY
    );

    const { subject, html } = buildDigestEmailHtml("Billy", [assessment!]);

    expect(subject).toContain("1 upcoming deadline");
    expect(html).toContain("Commercial Ave");
    expect(html).toContain("Urgent");
    expect(html).toContain("/workspace");
    expect(html).toContain("Manage watched areas in your workspace");
  });
});
