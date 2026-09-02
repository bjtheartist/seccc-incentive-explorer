// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  PERMIT_EXHIBIT_ROW_CAP,
  buildPermitExhibit,
  polygonCentroid,
  type PermitExhibitResult,
} from "@/lib/permit-exhibit";
import type { Ring } from "@/lib/shortlist-parcel-identity-resolver";
import { MethodsFooter } from "../MethodsFooter";
import { PermitExhibitHeader } from "../PermitExhibitHeader";

/**
 * R2 finding 8 follow-up — the row-cap marker must reach the READER.
 *
 * `buildPermitExhibit` has always computed `meta.truncation` when either
 * permit query came back at its 20,000-row cap, and its own doc comment says
 * "every surface rendering it must say so". No surface did: a dense downtown
 * PIN at 1000 ft that hit the cap rendered with the same header, the same
 * counts and the same methods footer as a complete exhibit, and the reader was
 * told nothing. The existing request-bounds test only greps permit-exhibit.ts
 * for literal strings and type-checks the interface, so it passes whether or
 * not the marker is ever emitted or displayed.
 *
 * This suite closes that: it builds a REAL truncated exhibit through
 * `buildPermitExhibit` (mocked only at the sql/fetch boundary, per the
 * repo-wide convention) and asserts the rendered disclosure on the components
 * every exhibit surface uses.
 */

afterEach(() => {
  cleanup();
});

// A realistic 25ft x 125ft Chicago lot, same fixture geometry as
// lib/__tests__/permit-exhibit.test.ts.
const LOT_WEST = -87.63;
const LOT_EAST = -87.6299081;
const LOT_SOUTH = 41.73;
const LOT_NORTH = 41.7303423;
const PARCEL_RINGS: Ring[] = [
  [
    [LOT_WEST, LOT_SOUTH],
    [LOT_EAST, LOT_SOUTH],
    [LOT_EAST, LOT_NORTH],
    [LOT_WEST, LOT_NORTH],
    [LOT_WEST, LOT_SOUTH],
  ],
];
const PARCEL_BBOX: [number, number, number, number] = [LOT_WEST, LOT_SOUTH, LOT_EAST, LOT_NORTH];
const PARCEL_CENTROID = polygonCentroid(PARCEL_RINGS, PARCEL_BBOX);
const TEST_PIN = "20363230080000";

function fetchImpl(): typeof fetch {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("cookcountyil.gov")) {
      return {
        ok: true,
        json: async () => ({
          features: [
            {
              attributes: {
                street_address: "8525 S EUCLID AVE",
                city_state_zip: "CHICAGO, IL 60617",
              },
              geometry: { rings: PARCEL_RINGS },
            },
          ],
        }),
      } as unknown as Response;
    }
    if (url.includes("gisapps.chicago.gov")) {
      return {
        ok: true,
        json: async () => ({ features: [] }),
      } as unknown as Response;
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as unknown as typeof fetch;
}

function areaRowAtCentroid(index: number) {
  return {
    permit_id: `AREA-${index}`,
    permit_type: "PERMIT - RENOVATION/ALTERATION",
    address: "8525 S EUCLID AVE",
    issue_date: "2020-01-01",
    permit_status: "COMPLETE",
    permit_milestone: null,
    work_type: null,
    work_description: null,
    reported_cost: null,
    lat: PARCEL_CENTROID.lat,
    lon: PARCEL_CENTROID.lon,
    fetched_at: "2026-08-20T00:00:00.000Z",
    normalized_address: "8525seuclidave",
    located_via: "point",
  };
}

/**
 * Returns exactly `PERMIT_EXHIBIT_ROW_CAP` rows for the S2 (radius) query,
 * which is the only signal Postgres gives that more rows existed, and a
 * short, honestly-under-cap result for the S1 (subject) query — so the
 * exhibit is truncated on the AREA read only, the realistic dense-downtown
 * case the cap was added for. Routed by query text, never by call order.
 */
function sqlAtAreaCap() {
  const areaRows = Array.from({ length: PERMIT_EXHIBIT_ROW_CAP }, (_unused, index) =>
    areaRowAtCentroid(index),
  );
  return vi.fn(async (strings: TemplateStringsArray) => {
    if (strings.join("").includes("located_via")) return areaRows;
    return [areaRowAtCentroid(0)];
  });
}

/** Built once — 20,000 rows through the real pipeline is not free, and every
 *  test here wants the same exhibit. */
let truncatedExhibit: Promise<PermitExhibitResult> | null = null;

function buildTruncatedExhibit(): Promise<PermitExhibitResult> {
  truncatedExhibit ??= buildPermitExhibit({
    pin: TEST_PIN,
    radiusFt: 1000,
    sql: sqlAtAreaCap() as unknown as Parameters<typeof buildPermitExhibit>[0]["sql"],
    fetchImpl: fetchImpl(),
    now: () => new Date("2026-08-25T12:00:00.000Z"),
    readZoningArchiveVintageRange: async () => ({ earliest: null, latest: null, snapshotCount: 0 }),
  });
  return truncatedExhibit;
}

describe("a truncated exhibit discloses that it is incomplete", () => {
  it("buildPermitExhibit really does mark an at-cap area read as truncated", { timeout: 60_000 }, async () => {
    const exhibit = await buildTruncatedExhibit();
    expect(exhibit.meta.truncation).not.toBeNull();
    expect(exhibit.meta.truncation?.scope).toBe("area");
    expect(exhibit.meta.truncation?.rowCap).toBe(PERMIT_EXHIBIT_ROW_CAP);
  });

  it("the methods footer — rendered by every exhibit surface — shows the notice", async () => {
    const exhibit = await buildTruncatedExhibit();
    render(<MethodsFooter meta={exhibit.meta} coverage={exhibit.coverage} />);

    const notice = screen.getByTestId("permit-exhibit-truncation-notice");
    expect(notice.textContent).toContain(exhibit.meta.truncation!.notice);
    // The reader is told the counts on the page are a floor, not a total.
    expect(notice.textContent).toMatch(/floor, not a total/);
    expect(notice.textContent).toContain(PERMIT_EXHIBIT_ROW_CAP.toLocaleString("en-US"));
  });

  it("the on-screen header shows it above the fold, before any count", async () => {
    const exhibit = await buildTruncatedExhibit();
    render(<PermitExhibitHeader meta={exhibit.meta} radiusFt={1000} />);

    const notice = screen.getByTestId("permit-exhibit-truncation-notice");
    expect(notice.textContent).toContain(exhibit.meta.truncation!.notice);
    expect(notice.textContent).toMatch(/radius read/);
  });

  it("says nothing at all when the exhibit is genuinely complete", async () => {
    const exhibit = await buildTruncatedExhibit();
    const complete: PermitExhibitResult = {
      ...exhibit,
      meta: { ...exhibit.meta, truncation: null },
    };
    render(<MethodsFooter meta={complete.meta} coverage={complete.coverage} />);
    expect(screen.queryByTestId("permit-exhibit-truncation-notice")).toBeNull();
  });
});
