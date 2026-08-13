import { describe, expect, it } from "vitest";
import {
  SHORTLIST_RANKING_MODEL_VERSION,
  SITE_MATCH_CRITERIA_VERSION,
  buildShortlistHref,
  buildSiteMatchmakerHref,
  buildVacancyHandoffHref,
  createEmptySiteMatchCriteria,
  decodeSiteMatchCriteria,
  encodeSiteMatchCriteria,
  isSiteMatchCriteriaReady,
  normalizeSiteMatchCriteria,
  shortlistRankingModelVersionSupported,
  siteMatchCriteriaVersionSupported,
  summarizeSiteMatchCriteria,
  type SiteMatchCriteria,
} from "@/lib/site-matchmaker";

function completeCriteria(overrides: Partial<SiteMatchCriteria> = {}): SiteMatchCriteria {
  return {
    zip: "60617",
    projectUse: "retail-service",
    propertyType: "existing-building",
    minSquareFeet: 1_500,
    maxSquareFeet: 5_000,
    context: "commercial-corridor",
    transportation: ["cta-bus", "cta-rail"],
    transportationDistance: "half-mile",
    walkability: "important",
    pedestrianActivity: "preferred",
    amenities: ["grocery", "restaurants-retail"],
    ...overrides,
  };
}

describe("site matchmaker criteria URL state", () => {
  it("round-trips supported criteria in a stable canonical order", () => {
    const encoded = encodeSiteMatchCriteria(completeCriteria());
    expect(encoded.toString()).toBe(
      "sm_v=1&zip=60617&sm_use=retail-service&sm_property=existing-building&sm_min_sqft=1500&sm_max_sqft=5000&sm_context=commercial-corridor&sm_transport=cta-rail%2Ccta-bus&sm_transport_distance=half-mile&sm_walkability=important&sm_pedestrian_activity=preferred&sm_amenities=restaurants-retail%2Cgrocery",
    );
    expect(decodeSiteMatchCriteria(encoded)).toEqual(completeCriteria({
      transportation: ["cta-rail", "cta-bus"],
      amenities: ["restaurants-retail", "grocery"],
    }));
  });

  it("accepts readable legacy aliases without preserving unsupported values", () => {
    const decoded = decodeSiteMatchCriteria(
      new URLSearchParams(
        "zip=60624&project=distribution-logistics&propertyType=vacant-land&minSqFt=2400&maxSqFt=9000&density=industrial-employment&transport=freight-rail,teleporter&amenities=libraries,casino",
      ),
    );
    expect(decoded).toMatchObject({
      zip: "60624",
      projectUse: "distribution-logistics",
      propertyType: "vacant-land",
      minSquareFeet: 2_400,
      maxSquareFeet: 9_000,
      context: "industrial-employment",
      transportation: ["freight-rail"],
      amenities: ["libraries"],
    });
  });

  it("rejects malformed selections and normalizes footprint bounds", () => {
    const decoded = decodeSiteMatchCriteria(
      new URLSearchParams(
        "zip=99999&sm_use=unknown&sm_property=castle&sm_min_sqft=5000000&sm_max_sqft=25&sm_transport=cta-bus,cta-bus",
      ),
    );
    expect(decoded).toEqual({
      zip: null,
      projectUse: null,
      propertyType: null,
      minSquareFeet: 100,
      maxSquareFeet: 2_000_000,
      context: null,
      transportation: ["cta-bus"],
      transportationDistance: null,
      walkability: null,
      pedestrianActivity: null,
      amenities: [],
    });
    expect(normalizeSiteMatchCriteria(completeCriteria({ minSquareFeet: 9_000, maxSquareFeet: 2_000 })))
      .toMatchObject({ minSquareFeet: 2_000, maxSquareFeet: 9_000 });
  });

  it("does not add query noise for an empty brief", () => {
    const empty = createEmptySiteMatchCriteria();
    expect(encodeSiteMatchCriteria(empty).toString()).toBe("");
    expect(buildSiteMatchmakerHref(empty)).toBe("/locate");
    expect(buildVacancyHandoffHref(empty)).toBeNull();
    expect(buildShortlistHref(empty)).toBeNull();
    expect(isSiteMatchCriteriaReady(empty)).toBe(false);
  });
});

describe("site matchmaker handoff", () => {
  it("opens the published vacancy map with a namespaced, source-attributed brief", () => {
    const href = buildVacancyHandoffHref(completeCriteria());
    expect(href).toBe(
      "/vacancy/60617/map?source=site-matchmaker&sm_v=1&sm_use=retail-service&sm_property=existing-building&sm_min_sqft=1500&sm_max_sqft=5000&sm_context=commercial-corridor&sm_transport=cta-rail%2Ccta-bus&sm_transport_distance=half-mile&sm_walkability=important&sm_pedestrian_activity=preferred&sm_amenities=restaurants-retail%2Cgrocery",
    );
    expect(isSiteMatchCriteriaReady(completeCriteria())).toBe(true);
  });

  it("opens the ranked shortlist on the SAME criteria contract as the map, PLUS its own sm_rv (Finding 5)", () => {
    const shortlist = buildShortlistHref(completeCriteria());
    const map = buildVacancyHandoffHref(completeCriteria());
    // Every criteria param the map carries, the shortlist carries too — the
    // shortlist URL is a strict superset (it adds `sm_rv`, which is
    // shortlist-specific and must NOT appear on the map handoff).
    const mapParams = new URLSearchParams(map!.split("?")[1]);
    const shortlistParams = new URLSearchParams(shortlist!.split("?")[1]);
    for (const [key, value] of mapParams) {
      expect(shortlistParams.get(key)).toBe(value);
    }
    expect(mapParams.has("sm_rv")).toBe(false);
    expect(shortlistParams.get("sm_rv")).toBe(SHORTLIST_RANKING_MODEL_VERSION);
    expect(shortlist).toContain("/vacancy/60617/shortlist?source=site-matchmaker");
  });

  it("withholds the shortlist until the brief carries area, use, and property type", () => {
    for (const missing of [{ zip: null }, { projectUse: null }, { propertyType: null }] as const) {
      expect(buildShortlistHref(completeCriteria(missing))).toBeNull();
    }
  });

  it("uses qualitative summaries without a rank or availability claim", () => {
    const summary = summarizeSiteMatchCriteria(completeCriteria());
    expect(summary).toEqual({
      location: "South Chicago (60617)",
      projectUse: "Retail or services",
      propertyType: "Existing building",
      footprint: "1,500 - 5,000 sq ft",
      context: "Commercial corridor",
      transportation: "CTA rail, CTA bus",
      transportationDistance: "Within 1/2 mile",
      walkability: "Important",
      pedestrianActivity: "Preferred",
      amenities: "Restaurants and retail, Grocery",
    });
    expect(JSON.stringify(summary).toLowerCase()).not.toMatch(
      /score|eligible|ideal|best|available|foot traffic/,
    );
  });
});

// ── Criteria versioning (PR2: "criteriaVersion is cosmetic" fix) ────────────

describe("siteMatchCriteriaVersionSupported", () => {
  it("supports the current version", () => {
    const params = new URLSearchParams({ sm_v: SITE_MATCH_CRITERIA_VERSION });
    expect(siteMatchCriteriaVersionSupported(params)).toBe(true);
  });

  it("treats an ABSENT sm_v as supported — back-compat for pre-versioning links", () => {
    expect(siteMatchCriteriaVersionSupported(new URLSearchParams({ zip: "60617" }))).toBe(true);
  });

  it("rejects an explicit, unrecognized version", () => {
    expect(siteMatchCriteriaVersionSupported(new URLSearchParams({ sm_v: "99" }))).toBe(false);
    expect(siteMatchCriteriaVersionSupported(new URLSearchParams({ sm_v: "0" }))).toBe(false);
    expect(siteMatchCriteriaVersionSupported(new URLSearchParams({ sm_v: "" }))).toBe(false);
  });

  it("stays in step with what encodeSiteMatchCriteria actually emits", () => {
    const encoded = encodeSiteMatchCriteria(completeCriteria());
    expect(siteMatchCriteriaVersionSupported(encoded)).toBe(true);
    expect(encoded.get("sm_v")).toBe(SITE_MATCH_CRITERIA_VERSION);
  });
});

// ── Finding 5: ranking-model request versioning (separate from sm_v) ───────

describe("shortlistRankingModelVersionSupported", () => {
  it("supports the current version", () => {
    const params = new URLSearchParams({ sm_rv: SHORTLIST_RANKING_MODEL_VERSION });
    expect(shortlistRankingModelVersionSupported(params)).toBe(true);
  });

  it("treats an ABSENT sm_rv as supported — back-compat for links minted before this versioning existed", () => {
    expect(shortlistRankingModelVersionSupported(new URLSearchParams({ zip: "60617" }))).toBe(true);
  });

  it("rejects an explicit, unrecognized version", () => {
    expect(shortlistRankingModelVersionSupported(new URLSearchParams({ sm_rv: "99" }))).toBe(false);
    expect(shortlistRankingModelVersionSupported(new URLSearchParams({ sm_rv: "0" }))).toBe(false);
  });

  it("is checked independently of sm_v — an unrecognized sm_rv fails even with a supported sm_v, and vice versa", () => {
    const badRv = new URLSearchParams({ sm_v: SITE_MATCH_CRITERIA_VERSION, sm_rv: "99" });
    expect(siteMatchCriteriaVersionSupported(badRv)).toBe(true);
    expect(shortlistRankingModelVersionSupported(badRv)).toBe(false);

    const badV = new URLSearchParams({ sm_v: "99", sm_rv: SHORTLIST_RANKING_MODEL_VERSION });
    expect(siteMatchCriteriaVersionSupported(badV)).toBe(false);
    expect(shortlistRankingModelVersionSupported(badV)).toBe(true);
  });

  it("stays in step with what buildShortlistHref actually emits", () => {
    const href = buildShortlistHref(completeCriteria())!;
    const params = new URLSearchParams(href.split("?")[1]);
    expect(shortlistRankingModelVersionSupported(params)).toBe(true);
    expect(params.get("sm_rv")).toBe(SHORTLIST_RANKING_MODEL_VERSION);
  });
});
