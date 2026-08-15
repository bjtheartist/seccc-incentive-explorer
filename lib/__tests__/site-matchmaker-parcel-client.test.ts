// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedCandidateParcelEnrichment,
  clearCandidateParcelEnrichmentCacheForTests,
  fetchCandidateParcelEnrichment,
} from "../site-matchmaker-parcel-client";

const PIN = "20363230080000";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        key: PIN,
        countyClass: "517",
        classGloss: "One-story commercial building",
        countyClassStatus: "available",
        lotAreaSqft: 3125,
        lotAreaStatus: "available",
        assessorBuildingSqft: 1800,
        assessorBuildingYear: "2025",
        assessorBuildingAreaStatus: "available",
        assessedValue: 6900,
        assessedYear: "2025",
        assessedStage: "board",
        assessedValueStatus: "available",
        impliedMarketValue: 27600,
        activeLicenses: [],
        activeLicenseStatus: "not_requested",
        enrichmentUnavailable: false,
        ...overrides,
      },
    ],
  };
}

beforeEach(() => clearCandidateParcelEnrichmentCacheForTests());
afterEach(() => vi.unstubAllGlobals());

describe("site-matchmaker parcel client", () => {
  it("deduplicates concurrent popup/table requests and caches a complete result by build + PIN", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return new Response(JSON.stringify(payload()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const popup = fetchCandidateParcelEnrichment("build-a", PIN);
    const table = fetchCandidateParcelEnrichment("build-a", "20-36-323-008-0000");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release();

    await expect(popup).resolves.toMatchObject({ status: "checked" });
    await expect(table).resolves.toMatchObject({ status: "checked" });
    expect(cachedCandidateParcelEnrichment("build-a", PIN)).toMatchObject({ status: "checked" });
  });

  it("partitions cache by build and fails closed for malformed responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ key: PIN }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCandidateParcelEnrichment("build-a", PIN)).resolves.toMatchObject({ status: "checked" });
    await expect(fetchCandidateParcelEnrichment("build-b", PIN)).resolves.toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects nonpositive and status-incoherent County area facts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(payload({ lotAreaSqft: 0 })), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(payload({ lotAreaSqft: null, lotAreaStatus: "available" })),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCandidateParcelEnrichment("build-zero", PIN)).resolves.toEqual({
      status: "unavailable",
    });
    await expect(fetchCandidateParcelEnrichment("build-incoherent", PIN)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it.each([
    ["zero assessed value", { assessedValue: 0 }],
    [
      "value marked unavailable",
      { assessedValueStatus: "unavailable", enrichmentUnavailable: true },
    ],
    [
      "missing class marked available",
      { countyClass: null, classGloss: null, countyClassStatus: "available" },
    ],
    [
      "published class marked not published",
      { countyClassStatus: "not_published" },
    ],
    ["zero implied market value", { impliedMarketValue: 0 }],
    ["class gloss detached from its class", { classGloss: null }],
    ["available assessment missing its stage", { assessedStage: null }],
    ["available license state with no matches", { activeLicenseStatus: "available" }],
    [
      "unavailable field without the aggregate failure flag",
      { lotAreaSqft: null, lotAreaStatus: "unavailable" },
    ],
  ])("rejects malformed %s responses", async (_name, overrides) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(payload(overrides)), { status: 200 })),
    );
    await expect(
      fetchCandidateParcelEnrichment(`build-malformed-${_name}`, PIN),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("accepts an honestly partial response but does not cache it", async () => {
    const partial = payload({
      countyClass: null,
      classGloss: null,
      countyClassStatus: "unavailable",
      lotAreaSqft: null,
      lotAreaStatus: "unavailable",
      assessorBuildingSqft: null,
      assessorBuildingYear: null,
      assessorBuildingAreaStatus: "unavailable",
      impliedMarketValue: null,
      enrichmentUnavailable: true,
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(partial), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCandidateParcelEnrichment("build-partial", PIN)).resolves.toMatchObject({
      status: "checked",
      sourceUnavailable: true,
    });
    await expect(fetchCandidateParcelEnrichment("build-partial", PIN)).resolves.toMatchObject({
      status: "checked",
      sourceUnavailable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not request upstream without a valid string PIN", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchCandidateParcelEnrichment("build-a", "bad-pin")).resolves.toEqual({
      status: "not_requested",
    });
    await expect(fetchCandidateParcelEnrichment("build-a", 20363230080000)).resolves.toEqual({
      status: "not_requested",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
