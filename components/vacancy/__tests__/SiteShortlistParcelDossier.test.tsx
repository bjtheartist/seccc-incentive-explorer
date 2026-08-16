// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DecoratedShortlistCandidate } from "@/lib/shortlist-engine";
import { createEmptySiteMatchCriteria } from "@/lib/site-matchmaker";
import { clearCandidateParcelEnrichmentCacheForTests } from "@/lib/site-matchmaker-parcel-client";
import { clearCandidateParcelResolutionCacheForTests } from "@/lib/site-matchmaker-parcel-resolution-client";

vi.mock("@/lib/analytics-events", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/vacancy/SiteShortlistMap", () => ({
  default: ({
    visibleCandidateKeys,
    onParcelDetails,
  }: {
    visibleCandidateKeys: readonly string[];
    onParcelDetails: (candidateKey: string, opener: HTMLButtonElement) => void;
  }) => (
    <div>
      <output data-testid="map-keys">{visibleCandidateKeys.join(",")}</output>
      <button
        type="button"
        onClick={(event) => onParcelDetails(visibleCandidateKeys[0], event.currentTarget)}
      >
        Map parcel details
      </button>
    </div>
  ),
}));

import SiteShortlistResults from "@/components/vacancy/SiteShortlistResults";

const candidate: DecoratedShortlistCandidate = {
  key: "candidate-01",
  address: "3040 S HOMAN AVE",
  pin: null,
  lat: 41.83776,
  lon: -87.70998,
  propertyType: "vacant_building",
  screenedPropertyType: "vacant_building",
  buildingSqft: null,
  lotSqft: null,
  zoningDistrict: "C1-2",
  zoningStatus: "resolved",
  badge: "aligned",
  badgeNote: "Broad family alignment only.",
  ownerLabel: "Corporate / LLC · mailing geography unknown (unverified)",
  ownerSector: "private",
  ownerStructure: "entity",
  incentiveCount: 2,
  saleYear: null,
  violation: false,
  conflictingPropertyTypes: false,
  overlays: {
    ssa: { present: false, name: null, unknown: false },
    ccsa: { present: false, name: null, unknown: false },
    tif: { present: false, name: null, unknown: false },
    nof: { present: false, name: null, unknown: false },
  },
  transitScore: null,
  score: 12,
  recordCompletenessScore: 2,
  nearestRailDisplay: null,
  expresswayDisplay: null,
  nearestSchool: null,
  nearestLibrary: null,
};

function batchItem(key: string) {
  return {
    key,
    countyClass: null,
    classGloss: null,
    countyClassStatus: "not_requested",
    lotAreaSqft: null,
    lotAreaStatus: "not_requested",
    assessorBuildingSqft: null,
    assessorBuildingYear: null,
    assessorBuildingAreaStatus: "not_requested",
    assessedValue: null,
    assessedYear: null,
    assessedStage: null,
    assessedValueStatus: "not_requested",
    impliedMarketValue: null,
    activeLicenses: [],
    activeLicenseStatus: "not_requested",
    enrichmentUnavailable: false,
  };
}

function liveItem(key: string) {
  return {
    key,
    countyClass: "517",
    classGloss: "One-story commercial building",
    countyClassStatus: "available",
    lotAreaSqft: 3123,
    lotAreaStatus: "available",
    assessorBuildingSqft: 1344,
    assessorBuildingYear: "2025",
    assessorBuildingAreaStatus: "available",
    assessedValue: 6972,
    assessedYear: "2025",
    assessedStage: "board",
    assessedValueStatus: "available",
    impliedMarketValue: 27888,
    activeLicenses: [],
    activeLicenseStatus: "not_found",
    enrichmentUnavailable: false,
  };
}

function renderResultRows(rows: DecoratedShortlistCandidate[]) {
  render(
    <SiteShortlistResults
      zip="60623"
      criteria={{
        ...createEmptySiteMatchCriteria(),
        zip: "60623",
        projectUse: "food-hospitality",
        propertyType: "existing-building",
      }}
      scored={false}
      source="site-matchmaker"
      buildId="build-current"
      ranked={rows}
      boundary={null}
      centroid={{ lat: 41.83776, lon: -87.70998 }}
    />,
  );
}

function renderResults(row = candidate) {
  renderResultRows([row]);
}

beforeEach(() => {
  clearCandidateParcelEnrichmentCacheForTests();
  clearCandidateParcelResolutionCacheForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Site Shortlist parcel dossier", () => {
  it("does no parcel lookup before intent, resolves one exact parcel, restores all four links, and reuses the same card/map dossier", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/shortlist/resolve-parcel?")) {
        return new Response(JSON.stringify({
          status: "resolved",
          pin: "16264270400000",
          source: "cook_county_current_parcels",
          matchMethod: "exact_intersection",
          checkedAt: "2026-08-15T21:00:00.000Z",
        }), { status: 200 });
      }
      if (url === "/api/shortlist/enrich") {
        const body = JSON.parse(String(init?.body)) as { items: Array<{ key: string }> };
        const item = body.items[0];
        const direct = item.key === "16264270400000";
        return new Response(JSON.stringify({ items: [direct ? liveItem(item.key) : batchItem(item.key)] }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderResults();

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/shortlist/enrich")).toHaveLength(1);
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("resolve-parcel"))).toHaveLength(0);
    const cardMaps = screen.getByRole("link", { name: /Open 3040 S Homan Ave in Google Maps/ });
    expect(cardMaps.getAttribute("href")).toContain("query=3040+S+HOMAN+AVE%2C+Chicago%2C+IL+60623");

    const OriginalURL = URL;
    class TestURL extends OriginalURL {
      static createObjectURL = vi.fn(() => "blob:shortlist");
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", TestURL);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Download the full shortlist (CSV)" }));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("resolve-parcel"))).toHaveLength(0);
    anchorClick.mockRestore();

    const cardOpener = screen.getByRole("button", { name: "Parcel details" });
    fireEvent.click(cardOpener);
    const dialog = screen.getByRole("dialog", { name: "3040 S HOMAN AVE" });
    expect(dialog.textContent).toContain("resolving the exact County parcel");

    await waitFor(() => expect(dialog.textContent).toContain("$6,972"));
    expect(dialog.textContent).toContain("3,123 sq ft · current County record");
    expect(dialog.textContent).toContain("1,344 sq ft · current County record");
    expect(dialog.textContent).toContain("current County parcel resolved by exact map-point intersection");
    expect(within(dialog).getByRole("link", { name: /Google Maps/ })).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: /CookViewer parcel details/ }).getAttribute("href")).toContain("16264270400000");
    expect(within(dialog).getByRole("link", { name: /Assessor property record/ }).getAttribute("href")).toContain("16264270400000");
    expect(within(dialog).getByRole("link", { name: /Clerk recorded documents/ }).getAttribute("href")).toContain("16264270400000");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("resolve-parcel"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/shortlist/enrich")).toHaveLength(2);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(cardOpener));
    const mapOpener = screen.getByRole("button", { name: "Map parcel details" });
    fireEvent.click(mapOpener);
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("$6,972"));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("resolve-parcel"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/shortlist/enrich")).toHaveLength(2);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(mapOpener));
  });

  it("keeps Google Maps available while an ambiguous County intersection locks PIN-derived links and facts", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/shortlist/resolve-parcel?")) {
        return new Response(JSON.stringify({
          status: "ambiguous",
          candidateCount: 2,
          checkedAt: "2026-08-15T21:00:00.000Z",
          source: "cook_county_current_parcels",
          matchMethod: "exact_intersection",
        }), { status: 409 });
      }
      if (url === "/api/shortlist/enrich") {
        const body = JSON.parse(String(init?.body)) as { items: Array<{ key: string }> };
        return new Response(JSON.stringify({ items: [batchItem(body.items[0].key)] }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderResults();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Parcel details" }));

    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("2 County parcel records intersect"));
    expect(within(dialog).getByRole("link", { name: /Google Maps/ })).toBeTruthy();
    expect(within(dialog).queryByRole("link", { name: /CookViewer parcel details/ })).toBeNull();
    expect(within(dialog).queryByRole("link", { name: /Assessor property record/ })).toBeNull();
    expect(within(dialog).queryByRole("link", { name: /Clerk recorded documents/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry parcel lookup" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/shortlist/enrich")).toHaveLength(1);
  });

  it("does not let a truthy malformed saved PIN bypass exact current resolution", async () => {
    const invalidSavedPin = { ...candidate, key: "candidate-invalid-pin", pin: "not-a-pin" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/shortlist/resolve-parcel?")) {
        return new Response(JSON.stringify({
          status: "resolved",
          pin: "16264270400000",
          source: "cook_county_current_parcels",
          matchMethod: "exact_intersection",
          checkedAt: "2026-08-15T21:00:00.000Z",
        }), { status: 200 });
      }
      if (url === "/api/shortlist/enrich") {
        const body = JSON.parse(String(init?.body)) as { items: Array<{ key: string }> };
        const key = body.items[0].key;
        return new Response(JSON.stringify({
          items: [key === "16264270400000" ? liveItem(key) : batchItem(key)],
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderResults(invalidSavedPin);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Parcel details" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("current County parcel resolved"));
    expect(dialog.textContent).toContain("PIN 16-26-427-040-0000");
    expect(dialog.textContent).not.toContain("not-a-pin");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("resolve-parcel"))).toHaveLength(1);
  });

  it("keeps the selected B dossier authoritative when an older A resolution returns late", async () => {
    const second = {
      ...candidate,
      key: "candidate-02",
      address: "3100 S HOMAN AVE",
      lat: 41.8361,
      lon: -87.7099,
    };
    let resolveFirst!: (value: Response) => void;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/shortlist/resolve-parcel?")) {
        const address = new URL(url, "http://localhost").searchParams.get("address");
        if (address === candidate.address) {
          return new Promise<Response>((resolve) => { resolveFirst = resolve; });
        }
        return new Response(JSON.stringify({
          status: "resolved",
          pin: "16264270410000",
          source: "cook_county_current_parcels",
          matchMethod: "exact_intersection",
          checkedAt: "2026-08-15T21:01:00.000Z",
        }), { status: 200 });
      }
      if (url === "/api/shortlist/enrich") {
        const body = JSON.parse(String(init?.body)) as { items: Array<{ key: string }> };
        return new Response(JSON.stringify({
          items: body.items.map((item) => item.key.length === 14 ? liveItem(item.key) : batchItem(item.key)),
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderResultRows([candidate, second]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const openers = screen.getAllByRole("button", { name: "Parcel details" });
    fireEvent.click(openers[0]);
    expect(screen.getByRole("dialog", { name: "3040 S HOMAN AVE" })).toBeTruthy();
    fireEvent.click(openers[1]);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "3100 S HOMAN AVE" }).textContent).toContain("$6,972"));

    resolveFirst(new Response(JSON.stringify({
      status: "resolved",
      pin: "16264270400000",
      source: "cook_county_current_parcels",
      matchMethod: "exact_intersection",
      checkedAt: "2026-08-15T21:02:00.000Z",
    }), { status: 200 }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("resolve-parcel"))).toHaveLength(2));
    expect(screen.getByRole("dialog", { name: "3100 S HOMAN AVE" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "3040 S HOMAN AVE" })).toBeNull();
  });

  it("preserves duplicate shortlist rows and reuses a checked parcel shared by their same PIN", async () => {
    const pin = "01234567890000";
    const rows = [
      { ...candidate, key: "duplicate-a", pin, address: "100 TEST ST" },
      { ...candidate, key: "duplicate-b", pin, address: "100 TEST ST" },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/shortlist/enrich") {
        const body = JSON.parse(String(init?.body)) as { items: Array<{ key: string }> };
        return new Response(JSON.stringify({
          items: body.items.map((item) => item.key === pin ? liveItem(item.key) : batchItem(item.key)),
        }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderResultRows(rows);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("map-keys").textContent).toBe("duplicate-a,duplicate-b");
    const openers = screen.getAllByRole("button", { name: "Parcel details" });
    expect(openers).toHaveLength(2);

    fireEvent.click(openers[0]);
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("$6,972"));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(openers[1]);
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("$6,972"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter(([, init]) => {
      if (!init?.body) return false;
      const body = JSON.parse(String(init.body)) as { items?: Array<{ key?: string }> };
      return body.items?.length === 1 && body.items[0].key === pin;
    })).toHaveLength(1);
  });
});
