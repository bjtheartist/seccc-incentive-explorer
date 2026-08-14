import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { isConfiguredMock, hasSessionMock, loadMock, filterMock } = vi.hoisted(() => ({
  isConfiguredMock: vi.fn(),
  hasSessionMock: vi.fn(),
  loadMock: vi.fn(),
  filterMock: vi.fn(),
}));

vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "cie_owner_files_admin",
  isOwnerFilesAdminConfigured: isConfiguredMock,
  hasValidOwnerFilesAdminSession: hasSessionMock,
}));

vi.mock("@/lib/community-investment", () => ({
  INVESTMENT_SOURCES: [
    "cdg",
    "cook-source-2023",
    "illinois-big",
    "illinois-hospitality-emergency",
    "illinois-b2b",
    "sba-rrf",
    "dceo-capital",
  ],
  loadCommunityInvestment: loadMock,
  filterInvestmentBySources: filterMock,
}));

vi.mock("@/lib/investment-deck-modes", () => ({
  parseFunderHqCsv: vi.fn(() => []),
}));

import { GET } from "./route";

const sourceLink = "https://example.com/official-source";
const fakeData = {
  generatedAt: "2026-07-28T00:00:00.000Z",
  meta: { totalRecords: 10 },
  records: [
    {
      id: "cdg-point",
      source: "cdg",
      funderType: "government",
      governmentFundingPurpose: "capital_project",
      funderName: "Chicago Community Development Grant",
      recipient: "Ordinary grant recipient",
      capitalClass: "grant",
      geometry: { kind: "point", lat: 41.75, lng: -87.58 },
      amountAwarded: 50_000,
      logLine: "Storefront rehab",
      year: 2024,
      status: "completed",
      communityArea: "SOUTH SHORE",
      address: "7501 S Exchange Ave",
      postalCode: "60649",
      recordDate: "2024-03-01",
      recordProvenance: "official",
      links: ["not-a-link", sourceLink, "https://example.com/second-link"],
    },
    {
      id: "cook-a",
      source: "cook-source-2023",
      funderType: "government",
      governmentFundingPurpose: "programmatic",
      recipient: "Cook recipient A",
      geometry: { kind: "zip_area", zip: "60617" },
      amountAwarded: null,
      recovery: { historicalAmount: { value: 10_000 } },
      links: [sourceLink],
    },
    {
      id: "cook-b",
      source: "cook-source-2023",
      funderType: "government",
      governmentFundingPurpose: "programmatic",
      recipient: "Cook recipient B",
      geometry: { kind: "zip_area", zip: "60617" },
      amountAwarded: null,
      recovery: { historicalAmount: { value: 20_000 } },
      links: [sourceLink],
    },
    {
      id: "big-a",
      source: "illinois-big",
      funderType: "government",
      governmentFundingPurpose: "programmatic",
      recipient: "Illinois BIG recipient",
      geometry: { kind: "zip_area", zip: "60617" },
      amountAwarded: null,
      recovery: { historicalAmount: { value: 30_000 } },
      links: [sourceLink],
    },
    {
      id: "hospitality-citywide",
      source: "illinois-hospitality-emergency",
      funderType: "government",
      governmentFundingPurpose: "programmatic",
      recipient: "Illinois Hospitality recipient",
      geometry: { kind: "citywide" },
      amountAwarded: null,
      recovery: { historicalAmount: { value: 25_000 } },
      links: [sourceLink],
    },
    {
      id: "b2b-a",
      source: "illinois-b2b",
      funderType: "government",
      governmentFundingPurpose: "programmatic",
      recipient: "Illinois B2B recipient",
      geometry: { kind: "zip_area", zip: "60617" },
      amountAwarded: null,
      recovery: { historicalAmount: { value: 25_000 } },
      links: [sourceLink],
    },
    {
      id: "rrf-point",
      source: "sba-rrf",
      funderType: "government",
      governmentFundingPurpose: "programmatic",
      recipient: "Restaurant recipient",
      logLine: "Legal business: Restaurant Recipient LLC · Published uses: rent",
      geometry: { kind: "point", lat: 41.77, lng: -87.6 },
      amountAwarded: null,
      recovery: { historicalAmount: { value: 80_000 } },
      links: [sourceLink],
    },
    {
      id: "rrf-citywide",
      source: "sba-rrf",
      funderType: "government",
      governmentFundingPurpose: "programmatic",
      recipient: "Unplotted restaurant recipient",
      geometry: { kind: "citywide" },
      amountAwarded: null,
      recovery: { historicalAmount: { value: 90_000 } },
      links: [sourceLink],
    },
    {
      id: "dceo-point",
      source: "dceo-capital",
      funderType: "government",
      governmentFundingPurpose: "capital_project",
      recipient: "Address-sited state project",
      geometry: { kind: "point", lat: 41.76, lng: -87.59 },
      amountAwarded: null,
      publishedBalance: 750_000,
      links: [sourceLink],
    },
    {
      id: "dceo-citywide",
      source: "dceo-capital",
      funderType: "government",
      governmentFundingPurpose: "capital_project",
      recipient: "Unplotted state project",
      geometry: { kind: "citywide" },
      amountAwarded: null,
      publishedBalance: 1_250_000,
      links: [sourceLink],
    },
  ],
};

function req(url: string) {
  return new NextRequest(url);
}

beforeEach(() => {
  isConfiguredMock.mockReset().mockReturnValue(true);
  hasSessionMock.mockReset().mockReturnValue(true);
  loadMock.mockReset().mockReturnValue(fakeData);
  filterMock.mockReset().mockImplementation((data, sources: string[] | null) => ({
    ...data,
    records: sources
      ? data.records.filter((record: { source: string }) => sources.includes(record.source))
      : data.records,
  }));
});

describe("GET /api/owner-file/investment", () => {
  it("keeps the private dataset behind the configured admin session", async () => {
    hasSessionMock.mockReturnValue(false);
    const res = await GET(req("http://localhost/api/owner-file/investment?view=map"));
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(loadMock).not.toHaveBeenCalled();
  });

  it("projects recipient-level county rows and unplotted state rows out of the map response", async () => {
    const res = await GET(req("http://localhost/api/owner-file/investment?view=map"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.records.map((record: { id: string }) => record.id)).toEqual([
      "cdg-point",
      "rrf-point",
      "dceo-point",
    ]);
    expect(body.countyReliefByZip).toEqual([
      {
        sourceId: "cook-source-2023",
        programName: "Cook County 2023 Source Grant",
        zipCode: "60617",
        awardCount: 2,
        totalDisbursed: 30_000,
        year: 2023,
        sourceLink,
      },
    ]);
    expect(body.stateRecoveryByZip).toEqual([
      {
        sourceId: "illinois-b2b",
        programName: "Illinois Back to Business Grant Program",
        zipCode: "60617",
        awardCount: 1,
        totalDisbursed: 25_000,
        year: 2022,
        sourceLink,
      },
    ]);
    expect(body.state2020ReliefByZip).toEqual([
      {
        sourceId: "illinois-big",
        programName: "Business Interruption Grants Program",
        zipCode: "60617",
        awardCount: 1,
        totalDisbursed: 30_000,
        year: 2020,
        sourceLink,
      },
    ]);
    expect(body.stateCapitalCitywideCount).toBe(1);
    expect(body.federalRestaurantReliefCitywideCount).toBe(1);
    expect(body.state2020HospitalityCitywideCount).toBe(1);
    expect(JSON.stringify(body)).not.toContain("Cook recipient");
    expect(JSON.stringify(body)).not.toContain("Illinois BIG recipient");
    expect(JSON.stringify(body)).not.toContain("Illinois Hospitality recipient");
    expect(JSON.stringify(body)).not.toContain("Illinois B2B recipient");
    expect(JSON.stringify(body)).not.toContain("Unplotted restaurant recipient");
    expect(JSON.stringify(body)).not.toContain("Unplotted state project");
    expect(body.countyReliefByZip[0]).not.toHaveProperty("recipient");
    // Deliverable 1 (audit finding 9 / consult F6 + Q2): RRF is PLOTTED (it
    // survives isVisibleInProjectedView, unlike the ZIP-aggregate sources
    // above) but its recipient business name never reaches the default bulk
    // payload — neither directly nor smuggled through logLine.
    expect(JSON.stringify(body)).not.toContain("Restaurant recipient");
    expect(JSON.stringify(body)).not.toContain("Legal business: Restaurant Recipient LLC");
  });

  it("projects each surviving map record down to the fields the map client renders", async () => {
    const res = await GET(req("http://localhost/api/owner-file/investment?view=map"));
    const body = await res.json();

    expect(res.status).toBe(200);
    const cdg = body.records.find((record: { id?: string }) => record.id === "cdg-point");
    // The whitelist: exactly what investmentRecordsToPointFeatures + the popup
    // read (lib/community-investment-layer.ts / components/map/map-helpers.ts).
    expect(cdg).toEqual({
      id: "cdg-point",
      source: "cdg",
      funderType: "government",
      governmentFundingPurpose: "capital_project",
      funderName: "Chicago Community Development Grant",
      recipient: "Ordinary grant recipient",
      capitalClass: "grant",
      amountAwarded: 50_000,
      logLine: "Storefront rehab",
      year: 2024,
      geometry: { kind: "point", lat: 41.75, lng: -87.58 },
      status: "completed",
      communityArea: "SOUTH SHORE",
      // Flattened to the FIRST http(s) link — the only one the popup renders.
      links: [sourceLink],
    });
    // The dead-weight fields are stripped by name, not merely absent by luck.
    for (const stripped of ["address", "postalCode", "recordDate", "recordProvenance"]) {
      expect(cdg).not.toHaveProperty(stripped);
    }
    expect(JSON.stringify(body)).not.toContain("7501 S Exchange Ave");
    expect(JSON.stringify(body)).not.toContain("second-link");
    // A point record with recovery/publishedBalance keeps them (popup money fields).
    const dceo = body.records.find((record: { id?: string }) => record.id === "dceo-point");
    expect(dceo.publishedBalance).toBe(750_000);
    expect(dceo.governmentFundingPurpose).toBe("capital_project");
    const rrf = body.records.find((record: { id?: string }) => record.id === "rrf-point");
    expect(rrf.recovery).toEqual({ historicalAmount: { value: 80_000 } });
    expect(rrf.governmentFundingPurpose).toBe("programmatic");
    // Deliverable 1: RRF's recipient/logLine are withheld (empty/null) in the
    // default bulk payload, not merely absent — the client keys off the empty
    // string to render a "Reveal recipient name" action instead of a blank.
    expect(rrf.recipient).toBe("");
    expect(rrf.logLine).toBeNull();
    // Every OTHER field the map/popup need still ships — this is a targeted
    // identity strip, not a wholesale field removal.
    expect(rrf.id).toBe("rrf-point");
    expect(rrf.geometry).toEqual({ kind: "point", lat: 41.77, lng: -87.6 });
  });

  describe("recipient-record view (deliverable 1 — lazy RRF retrieval)", () => {
    it("401s unauthenticated, before any data load, with private/no-store on the failure path itself (Sol gate blocker 3)", async () => {
      hasSessionMock.mockReturnValue(false);
      const res = await GET(
        req("http://localhost/api/owner-file/investment?view=recipient-record&id=rrf-point"),
      );
      expect(res.status).toBe(401);
      // Adversarial: asserted on the 401 response DIRECTLY, not inferred from
      // a passing 200 elsewhere — a cached "Unauthorized" is still a leak
      // surface (an intermediary could serve it to a since-authenticated
      // request, or reveal auth-gate existence/state to a shared cache).
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(loadMock).not.toHaveBeenCalled();
    });

    it("returns exactly one record's withheld fields, authenticated, no-store", async () => {
      const res = await GET(
        req("http://localhost/api/owner-file/investment?view=recipient-record&id=rrf-point"),
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(body).toEqual({
        id: "rrf-point",
        recipient: "Restaurant recipient",
        logLine: "Legal business: Restaurant Recipient LLC · Published uses: rent",
      });
    });

    it("404s an unknown id — no bulk prefetch, no enumeration signal", async () => {
      const res = await GET(
        req("http://localhost/api/owner-file/investment?view=recipient-record&id=does-not-exist"),
      );
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await res.json()).toEqual({ error: "Not found" });
    });

    it("404s a record whose source is not enrolled in lazy retrieval (e.g. an ordinary cdg point)", async () => {
      // Only sources withheld from the bulk payload (LAZY_RECORD_SOURCES) may
      // be fetched this way — an ordinary record's name is already in the
      // bulk payload, so exposing it again here would just be a second,
      // unnecessary identity-fetch surface with a different auth story.
      const res = await GET(
        req("http://localhost/api/owner-file/investment?view=recipient-record&id=cdg-point"),
      );
      expect(res.status).toBe(404);
    });

    it("requires an id", async () => {
      const res = await GET(
        req("http://localhost/api/owner-file/investment?view=recipient-record"),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("record id is required");
    });
  });

  it("reduces surviving CITYWIDE records to legend-summary fields — names only on development rows", async () => {
    loadMock.mockReturnValueOnce({
      ...fakeData,
      records: [
        ...fakeData.records,
        {
          id: "foundation-citywide",
          source: "foundation",
          funderType: "philanthropic",
          governmentFundingPurpose: null,
          funderName: "Example Foundation",
          recipient: "Out-of-bounds grantee name",
          geometry: { kind: "citywide" },
          amountAwarded: 40_000,
          logLine: "General operating support",
          year: 2023,
          address: null,
          links: [sourceLink],
        },
        {
          id: "development-citywide",
          source: "development",
          funderType: "private_development",
          governmentFundingPurpose: null,
          funderName: "Example Developer",
          recipient: "Advocate-style citywide project",
          geometry: { kind: "citywide" },
          amountAwarded: null,
          announcedInvestment: 300_000_000,
          year: null,
          address: null,
          links: [],
        },
      ],
    });

    const res = await GET(req("http://localhost/api/owner-file/investment?view=map"));
    const body = await res.json();
    const serialized = JSON.stringify(body);

    expect(res.status).toBe(200);
    const citywide = body.records.filter(
      (record: { geometry: { kind: string } }) => record.geometry.kind === "citywide",
    );
    // A non-development citywide record never plots and never opens a popup —
    // only the legend's re-scoping summary reads it, so only those fields ship.
    expect(citywide).toContainEqual({
      source: "foundation",
      funderType: "philanthropic",
      governmentFundingPurpose: null,
      amountAwarded: 40_000,
      year: 2023,
      geometry: { kind: "citywide" },
    });
    expect(serialized).not.toContain("Out-of-bounds grantee name");
    expect(serialized).not.toContain("General operating support");
    // A private_development citywide record KEEPS its name — the Megaprojects
    // legend lists it under "not plotted" (citywideDevelopmentProjectNames).
    expect(citywide).toContainEqual({
      source: "development",
      funderType: "private_development",
      governmentFundingPurpose: null,
      amountAwarded: null,
      year: null,
      geometry: { kind: "citywide" },
      recipient: "Advocate-style citywide project",
    });
  });

  it("FAILS CLOSED: aggregate-only sources stay nameless even when held CITYWIDE, not just ZIP-area", async () => {
    // Regression guard. The projection used to strip these families by
    // `geometry.kind === "zip_area"`, so name-stripping depended entirely on a
    // geometry value the importers own. #97 established that an unplottable
    // record is HELD CITYWIDE rather than deleted (out-of-bounds DCEO geocodes),
    // and BIG still deletes its one out-of-city ZIP row (60426 / Harvey) — so
    // "hold it citywide instead" is the obvious next fix. Under the old rule
    // that fix would have pushed every such recipient's BUSINESS NAME into the
    // default map payload. The rule is keyed on source now, so it cannot.
    loadMock.mockReturnValueOnce({
      ...fakeData,
      records: [
        ...fakeData.records,
        {
          id: "big-citywide",
          source: "illinois-big",
          recipient: "Citywide BIG recipient",
          geometry: { kind: "citywide" },
          amountAwarded: null,
          recovery: { historicalAmount: { value: 15_000 } },
          links: [sourceLink],
        },
        {
          id: "b2b-citywide",
          source: "illinois-b2b",
          recipient: "Citywide B2B recipient",
          geometry: { kind: "citywide" },
          amountAwarded: null,
          recovery: { historicalAmount: { value: 15_000 } },
          links: [sourceLink],
        },
        {
          id: "cook-citywide",
          source: "cook-source-2023",
          recipient: "Citywide Cook recipient",
          geometry: { kind: "citywide" },
          amountAwarded: null,
          recovery: { historicalAmount: { value: 15_000 } },
          links: [sourceLink],
        },
      ],
    });

    const res = await GET(req("http://localhost/api/owner-file/investment?view=map"));
    const body = await res.json();
    const serialized = JSON.stringify(body);

    expect(res.status).toBe(200);
    expect(body.records.map((record: { id: string }) => record.id)).toEqual([
      "cdg-point",
      "rrf-point",
      "dceo-point",
    ]);
    expect(serialized).not.toContain("Citywide BIG recipient");
    expect(serialized).not.toContain("Citywide B2B recipient");
    expect(serialized).not.toContain("Citywide Cook recipient");
  });

  it("FAILS CLOSED: Hospitality has no per-ZIP drilldown, because it has no ZIPs", async () => {
    // The source publishes a municipality and nothing finer, so every Chicago
    // Hospitality record is citywide. A per-ZIP drilldown for it is meaningless
    // and is rejected outright rather than answered with an empty recipient list
    // that would read as "no awards in this ZIP".
    const res = await GET(
      req(
        "http://localhost/api/owner-file/investment?view=historical-recovery-recipients&source=illinois-hospitality-emergency&zip=60617",
      ),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "A supported historical recovery source is required",
    });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("FAILS CLOSED: a missing or unrecognized view returns the projected, nameless shape", async () => {
    // This inverts the branch's original default. Previously ONLY the exact
    // string "map" was projected, so a bare request — or any typo — fell
    // through to raw rows and dumped every recovery recipient's business name
    // in one payload. The safe shape is now the default; a typo degrades.
    for (const url of [
      "http://localhost/api/owner-file/investment",
      "http://localhost/api/owner-file/investment?source=cook-source-2023",
      "http://localhost/api/owner-file/investment?view=maps",
      "http://localhost/api/owner-file/investment?view=banana",
      "http://localhost/api/owner-file/investment?view=",
    ]) {
      const res = await GET(req(url));
      const body = await res.json();
      const raw = JSON.stringify(body);

      expect(res.status, url).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      // No name-bearing recovery row survives, whichever source was requested.
      expect(raw, url).not.toContain("Cook recipient");
      expect(raw, url).not.toContain("Illinois B2B recipient");
      expect(raw, url).not.toContain("Unplotted restaurant recipient");
      expect(raw, url).not.toContain("Unplotted state project");
      expect(raw, url).not.toContain("Restaurant recipient");
      expect(
        body.records.some(
          (record: { geometry: { kind: string } }) => record.geometry.kind === "zip_area",
        ),
        url,
      ).toBe(false);
      // The projection is the SAME one the map gets — one safe shape, not two.
      expect(body, url).toHaveProperty("countyReliefByZip");
      expect(body, url).toHaveProperty("stateRecoveryByZip");
    }
  });

  it("returns raw recipient-level rows ONLY for an explicit view=full opt-in", async () => {
    const res = await GET(
      req("http://localhost/api/owner-file/investment?source=cook-source-2023&view=full"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.records.map((record: { id: string }) => record.id)).toEqual([
      "cook-a",
      "cook-b",
    ]);
    // The raw shape carries no map aggregates — it is the unprojected export.
    expect(body).not.toHaveProperty("countyReliefByZip");
  });

  it("returns only one ZIP's historical Cook recipients on explicit drilldown", async () => {
    loadMock.mockReturnValue({
      ...fakeData,
      records: [
        ...fakeData.records,
        {
          id: "cook-other-zip",
          source: "cook-source-2023",
          recipient: "Other ZIP recipient",
          geometry: { kind: "zip_area", zip: "60643" },
          amountAwarded: 10_000,
          links: [sourceLink],
        },
      ],
    });

    const res = await GET(
      req(
        "http://localhost/api/owner-file/investment?view=county-relief-recipients&zip=60617",
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).toEqual({
      sourceId: "cook-source-2023",
      zipCode: "60617",
      programName: "Cook County 2023 Source Grant",
      programStatus: "complete",
      year: 2023,
      recipientCount: 2,
      sourceLink,
      recipients: [
        {
          id: "cook-a",
          businessName: "Cook recipient A",
          historicalAwardAmount: 10_000,
        },
        {
          id: "cook-b",
          businessName: "Cook recipient B",
          historicalAwardAmount: 20_000,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("Other ZIP recipient");
    expect(JSON.stringify(body)).not.toContain("Ordinary grant recipient");
    expect(body).not.toHaveProperty("totalAwardAmount");
    expect(filterMock).not.toHaveBeenCalled();
  });

  it("returns Illinois B2B recipients through the generic historical drilldown", async () => {
    const res = await GET(
      req(
        "http://localhost/api/owner-file/investment?view=historical-recovery-recipients&source=illinois-b2b&zip=60617",
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      sourceId: "illinois-b2b",
      zipCode: "60617",
      programName: "Illinois Back to Business Grant Program",
      programStatus: "complete",
      year: 2022,
      recipientCount: 1,
      sourceLink,
      recipients: [
        {
          id: "b2b-a",
          businessName: "Illinois B2B recipient",
          historicalAwardAmount: 25_000,
        },
      ],
    });
    expect(filterMock).not.toHaveBeenCalled();
  });

  it("returns Illinois BIG recipients through the generic historical drilldown", async () => {
    const res = await GET(
      req(
        "http://localhost/api/owner-file/investment?view=historical-recovery-recipients&source=illinois-big&zip=60617",
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      sourceId: "illinois-big",
      zipCode: "60617",
      programName: "Business Interruption Grants Program",
      programStatus: "complete",
      year: 2020,
      recipientCount: 1,
      sourceLink,
      recipients: [
        {
          id: "big-a",
          businessName: "Illinois BIG recipient",
          historicalAwardAmount: 30_000,
        },
      ],
    });
    expect(filterMock).not.toHaveBeenCalled();
  });

  it("requires one five-digit ZIP for recipient-level access", async () => {
    const res = await GET(
      req(
        "http://localhost/api/owner-file/investment?view=county-relief-recipients&zip=all",
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("five-digit ZIP");
    expect(filterMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported historical recipient sources", async () => {
    const res = await GET(
      req(
        "http://localhost/api/owner-file/investment?view=historical-recovery-recipients&source=sba-rrf&zip=60617",
      ),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("supported historical recovery source");
    expect(filterMock).not.toHaveBeenCalled();
  });

  it("keeps the ZIP recipient drilldown behind the admin session", async () => {
    hasSessionMock.mockReturnValue(false);
    const res = await GET(
      req(
        "http://localhost/api/owner-file/investment?view=county-relief-recipients&zip=60617",
      ),
    );

    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(loadMock).not.toHaveBeenCalled();
  });
});
