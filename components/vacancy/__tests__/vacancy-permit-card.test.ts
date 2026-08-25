import { describe, expect, it } from "vitest";
import {
  PERMIT_BADGE_ATTR,
  PERMIT_SLOT_ATTR,
  buildSiteCardHtml,
  permitBadgeText,
  permitMatchHtml,
  type CardData,
} from "../vacancy-site-card";
import type { PermitMatchState } from "@/lib/permit-match-client";
import { normalizePermitMatchPayload } from "@/lib/permit-match-client";
import type { MatchedPermit } from "@/lib/permit-match";
import {
  PERMIT_DATA_SOURCE_TEXT,
  PERMIT_MATCH_CHECKING_TEXT,
  PERMIT_MATCH_ERROR_TEXT,
  PERMIT_NO_MATCH_TEXT,
  PERMIT_PORTAL_URL,
  PERMIT_PROXIMITY_WARNING,
  PERMIT_SECTION_TITLE,
  PERMIT_VERIFICATION_NOTE,
} from "@/lib/permit-match-lines";
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

function card(over: Partial<CardData> = {}): CardData {
  return {
    isLand: false,
    markerNumber: null,
    address: "8131 S EXCHANGE AVE",
    ownerType: "city_public",
    propertyType: "vacant_land",
    pin: "21322110390000",
    squareFeet: 6234,
    zoningClass: "C1-1",
    incentiveCount: 3,
    ownerConfidence: "pin_matched",
    ownerStructure: "entity",
    ownerGeography: "in_state",
    clusterId: 3,
    saleYear: null,
    violation: false,
    cluster: cluster(12),
    neighborhood: "South Chicago",
    lat: 41.7461,
    lon: -87.5497,
    ...over,
  };
}

const permit: MatchedPermit = {
  permitId: "B100912345",
  permitType: "PERMIT - RENOVATION/ALTERATION",
  workType: "Interior Alteration",
  workDescription: "INTERIOR REMODEL",
  issueDate: "2024-03-15",
  reportedCost: 125000,
  permitStatus: "COMPLETE",
  permitMilestone: "COMPLETE",
  permitCondition: null,
  matchMethod: "pin_exact",
  matchConfidence: "high",
};

const loaded: PermitMatchState = { status: "loaded", matches: [permit] };
const empty: PermitMatchState = { status: "loaded", matches: [] };

describe("permitMatchHtml", () => {
  it("renders the full substance for a match", () => {
    const html = permitMatchHtml(loaded);
    expect(html).toContain("PERMIT - RENOVATION/ALTERATION");
    expect(html).toContain("Mar 15, 2024");
    expect(html).toContain("$125,000 (Applicant Estimate)");
    expect(html).toContain("COMPLETE");
    expect(html).toContain("B100912345");
    expect(html).toContain("Parcel PIN · High confidence");
    expect(html).toContain(PERMIT_DATA_SOURCE_TEXT);
    expect(html).toContain(PERMIT_VERIFICATION_NOTE);
    expect(html).toContain(PERMIT_PORTAL_URL);
    expect(html).not.toContain(PERMIT_PROXIMITY_WARNING);
  });

  it("warns that a location-only match may belong to a neighboring parcel", () => {
    const proximity: PermitMatchState = {
      status: "loaded",
      matches: [
        {
          ...permit,
          matchMethod: "spatial_proximity",
          matchConfidence: "low",
        },
      ],
    };

    const html = permitMatchHtml(proximity);
    expect(html).toContain("Location within 25 m · Low confidence");
    expect(html).toContain(PERMIT_PROXIMITY_WARNING);
  });

  it("never prints a cost without the applicant-estimate qualifier", () => {
    const html = permitMatchHtml(loaded);
    const costMatches = html.match(/\$[\d,]+/g) ?? [];
    expect(costMatches.length).toBe(1);
    const idx = html.indexOf(costMatches[0] as string);
    expect(html.slice(idx, idx + 60)).toContain("(Applicant Estimate)");
  });

  it("never aggregates several matches into a total", () => {
    const many: PermitMatchState = {
      status: "loaded",
      matches: [
        permit,
        // Distinctive ids: a bare "B2"/"B3" would collide with the navy hex
        // (#0C1B33) in the inline styles and make this assertion meaningless.
        { ...permit, permitId: "SECOND-PERMIT-ID", reportedCost: 400000 },
        { ...permit, permitId: "THIRD-PERMIT-ID", reportedCost: 900000 },
      ],
    };
    const html = permitMatchHtml(many);
    // Exactly one permit and one dollar figure — no sum, no "total".
    expect((html.match(/\$[\d,]+/g) ?? []).length).toBe(1);
    expect(html).toContain("$125,000");
    expect(html).not.toContain("1,425,000");
    expect(html.toLowerCase()).not.toContain("total");
    expect(html).not.toContain("SECOND-PERMIT-ID");
    expect(html).not.toContain("THIRD-PERMIT-ID");
  });

  it("states an absence as an absence, with the queried window", () => {
    expect(permitMatchHtml(empty)).toContain(PERMIT_NO_MATCH_TEXT);
    expect(permitMatchHtml(empty)).toContain("2015–Present");
  });

  it("renders a failed lookup as 'could not check', NEVER as an absence", () => {
    const html = permitMatchHtml({ status: "error" });
    expect(html).toContain(PERMIT_MATCH_ERROR_TEXT);
    expect(html).not.toContain(PERMIT_NO_MATCH_TEXT);
  });

  it("renders an in-flight lookup as checking, never as an answer", () => {
    const html = permitMatchHtml({ status: "loading" });
    expect(html).toContain(PERMIT_MATCH_CHECKING_TEXT);
    expect(html).not.toContain(PERMIT_NO_MATCH_TEXT);
  });

  it("renders nothing at all when idle", () => {
    expect(permitMatchHtml({ status: "idle" })).toBe("");
  });

  it("escapes interpolated values", () => {
    const nasty: PermitMatchState = {
      status: "loaded",
      matches: [{ ...permit, permitType: '<img src=x onerror="alert(1)">' }],
    };
    const html = permitMatchHtml(nasty);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("permitBadgeText", () => {
  it("is silent until the lookup completes", () => {
    expect(permitBadgeText({ status: "idle" })).toBe("");
    expect(permitBadgeText({ status: "loading" })).toBe("");
    expect(permitBadgeText({ status: "error" })).toBe("");
  });

  it("distinguishes a match from a checked absence", () => {
    expect(permitBadgeText(loaded)).toBe(" · matched");
    expect(permitBadgeText(empty)).toBe(" · none");
  });
});

describe("buildSiteCardHtml permit section", () => {
  it("adds the section with its patch slots once a lookup is underway", () => {
    const html = buildSiteCardHtml(card(), "60617", null, { permits: loaded });
    expect(html).toContain(PERMIT_SECTION_TITLE);
    expect(html).toContain(PERMIT_SLOT_ATTR);
    expect(html).toContain(PERMIT_BADGE_ATTR);
    expect(html).toContain("B100912345");
  });

  it("omits the section entirely when no lookup is underway", () => {
    const html = buildSiteCardHtml(card(), "60617", null, {});
    expect(html).not.toContain(PERMIT_SECTION_TITLE);
    expect(html).not.toContain(PERMIT_SLOT_ATTR);
    // And it must not silently imply an absence either.
    expect(html).not.toContain(PERMIT_NO_MATCH_TEXT);
  });

  it("leaves every other section of the card intact", () => {
    const withPermits = buildSiteCardHtml(card(), "60617", null, { permits: loaded });
    expect(withPermits).toContain("Site facts");
    expect(withPermits).toContain("Programs and zones");
    expect(withPermits).toContain("Why it was flagged");
    expect(withPermits).toContain("Data and sources");
  });
});

describe("normalizePermitMatchPayload", () => {
  const wire = {
    matches: [
      {
        permitId: "B100912345",
        permitType: "PERMIT - RENOVATION/ALTERATION",
        workType: null,
        workDescription: null,
        issueDate: "2024-03-15",
        reportedCost: 125000,
        permitStatus: "COMPLETE",
        permitMilestone: null,
        permitCondition: null,
        matchMethod: "pin_exact",
        matchConfidence: "high",
      },
    ],
  };

  it("accepts a well-formed payload", () => {
    expect(normalizePermitMatchPayload(wire)!.length).toBe(1);
  });

  it("accepts an empty match list — that is a real answer", () => {
    expect(normalizePermitMatchPayload({ matches: [] })).toEqual([]);
  });

  it("rejects the WHOLE payload when one entry is malformed, rather than shortening it", () => {
    const bad = { matches: [wire.matches[0], { permitId: "B2", matchMethod: "vibes" }] };
    expect(normalizePermitMatchPayload(bad)).toBeNull();
  });

  it("rejects an unknown match method or confidence", () => {
    expect(
      normalizePermitMatchPayload({
        matches: [{ ...wire.matches[0], matchMethod: "fuzzy_name" }],
      }),
    ).toBeNull();
    expect(
      normalizePermitMatchPayload({
        matches: [{ ...wire.matches[0], matchConfidence: "certain" }],
      }),
    ).toBeNull();
  });

  it("rejects a body that is not a payload at all", () => {
    expect(normalizePermitMatchPayload(null)).toBeNull();
    expect(normalizePermitMatchPayload("nope")).toBeNull();
    expect(normalizePermitMatchPayload({})).toBeNull();
  });
});
