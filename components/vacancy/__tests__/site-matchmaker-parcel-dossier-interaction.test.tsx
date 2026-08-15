// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SiteMatchmakerResultsTable from "../SiteMatchmakerResultsTable";
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
  it("loads one clicked PIN, renders parity facts/three official links, closes on Escape, and restores focus", async () => {
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
    expect(screen.getByRole("button", { name: "Retry County check" })).not.toBeNull();
  });
});
