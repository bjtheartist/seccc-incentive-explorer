import { describe, expect, it } from "vitest";
import {
  ACTIVITY_BADGE_ATTR,
  ACTIVITY_SLOT_ATTR,
  CARD_SCROLLER_ATTR,
  PARCEL_ENRICHMENT_SLOT_ATTR,
  PARCEL_ENRICHMENT_RETRY_ATTR,
  STAR_BUTTON_ATTR,
  ZONE_BADGE_ATTR,
  ZONE_SLOT_ATTR,
  activityBadgeText,
  buildSiteCardHtml,
  cautionLine,
  programsAndZonesRows,
  parcelEnrichmentHtml,
  significanceSentence,
  siteActivityHtml,
  zoneBadgeText,
  type CardData,
} from "../vacancy-site-card";
import { STARRED_RING } from "@/lib/vacancy-starred";
import type { SiteZoneMatch } from "@/lib/vacancy-site-zones";
import type { SiteActivityState } from "@/lib/site-activity-client";
import { SITE_ACTIVITY_SOURCES, type SiteActivityContext } from "@/lib/site-activity";
import type { VacancyCluster } from "@/lib/vacancy-index";

function cluster(count: number): VacancyCluster {
  return {
    id: 3,
    centroid: { lat: 41.74, lon: -87.54 },
    bbox: [-87.55, 41.73, -87.53, 41.75],
    count,
    ownerTypeCounts: [],
    taxSaleCount: 0,
    violationCount: 0,
    vacantLandCount: count,
    vacantBuildingCount: 0,
    corridorName: "Commercial Avenue",
  };
}

function card(over: Partial<CardData>): CardData {
  return {
    isLand: false,
    markerNumber: null,
    address: over.address ?? "8131 S EXCHANGE AVE",
    ownerType: over.ownerType ?? "city_public",
    propertyType: over.propertyType ?? "vacant_land",
    pin: over.pin ?? "21322110390000",
    squareFeet: over.squareFeet ?? 6234,
    zoningClass: over.zoningClass ?? "C1-1",
    incentiveCount: over.incentiveCount ?? 3,
    ownerConfidence: over.ownerConfidence ?? "pin_matched",
    ownerStructure: over.ownerStructure ?? "entity",
    ownerGeography: over.ownerGeography ?? "in_state",
    clusterId: over.clusterId ?? 3,
    saleYear: over.saleYear ?? null,
    violation: over.violation ?? false,
    cluster: over.cluster ?? cluster(over.clusterId != null ? 12 : 12),
    neighborhood: over.neighborhood ?? "South Chicago",
    ...over,
  };
}

describe("significanceSentence", () => {
  it("is exactly one sentence (one terminal period, no interior sentence break)", () => {
    const s = significanceSentence(card({ cluster: cluster(12) }));
    expect(s.endsWith(".")).toBe(true);
    // No interior ". " (would signal a second sentence).
    expect(s.slice(0, -1)).not.toMatch(/\.\s/);
    expect((s.match(/[.!?]/g) ?? []).length).toBe(1);
  });

  it("leads with land use and approximate size, never an owner phrase", () => {
    const s = significanceSentence(card({ zoningClass: "C1-1", squareFeet: 6234, cluster: cluster(3) }));
    expect(s).toMatch(/^Commercial parcel/);
    expect(s).toMatch(/about 6,200 sq ft/);
    expect(s.toLowerCase()).not.toContain("ideal for");
    expect(s.toLowerCase()).not.toContain("available");
  });
});

describe("cautionLine", () => {
  it("returns null when there is no consequential condition (no positive empty state)", () => {
    expect(cautionLine(card({ saleYear: null, violation: false }))).toBeNull();
  });
  it("surfaces the tax-sale record first", () => {
    expect(cautionLine(card({ saleYear: 2015, violation: true }))).toMatch(
      /tax-sale record on file \(latest 2015\) — verify current tax and title status/i,
    );
  });
  it("surfaces a building violation when there is no tax sale", () => {
    expect(cautionLine(card({ saleYear: null, violation: true }))).toMatch(/building-violation/i);
  });
});

describe("buildSiteCardHtml", () => {
  it("leads with the address and the property-type + approximate-size line", () => {
    const html = buildSiteCardHtml(card({ address: "8131 S EXCHANGE AVE", squareFeet: 6234 }), "60617", "July 22, 2026");
    expect(html).toContain("8131 S EXCHANGE AVE");
    expect(html).toContain("Vacant land · about 6,200 sq ft");
  });

  it("renders at most one caution line", () => {
    const html = buildSiteCardHtml(card({ saleYear: 2015, violation: true }), "60617", null);
    const cautions = html.match(/Needs checking/g) ?? [];
    expect(cautions.length).toBe(1);
  });

  it("puts the PIN behind the Site facts accordion", () => {
    const html = buildSiteCardHtml(card({ pin: "21322110390000" }), "60617", null);
    expect(html).toContain("<details");
    expect(html).toContain("Site facts");
    expect(html).toContain("21322110390000");
  });

  it("keeps all four source-separated space facts in the standard pin dossier", () => {
    const html = buildSiteCardHtml(
      card({
        space: {
          lotAreaSqft: 12027,
          assessorBuildingSqft: 5000,
          assessorBuildingYear: 2024,
          cityGroundFootprintSqft: 2500,
          cityGroundFootprintVintage: "Current as of August 2015",
          availableSpaceSqft: 2000,
          availableSpaceSource: "Owner confirmation",
          availableSpaceVerifiedAt: "2026-08-01T00:00:00.000Z",
          availableSpaceReconfirmAfter: "2026-09-01T00:00:00.000Z",
        },
      }),
      "60617",
      null,
    );

    expect(html).toContain("Lot area: 12,027 sq ft");
    expect(html).toContain("Assessor building area: 5,000 sq ft");
    expect(html).toContain("Mapped building footprint on parcel: 2,500 sq ft");
    expect(html).toContain("Reported available space: 2,000 sq ft");
    expect(html).toContain("Current as of August 2015");
    expect(html).toContain("confirm current availability");
  });

  it("maps unknown ownership to 'Not yet classified' and never shows 'Unknown'", () => {
    const html = buildSiteCardHtml(card({ ownerType: "unknown" }), "60617", null);
    expect(html).toContain("Not yet classified");
    expect(html).not.toMatch(/>Unknown</);
  });

  it("links to the opportunity area when the site has a cluster", () => {
    const html = buildSiteCardHtml(card({ clusterId: 3 }), "60617", null);
    expect(html).toContain("/vacancy/60617/areas/3");
    expect(html).toContain("View its opportunity area");
  });

  it("offers a single primary county-record action when a PIN resolves", () => {
    const html = buildSiteCardHtml(card({ ownerType: "city_public", saleYear: null }), "60617", null);
    expect(html).toContain("cookcountyil.gov/cookviewer");
    expect(html).toContain("Check parcel record");
    expect(html).toContain("www.cookcountyassessoril.gov/pin/21322110390000");
    expect(html).toContain("crs.cookcountyclerkil.gov/Search/ResultByPin?id1=21322110390000");
  });

  it("surfaces lot/building/owner facts at a glance and a source-honest assessed value in the clicked popup", () => {
    const html = buildSiteCardHtml(
      card({
        squareFeet: null,
        space: { lotAreaSqft: 3125, assessorBuildingSqft: 1800, assessorBuildingYear: 2024 },
        ownerType: "city_public",
      }),
      "60617",
      null,
      {
        parcelEnrichment: {
          status: "checked",
          sourceUnavailable: false,
          facts: {
            countyClass: "517",
            classGloss: "Commercial building",
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
          },
        },
      },
    );
    expect(html).toContain("Lot 3,125 sq ft");
    expect(html).toContain("Assessor building 1,800 sq ft");
    expect(html).toContain("Public agency owner classification");
    expect(html).toContain(`${PARCEL_ENRICHMENT_SLOT_ATTR}`);
    expect(html).toContain("Lot area: 3,333 sq ft");
    expect(html).toContain("Assessor building area: 1,900 sq ft");
    expect(html).toContain("Assessed value: $6,900");
    expect(html).toContain("tax year 2025 · board total");
  });

  it("keeps County failure distinct from a successful no-published-value check", () => {
    const unavailable = parcelEnrichmentHtml({ status: "unavailable" });
    expect(unavailable).toContain("Temporarily unavailable");
    expect(unavailable).toContain(PARCEL_ENRICHMENT_RETRY_ATTR);
    expect(unavailable).toContain("Retry County check");
    expect(
      parcelEnrichmentHtml({
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
          activeLicenseStatus: "not_requested",
        },
      }),
    ).toContain("Assessed value: Not published");
  });

  it("never emits an owner name field (anonymized end to end)", () => {
    const html = buildSiteCardHtml(card({}), "60617", null).toLowerCase();
    expect(html).not.toContain("ownername");
    expect(html).not.toContain("taxpayer name");
    expect(html).not.toContain("mailing address");
  });
});

// ── Programs and zones ───────────────────────────────────────────────────────

/** The eight geographies the static resolver actually returns for 4048 W
 *  MADISON ST — see lib/__tests__/vacancy-site-zones.test.ts, which derives
 *  them from the committed GeoJSON rather than asserting this literal. */
const MADISON_ZONES: SiteZoneMatch[] = [
  { key: "tif", label: "TIF District", name: "Madison/Austin Corridor TIF (T-75)" },
  { key: "ssa", label: "Special Service Area", name: "West Garfield Park (SSA #77)" },
  { key: "enterprise", label: "Enterprise Zone", name: "Chicago Enterprise Zone V" },
  {
    key: "federalOZ",
    label: "Opportunity Zone (Federal & State)",
    name: "Federal Qualified Opportunity Zone",
  },
  { key: "nmtcEligible", label: "NMTC Eligible Census Tract", name: "" },
  { key: "qct", label: "Qualified Census Tract (HUD)", name: "Census Tract 2602" },
  { key: "energyCommunities", label: "IRA Energy Community", name: "MSA Energy Community" },
  { key: "hubzone", label: "SBA HUBZone", name: "HUBZone Qualified Tract 17031260200" },
];

/** A reconciled VACANT LAND dot: the export gives it no zoning and a literal
 *  incentiveCount of 0 — the exact shape that produced the wrong card. */
const madisonLandDot = card({
  address: "4048 W MADISON ST",
  ownerType: "local_private",
  propertyType: "vacant_land",
  pin: "16104250200000",
  squareFeet: null,
  zoningClass: null,
  incentiveCount: 0,
  ownerConfidence: "inferred",
  clusterId: null,
  cluster: null,
  lat: 41.8811054031,
  lon: -87.7279171939,
});

describe("programsAndZonesRows", () => {
  it("no longer reads a land dot's stamped zero as proof of no coverage", () => {
    const rows = programsAndZonesRows(madisonLandDot, {
      status: "loaded",
      matches: MADISON_ZONES,
      unknownKeys: [],
      checkedAt: "2026-08-13T00:00:00.000Z",
    }).join("\n");

    expect(rows).toContain("Inside 8 mapped incentive geographies:");
    expect(rows).not.toContain("Not inside a mapped incentive geography");
    expect(rows).toContain("TIF District — Madison/Austin Corridor TIF (T-75)");
    expect(rows).toContain("Special Service Area — West Garfield Park (SSA #77)");
    expect(rows).toContain("Enterprise Zone — Chicago Enterprise Zone V");
    expect(rows).toContain("Opportunity Zone (Federal &amp; State)");
  });

  it("keeps the zoning line unchanged (still honest when zoning is absent)", () => {
    expect(programsAndZonesRows(madisonLandDot, { status: "loaded", matches: [], unknownKeys: [], checkedAt: "2026-08-13T00:00:00.000Z" })[0]).toBe(
      "Zoning not recorded.",
    );
    expect(programsAndZonesRows(card({ zoningClass: "C1-1" }))[0]).not.toBe(
      "Zoning not recorded.",
    );
  });

  it("claims 'not inside a mapped incentive geography' ONLY from a completed empty lookup", () => {
    const claim = "Not inside a mapped incentive geography.";
    expect(programsAndZonesRows(madisonLandDot, { status: "loaded", matches: [], unknownKeys: [], checkedAt: "2026-08-13T00:00:00.000Z" })).toContain(
      claim,
    );
    expect(programsAndZonesRows(madisonLandDot, { status: "loading" })).not.toContain(claim);
    expect(programsAndZonesRows(madisonLandDot, { status: "error" })).not.toContain(claim);
  });

  it("says the lookup failed rather than inventing an absence of coverage", () => {
    const rows = programsAndZonesRows(madisonLandDot, { status: "error" }).join("\n");
    expect(rows).toMatch(/could not check/i);
    expect(rows).toMatch(/full address report|verify/i);
  });

  it("preserves the legacy stamped-count phrasing when there is no coordinate to check", () => {
    expect(programsAndZonesRows(card({ incentiveCount: 3 }))).toContain(
      "Intersects 3 incentive geographies.",
    );
    expect(programsAndZonesRows(card({ incentiveCount: 1 }))).toContain(
      "Intersects 1 incentive geography.",
    );
  });

  it("renders an unnamed layer as the layer alone, never as a dangling dash", () => {
    const rows = programsAndZonesRows(madisonLandDot, {
      status: "loaded",
      matches: [{ key: "nmtcEligible", label: "NMTC Eligible Census Tract", name: "" }],
    unknownKeys: [],
    checkedAt: "2026-08-13T00:00:00.000Z",
    }).join("\n");
    expect(rows).toContain("NMTC Eligible Census Tract");
    expect(rows).not.toContain("NMTC Eligible Census Tract —");
  });

  it("escapes zone names — the slot is written with innerHTML", () => {
    const rows = programsAndZonesRows(madisonLandDot, {
      status: "loaded",
      matches: [{ key: "tif", label: "TIF District", name: "<img src=x onerror=alert(1)>" }],
    unknownKeys: [],
    checkedAt: "2026-08-13T00:00:00.000Z",
    }).join("\n");
    expect(rows).not.toContain("<img");
    expect(rows).toContain("&lt;img");
  });

  it("never promises eligibility, only containment", () => {
    const rows = programsAndZonesRows(madisonLandDot, {
      status: "loaded",
      matches: MADISON_ZONES,
      unknownKeys: [],
      checkedAt: "2026-08-13T00:00:00.000Z",
    })
      .join("\n")
      .toLowerCase();
    for (const banned of ["you qualify", "eligible for", "ideal for", "available", "guaranteed"]) {
      expect(rows).not.toContain(banned);
    }
  });
});

describe("zoneBadgeText", () => {
  it("summarizes coverage on the collapsed accordion, and stays silent otherwise", () => {
    expect(zoneBadgeText({ status: "loaded", matches: MADISON_ZONES, unknownKeys: [], checkedAt: "2026-08-13T00:00:00.000Z" })).toBe(" · 8 mapped");
    expect(zoneBadgeText({ status: "loaded", matches: [], unknownKeys: [], checkedAt: "2026-08-13T00:00:00.000Z" })).toBe("");
    expect(zoneBadgeText({ status: "loading" })).toBe("");
    expect(zoneBadgeText({ status: "error" })).toBe("");
  });
});

describe("buildSiteCardHtml — zones", () => {
  it("carries the patchable slot and badge the map updates when the lookup lands", () => {
    const html = buildSiteCardHtml(madisonLandDot, "60624", null, { zones: { status: "loading" } });
    expect(html).toContain(ZONE_SLOT_ATTR);
    expect(html).toContain(ZONE_BADGE_ATTR);
    expect(html).toMatch(/Checking mapped incentive geographies/);
  });

  it("links out to the full address report for the exact point", () => {
    const html = buildSiteCardHtml(madisonLandDot, "60624", null, {
      zones: { status: "loaded", matches: MADISON_ZONES, unknownKeys: [], checkedAt: "2026-08-13T00:00:00.000Z" },
    });
    expect(html).toContain("/report?instant=true&amp;lat=41.88111&amp;lon=-87.72792");
    expect(html).toContain("Full address report");
  });

  it("omits the report link when the record carries no coordinate", () => {
    const html = buildSiteCardHtml(card({ lat: null, lon: null }), "60617", null);
    expect(html).not.toContain("Full address report");
  });
});

// ── Site activity context (compact) ──────────────────────────────────────────

/**
 * The compact variant of the report's Site Activity card. Same discipline in a
 * quarter of the space: one figure + one qualifier + its own source line per
 * measure, absences stated as absences, and no combined figure anywhere.
 */

const ACTIVITY_CONTEXT: SiteActivityContext = {
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
      { category: "other", count: 2 },
    ],
  },
  radii: { arterialMi: 0.15, railMi: 0.5, catchmentMi: 0.5, licenseMi: 0.25 },
};

const EMPTY_ACTIVITY_CONTEXT: SiteActivityContext = {
  arterial: null,
  rail: [],
  catchment: null,
  licenses: null,
  radii: ACTIVITY_CONTEXT.radii,
};

const loadedActivity = (context: SiteActivityContext): SiteActivityState => ({
  status: "loaded",
  context,
  sources: SITE_ACTIVITY_SOURCES,
});

describe("siteActivityHtml", () => {
  it("renders each measure as a figure, a qualifier, and its own source line", () => {
    const html = siteActivityHtml(loadedActivity(ACTIVITY_CONTEXT));
    expect(html).toContain("<strong>18,500 vehicles/day</strong>");
    expect(html).toContain("on S COMMERCIAL AVE · station s1 · 0.04 mi away");
    expect(html).toContain("<strong>3,210 avg weekday entries</strong>");
    expect(html).toContain("<strong>4,712 residents · 1,180 jobs</strong>");
    expect(html).toContain("<strong>27 active licenses</strong>");
    // Provenance travels with every value, with its verify link.
    expect(html).toContain("Illinois DOT traffic counts (AADT) · 2025 count year");
    expect(html).toContain("CTA 'L' station daily entries · 2026-05");
    expect(html).toContain("ACS 2020-2024 5-year · LODES8 2023");
    expect((html.match(/verify /g) ?? []).length).toBe(4);
  });

  it("states absences as absences with their radii, never as zeros", () => {
    const html = siteActivityHtml(loadedActivity(EMPTY_ACTIVITY_CONTEXT));
    expect(html).toContain("No IDOT count station within 0.15 mi of this site.");
    expect(html).toContain("No 'L' station within 0.5 mi of this site.");
    expect(html).toContain("No census block-group centroid within 0.5 mi.");
    expect(html).toContain("No active business license on record within 0.25 mi.");
    expect(html).not.toContain("<strong>0");
    // Nothing was measured, so nothing is attributed.
    expect(html).not.toContain("verify ");
  });

  it("says the lookup failed rather than inventing quiet surroundings", () => {
    const html = siteActivityHtml({ status: "error" });
    expect(html).toMatch(/could not check/i);
    expect(html).not.toMatch(/No IDOT count station/);
    expect(html).not.toMatch(/No 'L' station/);
  });

  it("says it is still checking while the lookup is in flight", () => {
    expect(siteActivityHtml({ status: "loading" })).toMatch(/checking public measurements/i);
    expect(siteActivityHtml({ status: "idle" })).toBe("");
  });

  it("never publishes a modeled or combined figure", () => {
    const html = siteActivityHtml(loadedActivity(ACTIVITY_CONTEXT)).toLowerCase();
    for (const banned of [
      "foot traffic",
      "foot-traffic",
      "footfall",
      "visitors",
      "estimated",
      "projected",
      "activity score",
    ]) {
      expect(html).not.toContain(banned);
    }
    expect(html).toContain("nothing modeled");
  });

  it("escapes source and measure text — the slot is written with innerHTML", () => {
    const html = siteActivityHtml(
      loadedActivity({
        ...ACTIVITY_CONTEXT,
        arterial: {
          ...ACTIVITY_CONTEXT.arterial!,
          roadName: "<img src=x onerror=alert(1)>",
        },
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("activityBadgeText", () => {
  it("counts only the measures that returned something inside their radius", () => {
    expect(activityBadgeText(loadedActivity(ACTIVITY_CONTEXT))).toBe(" · 4 of 4 measured");
    expect(activityBadgeText(loadedActivity(EMPTY_ACTIVITY_CONTEXT))).toBe(" · 0 of 4 measured");
    expect(
      activityBadgeText(loadedActivity({ ...ACTIVITY_CONTEXT, rail: [], licenses: null })),
    ).toBe(" · 2 of 4 measured");
  });

  it("stays silent until the lookup completes, so it can never imply a count", () => {
    expect(activityBadgeText({ status: "loading" })).toBe("");
    expect(activityBadgeText({ status: "error" })).toBe("");
    expect(activityBadgeText({ status: "idle" })).toBe("");
  });
});

describe("buildSiteCardHtml — site activity", () => {
  it("carries the patchable slot and badge the map updates when the lookup lands", () => {
    const html = buildSiteCardHtml(madisonLandDot, "60624", null, {
      activity: { status: "loading" },
    });
    expect(html).toContain("Site activity context");
    expect(html).toContain(ACTIVITY_SLOT_ATTR);
    expect(html).toContain(ACTIVITY_BADGE_ATTR);
    expect(html).toMatch(/Checking public measurements/i);
  });

  it("renders the compact measures inside the card once loaded", () => {
    const html = buildSiteCardHtml(madisonLandDot, "60624", null, {
      activity: loadedActivity(ACTIVITY_CONTEXT),
    });
    expect(html).toContain("<strong>18,500 vehicles/day</strong>");
    expect(html).toContain(" · 4 of 4 measured");
  });

  it("omits the section entirely for a record with no coordinate to measure from", () => {
    const html = buildSiteCardHtml(card({ lat: null, lon: null }), "60617", null, {
      activity: loadedActivity(ACTIVITY_CONTEXT),
    });
    expect(html).not.toContain("Site activity context");
    expect(html).not.toContain(ACTIVITY_SLOT_ATTR);
  });

  it("adds nothing at all when no lookup was requested (pre-existing callers)", () => {
    const html = buildSiteCardHtml(madisonLandDot, "60624", null);
    expect(html).not.toContain("Site activity context");
    expect(html).not.toContain(ACTIVITY_SLOT_ATTR);
  });

  it("keeps the section inside the capped scroller, like every other section", () => {
    const html = buildSiteCardHtml(madisonLandDot, "60624", null, {
      maxHeightPx: 300,
      activity: loadedActivity(ACTIVITY_CONTEXT),
    });
    expect(html.indexOf("Site activity context")).toBeGreaterThan(
      html.indexOf(CARD_SCROLLER_ATTR),
    );
  });
});

// ── Viewport fit ─────────────────────────────────────────────────────────────

describe("buildSiteCardHtml — viewport fit", () => {
  it("wraps the card in a capped scroll container when a max height is given", () => {
    const html = buildSiteCardHtml(card({}), "60617", null, { maxHeightPx: 496 });
    expect(html).toContain(CARD_SCROLLER_ATTR);
    expect(html).toContain("max-height:496px");
    expect(html).toContain("overflow-y:auto");
    // Overscroll must not chain out to the page behind the map.
    expect(html).toContain("overscroll-behavior:contain");
  });

  it("keeps every section INSIDE the scroller, so nothing can be clipped away", () => {
    const html = buildSiteCardHtml(card({}), "60617", null, { maxHeightPx: 300 });
    const start = html.indexOf(CARD_SCROLLER_ATTR);
    expect(start).toBeGreaterThan(-1);
    // "Data and sources" — the section the reported screenshot lost — is inside.
    expect(html.indexOf("Data and sources")).toBeGreaterThan(start);
    expect(html.indexOf("Why it was flagged")).toBeGreaterThan(start);
  });

  it("adds no cap (and no scroller) when the container could not be measured", () => {
    for (const cap of [null, undefined, 0, Number.NaN]) {
      const html = buildSiteCardHtml(card({}), "60617", null, { maxHeightPx: cap });
      expect(html).not.toContain(CARD_SCROLLER_ATTR);
    }
  });
});

// ── Starred (admin) ──────────────────────────────────────────────────────────

describe("buildSiteCardHtml — starred", () => {
  it("emits NO star markup at all for a public reader", () => {
    const html = buildSiteCardHtml(card({}), "60617", null);
    expect(html).not.toContain(STAR_BUTTON_ATTR);
    expect(html).not.toContain("★");
    expect(html).not.toContain("☆");
  });

  it("renders an unpressed star for an admin who has not saved this site", () => {
    const html = buildSiteCardHtml(card({}), "60617", null, {
      star: { key: "pin:21322110390000", starred: false },
    });
    expect(html).toContain(`${STAR_BUTTON_ATTR}="pin:21322110390000"`);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("☆");
  });

  it("renders a pressed star in the starred color once saved", () => {
    const html = buildSiteCardHtml(card({}), "60617", null, {
      star: { key: "pin:21322110390000", starred: true },
    });
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("★");
    expect(html).toContain(STARRED_RING);
  });

  it("escapes the star key so it cannot break out of the attribute", () => {
    const html = buildSiteCardHtml(card({}), "60617", null, {
      star: { key: 'addr:" onmouseover=alert(1) x="', starred: false },
    });
    // The quotes are neutralized, so the payload stays inert attribute text.
    expect(html).toContain("&quot; onmouseover=alert(1) x=&quot;");
    expect(html).not.toMatch(/data-vacancy-star="[^"]*" onmouseover=/);
  });
});
