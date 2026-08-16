// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SiteMatchmakerResultsTable from "../SiteMatchmakerResultsTable";
import { ParcelDossierDialog } from "../SiteMatchmakerParcelDossier";
import { clearCandidateParcelEnrichmentCacheForTests } from "@/lib/site-matchmaker-parcel-client";
import type { VacancySitePoint } from "@/lib/vacancy-index";

const point: VacancySitePoint = {
  lat: 41.73,
  lon: -87.55,
  ownerType: "city_public",
  propertyType: "vacant_building",
  markerNumber: null,
  address: "8130 S CORNELL AVE",
  pin: "20363230080000",
  squareFeet: null,
  space: { lotAreaSqft: 3125, assessorBuildingSqft: 1800, assessorBuildingYear: 2024 },
  zoningClass: "B3-2",
  incentiveCount: 2,
  ownerConfidence: "pin_matched",
  clusterId: null,
  saleYear: null,
  violation: false,
  ownerStructure: "government",
  ownerGeography: "in_state",
  pinMatch: "inventory",
};

function enrichmentPayload() {
  return {
    items: [
      {
        key: "20363230080000",
        countyClass: "517",
        classGloss: "One-story commercial building",
        countyClassStatus: "available",
        lotAreaSqft: 3333,
        lotAreaStatus: "available",
        assessorBuildingSqft: 1900,
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
      },
    ],
  };
}

function mockFetch({ failEnrichment = false } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("site-matchmaker-context")) {
      return new Response(
        JSON.stringify({ version: 1, zip: "60617", generatedAt: "2026-08-15", rows: {}, sources: [] }),
        { status: 200 },
      );
    }
    if (url.includes("/api/parcel-space")) {
      return new Response(JSON.stringify({ status: "available", measurements: [] }), { status: 200 });
    }
    if (url.includes("/api/shortlist/enrich")) {
      return failEnrichment
        ? new Response(JSON.stringify({ error: "down" }), { status: 503 })
        : new Response(JSON.stringify(enrichmentPayload()), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

beforeEach(() => {
  clearCandidateParcelEnrichmentCacheForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Site Matchmaker parcel dossier", () => {
  it("loads one clicked PIN, renders parity facts/Google Maps/three official links, closes on Escape, and restores focus", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SiteMatchmakerResultsTable
        sitePoints={[point]}
        zip="60617"
        neighborhood="South Chicago"
        buildId="build-a"
      />,
    );

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/shortlist/enrich"))).toHaveLength(0);
    const opener = screen.getAllByRole("button", { name: "Parcel details" })[0];
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "8130 S CORNELL AVE" });
    expect(dialog.textContent).toContain("3,125 sq ft");
    expect(dialog.textContent).toContain("Government");
    await waitFor(() => expect(dialog.textContent).toContain("$6,900"));
    expect(dialog.textContent).toContain("3,333 sq ft");
    expect(dialog.textContent).toContain("1,900 sq ft");
    expect(dialog.textContent).toContain("Tax year 2025 · board total");
    expect(screen.getByRole("link", { name: /Open this location in Google Maps/ }).getAttribute("href")).toContain(
      "query=8130+S+CORNELL+AVE%2C+Chicago%2C+IL+60617",
    );
    expect(screen.getByRole("link", { name: /CookViewer parcel details/ }).getAttribute("href")).toBe(
      "https://maps.cookcountyil.gov/cookviewer/?pin14=20363230080000",
    );
    expect(screen.getByRole("link", { name: /Assessor property record/ }).getAttribute("href")).toBe(
      "https://www.cookcountyassessoril.gov/pin/20363230080000",
    );
    expect(screen.getByRole("link", { name: /Clerk recorded documents/ }).getAttribute("href")).toBe(
      "https://crs.cookcountyclerkil.gov/Search/ResultByPin?id1=20363230080000",
    );
    const closeButton = screen.getByRole("button", { name: "Close parcel details" });
    const clerkLink = screen.getByRole("link", { name: /Clerk recorded documents/ });
    expect(document.activeElement).toBe(closeButton);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(clerkLink);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/shortlist/enrich"))).toHaveLength(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(opener);
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("$6,900"));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/shortlist/enrich"))).toHaveLength(1);
  });

  it("keeps static facts and record links available when the County enrichment request fails", async () => {
    vi.stubGlobal("fetch", mockFetch({ failEnrichment: true }));
    render(
      <SiteMatchmakerResultsTable
        sitePoints={[point]}
        zip="60617"
        neighborhood="South Chicago"
        buildId="build-failure"
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Parcel details" })[0]);
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("temporarily unavailable"));
    expect(dialog.textContent).toContain("3,125 sq ft");
    expect(screen.getByRole("link", { name: /Assessor property record/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Retry County details" })).not.toBeNull();
  });

  it.each([
    [
      {
        status: "no_match",
        reason: "no_intersection",
        checkedAt: "2026-08-15T20:00:00.000Z",
        source: "cook_county_current_parcels",
        matchMethod: "exact_intersection",
      } as const,
      "no exact address-matched County parcel was confirmed",
    ],
    [
      {
        status: "ambiguous",
        candidateCount: 2,
        checkedAt: "2026-08-15T20:00:00.000Z",
        source: "cook_county_current_parcels",
        matchMethod: "exact_intersection",
      } as const,
      "2 County parcel records intersect this map point",
    ],
    [{ status: "unavailable" } as const, "exact County parcel lookup is temporarily unavailable"],
    [{ status: "malformed" } as const, "County parcel lookup returned an unusable response"],
  ])("keeps each parcel-identity failure state distinct: %s", (resolution, expectedCopy) => {
    render(
      <ParcelDossierDialog
        row={{
          address: "3040 S HOMAN AVE",
          pin: null,
          lat: 41.83776,
          lon: -87.70998,
          space: {},
          ownerSector: "unclassified",
          ownerStructure: "unresolved",
        }}
        zip="60623"
        resolution={resolution}
        enrichment={{ status: "not_requested" }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onRetryResolution={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(expectedCopy);
    expect(screen.getByRole("link", { name: /Open this location in Google Maps/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /CookViewer parcel details/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry parcel lookup" })).toBeTruthy();
  });

  it("dates an exact map-point match in the header, and never dates a saved-snapshot PIN", () => {
    // A precomputed exact match may have been checked days before this page
    // load, so the header says WHEN. A snapshot PIN has no check date to
    // report and must not borrow one.
    const row = {
      address: "3040 S HOMAN AVE",
      pin: "16264270400000",
      lat: 41.83776,
      lon: -87.70998,
      space: {},
      ownerSector: "unclassified" as const,
      ownerStructure: "unresolved" as const,
    };
    const { unmount } = render(
      <ParcelDossierDialog
        row={row}
        zip="60623"
        resolution={{
          status: "resolved",
          pin: "16264270400000",
          pinSource: "coordinate_exact",
          source: "cook_county_current_parcels",
          matchMethod: "exact_intersection",
          checkedAt: "2026-08-16T03:58:31.254Z",
        }}
        enrichment={{ status: "not_requested" }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const exactText = screen.getByRole("dialog").textContent ?? "";
    expect(exactText).toContain("current County parcel resolved by exact map-point intersection");
    expect(exactText).toContain("checked Aug 15, 2026");
    expect(exactText).not.toContain("published in the saved shortlist snapshot");
    unmount();

    render(
      <ParcelDossierDialog
        row={row}
        zip="60623"
        resolution={{
          status: "resolved",
          pin: "16264270400000",
          pinSource: "saved_snapshot",
          source: "saved_shortlist_snapshot",
          matchMethod: "published_pin",
          checkedAt: null,
        }}
        enrichment={{ status: "not_requested" }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const savedText = screen.getByRole("dialog").textContent ?? "";
    expect(savedText).toContain("published in the saved shortlist snapshot");
    expect(savedText).not.toContain("checked ");
  });

  it("dates a County fact served from the precomputed snapshot instead of calling it 'current'", () => {
    // "Current County record" is a claim about freshness. A fact read from
    // the committed snapshot may be hours or days old, so it names the day
    // it was actually read; a live lookup keeps today's wording.
    const row = {
      address: "8130 S CORNELL AVE",
      pin: "20363230080000",
      lat: 41.73,
      lon: -87.55,
      space: { lotAreaSqft: 3125, assessorBuildingSqft: 1800, assessorBuildingYear: 2024 },
      ownerSector: "public" as const,
      ownerStructure: "government" as const,
    };
    const facts = {
      countyClass: "517",
      classGloss: "One-story commercial building",
      countyClassStatus: "available" as const,
      lotAreaSqft: 3333,
      lotAreaStatus: "available" as const,
      assessorBuildingSqft: 1900,
      assessorBuildingYear: "2025",
      assessorBuildingAreaStatus: "available" as const,
      assessedValue: 6900,
      assessedYear: "2025",
      assessedStage: "board" as const,
      assessedValueStatus: "available" as const,
      impliedMarketValue: 27_600,
      activeLicenses: [],
      activeLicenseStatus: "not_requested" as const,
    };

    const { unmount } = render(
      <ParcelDossierDialog
        row={row}
        zip="60617"
        enrichment={{
          status: "checked",
          facts: {
            ...facts,
            countyFactsSource: "precomputed_snapshot",
            countyFactsCheckedAt: "2026-08-16T04:02:47.077Z",
          },
          sourceUnavailable: false,
        }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const snapshotText = screen.getByRole("dialog").textContent ?? "";
    expect(snapshotText).toContain("3,333 sq ft · County record · checked Aug 15, 2026");
    expect(snapshotText).toContain("1,900 sq ft · County record · checked Aug 15, 2026");
    expect(snapshotText).toContain("2025 · County record · checked Aug 15, 2026");
    expect(snapshotText).not.toContain("current County record");
    unmount();

    render(
      <ParcelDossierDialog
        row={row}
        zip="60617"
        enrichment={{
          status: "checked",
          facts: { ...facts, countyFactsSource: "live_county", countyFactsCheckedAt: "2026-08-16T04:02:47.077Z" },
          sourceUnavailable: false,
        }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const liveText = screen.getByRole("dialog").textContent ?? "";
    expect(liveText).toContain("3,333 sq ft · current County record");
    expect(liveText).not.toContain("checked Aug 15, 2026");
  });

  it("dates a precomputed fact in the RESULTS TABLE cell too, once enrichment lands", async () => {
    // The map page sends its own buildId today, so the enrich route always
    // answers this table live. That is a caller-side accident, not a
    // guarantee — if a caller ever sends the universe buildId the route
    // answers from the snapshot, and this surface must already say so.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("site-matchmaker-context")) {
        return new Response(
          JSON.stringify({ version: 1, zip: "60617", generatedAt: "2026-08-15", rows: {}, sources: [] }),
          { status: 200 },
        );
      }
      if (url.includes("/api/parcel-space")) {
        return new Response(JSON.stringify({ status: "available", measurements: [] }), { status: 200 });
      }
      if (url.includes("/api/shortlist/enrich")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                key: "20363230080000",
                countyClass: null,
                classGloss: null,
                countyClassStatus: "not_published",
                lotAreaSqft: null,
                lotAreaStatus: "not_published",
                assessorBuildingSqft: null,
                assessorBuildingYear: null,
                assessorBuildingAreaStatus: "not_published",
                assessedValue: null,
                assessedYear: null,
                assessedStage: null,
                assessedValueStatus: "not_published",
                impliedMarketValue: null,
                activeLicenses: [],
                activeLicenseStatus: "not_requested",
                countyFactsSource: "precomputed_snapshot",
                countyFactsCheckedAt: "2026-08-16T04:02:47.077Z",
                enrichmentUnavailable: false,
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SiteMatchmakerResultsTable
        sitePoints={[point]}
        zip="60617"
        neighborhood="South Chicago"
        buildId="build-precomputed-table"
      />,
    );

    // Enrichment reaches the table's own cells only after a row is opened.
    const opener = screen.getAllByRole("button", { name: "Parcel details" })[0];
    fireEvent.click(opener);
    await waitFor(() =>
      expect(screen.getByRole("dialog").textContent).toContain("County record (checked Aug 15, 2026)"),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // With the dialog gone, this text can only be the table cell itself.
    expect(document.body.textContent).toContain(
      "saved snapshot; County record (checked Aug 15, 2026) did not publish an area",
    );
    expect(document.body.textContent).not.toContain("current record did not publish an area");
  });

  it("names the dated snapshot — not 'the current record' — as what did not publish an area", () => {
    // `not_published` is the one NEGATIVE state a snapshot read can produce
    // (a snapshot read is never "unavailable"), so it is the other place
    // "current" would assert a freshness nobody checked today.
    const facts = {
      countyClass: null,
      classGloss: null,
      countyClassStatus: "not_published" as const,
      lotAreaSqft: null,
      lotAreaStatus: "not_published" as const,
      assessorBuildingSqft: null,
      assessorBuildingYear: null,
      assessorBuildingAreaStatus: "not_published" as const,
      assessedValue: null,
      assessedYear: null,
      assessedStage: null,
      assessedValueStatus: "not_published" as const,
      impliedMarketValue: null,
      activeLicenses: [],
      activeLicenseStatus: "not_requested" as const,
    };
    const row = {
      address: "8130 S CORNELL AVE",
      pin: "20363230080000",
      lat: 41.73,
      lon: -87.55,
      space: { lotAreaSqft: 3125, assessorBuildingSqft: 1800, assessorBuildingYear: 2024 },
      ownerSector: "public" as const,
      ownerStructure: "government" as const,
    };

    const { unmount } = render(
      <ParcelDossierDialog
        row={row}
        zip="60617"
        enrichment={{
          status: "checked",
          facts: {
            ...facts,
            countyFactsSource: "precomputed_snapshot",
            countyFactsCheckedAt: "2026-08-16T04:02:47.077Z",
          },
          sourceUnavailable: false,
        }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const snapshotText = screen.getByRole("dialog").textContent ?? "";
    expect(snapshotText).toContain(
      "3,125 sq ft · saved snapshot; County record (checked Aug 15, 2026) did not publish an area",
    );
    expect(snapshotText).toContain(
      "2024 · saved snapshot; County record (checked Aug 15, 2026) did not publish a building year",
    );
    expect(snapshotText).not.toContain("current record did not publish");
    unmount();

    render(
      <ParcelDossierDialog
        row={row}
        zip="60617"
        enrichment={{
          status: "checked",
          facts: { ...facts, countyFactsSource: "live_county", countyFactsCheckedAt: null },
          sourceUnavailable: false,
        }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const liveText = screen.getByRole("dialog").textContent ?? "";
    // Live copy is unchanged, to the byte.
    expect(liveText).toContain("3,125 sq ft · saved snapshot; current record did not publish an area");
    expect(liveText).toContain("2024 · saved snapshot; current record did not publish a building year");
  });

  it("does not offer a retry loop when the record has no usable Chicago map point", () => {
    render(
      <ParcelDossierDialog
        row={{
          address: "Address not published",
          pin: null,
          lat: 999,
          lon: 999,
          space: {},
          ownerSector: "unclassified",
          ownerStructure: "unresolved",
        }}
        zip="60623"
        resolution={{ status: "no_match", reason: "invalid_location", checkedAt: null }}
        enrichment={{ status: "not_requested" }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onRetryResolution={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("no usable Chicago map point");
    expect(screen.queryByRole("button", { name: "Retry parcel lookup" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Google Maps/ })).toBeNull();
  });

  it.each([
    [
      { status: "not_checked" } as const,
      [
        "3,125 sq ft · saved snapshot; current record not checked",
        "1,800 sq ft · saved snapshot; current record not checked",
        "2024 · saved snapshot; current record not checked",
        "County property classNot checked",
        "County assessment has not been checked",
      ],
    ],
    [
      { status: "not_requested" } as const,
      [
        "3,125 sq ft · saved snapshot; current check not requested — confirmed PIN required",
        "1,800 sq ft · saved snapshot; current check not requested — confirmed PIN required",
        "2024 · saved snapshot; current check not requested — confirmed PIN required",
        "County property classNot requested — confirmed PIN required",
        "A confirmed 14-digit PIN is required",
      ],
    ],
    [
      { status: "unavailable" } as const,
      [
        "3,125 sq ft · saved snapshot; current check unavailable",
        "1,800 sq ft · saved snapshot; current check unavailable",
        "2024 · saved snapshot; current check unavailable",
        "County property classUnavailable",
        "County assessment data is temporarily unavailable",
      ],
    ],
  ])("keeps snapshot facts distinct from the current County check state: %s", (enrichment, expectedCopy) => {
    render(
      <ParcelDossierDialog
        row={{
          address: "8130 S CORNELL AVE",
          pin: "20363230080000",
          lat: 41.73,
          lon: -87.55,
          space: { lotAreaSqft: 3125, assessorBuildingSqft: 1800, assessorBuildingYear: 2024 },
          ownerSector: "public",
          ownerStructure: "government",
        }}
        zip="60617"
        resolution={{
          status: "resolved",
          pin: "20363230080000",
          pinSource: "saved_snapshot",
          source: "saved_shortlist_snapshot",
          matchMethod: "published_pin",
          checkedAt: null,
        }}
        enrichment={enrichment}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const text = screen.getByRole("dialog").textContent ?? "";
    for (const copy of expectedCopy) expect(text).toContain(copy);
  });

  it("distinguishes a completed County check that did not publish fields", () => {
    render(
      <ParcelDossierDialog
        row={{
          address: "3040 S HOMAN AVE",
          pin: "16264270400000",
          lat: 41.83776,
          lon: -87.70998,
          space: {},
          ownerSector: "private",
          ownerStructure: "entity",
        }}
        zip="60623"
        resolution={{
          status: "resolved",
          pin: "16264270400000",
          pinSource: "saved_snapshot",
          source: "saved_shortlist_snapshot",
          matchMethod: "published_pin",
          checkedAt: null,
        }}
        enrichment={{
          status: "checked",
          sourceUnavailable: false,
          facts: {
            countyClass: null,
            classGloss: null,
            countyClassStatus: "not_published",
            lotAreaSqft: null,
            lotAreaStatus: "not_published",
            assessorBuildingSqft: null,
            assessorBuildingYear: null,
            assessorBuildingAreaStatus: "not_published",
            assessedValue: null,
            assessedYear: null,
            assessedStage: null,
            assessedValueStatus: "not_published",
            impliedMarketValue: null,
            activeLicenses: [],
            activeLicenseStatus: "not_found",
          },
        }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toContain("Lot areaNot published");
    expect(text).toContain("Assessor building areaNot published");
    expect(text).toContain("Assessor building tax yearNot published");
    expect(text).toContain("County property classNot published");
  });
});
