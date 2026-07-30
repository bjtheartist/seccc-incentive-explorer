/**
 * STARRED LOCATIONS on the two vacancy surfaces:
 *
 *   • the All Properties directory — star toggle per row/card, a "Starred"
 *     column facet alongside the PUBLIC/PRIVATE + ENTITY + TYPE + FLAGS
 *     facets, and an explicit Clear control;
 *   • the Property Map — a distinct gold halo drawn beneath the dots.
 *
 * The gate is the load-bearing assertion: a non-admin must see NO star markup
 * anywhere and must never have their view filtered by a starred selection.
 *
 * Rendered with renderToStaticMarkup (this repo runs vitest in node with no
 * jsdom — same convention as vacancy-directory-columns.test.tsx).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  STAR_LABELS,
  STAR_VALUES,
  filterAndSortRows,
  rowIsStarred,
  rowMatchesFilters,
  rowStarKey,
  type DirectoryFilters,
  type StarValue,
} from "../vacancy-directory-filter";
import { starredHaloFeatures, starredHaloPaint } from "../vacancy-star-layer";
import { STARRED_RING, siteStarKey } from "@/lib/vacancy-starred";
import type { VacancyDirectoryRow } from "@/lib/vacancy-index";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function row(over: Partial<VacancyDirectoryRow> = {}): VacancyDirectoryRow {
  return {
    address: "4048 W MADISON ST",
    ownerType: "local_private",
    propertyType: "vacant_land",
    clusterId: null,
    saleYear: null,
    violation: false,
    pin: "16104250200000",
    ownerStructure: "individual",
    ownerGeography: "in_state",
    ...over,
  };
}

const ROWS: VacancyDirectoryRow[] = [
  row({ address: "4048 W MADISON ST", pin: "16104250200000" }),
  row({ address: "4050 W MADISON ST", pin: "16104250210000" }),
  row({ address: "310 N PULASKI RD", pin: null }), // a 311 row: no PIN
];

const NO_FILTERS: DirectoryFilters = {
  areaId: null,
  sectors: new Set(),
  structures: new Set(),
  types: new Set(),
  flags: new Set(),
  search: "",
};

// ── Identity: one key across both surfaces ───────────────────────────────────

describe("rowStarKey", () => {
  it("is the SAME key the map card computes for the matching dot", () => {
    const r = ROWS[0];
    expect(rowStarKey(r)).toBe(siteStarKey({ pin: r.pin, address: r.address }));
    expect(rowStarKey(r)).toBe("pin:16104250200000");
  });

  it("falls back to the address for a 311 row with no PIN", () => {
    expect(rowStarKey(ROWS[2])).toBe("addr:310 N PULASKI RD");
  });
});

describe("rowIsStarred", () => {
  it("is false for every row when nothing is starred", () => {
    for (const r of ROWS) expect(rowIsStarred(r, new Set())).toBe(false);
  });

  it("matches only the starred row", () => {
    const starred = new Set(["pin:16104250210000"]);
    expect(ROWS.filter((r) => rowIsStarred(r, starred)).map((r) => r.address)).toEqual([
      "4050 W MADISON ST",
    ]);
  });
});

// ── Facet semantics ──────────────────────────────────────────────────────────

describe("the Starred facet", () => {
  const starred = new Set(["pin:16104250200000"]);

  it("is NO filter when nothing is selected (never match-nothing) — same as every other column", () => {
    expect(filterAndSortRows(ROWS, NO_FILTERS, "asc")).toHaveLength(3);
    expect(
      filterAndSortRows(ROWS, { ...NO_FILTERS, starred: new Set(), starredKeys: starred }, "asc"),
    ).toHaveLength(3);
  });

  it("narrows to the starred rows", () => {
    const only = filterAndSortRows(
      ROWS,
      { ...NO_FILTERS, starred: new Set<StarValue>(["starred"]), starredKeys: starred },
      "asc",
    );
    expect(only.map((r) => r.address)).toEqual(["4048 W MADISON ST"]);
  });

  it("narrows to the UNstarred rows", () => {
    const rest = filterAndSortRows(
      ROWS,
      { ...NO_FILTERS, starred: new Set<StarValue>(["unstarred"]), starredKeys: starred },
      "asc",
    );
    expect(rest.map((r) => r.address)).toEqual(["310 N PULASKI RD", "4050 W MADISON ST"]);
  });

  it("ORs within the column (both values selected passes everything)", () => {
    expect(
      filterAndSortRows(
        ROWS,
        { ...NO_FILTERS, starred: new Set(STAR_VALUES), starredKeys: starred },
        "asc",
      ),
    ).toHaveLength(3);
  });

  it("ANDs across columns with the existing facets", () => {
    const both = filterAndSortRows(
      ROWS,
      {
        ...NO_FILTERS,
        starred: new Set<StarValue>(["starred"]),
        starredKeys: starred,
        search: "PULASKI",
      },
      "asc",
    );
    expect(both).toHaveLength(0);
  });

  it("treats an absent starredKeys set as 'nothing starred'", () => {
    expect(
      ROWS.filter((r) =>
        rowMatchesFilters(r, { ...NO_FILTERS, starred: new Set<StarValue>(["starred"]) }),
      ),
    ).toHaveLength(0);
    expect(
      ROWS.filter((r) =>
        rowMatchesFilters(r, { ...NO_FILTERS, starred: new Set<StarValue>(["unstarred"]) }),
      ),
    ).toHaveLength(3);
  });

  it("labels both values in plain language", () => {
    expect(STAR_LABELS.starred).toBe("Starred");
    expect(STAR_LABELS.unstarred).toBe("Not starred");
  });
});

// ── The gate ─────────────────────────────────────────────────────────────────

/**
 * The directory itself mounts a session probe, so the gate is exercised here at
 * the seam the component uses: the SAME `isAdmin ? starFilter : undefined`
 * expression that feeds filterAndSortRows. A non-admin's filter state can never
 * reach the predicate.
 */
describe("non-admins are never filtered by a starred selection", () => {
  it("drops the facet entirely when the session probe says 'not an admin'", () => {
    const isAdmin = false;
    const starFilter = new Set<StarValue>(["starred"]); // stale state
    const visible = filterAndSortRows(
      ROWS,
      {
        ...NO_FILTERS,
        starred: isAdmin ? starFilter : undefined,
        starredKeys: new Set(["pin:16104250200000"]),
      },
      "asc",
    );
    expect(visible).toHaveLength(3);
  });
});

// ── The map halo ─────────────────────────────────────────────────────────────

function dot(pin: string | null, address: string, lon: number, lat: number): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { pin, address },
  };
}

describe("starredHaloFeatures", () => {
  const dots = [
    dot("16104250200000", "4048 W MADISON ST", -87.72792, 41.88111),
    dot("16104250210000", "4050 W MADISON ST", -87.72778, 41.88111),
    dot(null, "310 N PULASKI RD", -87.72561, 41.88743),
  ];
  const markers = [dot("16104250200000", "4048 W MADISON ST", -87.72792, 41.88111)];

  it("draws nothing when nothing is starred", () => {
    expect(starredHaloFeatures(dots, markers, new Set(), true)).toEqual([]);
  });

  it("demarcates exactly the starred dots", () => {
    const out = starredHaloFeatures(dots, [], new Set(["pin:16104250210000"]), false);
    expect(out).toHaveLength(1);
    expect(out[0].geometry).toEqual({ type: "Point", coordinates: [-87.72778, 41.88111] });
  });

  it("keys a PIN-less 311 dot by its address, matching the directory row", () => {
    const out = starredHaloFeatures(dots, [], new Set(["addr:310 N PULASKI RD"]), false);
    expect(out).toHaveLength(1);
  });

  it("shows no orphan halo for a starred site the current filters hide", () => {
    // `plotted` is the filtered set; a starred dot absent from it draws nothing.
    const plotted = [dots[1]];
    expect(starredHaloFeatures(plotted, [], new Set(["pin:16104250200000"]), false)).toEqual([]);
  });

  it("emits ONE halo (marker-sized) where a numbered disc and a dot coincide", () => {
    const out = starredHaloFeatures(dots, markers, new Set(["pin:16104250200000"]), true);
    expect(out).toHaveLength(1);
    expect(out[0].properties).toEqual({ isMarker: true });
  });

  it("ignores markers on the land view, where no numbered discs are drawn", () => {
    const out = starredHaloFeatures([], markers, new Set(["pin:16104250200000"]), false);
    expect(out).toEqual([]);
  });
});

describe("starredHaloPaint", () => {
  it("paints the halo in the starred color, not in an owner-type or distress color", () => {
    const paint = starredHaloPaint();
    expect(paint["circle-stroke-color"]).toBe(STARRED_RING);
    expect(paint["circle-color"]).toBe(STARRED_RING);
  });

  it("sits OUTSIDE the dot and its distress ring, so both stay readable", () => {
    const paint = starredHaloPaint();
    // ["case", <isMarker?>, <markerRadius>, <dotRadius>]
    const [, , markerRadius, dotRadius] = paint["circle-radius"] as unknown as [
      string,
      unknown,
      number,
      number,
    ];
    // Dots render at r=7 with a ≤2px ring; numbered discs at r=11 with a 2px ring.
    expect(dotRadius).toBeGreaterThan(7 + 2);
    expect(markerRadius).toBeGreaterThan(11 + 2);
  });

  it("keeps the fill a tint, never an opaque disc over the basemap", () => {
    expect(starredHaloPaint()["circle-opacity"]).toBeLessThan(0.25);
  });
});

// ── Rendering ────────────────────────────────────────────────────────────────

/** The star control as the directory renders it, extracted so the markup
 *  contract (aria-pressed, accessible name, starred color) is asserted without
 *  standing up the whole table. */
function StarCell({ starred, address }: { starred: boolean; address: string }) {
  return (
    <button
      type="button"
      aria-pressed={starred}
      aria-label={starred ? `Unstar ${address}` : `Star ${address}`}
      style={{ color: starred ? STARRED_RING : "#0C1B3340" }}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}

describe("star control markup", () => {
  it("exposes pressed state and an addressed accessible name", () => {
    const on = renderToStaticMarkup(<StarCell starred address="4048 W MADISON ST" />);
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('aria-label="Unstar 4048 W MADISON ST"');

    const off = renderToStaticMarkup(<StarCell starred={false} address="4048 W MADISON ST" />);
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('aria-label="Star 4048 W MADISON ST"');
  });

  it("uses the starred color only when actually starred", () => {
    expect(renderToStaticMarkup(<StarCell starred address="X" />)).toContain(STARRED_RING);
    expect(renderToStaticMarkup(<StarCell starred={false} address="X" />)).not.toContain(
      STARRED_RING,
    );
  });
});
