import { describe, expect, it, vi } from "vitest";
import { INVESTMENT_STATUSES, type CommunityInvestmentRecord } from "@/lib/community-investment";
import {
  citywideInvestmentEntries,
  COMMUNITY_INVESTMENT_ENDPOINT,
  DEV_DOT_RADIUS_MAX,
  DEV_DOT_RADIUS_MIN,
  fetchCommunityInvestmentLayer,
  fetchCountyReliefRecipients,
  fetchHistoricalRecoveryRecipients,
  excludeMegaprojectFeatures,
  filterInvestmentPointFeatures,
  INVESTMENT_STATUS_LABELS,
  investmentRecordsToPointFeatures,
  investmentStatusLabel,
  makeDevelopmentDotRadiusScale,
  presentFunderTypesInOrder,
  summarizeCitywideEntries,
  summarizeCitywideInvestment,
  buildMegaprojectFeatures,
  citywideDevelopmentProjectNames,
  makeMegaprojectRadiusScale,
  megaprojectStatusGroup,
  summarizeMegaprojects,
  truncateMegaprojectLabel,
  MEGAPROJECT_ANNOUNCED_CAPITAL_LABEL,
  MEGAPROJECT_LABEL_MAX_CHARS,
  MEGAPROJECT_RADIUS_MAX,
  MEGAPROJECT_RADIUS_MIN,
  MEGAPROJECT_STATUS_GROUPS,
  MEGAPROJECT_STATUS_GROUP_BY_STATUS,
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
    capitalClass: "grant",
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
      { source: "foundation", funderType: "philanthropic", year: 2021, amountAwarded: 250_000 },
      { source: "cdg", funderType: "government", year: 2020, amountAwarded: null },
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
    // The two citywide rows here are philanthropic + government, not development,
    // so the megaproject "not plotted" list is empty for this fixture.
    expect(result.citywideDevelopmentNames).toEqual([]);
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
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      `${COMMUNITY_INVESTMENT_ENDPOINT}?view=map&source=cdg`,
    );
  });

  it("aggregates Cook County recipients by source ZIP without creating points", async () => {
    const countyRecords = [
      record({
        id: "cook-1",
        source: "cook-source-2023",
        funderName: "Cook County 2023 Source Grant",
        amountAwarded: null,
        recovery: {
          sourceId: "cook-source-2023",
          historicalAmount: {
            value: 10_000,
            currency: "USD",
            assistanceType: "grant",
          },
        },
        year: 2023,
        geometry: { kind: "zip_area", zip: "60617" },
        address: null,
        status: "disbursed",
      }),
      record({
        id: "cook-2",
        source: "cook-source-2023",
        funderName: "Cook County 2023 Source Grant",
        amountAwarded: null,
        recovery: {
          sourceId: "cook-source-2023",
          historicalAmount: {
            value: 20_000,
            currency: "USD",
            assistanceType: "grant",
          },
        },
        year: 2023,
        geometry: { kind: "zip_area", zip: "60617" },
        address: null,
        status: "disbursed",
      }),
    ];
    const fetchImpl = fetchStub(200, { records: countyRecords });
    const result = await fetchCommunityInvestmentLayer({ fetchImpl });
    expect(result.pointFeatures).toEqual([]);
    expect(result.countyReliefByZip).toEqual([
      {
        sourceId: "cook-source-2023",
        programName: "Cook County 2023 Source Grant",
        zipCode: "60617",
        awardCount: 2,
        totalDisbursed: 30_000,
        year: 2023,
        sourceLink: "https://example.gov/round",
      },
    ]);
  });

  it("keeps Illinois B2B ZIP history separate from Cook County aggregates", async () => {
    const fetchImpl = fetchStub(200, {
      records: [
        record({
          id: "b2b-1",
          source: "illinois-b2b",
          funderName: "Illinois Back to Business Grant Program",
          amountAwarded: null,
          recovery: {
            sourceId: "illinois-b2b",
            historicalAmount: {
              value: 35_000,
              currency: "USD",
              assistanceType: "grant",
            },
          },
          year: 2022,
          geometry: { kind: "zip_area", zip: "60617" },
          address: null,
          status: "disbursed",
        }),
      ],
    });
    const result = await fetchCommunityInvestmentLayer({ fetchImpl });
    expect(result.countyReliefByZip).toEqual([]);
    expect(result.stateRecoveryByZip).toEqual([
      {
        sourceId: "illinois-b2b",
        programName: "Illinois Back to Business Grant Program",
        zipCode: "60617",
        awardCount: 1,
        totalDisbursed: 35_000,
        year: 2022,
        sourceLink: "https://example.gov/round",
      },
    ]);
  });

  it("keeps unplotted DCEO records out of the base citywide commitment summary", async () => {
    const fetchImpl = fetchStub(200, {
      records: [
        record({
          id: "state-citywide",
          source: "dceo-capital",
          funderName: "Illinois DCEO",
          capitalClass: "state_appropriation",
          amountAwarded: null,
          publishedBalance: 500_000,
          geometry: { kind: "citywide" },
          address: null,
          status: "appropriated",
        }),
      ],
    });
    const result = await fetchCommunityInvestmentLayer({ fetchImpl });
    expect(result.citywide).toEqual({ count: 0, totalDollars: 0 });
    expect(result.citywideEntries).toEqual([]);
    expect(result.stateCapitalCitywideCount).toBe(1);
  });

  it("accepts the gated route's privacy-preserving map projection", async () => {
    const fetchImpl = fetchStub(200, {
      records: [],
      countyReliefByZip: [
        {
          sourceId: "cook-source-2023",
          programName: "Cook County 2023 Source Grant",
          zipCode: "60617",
          awardCount: 12,
          totalDisbursed: 180_000,
          year: 2023,
          sourceLink: "https://example.gov/list.pdf",
        },
      ],
      stateCapitalCitywideCount: 9,
    });
    const result = await fetchCommunityInvestmentLayer({ fetchImpl });
    expect(result.countyReliefByZip).toHaveLength(1);
    expect(result.stateCapitalCitywideCount).toBe(9);
    expect(result.pointFeatures).toEqual([]);
  });
});

describe("fetchCountyReliefRecipients", () => {
  it("requests Illinois B2B recipients through the generic one-ZIP endpoint", async () => {
    const fetchImpl = fetchStub(200, {
      sourceId: "illinois-b2b",
      zipCode: "60617",
      programName: "Illinois Back to Business Grant Program",
      programStatus: "complete",
      year: 2022,
      recipients: [
        {
          id: "b2b-1",
          businessName: "Neighborhood Business",
          historicalAwardAmount: 35_000,
        },
      ],
    });
    const result = await fetchHistoricalRecoveryRecipients(
      "illinois-b2b",
      "60617",
      { fetchImpl },
    );
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      `${COMMUNITY_INVESTMENT_ENDPOINT}?view=historical-recovery-recipients&source=illinois-b2b&zip=60617`,
    );
    expect(result.programName).toBe("Illinois Back to Business Grant Program");
    expect(result.year).toBe(2022);
    expect(result.recipients[0].businessName).toBe("Neighborhood Business");
  });

  it("requests one ZIP and returns the authenticated historical recipient rows", async () => {
    const fetchImpl = fetchStub(200, {
      zipCode: "60617",
      programName: "Cook County 2023 Source Grant",
      programStatus: "complete",
      year: 2023,
      recipientCount: 2,
      sourceLink: "https://example.gov/list.pdf",
      recipients: [
        {
          id: "cook-1",
          businessName: "First Business",
          historicalAwardAmount: 10_000,
        },
        {
          id: "cook-2",
          businessName: "Second Business",
          historicalAwardAmount: 20_000,
        },
      ],
    });

    const result = await fetchCountyReliefRecipients("60617", { fetchImpl });

    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      `${COMMUNITY_INVESTMENT_ENDPOINT}?view=historical-recovery-recipients&source=cook-source-2023&zip=60617`,
    );
    expect(result.status).toBe("ready");
    expect(result.recipientCount).toBe(2);
    expect(result.recipients.map((recipient) => recipient.businessName)).toEqual([
      "First Business",
      "Second Business",
    ]);
  });

  it("maps an expired admin session to an empty unauthorized result", async () => {
    const fetchImpl = fetchStub(401, { error: "Unauthorized" });
    const result = await fetchCountyReliefRecipients("60617", { fetchImpl });

    expect(result.status).toBe("unauthorized");
    expect(result.recipients).toEqual([]);
  });

  it("does not request a bulk or malformed ZIP lookup", async () => {
    const fetchImpl = fetchStub(200, { recipients: [] });

    await expect(
      fetchCountyReliefRecipients("all", { fetchImpl }),
    ).rejects.toThrow("five-digit ZIP");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops malformed recipient entries and unsafe source links", async () => {
    const fetchImpl = fetchStub(200, {
      sourceLink: "javascript:alert(1)",
      recipients: [
        {
          id: "cook-valid",
          businessName: "Valid Business",
          historicalAwardAmount: 10_000,
        },
        {
          id: "cook-invalid",
          historicalAwardAmount: 20_000,
        },
      ],
    });

    const result = await fetchCountyReliefRecipients("60617", { fetchImpl });

    expect(result.recipients).toEqual([
      {
        id: "cook-valid",
        businessName: "Valid Business",
        historicalAwardAmount: 10_000,
      },
    ]);
    expect(result.recipientCount).toBe(1);
    expect(result.sourceLink).toBeNull();
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
      capitalClass: "grant",
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
        capitalClass: "grant",
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

  it("sizes NON-GRANT capital dots by their OWN money field (per-class), not the 4px floor", () => {
    const nonGrant = (
      id: string,
      capitalClass: "tif_subsidy" | "federal_program" | "tax_credit",
      source: "tif" | "cdbg-home" | "lihtc",
      money: number,
      lat: number,
    ): CommunityInvestmentRecord => ({
      id,
      source,
      funderType: "government",
      funderName: "Public capital",
      recipient: id,
      amountAwarded: null,
      authorizedAmount: capitalClass === "tax_credit" ? null : money,
      creditAmount: capitalClass === "tax_credit" ? money : null,
      logLine: null,
      year: 2022,
      geometry: { kind: "point", lat, lng: -87.6 },
      address: `${id} St`,
      status: "awarded",
      capitalClass,
      links: [],
    });

    const features = investmentRecordsToPointFeatures([
      nonGrant("tif-big", "tif_subsidy", "tif", 900_000_000, 41.70),
      nonGrant("tif-small", "tif_subsidy", "tif", 2_000_000, 41.71),
      nonGrant("hud-one", "federal_program", "cdbg-home", 5_000_000, 41.72),
      nonGrant("lihtc-one", "tax_credit", "lihtc", 12_000_000, 41.73),
      record({
        id: "dceo-one",
        source: "dceo-capital",
        capitalClass: "state_appropriation",
        amountAwarded: null,
        publishedBalance: 750_000,
        status: "appropriated",
        geometry: { kind: "point", lat: 41.74, lng: -87.6 },
      }),
    ]);
    const byId = new Map(features.map((f) => [f.properties.id, f]));

    // Every non-grant dot carries a radiusPx (so the paint no longer floors it).
    for (const id of ["tif-big", "tif-small", "hud-one", "lihtc-one", "dceo-one"]) {
      const r = byId.get(id)!.properties.radiusPx;
      expect(typeof r).toBe("number");
      expect(r).toBeGreaterThanOrEqual(DEV_DOT_RADIUS_MIN);
      expect(r).toBeLessThanOrEqual(DEV_DOT_RADIUS_MAX);
    }
    // Within the tif_subsidy class, the $900M ceiling reads larger than the $2M one.
    expect(byId.get("tif-big")!.properties.radiusPx!).toBeGreaterThan(
      byId.get("tif-small")!.properties.radiusPx!,
    );
    // The $900M TIF is the max of its own domain → the max radius.
    expect(byId.get("tif-big")!.properties.radiusPx).toBe(DEV_DOT_RADIUS_MAX);
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

// ── Megaprojects view mode ────────────────────────────────────────────────────

const megaRecords: CommunityInvestmentRecord[] = [
  record({
    id: "dev-open",
    source: "development",
    funderType: "private_development",
    status: "opened",
    amountAwarded: null,
    announcedInvestment: 1_000_000_000,
    geometry: { kind: "point", lat: 41.7, lng: -87.6 },
    recipient: "The 78",
    year: null,
  }),
  record({
    id: "dev-build",
    source: "development",
    funderType: "private_development",
    status: "under_construction",
    amountAwarded: null,
    announcedInvestment: 250_000_000,
    geometry: { kind: "point", lat: 41.71, lng: -87.61 },
    recipient: "Some Under-Construction Megaproject With A Very Long Name",
    year: null,
  }),
  record({
    id: "dev-plan-nullcapital",
    source: "development",
    funderType: "private_development",
    status: "announced",
    amountAwarded: null,
    announcedInvestment: null, // e.g. the Fire-stadium subset row — floors at min
    geometry: { kind: "point", lat: 41.72, lng: -87.62 },
    recipient: "Announced No Price Tag",
    year: null,
  }),
  record({
    id: "dev-stall",
    source: "development",
    funderType: "private_development",
    status: "stalled",
    amountAwarded: null,
    announcedInvestment: 40_000_000,
    geometry: { kind: "point", lat: 41.73, lng: -87.63 },
    recipient: "Stalled Project",
    year: null,
  }),
  // A non-development POINT — must be excluded from the megaproject set.
  record({ id: "gov-point", funderType: "government", status: "awarded", geometry: { kind: "point", lat: 41.74, lng: -87.64 } }),
  // A CITYWIDE development — never plots; surfaces only in the "not plotted" note.
  record({
    id: "dev-citywide",
    source: "development",
    funderType: "private_development",
    status: "announced",
    amountAwarded: null,
    announcedInvestment: 500_000_000,
    geometry: { kind: "citywide" },
    address: null,
    recipient: "Advocate South Side Investment",
    year: null,
  }),
];

describe("megaproject status-group mapping", () => {
  it("maps every INVESTMENT_STATUS to one of the four groups (exhaustive)", () => {
    const groups = new Set<string>(MEGAPROJECT_STATUS_GROUPS);
    for (const s of INVESTMENT_STATUSES) {
      const group = MEGAPROJECT_STATUS_GROUP_BY_STATUS[s];
      expect(group, `${s} has a group`).toBeTruthy();
      expect(groups.has(group), `${s} → known group`).toBe(true);
    }
    // The mapping's keys are EXACTLY the status enum — no missing / extra keys.
    expect(Object.keys(MEGAPROJECT_STATUS_GROUP_BY_STATUS).sort()).toEqual([...INVESTMENT_STATUSES].sort());
  });

  it("buckets the lifecycle states into open / building / planned / stalled", () => {
    expect(["opened", "partially_open", "completed"].map(megaprojectStatusGroup)).toEqual(["open", "open", "open"]);
    expect(megaprojectStatusGroup("under_construction")).toBe("building");
    expect(["announced", "proposed", "awarded"].map(megaprojectStatusGroup)).toEqual([
      "planned",
      "planned",
      "planned",
    ]);
    expect(["stalled", "cancelled"].map(megaprojectStatusGroup)).toEqual(["stalled", "stalled"]);
  });

  it("folds an off-enum / empty status to 'planned' rather than throwing", () => {
    expect(megaprojectStatusGroup("mystery")).toBe("planned");
    expect(megaprojectStatusGroup(null)).toBe("planned");
    expect(megaprojectStatusGroup(undefined)).toBe("planned");
  });
});

describe("makeMegaprojectRadiusScale", () => {
  it("maps the largest to MAX, a null/zero amount to MIN, clamped 6–24px", () => {
    const scale = makeMegaprojectRadiusScale([1_000_000_000, 250_000_000, null, 40_000_000]);
    expect(scale(1_000_000_000)).toBe(MEGAPROJECT_RADIUS_MAX);
    expect(scale(null)).toBe(MEGAPROJECT_RADIUS_MIN);
    expect(scale(0)).toBe(MEGAPROJECT_RADIUS_MIN);
    const mid = scale(250_000_000);
    expect(mid).toBeGreaterThan(MEGAPROJECT_RADIUS_MIN);
    expect(mid).toBeLessThan(MEGAPROJECT_RADIUS_MAX);
  });

  it("renders a degenerate (all-equal) domain at the midpoint radius", () => {
    const flat = makeMegaprojectRadiusScale([5, 5, 5]);
    expect(flat(5)).toBe((MEGAPROJECT_RADIUS_MIN + MEGAPROJECT_RADIUS_MAX) / 2);
  });
});

describe("truncateMegaprojectLabel", () => {
  it("passes a short name through and truncates a long one to the cap with an ellipsis", () => {
    expect(truncateMegaprojectLabel("The 78")).toBe("The 78");
    const long = truncateMegaprojectLabel("Some Under-Construction Megaproject With A Very Long Name");
    expect(long.length).toBeLessThanOrEqual(MEGAPROJECT_LABEL_MAX_CHARS);
    expect(long.endsWith("…")).toBe(true);
    expect(truncateMegaprojectLabel(null)).toBe("");
  });
});

describe("buildMegaprojectFeatures", () => {
  it("keeps ONLY development points, stamping status group + label + a 6–24px radius", () => {
    const points = investmentRecordsToPointFeatures(megaRecords); // citywide already excluded
    const mega = buildMegaprojectFeatures(points);

    // gov-point (non-development) and the citywide dev are both excluded.
    expect(mega.map((f) => f.properties.id)).toEqual([
      "dev-open",
      "dev-build",
      "dev-plan-nullcapital",
      "dev-stall",
    ]);
    expect(mega.map((f) => f.properties.id)).not.toContain("gov-point");
    expect(mega.map((f) => f.properties.id)).not.toContain("dev-citywide");

    const byId = Object.fromEntries(mega.map((f) => [f.properties.id, f.properties]));
    expect(byId["dev-open"].statusGroup).toBe("open");
    expect(byId["dev-build"].statusGroup).toBe("building");
    expect(byId["dev-plan-nullcapital"].statusGroup).toBe("planned");
    expect(byId["dev-stall"].statusGroup).toBe("stalled");

    // Radius sized by announcedInvestment: largest → 24, null-capital → 6 (floor).
    expect(byId["dev-open"].radiusPx).toBe(MEGAPROJECT_RADIUS_MAX);
    expect(byId["dev-plan-nullcapital"].radiusPx).toBe(MEGAPROJECT_RADIUS_MIN);

    // The reused popup contract is intact (development → "Announced" branch reads these).
    expect(byId["dev-open"].announcedInvestment).toBe(1_000_000_000);
    expect(byId["dev-build"].label.length).toBeLessThanOrEqual(MEGAPROJECT_LABEL_MAX_CHARS);
  });
});

describe("excludeMegaprojectFeatures", () => {
  it("keeps the base feed free of private-development records", () => {
    const points = investmentRecordsToPointFeatures(megaRecords);
    expect(excludeMegaprojectFeatures(points).map((f) => f.properties.id)).toEqual(["gov-point"]);
  });
});

describe("summarizeMegaprojects", () => {
  it("counts per status group and totals ANNOUNCED capital (null → 0), never awarded", () => {
    const mega = buildMegaprojectFeatures(investmentRecordsToPointFeatures(megaRecords));
    const summary = summarizeMegaprojects(mega);
    expect(summary.plottedCount).toBe(4);
    expect(summary.groupCounts).toEqual({ open: 1, building: 1, planned: 1, stalled: 1 });
    // 1B + 250M + 0 (null) + 40M — announcedInvestment only, amountAwarded ignored.
    expect(summary.totalAnnounced).toBe(1_290_000_000);
  });
});

describe("citywideDevelopmentProjectNames", () => {
  it("returns the citywide DEVELOPMENT names and excludes point-dev + non-dev citywide", () => {
    expect(citywideDevelopmentProjectNames(megaRecords)).toEqual(["Advocate South Side Investment"]);
    // The philanthropic + government citywide rows in the other fixture never appear.
    expect(citywideDevelopmentProjectNames(records)).toEqual([]);
  });
});

describe("MEGAPROJECT_ANNOUNCED_CAPITAL_LABEL", () => {
  it("is the exact legend string (Announced, never Awarded)", () => {
    expect(MEGAPROJECT_ANNOUNCED_CAPITAL_LABEL).toBe("Announced private capital — not awarded dollars");
  });
});
