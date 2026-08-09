import { describe, expect, it } from "vitest";
import {
  ARTERIAL_RADIUS_MI,
  CATCHMENT_RADIUS_MI,
  LICENSE_RADIUS_MI,
  RAIL_RADIUS_MI,
  SITE_ACTIVITY_SOURCES,
  type SiteActivityContext,
} from "../site-activity";
import {
  SITE_ACTIVITY_MEASURE_ORDER,
  absenceStatement,
  arterialVintage,
  catchmentVintage,
  formatCount,
  licenseCategoryPhrase,
  licenseOtherCount,
  siteActivityCompactLines,
  sourceText,
} from "../site-activity-lines";

/**
 * The shared presentation layer for the site-activity block — the sentences the
 * report card and the compact vacancy card BOTH render. The rails under test
 * are the ones that make the block publishable next to reconciliation-gated
 * grant data: an absence is stated with its radius, a value never travels
 * without provenance, and nothing anywhere composes two feeds into one number.
 */

const RADII: SiteActivityContext["radii"] = {
  arterialMi: ARTERIAL_RADIUS_MI,
  railMi: RAIL_RADIUS_MI,
  catchmentMi: CATCHMENT_RADIUS_MI,
  licenseMi: LICENSE_RADIUS_MI,
};

function context(over: Partial<SiteActivityContext> = {}): SiteActivityContext {
  return {
    arterial: {
      roadName: "S COMMERCIAL AVE",
      aadt: 18500,
      aadtYear: "2025",
      stationId: "s1",
      distanceMi: 0.04,
    },
    rail: [
      {
        name: "87th",
        lines: ["Red"],
        avgWeekdayEntries: 3210.4,
        month: "2026-05",
        priorYearAvgWeekdayEntries: 2980,
        distanceMi: 0.21,
      },
    ],
    catchment: {
      population: 4712,
      jobs: 1180,
      blockGroups: 9,
      acsVintage: "ACS 2020-2024 5-year",
      lodesVintage: "LODES8 2023",
    },
    licenses: {
      total: 27,
      byCategory: [
        { category: "restaurant_cafe", count: 9 },
        { category: "retail_general", count: 7 },
        { category: "personal_services", count: 5 },
        { category: "grocery", count: 3 },
        { category: "gym_fitness", count: 1 },
        { category: "other", count: 2 },
      ],
    },
    radii: RADII,
    ...over,
  };
}

const EMPTY = context({ arterial: null, rail: [], catchment: null, licenses: null });

describe("absenceStatement", () => {
  it("states an absence WITH its disclosed radius, never as a zero", () => {
    expect(absenceStatement("arterial", RADII)).toBe(
      "No IDOT count station within 0.15 mi of this address.",
    );
    expect(absenceStatement("rail", RADII)).toBe(
      "No 'L' station within 0.5 mi of this address.",
    );
    expect(absenceStatement("catchment", RADII)).toBe(
      "No census block-group centroid within 0.5 mi.",
    );
    expect(absenceStatement("licenses", RADII)).toBe(
      "No active business license on record within 0.25 mi.",
    );
    for (const key of SITE_ACTIVITY_MEASURE_ORDER) {
      const statement = absenceStatement(key, RADII);
      // "No X within R mi" — a stated absence, never a counted zero.
      expect(statement).toMatch(/^No .+ within \d/);
      expect(statement).not.toMatch(/\b0 [a-z]/);
    }
  });

  it("swaps only the subject noun between the report and the vacancy card", () => {
    expect(absenceStatement("rail", RADII, "site")).toBe(
      "No 'L' station within 0.5 mi of this site.",
    );
    // Radius-only statements have no subject to swap — they must stay identical.
    expect(absenceStatement("catchment", RADII, "site")).toBe(
      absenceStatement("catchment", RADII, "address"),
    );
  });
});

describe("provenance text", () => {
  it("pairs the dataset label with the vintage the DATA carried", () => {
    expect(sourceText(SITE_ACTIVITY_SOURCES.aadt, "2025 count year")).toBe(
      "Illinois DOT traffic counts (AADT) · 2025 count year",
    );
  });

  it("falls back to the register's vintage only when the row carries none", () => {
    expect(sourceText(SITE_ACTIVITY_SOURCES.licenses)).toContain("2026-08 publication");
  });

  it("derives per-row vintages from the measure, not from the register", () => {
    const c = context();
    expect(arterialVintage(c.arterial!)).toBe("2025 count year");
    expect(catchmentVintage(c.catchment!)).toBe("ACS 2020-2024 5-year · LODES8 2023");
  });
});

describe("licence phrasing", () => {
  it("names the largest categories and keeps the remainder visible, not folded in", () => {
    const licenses = context().licenses!;
    expect(licenseCategoryPhrase(licenses)).toBe(
      "9 restaurants & cafes, 7 general retail, 5 personal services, 3 grocery",
    );
    expect(licenseOtherCount(licenses)).toBe(2);
  });

  it("reports no remainder when the data carried none", () => {
    expect(licenseOtherCount({ total: 1, byCategory: [{ category: "grocery", count: 1 }] })).toBeNull();
  });
});

describe("siteActivityCompactLines", () => {
  it("always returns all four measures, in the fixed order", () => {
    for (const ctx of [context(), EMPTY]) {
      expect(siteActivityCompactLines(ctx, SITE_ACTIVITY_SOURCES).map((l) => l.key)).toEqual([
        ...SITE_ACTIVITY_MEASURE_ORDER,
      ]);
    }
  });

  it("compresses each measure to a bold figure plus one qualifier", () => {
    const lines = siteActivityCompactLines(context(), SITE_ACTIVITY_SOURCES);
    const [arterial, rail, catchment, licenses] = lines;

    expect(arterial.figure).toBe("18,500 vehicles/day");
    expect(arterial.detail).toBe("on S COMMERCIAL AVE · station s1 · 0.04 mi away");

    expect(rail.figure).toBe("3,210 avg weekday entries");
    expect(rail.detail).toBe("at 87th (Red) · 0.21 mi away");

    expect(catchment.figure).toBe("4,712 residents · 1,180 jobs");
    expect(catchment.detail).toBe("across 9 census block groups by centroid");

    expect(licenses.figure).toBe("27 active licenses");
    expect(licenses.detail).toContain("9 restaurants & cafes");
    expect(licenses.detail).toContain("(+2 other licensed)");
  });

  it("ships a source line with every figure and none with an absence", () => {
    for (const line of siteActivityCompactLines(context(), SITE_ACTIVITY_SOURCES)) {
      expect(line.present).toBe(true);
      expect(line.source?.text).toBeTruthy();
      expect(line.source?.url).toMatch(/^https?:\/\//);
    }
    for (const line of siteActivityCompactLines(EMPTY, SITE_ACTIVITY_SOURCES)) {
      expect(line.present).toBe(false);
      expect(line.figure).toBeNull();
      expect(line.source).toBeNull();
    }
  });

  it("renders an empty context as four explicit absences, never as zeros", () => {
    const lines = siteActivityCompactLines(EMPTY, SITE_ACTIVITY_SOURCES, "site");
    expect(lines.map((l) => l.detail)).toEqual([
      "No IDOT count station within 0.15 mi of this site.",
      "No 'L' station within 0.5 mi of this site.",
      "No census block-group centroid within 0.5 mi.",
      "No active business license on record within 0.25 mi.",
    ]);
  });

  it("discloses the extra 'L' stations inside the walkshed rather than hiding them", () => {
    const c = context();
    const lines = siteActivityCompactLines(
      {
        ...c,
        rail: [
          c.rail[0],
          { ...c.rail[0], name: "79th", distanceMi: 0.44 },
          { ...c.rail[0], name: "69th", distanceMi: 0.49 },
        ],
      },
      SITE_ACTIVITY_SOURCES,
    );
    expect(lines[1].detail).toContain("+2 more stations within 0.5 mi");
  });

  it("names an unlisted line set without leaving empty parentheses", () => {
    const c = context();
    const lines = siteActivityCompactLines(
      { ...c, rail: [{ ...c.rail[0], lines: [] }] },
      SITE_ACTIVITY_SOURCES,
    );
    expect(lines[1].detail).not.toContain("()");
    expect(lines[1].detail).toBe("at 87th · 0.21 mi away");
  });

  it("explains a total made up entirely of uncategorized licenses", () => {
    const lines = siteActivityCompactLines(
      { ...context(), licenses: { total: 4, byCategory: [{ category: "other", count: 4 }] } },
      SITE_ACTIVITY_SOURCES,
    );
    expect(lines[3].figure).toBe("4 active licenses");
    expect(lines[3].detail).toBe("— 4 other licensed");
  });

  it("uses one block-group noun per count", () => {
    const singular = siteActivityCompactLines(
      { ...context(), catchment: { ...context().catchment!, blockGroups: 1 } },
      SITE_ACTIVITY_SOURCES,
    );
    expect(singular[2].detail).toBe("across 1 census block group by centroid");
  });

  it("never composes the feeds into a single activity figure", () => {
    const rendered = siteActivityCompactLines(context(), SITE_ACTIVITY_SOURCES)
      .map((l) => `${l.label} ${l.figure ?? ""} ${l.detail} ${l.source?.text ?? ""}`)
      .join("\n")
      .toLowerCase();
    for (const banned of [
      "foot traffic",
      "foot-traffic",
      "footfall",
      "visitors",
      "visits",
      "estimated",
      "projected",
      "activity score",
      "index of",
    ]) {
      expect(rendered).not.toContain(banned);
    }
  });
});

describe("formatCount", () => {
  it("groups thousands so a five-figure count cannot be misread", () => {
    expect(formatCount(18500)).toBe("18,500");
    expect(formatCount(0)).toBe("0");
  });
});
