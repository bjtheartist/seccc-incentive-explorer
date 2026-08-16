import { describe, expect, it } from "vitest";
import {
  SHORTLIST_RANKING_MODEL_VERSION,
  SITE_MATCH_CRITERIA_VERSION,
  SITE_MATCH_CRITERIA_PARAM_KEYS,
  SITE_MATCH_VERSION_PARAM_KEYS,
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
// Re-review Finding 5: RANKING_MODEL_VERSION (lib/shortlist-engine.ts, the
// DATA-compatibility check against a loaded universe file) and
// SHORTLIST_RANKING_MODEL_VERSION (this module, the REQUEST-level sm_rv
// check) are deliberately two independent constants, kept in lockstep by
// convention rather than a shared import (see this module's own comment on
// SHORTLIST_RANKING_MODEL_VERSION for why: importing shortlist-engine.ts
// here would form a real circular dependency, since that file itself
// imports criteria types FROM this one). A convention with no test is not a
// contract — this file imports BOTH constants directly and asserts they
// agree, so a PR that bumps one without the other fails CI instead of
// silently shipping a version-checked URL that no longer matches the data
// version it claims to speak.
import { RANKING_MODEL_VERSION } from "@/lib/shortlist-engine";

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
    zoningAlignment: null,
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
      zoningAlignment: null,
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

  // ── zoning-alignment-rank change: sm_zoning round-trip ────────────────────

  it("round-trips sm_zoning=aligned to zoningAlignment: 'aligned-only' and back", () => {
    const withZoning = completeCriteria({ zoningAlignment: "aligned-only" });
    const encoded = encodeSiteMatchCriteria(withZoning);
    expect(encoded.get("sm_zoning")).toBe("aligned");
    expect(decodeSiteMatchCriteria(encoded).zoningAlignment).toBe("aligned-only");
  });

  it("decodes an absent or unrecognized sm_zoning to null — never a silent alias", () => {
    expect(decodeSiteMatchCriteria(new URLSearchParams("zip=60617")).zoningAlignment).toBeNull();
    expect(
      decodeSiteMatchCriteria(new URLSearchParams("zip=60617&sm_zoning=yes")).zoningAlignment,
    ).toBeNull();
    expect(
      decodeSiteMatchCriteria(new URLSearchParams("zip=60617&sm_zoning=true")).zoningAlignment,
    ).toBeNull();
  });

  it("omits sm_zoning from the encoded URL when not selected", () => {
    expect(encodeSiteMatchCriteria(completeCriteria()).toString()).not.toContain("sm_zoning");
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
      zoningAlignment: "Zoning-alignment filter not selected",
    });
    expect(JSON.stringify(summary).toLowerCase()).not.toMatch(
      /score|eligible|ideal|best|available|foot traffic/,
    );
  });

  it("gives the aligned-only zoning chip its own honest label", () => {
    const summary = summarizeSiteMatchCriteria(completeCriteria({ zoningAlignment: "aligned-only" }));
    expect(summary.zoningAlignment).toBe("Aligned zoning families only");
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

  // ── Finding 5 (re-review): sm_rv must never fall BEHIND the data version ──
  //
  // The pre-fix state had each side's OWN tests passing independently —
  // shortlistRankingModelVersionSupported tested against
  // SHORTLIST_RANKING_MODEL_VERSION, RANKING_MODEL_VERSION tested against
  // RANKING_INPUTS_VERSION — with nothing anywhere asserting the two
  // version families actually AGREE. A PR that bumped
  // lib/shortlist-engine.ts's RANKING_MODEL_VERSION without also bumping
  // this module's SHORTLIST_RANKING_MODEL_VERSION string would leave every
  // OLD sm_rv link "supported" against a DATA version it no longer matches
  // — the exact silent-drift failure mode Finding 5 named — and every test
  // suite in the repo would still pass. This test imports both constants
  // directly and compares them, so that specific drift fails CI.
  //
  // RELAXED (zoning-alignment-rank change) from strict equality to
  // "sm_rv >= data version": that PR bumped SHORTLIST_RANKING_MODEL_VERSION
  // alone, "2" -> "3", because the ranking ALGORITHM changed (zoning
  // alignment now orders results) without touching any committed universe
  // FILE's shape or `rankingInputsVersion` — bumping RANKING_MODEL_VERSION
  // to match would have failed EVERY already-published ZIP closed until
  // every committed data/exports/shortlist-universe/*.json file was
  // regenerated, which that change did not warrant (see the doc comment on
  // `SHORTLIST_RANKING_MODEL_VERSION` for the full reasoning). The
  // protection Finding 5 actually needs still holds under the relaxed
  // invariant: sm_rv can never be STALE relative to the data version (that
  // would silently mis-decode an old link against newer data), but it MAY
  // legitimately run ahead when only ranking semantics — not the universe
  // row shape — changed.
  it("SHORTLIST_RANKING_MODEL_VERSION (request-level sm_rv) never falls BEHIND RANKING_MODEL_VERSION (lib/shortlist-engine.ts's data-compatibility check) — it MAY run ahead for an algorithm-only ranking change that touches no universe-row field", () => {
    expect(Number(SHORTLIST_RANKING_MODEL_VERSION)).toBeGreaterThanOrEqual(RANKING_MODEL_VERSION);
  });
});

describe("SITE_MATCH_CRITERIA_PARAM_KEYS — the allowlist the shortlist page and map handoff copy before decoding", () => {
  it("covers every sm_* key a fully-populated encoded brief emits, so no criterion is silently dropped", () => {
    const encoded = encodeSiteMatchCriteria(
      normalizeSiteMatchCriteria({
        zip: "60619",
        projectUse: "food-hospitality",
        propertyType: "existing-building",
        minSquareFeet: 1000,
        maxSquareFeet: 5000,
        context: "neighborhood-scale",
        transportation: ["cta-rail"],
        transportationDistance: "half-mile",
        walkability: "important",
        pedestrianActivity: "important",
        amenities: ["grocery"],
        zoningAlignment: "aligned-only",
      }),
    );
    // Every criterion must actually be present in the encoded brief, so a
    // silently-discarded value cannot hide an allowlist gap.
    for (const key of SITE_MATCH_CRITERIA_PARAM_KEYS) expect(encoded.has(key), `${key} must be emitted`).toBe(true);
    const emitted = [...new Set([...encoded.keys()])].filter((key) => key.startsWith("sm_"));
    const allowlisted = new Set<string>([...SITE_MATCH_CRITERIA_PARAM_KEYS, ...SITE_MATCH_VERSION_PARAM_KEYS]);
    for (const key of emitted) expect(allowlisted.has(key), `${key} must be allowlisted`).toBe(true);
    expect(SITE_MATCH_CRITERIA_PARAM_KEYS).toContain("sm_zoning");
  });
});
