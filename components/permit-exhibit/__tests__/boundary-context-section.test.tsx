// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  FIXTURE_PERMIT_EXHIBIT_MIXED,
  fixturePermitExhibitWithArchive,
  fixturePermitExhibitZoningNotFound,
} from "@/lib/permit-exhibit-fixtures";
import { BoundaryContextSection } from "../BoundaryContextSection";

afterEach(() => {
  cleanup();
});

/**
 * S3 pinning tests. The binding honest limit: no per-permit historical
 * boundary claim is ever rendered — only the spine's `limitNote`, verbatim.
 * Zoning status is rendered per its own distinct fact
 * (resolved/not_found/unavailable) rather than collapsed to one state.
 */
describe("BoundaryContextSection — S3", () => {
  it("renders the resolved zoning district", () => {
    render(<BoundaryContextSection boundaryContext={FIXTURE_PERMIT_EXHIBIT_MIXED.boundaryContext} />);
    expect(screen.getByText(`Zoning ${FIXTURE_PERMIT_EXHIBIT_MIXED.boundaryContext.zoningDistrict.zoneClass}`)).toBeTruthy();
  });

  it("renders the spine's exact honest-limit sentence verbatim", () => {
    render(<BoundaryContextSection boundaryContext={FIXTURE_PERMIT_EXHIBIT_MIXED.boundaryContext} />);
    expect(screen.getByText(FIXTURE_PERMIT_EXHIBIT_MIXED.boundaryContext.limitNote)).toBeTruthy();
  });

  it("distinguishes 'not_found' (City published nothing) from a generic zoning message — never collapsed to one state", () => {
    const notFound = fixturePermitExhibitZoningNotFound();
    render(<BoundaryContextSection boundaryContext={notFound.boundaryContext} />);
    expect(screen.getByText("No zoning district published at this point")).toBeTruthy();
    expect(screen.queryByText("Zoning lookup unavailable")).toBeNull();
  });

  it("distinguishes 'unavailable' (the live lookup itself failed) from 'not_found'", () => {
    const unavailable = {
      ...FIXTURE_PERMIT_EXHIBIT_MIXED.boundaryContext,
      zoningDistrict: {
        status: "unavailable" as const,
        zoneClass: null,
        recordUpdatedAt: null,
        sourceLabel: "City of Chicago zoning boundaries",
        sourceUrl: "https://example.com",
      },
    };
    render(<BoundaryContextSection boundaryContext={unavailable} />);
    expect(screen.getByText("Zoning lookup unavailable")).toBeTruthy();
    expect(screen.queryByText("No zoning district published at this point")).toBeNull();
  });

  it("renders the honest 'no archived snapshots yet' line when the archive index is empty", () => {
    render(<BoundaryContextSection boundaryContext={FIXTURE_PERMIT_EXHIBIT_MIXED.boundaryContext} />);
    expect(screen.getByText("No dated zoning-boundary snapshots are archived yet.")).toBeTruthy();
  });

  it("renders the archived vintage range once the archive has snapshots", () => {
    const withArchive = fixturePermitExhibitWithArchive();
    render(<BoundaryContextSection boundaryContext={withArchive.boundaryContext} />);
    expect(screen.getByText(/Dated zoning-boundary snapshots archived:/)).toBeTruthy();
    expect(screen.getByText(/\(12\)/)).toBeTruthy();
  });

  it("never renders a per-permit historical boundary claim", () => {
    const { container } = render(<BoundaryContextSection boundaryContext={FIXTURE_PERMIT_EXHIBIT_MIXED.boundaryContext} />);
    expect(container.textContent).not.toMatch(/at the time (it|the permit) was issued/i);
  });
});
