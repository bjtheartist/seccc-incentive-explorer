// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { shortlistCriterionById } from "@/lib/shortlist-criteria";
import { createEmptySiteMatchCriteria, type SiteMatchCriteria } from "@/lib/site-matchmaker";
import type { CandidateOverlays, DecoratedShortlistCandidate } from "@/lib/shortlist-engine";

/**
 * Round-3 re-review, Findings 2, 3, and 10(b): component-level coverage for
 * SiteShortlistResults — the actual RENDERED/EMITTED surface, not just the
 * pure helpers it calls. Sol's round-3 verdict was explicit that helper-only
 * tests (lib/__tests__/shortlist-criteria.test.ts,
 * lib/__tests__/shortlist-engine.test.ts) leave the component's OWN wiring
 * unguarded — it could regress to reading the wrong field, or stop calling
 * the helper altogether, with every existing test still green.
 */

const { trackEventMock } = vi.hoisted(() => ({ trackEventMock: vi.fn() }));

vi.mock("@/lib/analytics-events", () => ({ trackEvent: trackEventMock }));
// SiteShortlistMap pulls in raw mapbox-gl (WebGL/worker APIs jsdom does not
// provide) — replaced with a no-op exactly like the page-level fail-closed
// tests already do for the whole results component.
vi.mock("@/components/vacancy/SiteShortlistMap", () => ({ default: () => null }));

import SiteShortlistResults from "@/components/vacancy/SiteShortlistResults";

function noOverlays(): CandidateOverlays {
  return {
    ssa: { present: false, name: null },
    ccsa: { present: false, name: null },
    tif: { present: false, name: null },
    nof: { present: false, name: null },
  };
}

function candidate(overrides: Partial<DecoratedShortlistCandidate> = {}): DecoratedShortlistCandidate {
  return {
    key: "pin:1",
    address: "1 FIRST ST",
    pin: "1",
    lat: 41.75,
    lon: -87.605,
    propertyType: "vacant_building",
    screenedPropertyType: "vacant_building",
    buildingSqft: 4000,
    lotSqft: null,
    zoningDistrict: "B3-2",
    zoningStatus: "resolved",
    badge: "aligned",
    badgeNote: "Aligned note",
    ownerLabel: "Corporate / LLC · out-of-state mailing address (unverified)",
    incentiveCount: 1,
    saleYear: null,
    violation: false,
    conflictingPropertyTypes: false,
    overlays: noOverlays(),
    transitScore: null,
    score: 0,
    recordCompletenessScore: 4,
    nearestRailDisplay: null,
    expresswayDisplay: null,
    nearestSchool: null,
    nearestLibrary: null,
    ...overrides,
  };
}

function baseCriteria(overrides: Partial<SiteMatchCriteria> = {}): SiteMatchCriteria {
  return {
    ...createEmptySiteMatchCriteria(),
    zip: "60619",
    projectUse: "retail-service",
    propertyType: "existing-building",
    ...overrides,
  };
}

function neverResolvingFetchMock() {
  // Enrichment is irrelevant to Findings 2/3 — a fetch that never resolves
  // keeps `enrich` in "loading" state for the whole test, with no need to
  // await/flush anything unrelated to what's being asserted.
  return vi.fn(() => new Promise<Response>(() => {}));
}

beforeEach(() => {
  trackEventMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── Finding 2: the ACTUAL EMITTED payload, not just the helper ─────────────

describe("SiteShortlistResults — site_shortlist_generated payload (Finding 2)", () => {
  it("the ACTUAL emitted criteriaIds/criteriaBehaviors match INDEPENDENT registry lookups for every id, at the same index", () => {
    vi.stubGlobal("fetch", neverResolvingFetchMock());
    const criteria = baseCriteria({
      transportation: ["cta-rail", "cta-bus"], // one SCORE id, one UNSUPPORTED id
      amenities: ["schools", "grocery"], // one DISPLAY-ONLY id, one UNSUPPORTED id
    });

    render(
      <SiteShortlistResults
        zip="60619"
        criteria={criteria}
        scored={true}
        source={null}
        buildId="build-1"
        ranked={[candidate()]}
        boundary={null}
        centroid={{ lat: 41.75, lon: -87.605 }}
      />,
    );

    const call = trackEventMock.mock.calls.find(([eventType]) => eventType === "site_shortlist_generated");
    expect(call).toBeDefined();
    const payload = call![1] as {
      metadata: { criteriaIds: string[]; criteriaBehaviors: string[] };
    };

    expect(payload.metadata.criteriaIds.length).toBeGreaterThan(0);
    expect(payload.metadata.criteriaIds.length).toBe(payload.metadata.criteriaBehaviors.length);

    // Independent re-derivation: look up EACH emitted id's behavior via a
    // SEPARATE, direct shortlistCriterionById call and compare against what
    // the component actually emitted — not the helper's own internal
    // consistency, the component's real output.
    for (let i = 0; i < payload.metadata.criteriaIds.length; i++) {
      const independentLookup = shortlistCriterionById(payload.metadata.criteriaIds[i]);
      expect(payload.metadata.criteriaBehaviors[i]).toBe(independentLookup?.behavior);
    }
    // Sanity: this selection spans more than one behavior, so the test
    // could not pass by every emitted behavior being one hardcoded string.
    expect(new Set(payload.metadata.criteriaBehaviors).size).toBeGreaterThan(1);
    expect(payload.metadata.criteriaIds).toContain("cta-rail");
    expect(payload.metadata.criteriaIds).toContain("cta-bus");
    expect(payload.metadata.criteriaIds).toContain("schools");
  });

  it("REGRESSION GUARD: a hand-rolled per-badge count would NOT satisfy this — the emitted ids are the WIZARD criterion ids, never badge names", () => {
    vi.stubGlobal("fetch", neverResolvingFetchMock());
    const criteria = baseCriteria({ transportation: ["metra"] });
    render(
      <SiteShortlistResults
        zip="60619"
        criteria={criteria}
        scored={true}
        source={null}
        buildId="build-1"
        ranked={[candidate({ badge: "not-aligned" })]}
        boundary={null}
        centroid={{ lat: 41.75, lon: -87.605 }}
      />,
    );
    const call = trackEventMock.mock.calls.find(([eventType]) => eventType === "site_shortlist_generated");
    const payload = call![1] as { metadata: { criteriaIds: string[] } };
    expect(payload.metadata.criteriaIds).not.toContain("aligned");
    expect(payload.metadata.criteriaIds).not.toContain("not-aligned");
    expect(payload.metadata.criteriaIds).toContain("metra");
  });
});

// ── Finding 3: the RENDERED card copy, not just the engine field ───────────

describe("SiteShortlistResults — conflicted-row card copy reports the REQUESTED screening type (Finding 3)", () => {
  it("under a LAND search, a conflicted row's card reads 'screened as a land record' — even though its resolved propertyType is 'vacant_building'", () => {
    vi.stubGlobal("fetch", neverResolvingFetchMock());
    const criteria = baseCriteria({ propertyType: "vacant-land" });
    const conflicted = candidate({
      key: "conflicted-land",
      conflictingPropertyTypes: true,
      // Resolved type says building (building evidence won resolution per
      // lib/canonical-sites.ts) — but THIS search's own screening admitted
      // it via land evidence, so the card must say "land", not "building".
      propertyType: "vacant_building",
      screenedPropertyType: "vacant_land",
    });

    render(
      <SiteShortlistResults
        zip="60619"
        criteria={criteria}
        scored={false}
        source={null}
        buildId="build-1"
        ranked={[conflicted]}
        boundary={null}
        centroid={{ lat: 41.75, lon: -87.605 }}
      />,
    );

    expect(screen.getByText(/screened as a land record for this search/i)).toBeTruthy();
    expect(screen.queryByText(/screened as a building record for this search/i)).toBeNull();
  });

  it("under a BUILDING search, the SAME conflicted-row shape reads 'screened as a building record'", () => {
    vi.stubGlobal("fetch", neverResolvingFetchMock());
    const criteria = baseCriteria({ propertyType: "existing-building" });
    const conflicted = candidate({
      key: "conflicted-building",
      conflictingPropertyTypes: true,
      propertyType: "vacant_building",
      screenedPropertyType: "vacant_building",
    });

    render(
      <SiteShortlistResults
        zip="60619"
        criteria={criteria}
        scored={false}
        source={null}
        buildId="build-1"
        ranked={[conflicted]}
        boundary={null}
        centroid={{ lat: 41.75, lon: -87.605 }}
      />,
    );

    expect(screen.getByText(/screened as a building record for this search/i)).toBeTruthy();
    expect(screen.queryByText(/screened as a land record for this search/i)).toBeNull();
  });

  it("a NON-conflicted row never shows the dual-evidence flag at all", () => {
    vi.stubGlobal("fetch", neverResolvingFetchMock());
    render(
      <SiteShortlistResults
        zip="60619"
        criteria={baseCriteria()}
        scored={false}
        source={null}
        buildId="build-1"
        ranked={[candidate({ conflictingPropertyTypes: false })]}
        boundary={null}
        centroid={{ lat: 41.75, lon: -87.605 }}
      />,
    );
    expect(screen.queryByText(/screened as a .* record for this search/i)).toBeNull();
  });
});

// ── Finding 10(b): adversarial enrichment delivered AFTER MOUNT ────────────

describe("SiteShortlistResults — adversarial enrichment changes card FACTS but never DOM order/membership (Finding 10, layer b)", () => {
  it("delivering adversarial enrichment (highest value on the LAST-ranked card) after mount updates facts, but the card order in the DOM is pinned to the `ranked` prop order throughout", async () => {
    const ranked = [
      candidate({ key: "a", pin: "1", address: "1 FIRST ST", score: 40 }),
      candidate({ key: "b", pin: "2", address: "2 SECOND ST", score: 20 }),
      candidate({ key: "c", pin: "3", address: "3 THIRD ST", score: 0 }),
    ];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          // ADVERSARIAL: the LAST-ranked candidate ("c") gets the highest
          // assessed value, implied market value, and an active license —
          // every enrichment fact a value-coupled implementation would be
          // tempted to reorder on. The FIRST-ranked candidate ("a") gets
          // nothing.
          {
            key: "c",
            countyClass: "517",
            classGloss: "One-story commercial building",
            assessedValue: 50_000_000,
            assessedYear: "2024",
            impliedMarketValue: 200_000_000,
            activeLicenses: [{ name: "Big License Co", description: "Retail Food" }],
            enrichmentUnavailable: false,
          },
          {
            key: "a",
            countyClass: null,
            classGloss: null,
            assessedValue: null,
            assessedYear: null,
            impliedMarketValue: null,
            activeLicenses: [],
            enrichmentUnavailable: false,
          },
          {
            key: "b",
            countyClass: null,
            classGloss: null,
            assessedValue: null,
            assessedYear: null,
            impliedMarketValue: null,
            activeLicenses: [],
            enrichmentUnavailable: false,
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SiteShortlistResults
        zip="60619"
        criteria={baseCriteria()}
        scored={true}
        source={null}
        buildId="build-1"
        ranked={ranked}
        boundary={null}
        centroid={{ lat: 41.75, lon: -87.605 }}
      />,
    );

    const cardOrder = () => screen.getAllByRole("heading", { level: 3 }).map((el) => el.textContent);

    // Before enrichment resolves, the DOM already reflects the `ranked`
    // prop's own order — never anything else.
    expect(cardOrder()).toEqual(["1 First St", "2 Second St", "3 Third St"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/shortlist/enrich", expect.objectContaining({ method: "POST" }));

    // Wait for the adversarial enrichment to actually land — a card FACT
    // changes (the assessed value now renders for "c").
    await waitFor(() => {
      expect(screen.getByText(/\$50,000,000/)).toBeTruthy();
    });
    expect(screen.getByText(/Big License Co/)).toBeTruthy();

    // DOM order and membership are UNCHANGED — "c" now looks like the most
    // valuable record on the page by every enrichment fact, and it is
    // still rendered LAST.
    expect(cardOrder()).toEqual(["1 First St", "2 Second St", "3 Third St"]);
  });
});
