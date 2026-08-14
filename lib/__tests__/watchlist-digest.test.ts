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

/**
 * review6 S16: v2 zone-evidence envelope fixture — replaces the v1
 * positives-only array shape (`[{ key, name }]`) `checkZones` mocks used
 * to return, matching `assessWatchedArea`'s migration from
 * `normalizeZoneCheckResponse` to `normalizeZoneEvidenceV2`.
 */
function zoneEvidenceV2(
  matched: Record<string, string | undefined> = {},
): unknown {
  return {
    schemaVersion: 2,
    dataRevision: "test-revision",
    checkedAt: TODAY.toISOString(),
    requestedLayers: Object.keys(matched),
    layers: Object.fromEntries(
      Object.entries(matched).map(([key, name]) => [
        key,
        { state: "matched", name: name ?? null },
      ]),
    ),
  };
}

/**
 * review7 S22: a more general v2 envelope fixture that can carry a mix
 * of "matched"/"not_matched"/"unknown" layer states — needed to prove
 * `zoneDataIncomplete` correctly reflects a genuine unresolved layer
 * (not just "no matches"), while a real "matched" layer alongside an
 * "unknown" one still produces its deadline (known positives preserved
 * alongside an incomplete-data caveat, never suppressed by it).
 */
function zoneEvidenceV2WithStates(
  layers: Record<string, { state: "matched" | "not_matched" | "unknown"; name?: string }>,
): unknown {
  return {
    schemaVersion: 2,
    dataRevision: "test-revision",
    checkedAt: TODAY.toISOString(),
    requestedLayers: Object.keys(layers),
    layers: Object.fromEntries(
      Object.entries(layers).map(([key, entry]) => [
        key,
        { state: entry.state, name: entry.name ?? null },
      ]),
    ),
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
    checkZones: async () => zoneEvidenceV2({ tif: "Test District" }),
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

  it("degrades to no CONFIRMED findings when the area's lookups fail, but stays notable with zoneDataIncomplete (review7 S22)", async () => {
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

    // The failure degrades to zero CONFIRMED findings — it never throws.
    // review7 S22: it must NOT also degrade to `notable: false` — a
    // lookup failure is the WORST case of incomplete zone data (zero
    // evidence at all, not just one unresolved layer), so this area
    // stays notable specifically so the digest surfaces a caveat
    // instead of silently dropping it. Silently treating this the same
    // as "confirmed nothing due" was the exact false-negative S22 named.
    expect(result).toMatchObject({
      areaLabel: "Bad geometry",
      tif: null,
      deadlines: [],
      notable: true,
      zoneDataIncomplete: true,
    });
  });

  it("is not notable when nothing expires and no deadlines are near", async () => {
    const result = await assessWatchedArea(
      { areaType: "point", areaId: "41.7355,-87.5512", areaLabel: null },
      {
        ...resolvers,
        findTifBoundary: async () => null,
        checkZones: async () => zoneEvidenceV2(),
        programs: [],
      },
      TODAY
    );

    expect(result?.notable).toBe(false);
    expect(result?.tif).toBeNull();
    expect(result?.deadlines).toHaveLength(0);
    expect(result?.zoneDataIncomplete).toBe(false);
  });

  /**
   * review7 S22 (HIGH, BLOCKING) — the coordinator's TEST requirement
   * verbatim: "v2 unknown-layer fixtures preserve known positives and
   * produce the caveat, never an unqualified complete digest."
   */
  it("a MIX of matched + unknown layers: the matched program's deadline is PRESERVED and zoneDataIncomplete is true", async () => {
    const result = await assessWatchedArea(
      { areaType: "point", areaId: "41.7355,-87.5512", areaLabel: "Mixed Ave" },
      {
        ...resolvers,
        findTifBoundary: async () => null,
        checkZones: async () =>
          zoneEvidenceV2WithStates({
            tif: { state: "matched", name: "Test District" },
            nof: { state: "unknown" },
          }),
      },
      TODAY
    );

    expect(result?.notable).toBe(true);
    expect(result?.zoneDataIncomplete).toBe(true);
    // The known positive (tif matched -> zoneProgram's deadline) is NOT
    // suppressed just because a DIFFERENT layer (nof) was unresolved.
    expect(result?.deadlines).toHaveLength(1);
    expect(result?.deadlines[0]).toMatchObject({
      kind: "program_deadline",
      programId: "tif-program",
    });
  });

  it("ALL layers unknown (checkZones resolves, but resolves nothing): zero confirmed findings, still notable, zoneDataIncomplete true", async () => {
    const result = await assessWatchedArea(
      { areaType: "point", areaId: "41.7355,-87.5512", areaLabel: "Fully Unresolved Ave" },
      {
        ...resolvers,
        findTifBoundary: async () => null,
        checkZones: async () =>
          zoneEvidenceV2WithStates({
            tif: { state: "unknown" },
          }),
      },
      TODAY
    );

    expect(result?.tif).toBeNull();
    expect(result?.deadlines).toHaveLength(0);
    // The exact false-negative S22 named: zero confirmed findings must
    // NOT collapse into notable:false here — that's indistinguishable
    // from a genuinely fully-resolved, confirmed-empty area.
    expect(result?.notable).toBe(true);
    expect(result?.zoneDataIncomplete).toBe(true);
  });

  it("all layers resolved (no unknown): zoneDataIncomplete stays false even with a real match", async () => {
    const result = await assessWatchedArea(
      { areaType: "point", areaId: "41.7355,-87.5512", areaLabel: "Fully Resolved Ave" },
      resolvers, // default resolvers: tif matched, no unknown layers
      TODAY
    );
    expect(result?.notable).toBe(true);
    expect(result?.zoneDataIncomplete).toBe(false);
  });
});

describe("buildDigestEmailHtml", () => {
  it("renders one email covering all notable areas with a workspace footer link", async () => {
    const assessment = await assessWatchedArea(
      { areaType: "point", areaId: "41.7355,-87.5512", areaLabel: "Commercial Ave" },
      {
        findTifBoundary: async () => boundary(isoInDays(60)),
        checkZones: async () => zoneEvidenceV2(),
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

  const CAVEAT_TEXT = "could not be verified for this location this week";

  /**
   * review7 S22 (HIGH, BLOCKING) — "render a visible caveat wherever
   * digest results may be incomplete... never an unqualified complete
   * digest." Table-driven per the coordinator's requirement: an area
   * that mixes a real match with an unknown layer renders BOTH the
   * confirmed deadline AND the caveat; an area with zero confirmed
   * findings but incomplete zone data still appears with ONLY the
   * caveat; a fully-resolved area never renders the caveat at all.
   */
  it("an area with a real deadline AND incomplete zone data renders BOTH — the known positive is never hidden by the caveat", async () => {
    const assessment = await assessWatchedArea(
      { areaType: "point", areaId: "41.7355,-87.5512", areaLabel: "Mixed Ave" },
      {
        findTifBoundary: async () => null,
        checkZones: async () =>
          zoneEvidenceV2WithStates({
            tif: { state: "matched", name: "Test District" },
            nof: { state: "unknown" },
          }),
        programs: [
          {
            id: "tif-program",
            name: "TIF Improvement Fund",
            zoneKey: "tif",
            deadline: isoInDays(30),
            summary: "Test program",
          } as unknown as Program,
        ],
        tifFinancials: null,
        sbifRollout: null,
      },
      TODAY,
    );

    const { html } = buildDigestEmailHtml("Billy", [assessment!]);
    expect(html).toContain("Mixed Ave");
    expect(html).toContain("TIF Improvement Fund");
    expect(html).toContain(CAVEAT_TEXT);
  });

  it("an area with ZERO confirmed findings but incomplete zone data still appears, with ONLY the caveat — never silently dropped", async () => {
    const assessment = await assessWatchedArea(
      { areaType: "point", areaId: "41.7355,-87.5512", areaLabel: "Unresolved Ave" },
      {
        findTifBoundary: async () => null,
        checkZones: async () => zoneEvidenceV2WithStates({ tif: { state: "unknown" } }),
        programs: [],
        tifFinancials: null,
        sbifRollout: null,
      },
      TODAY,
    );

    const { html } = buildDigestEmailHtml("Billy", [assessment!]);
    // The exact regression this finding is about: this area must NOT be
    // absent from the email just because it has no confirmed findings.
    expect(html).toContain("Unresolved Ave");
    expect(html).toContain(CAVEAT_TEXT);
  });

  it("a fully-resolved area (no unknown layers) NEVER renders the caveat — never an unqualified digest is over-qualified either", async () => {
    const assessment = await assessWatchedArea(
      { areaType: "point", areaId: "41.7355,-87.5512", areaLabel: "Commercial Ave" },
      {
        findTifBoundary: async () => boundary(isoInDays(60)),
        checkZones: async () => zoneEvidenceV2(),
        programs: [],
        tifFinancials: null,
        sbifRollout: null,
      },
      TODAY,
    );

    const { html } = buildDigestEmailHtml("Billy", [assessment!]);
    expect(html).toContain("Commercial Ave");
    expect(html).not.toContain(CAVEAT_TEXT);
  });

  it("multiple areas: an incomplete one's caveat never bleeds into a separate, fully-resolved area's block", async () => {
    const resolved = await assessWatchedArea(
      { areaType: "point", areaId: "41.7355,-87.5512", areaLabel: "Resolved Ave" },
      {
        findTifBoundary: async () => boundary(isoInDays(60)),
        checkZones: async () => zoneEvidenceV2(),
        programs: [],
        tifFinancials: null,
        sbifRollout: null,
      },
      TODAY,
    );
    const incomplete = await assessWatchedArea(
      { areaType: "point", areaId: "41.9,-87.7", areaLabel: "Incomplete Ave" },
      {
        findTifBoundary: async () => null,
        checkZones: async () => zoneEvidenceV2WithStates({ tif: { state: "unknown" } }),
        programs: [],
        tifFinancials: null,
        sbifRollout: null,
      },
      TODAY,
    );

    const { html } = buildDigestEmailHtml("Billy", [resolved!, incomplete!]);
    expect(html).toContain("Resolved Ave");
    expect(html).toContain("Incomplete Ave");
    expect((html.match(new RegExp(CAVEAT_TEXT, "g")) ?? []).length).toBe(1);
  });
});
