import { describe, expect, it, vi } from "vitest";
import { INVESTMENT_STATUSES, type CommunityInvestmentRecord } from "@/lib/community-investment";
import {
  citywideInvestmentEntries,
  COMMUNITY_INVESTMENT_ENDPOINT,
  DEV_DOT_RADIUS_MAX,
  DEV_DOT_RADIUS_MIN,
  fetchCommunityInvestmentLayer,
  filterInvestmentPointFeatures,
  INVESTMENT_STATUS_LABELS,
  investmentRecordsToPointFeatures,
  investmentStatusLabel,
  makeDevelopmentDotRadiusScale,
  presentFunderTypesInOrder,
  summarizeCitywideEntries,
  summarizeCitywideInvestment,
  type InvestmentPointFeature,
} from "@/lib/community-investment-layer";

/**
 * Unit coverage for the client-safe Community Investment map-layer helpers,
 * mirroring the fetchImpl-seam pattern in
 * components/report/__tests__/admin-ownership-gating.test.tsx: the toggle's
 * network behavior (which gated endpoint, what it does with 401 / citywide
 * rows) is exercised without rendering the map.
 */

function record(overrides: Partial<CommunityInvestmentRecord>): CommunityInvestmentRecord {
  return {
    id: "x-1",
    source: "cdg",
    funderType: "government",
    funderName: "City of Chicago — Community Development Grant",
    recipient: "Example Grantee",
    amountAwarded: 100_000,
    logLine: "Facade rehab",
    year: 2019,
    geometry: { kind: "point", lat: 41.75, lng: -87.6 },
    address: "100 W Example St",
    status: "awarded",
    links: ["https://example.gov/round"],
    ...overrides,
  };
}

const records: CommunityInvestmentRecord[] = [
  record({ id: "gov-2019", funderType: "government", year: 2019, amountAwarded: 100_000 }),
  record({
    id: "phil-2022",
    source: "foundation",
    funderType: "philanthropic",
    year: 2022,
    amountAwarded: 50_000,
    links: [],
  }),
  record({
    id: "dev-noyear",
    source: "development",
    funderType: "private_development",
    year: null,
    amountAwarded: null,
    // first link is not http(s) → skipped; second is the source link.
    links: ["ftp://nope", "https://dev.example/project"],
    geometry: { kind: "point", lat: 41.8, lng: -87.62 },
  }),
  record({
    id: "cw-phil-2021",
    source: "foundation",
    funderType: "philanthropic",
    year: 2021,
    amountAwarded: 250_000,
    geometry: { kind: "citywide" },
    address: null,
  }),
  record({
    id: "cw-gov-noamt",
    funderType: "government",
    year: 2020,
    amountAwarded: null,
    geometry: { kind: "citywide" },
    address: null,
  }),
];

function fetchStub(status: number, body?: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("investmentRecordsToPointFeatures", () => {
  it("excludes citywide records — only point geometries become features", () => {
    const features = investmentRecordsToPointFeatures(records);
    expect(features).toHaveLength(3);
    const ids = features.map((f) => f.properties.id);
    expect(ids).toEqual(["gov-2019", "phil-2022", "dev-noyear"]);
    expect(ids).not.toContain("cw-phil-2021");
    expect(ids).not.toContain("cw-gov-noamt");
  });

  it("carries the popup fields and flattens the first http(s) link to sourceLink", () => {
    const [gov, phil, dev] = investmentRecordsToPointFeatures(records);
    expect(gov.geometry).toEqual({ type: "Point", coordinates: [-87.6, 41.75] });
    expect(gov.properties.sourceLink).toBe("https://example.gov/round");
    expect(phil.properties.sourceLink).toBe(""); // no links
    expect(dev.properties.sourceLink).toBe("https://dev.example/project"); // ftp skipped
    expect(dev.properties.amountAwarded).toBeNull();
    expect(dev.properties.year).toBeNull();
  });
});

describe("filterInvestmentPointFeatures", () => {
  const features = investmentRecordsToPointFeatures(records);

  it("returns every plotted point under the 'all' range with all funder types active", () => {
    const out = filterInvestmentPointFeatures(features, {
      yearRangeId: "all",
      activeFunderTypes: ["government", "philanthropic", "private_development"],
    });
    expect(out.map((f) => f.properties.id)).toEqual(["gov-2019", "phil-2022", "dev-noyear"]);
  });

  it("filters by year window — a null-year point never satisfies a bounded window", () => {
    const out = filterInvestmentPointFeatures(features, {
      yearRangeId: "2017-2019",
      activeFunderTypes: ["government", "philanthropic", "private_development"],
    });
    expect(out.map((f) => f.properties.id)).toEqual(["gov-2019"]);
  });

  it("filters by funderType checkboxes", () => {
    const out = filterInvestmentPointFeatures(features, {
      yearRangeId: "all",
      activeFunderTypes: ["philanthropic"],
    });
    expect(out.map((f) => f.properties.id)).toEqual(["phil-2022"]);
  });

  it("keeps an unknown (off-enum) funderType only while EVERY funder checkbox is on", () => {
    // A future/off-enum funderType has no checkbox and paints grey via the paint
    // fallback; it must stay visible under "all on" and hide when any box is off,
    // never silently filtered out with no control to bring it back.
    const unknown = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-87.6, 41.75] },
      properties: {
        id: "unknown-1",
        recipient: "Mystery",
        funderName: "Mystery",
        funderType: "other" as unknown as "government",
        amountAwarded: 1000,
        logLine: null,
        year: 2022,
        status: "awarded" as const,
        sourceLink: "",
      },
    } as InvestmentPointFeature;

    const allOn = filterInvestmentPointFeatures([unknown], {
      yearRangeId: "all",
      activeFunderTypes: ["government", "philanthropic", "private_development"],
    });
    expect(allOn.map((f) => f.properties.id)).toEqual(["unknown-1"]);

    const oneOff = filterInvestmentPointFeatures([unknown], {
      yearRangeId: "all",
      activeFunderTypes: ["government", "philanthropic"],
    });
    expect(oneOff).toEqual([]);
  });
});

describe("citywideInvestmentEntries / summarizeCitywideEntries", () => {
  const entries = citywideInvestmentEntries(records);

  it("extracts only the citywide records' filterable fields", () => {
    expect(entries).toEqual([
      { funderType: "philanthropic", year: 2021, amountAwarded: 250_000 },
      { funderType: "government", year: 2020, amountAwarded: null },
    ]);
  });

  it("unfiltered (opts null) matches summarizeCitywideInvestment", () => {
    expect(summarizeCitywideEntries(entries, null)).toEqual(summarizeCitywideInvestment(records));
  });

  it("re-scopes the citywide figure to the active year window", () => {
    // Narrowing to 2017–2019 excludes both citywide records (2021, 2020).
    const scoped = summarizeCitywideEntries(entries, {
      yearRangeId: "2017-2019",
      activeFunderTypes: ["government", "philanthropic", "private_development"],
    });
    expect(scoped).toEqual({ count: 0, totalDollars: 0 });
  });

  it("re-scopes the citywide figure to the active funderType checkboxes", () => {
    const govOnly = summarizeCitywideEntries(entries, {
      yearRangeId: "all",
      activeFunderTypes: ["government"],
    });
    // Only the (null-amount) government citywide record remains.
    expect(govOnly).toEqual({ count: 1, totalDollars: 0 });
  });
});

describe("summarizeCitywideInvestment", () => {
  it("counts only citywide records and sums their non-null awarded dollars", () => {
    const summary = summarizeCitywideInvestment(records);
    expect(summary.count).toBe(2);
    expect(summary.totalDollars).toBe(250_000); // cw-gov-noamt contributes 0
  });
});

describe("presentFunderTypesInOrder", () => {
  it("dedupes and returns in canonical funder order", () => {
    expect(
      presentFunderTypesInOrder(["philanthropic", "government", "government", "private_development", null])
    ).toEqual(["government", "philanthropic", "private_development"]);
  });
});

describe("fetchCommunityInvestmentLayer", () => {
  it("requests the gated /api/owner-file/investment endpoint and transforms the export", async () => {
    const fetchImpl = fetchStub(200, { generatedAt: "2026-01-01", meta: {}, records });
    const result = await fetchCommunityInvestmentLayer({ fetchImpl });

    const requestedUrls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(requestedUrls[0]).toContain(COMMUNITY_INVESTMENT_ENDPOINT);
    expect(COMMUNITY_INVESTMENT_ENDPOINT).toBe("/api/owner-file/investment");

    expect(result.status).toBe("ready");
    // Citywide rows excluded from the geojson source.
    expect(result.pointFeatures.map((f) => f.properties.id)).toEqual([
      "gov-2019",
      "phil-2022",
      "dev-noyear",
    ]);
    expect(result.presentFunderTypes).toEqual(["government", "philanthropic", "private_development"]);
    expect(result.citywide).toEqual({ count: 2, totalDollars: 250_000 });
  });

  it("maps a 401 to 'unauthorized' with no features", async () => {
    const fetchImpl = fetchStub(401, { error: "Unauthorized" });
    const result = await fetchCommunityInvestmentLayer({ fetchImpl });
    expect(result.status).toBe("unauthorized");
    expect(result.pointFeatures).toEqual([]);
    expect(result.presentFunderTypes).toEqual([]);
  });

  it("maps a 503 (export not generated) to 'unavailable'", async () => {
    const fetchImpl = fetchStub(503, { error: "not generated" });
    const result = await fetchCommunityInvestmentLayer({ fetchImpl });
    expect(result.status).toBe("unavailable");
    expect(result.pointFeatures).toEqual([]);
  });

  it("appends a source filter to the endpoint when given", async () => {
    const fetchImpl = fetchStub(200, { records: [] });
    await fetchCommunityInvestmentLayer({ fetchImpl, source: "cdg" });
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`${COMMUNITY_INVESTMENT_ENDPOINT}?source=cdg`);
  });
});

// ── Development dot: announcedInvestment carried + radius sized by it ──────────

describe("development dots: announcedInvestment + radiusPx", () => {
  const dev = (id: string, announcedInvestment: number | null, lat = 41.8, lng = -87.62) =>
    ({
      id,
      source: "development",
      funderType: "private_development",
      funderName: "Developer",
      recipient: id,
      amountAwarded: null,
      announcedInvestment,
      logLine: null,
      year: 2024,
      geometry: { kind: "point", lat, lng },
      address: null,
      status: "under_construction",
      links: [],
    }) satisfies CommunityInvestmentRecord;

  it("carries announcedInvestment onto the feature and stamps a radiusPx on dev dots only", () => {
    const features = investmentRecordsToPointFeatures([
      dev("big", 9_000_000_000),
      dev("small", 22_000_000),
      dev("subset", null),
      {
        id: "gov",
        source: "cdg",
        funderType: "government",
        funderName: "City",
        recipient: "Grant",
        amountAwarded: 250_000,
        announcedInvestment: null,
        logLine: null,
        year: 2022,
        geometry: { kind: "point", lat: 41.75, lng: -87.6 },
        address: "1 Main St",
        status: "awarded",
        links: [],
      },
    ]);
    const byId = new Map(features.map((f) => [f.properties.id, f]));
    // announcedInvestment is carried through on every point feature.
    expect(byId.get("big")!.properties.announcedInvestment).toBe(9_000_000_000);
    expect(byId.get("gov")!.properties.announcedInvestment).toBeNull();

    // A development dot gets a radius in [4,18]; the biggest ≥ the smallest, and a
    // null-capital development sits at the floor.
    const big = byId.get("big")!.properties.radiusPx!;
    const small = byId.get("small")!.properties.radiusPx!;
    const subset = byId.get("subset")!.properties.radiusPx!;
    expect(big).toBeGreaterThanOrEqual(small);
    expect(big).toBeLessThanOrEqual(DEV_DOT_RADIUS_MAX);
    expect(small).toBeGreaterThanOrEqual(DEV_DOT_RADIUS_MIN);
    expect(subset).toBe(DEV_DOT_RADIUS_MIN);

    // Non-development dots never get a radiusPx (they size by amountAwarded in the paint).
    expect(byId.get("gov")!.properties.radiusPx).toBeUndefined();
  });

  it("makeDevelopmentDotRadiusScale: null/0 → min, max amount → max, monotonic", () => {
    const scale = makeDevelopmentDotRadiusScale([null, 22_000_000, 9_000_000_000]);
    expect(scale(null)).toBe(DEV_DOT_RADIUS_MIN);
    expect(scale(0)).toBe(DEV_DOT_RADIUS_MIN);
    expect(scale(9_000_000_000)).toBe(DEV_DOT_RADIUS_MAX);
    expect(scale(22_000_000)).toBeGreaterThan(DEV_DOT_RADIUS_MIN);
    expect(scale(22_000_000)).toBeLessThan(DEV_DOT_RADIUS_MAX);
    // Degenerate domain (all equal) → midpoint.
    const flat = makeDevelopmentDotRadiusScale([5, 5, 5]);
    expect(flat(5)).toBe((DEV_DOT_RADIUS_MIN + DEV_DOT_RADIUS_MAX) / 2);
  });
});

// ── Status labels are exhaustive + humanized ──────────────────────────────────

describe("INVESTMENT_STATUS_LABELS", () => {
  it("covers every INVESTMENT_STATUS with a humanized (non snake_case) label", () => {
    for (const s of INVESTMENT_STATUSES) {
      const label = INVESTMENT_STATUS_LABELS[s];
      expect(label, `${s} has a label`).toBeTruthy();
      expect(label).not.toContain("_");
    }
    expect(Object.keys(INVESTMENT_STATUS_LABELS).sort()).toEqual([...INVESTMENT_STATUSES].sort());
  });

  it("investmentStatusLabel humanizes a known status and passes an unknown one through", () => {
    expect(investmentStatusLabel("under_construction")).toBe("Under construction");
    expect(investmentStatusLabel("opened")).toBe("Opened");
    expect(investmentStatusLabel("")).toBe("");
    expect(investmentStatusLabel("mystery")).toBe("mystery");
  });
});
