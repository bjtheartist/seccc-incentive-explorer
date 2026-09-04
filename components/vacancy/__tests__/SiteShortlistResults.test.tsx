// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { shortlistCriterionById } from "@/lib/shortlist-criteria";
import { createEmptySiteMatchCriteria, type SiteMatchCriteria } from "@/lib/site-matchmaker";
import type { CandidateOverlays, DecoratedShortlistCandidate } from "@/lib/shortlist-engine";
import { shortlistCardDomId } from "@/lib/shortlist-map-layers";

/**
 * Round-3 re-review, Findings 2, 3, and 10(b): component-level coverage for
 * SiteShortlistResults — the actual RENDERED/EMITTED surface, not just the
 * pure helpers it calls. Sol's round-3 verdict was explicit that helper-only
 * tests (lib/__tests__/shortlist-criteria.test.ts,
 * lib/__tests__/shortlist-engine.test.ts) leave the component's OWN wiring
 * unguarded — it could regress to reading the wrong field, or stop calling
 * the helper altogether, with every existing test still green.
 */

const { shortlistCsvMock, trackEventMock } = vi.hoisted(() => ({
  shortlistCsvMock: vi.fn(() => "csv-output"),
  trackEventMock: vi.fn(),
}));

vi.mock("@/lib/analytics-events", () => ({ trackEvent: trackEventMock }));
vi.mock("@/lib/shortlist-csv", () => ({
  shortlistCsv: shortlistCsvMock,
  shortlistCsvFilename: (zip: string) => `site-shortlist-${zip}.csv`,
}));
// SiteShortlistMap pulls in raw mapbox-gl (WebGL/worker APIs jsdom does not
// provide) — replaced with a no-op exactly like the page-level fail-closed
// tests already do for the whole results component.
vi.mock("@/components/vacancy/SiteShortlistMap", () => ({
  default: ({ visibleCandidateKeys }: { visibleCandidateKeys: readonly string[] }) => (
    <output data-testid="mock-map-keys">{visibleCandidateKeys.join(",")}</output>
  ),
}));
// SiteShortlistResults imports the map through SiteShortlistMapIsland, a
// next/dynamic(ssr:false) wrapper. Under jsdom that dynamic import resolves on
// a later tick, so mocking only the inner module leaves a real async boundary
// between render and the synchronous getByTestId calls below; on a loaded CI
// runner the mock had not mounted yet (3 deterministic failures on PR #272).
// Mock the island itself so the map is synchronous in this test.
vi.mock("@/components/vacancy/SiteShortlistMapIsland", () => ({
  default: ({ visibleCandidateKeys }: { visibleCandidateKeys: readonly string[] }) => (
    <output data-testid="mock-map-keys">{visibleCandidateKeys.join(",")}</output>
  ),
}));

import SiteShortlistResults, {
  assessedValueCardText,
  impliedMarketValueCardText,
} from "@/components/vacancy/SiteShortlistResults";
import type { ShortlistEnrichmentFacts } from "@/lib/site-shortlist";

function noOverlays(): CandidateOverlays {
  return {
    ssa: { present: false, name: null, unknown: false },
    ccsa: { present: false, name: null, unknown: false },
    tif: { present: false, name: null, unknown: false },
    nof: { present: false, name: null, unknown: false },
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
  shortlistCsvMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function assessmentFacts(
  overrides: Partial<ShortlistEnrichmentFacts> = {},
): ShortlistEnrichmentFacts {
  return {
    countyClass: null,
    classGloss: null,
    assessedValue: null,
    assessedYear: null,
    impliedMarketValue: null,
    activeLicenses: [],
    ...overrides,
  };
}

describe("SiteShortlistResults — assessment card source states", () => {
  it("keeps not checked, checking, and missing-response states distinct", () => {
    expect(assessedValueCardText(null, "idle")).toBe("Not checked");
    expect(impliedMarketValueCardText(null, "idle")).toBe("Not checked");
    expect(assessedValueCardText(null, "loading")).toBe("Checking…");
    expect(impliedMarketValueCardText(null, "loading")).toBe("Checking…");
    expect(assessedValueCardText(null, "loaded")).toBe("Unavailable");
    expect(impliedMarketValueCardText(null, "loaded")).toBe("Unavailable");
  });

  it.each([
    [
      "not_requested",
      "Not requested — PIN needs verification",
      "Not requested — PIN needs verification",
    ],
    ["unavailable", "Unavailable", "Unavailable"],
    ["not_published", "Not published", "Not published"],
  ] as const)("renders the %s state without collapsing it", (status, assessed, implied) => {
    const facts = assessmentFacts({ assessedValueStatus: status });
    expect(assessedValueCardText(facts, "loaded")).toBe(assessed);
    expect(impliedMarketValueCardText(facts, "loaded")).toBe(implied);
  });

  it("formats available values and normalizes decimal-looking County years", () => {
    const facts = assessmentFacts({
      countyClass: "211",
      assessedValue: 19_600,
      assessedYear: "2026.0",
      assessedStage: "mailed",
      assessedValueStatus: "available",
      impliedMarketValue: 196_000,
    });
    expect(assessedValueCardText(facts, "loaded")).toBe("$19,600 (2026 · mailed)");
    expect(impliedMarketValueCardText(facts, "loaded")).toBe("~$196,000");
  });

  it("explains why an available assessment may have no convertible implied value", () => {
    const facts = assessmentFacts({
      assessedValue: 19_600,
      assessedValueStatus: "available",
    });
    expect(impliedMarketValueCardText(facts, "loaded")).toBe("Not available for this County class");
  });
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

// ── build-spec.md PR-A item 4/6 (F8): a missing expressway-context match ──
//    is disclosed honestly, and never changes rank.

describe("SiteShortlistResults — expressway context-missing disclosure never affects rank (F8)", () => {
  it("renders the exact 'Not available in this context snapshot.' line for a candidate whose key has no context match, while a decorated candidate with EQUAL score inputs keeps its normal display and BOTH keep the ranked prop's order", () => {
    vi.stubGlobal("fetch", neverResolvingFetchMock());
    const decorated = candidate({
      key: "a",
      pin: "1",
      address: "1 First St",
      score: 10,
      expresswayDisplay: { name: "Dan Ryan Expy (I-90/94)", miles: 0.4 },
    });
    const contextMissing = candidate({
      key: "b",
      pin: "2",
      address: "2 Second St",
      score: 10, // EQUAL score inputs — a missing context match must never be
      // used as a ranking signal, so this candidate's position is decided
      // solely by the `ranked` prop order, exactly like `decorated`'s.
      expresswayDisplay: null,
    });

    render(
      <SiteShortlistResults
        zip="60619"
        criteria={baseCriteria()}
        scored={true}
        source={null}
        buildId="build-1"
        ranked={[decorated, contextMissing]}
        boundary={null}
        centroid={{ lat: 41.75, lon: -87.605 }}
      />,
    );

    // Rank: the DOM keeps the exact `ranked` prop order for both equal-score
    // candidates — the missing context match on "b" moved it nowhere.
    const cardOrder = screen.getAllByRole("heading", { level: 3 }).map((el) => el.textContent);
    expect(cardOrder).toEqual(["1 First St", "2 Second St"]);

    const decoratedCard = document.getElementById(shortlistCardDomId("a"));
    const missingCard = document.getElementById(shortlistCardDomId("b"));
    expect(decoratedCard?.textContent).toContain("Dan Ryan Expy (I-90/94)");
    expect(decoratedCard?.textContent).not.toContain("Not available in this context snapshot.");
    expect(missingCard?.textContent).toContain(
      "Expressway proximity (display only): Not available in this context snapshot.",
    );
  });
});

// ── review5 S2: overlay unknown-vs-absent must actually reach the DOM ──────

describe("SiteShortlistResults — overlay coverage disclosure (review5 S2)", () => {
  it("renders a known positive overlay AND discloses a different unknown layer on the SAME card — never 'None mapped'", () => {
    vi.stubGlobal("fetch", neverResolvingFetchMock());
    render(
      <SiteShortlistResults
        zip="60619"
        criteria={baseCriteria()}
        scored={true}
        source={null}
        buildId="build-1"
        ranked={[
          candidate({
            overlays: {
              ssa: { present: true, name: "Greater Chatham", unknown: false },
              ccsa: { present: false, name: null, unknown: false },
              tif: { present: false, name: null, unknown: true },
              nof: { present: false, name: null, unknown: false },
            },
          }),
        ]}
        boundary={null}
        centroid={{ lat: 41.75, lon: -87.605 }}
      />,
    );

    expect(screen.getByText(/SSA: Greater Chatham/)).toBeTruthy();
    expect(screen.getByText(/TIF not checked/)).toBeTruthy();
    expect(screen.queryByText(/none mapped/i)).toBeNull();
  });

  it("renders 'Not checked' — not 'None mapped' — when every overlay layer is unknown", () => {
    vi.stubGlobal("fetch", neverResolvingFetchMock());
    render(
      <SiteShortlistResults
        zip="60619"
        criteria={baseCriteria()}
        scored={true}
        source={null}
        buildId="build-1"
        ranked={[
          candidate({
            overlays: {
              ssa: { present: false, name: null, unknown: true },
              ccsa: { present: false, name: null, unknown: true },
              tif: { present: false, name: null, unknown: true },
              nof: { present: false, name: null, unknown: true },
            },
          }),
        ]}
        boundary={null}
        centroid={{ lat: 41.75, lon: -87.605 }}
      />,
    );

    expect(screen.getByText(/Not checked/)).toBeTruthy();
    expect(screen.queryByText(/none mapped/i)).toBeNull();
  });
});

describe("SiteShortlistResults — shared zoning filters", () => {
  function zoningCandidates(): DecoratedShortlistCandidate[] {
    return [
      candidate({ key: "rank-1", address: "1 B STREET", zoningDistrict: "B3-2", badge: "aligned" }),
      candidate({ key: "rank-2", address: "2 C ONE STREET", zoningDistrict: "C1-1", badge: "not-aligned" }),
      candidate({ key: "rank-3", address: "3 C TWO STREET", zoningDistrict: "C1-2", badge: "aligned" }),
      candidate({ key: "rank-4", address: "4 R STREET", zoningDistrict: "RS-2", badge: "aligned" }),
      candidate({
        key: "rank-5",
        address: "5 UNKNOWN STREET",
        zoningDistrict: null,
        zoningStatus: "unresolved",
        badge: "unresolved",
      }),
    ];
  }

  function renderZoningResults() {
    const ranked = zoningCandidates();
    const fetchMock = neverResolvingFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SiteShortlistResults
        zip="60619"
        criteria={baseCriteria()}
        scored={false}
        source={null}
        buildId="build-1"
        ranked={ranked}
        boundary={null}
        centroid={{ lat: 41.75, lon: -87.605 }}
      />,
    );
    return { fetchMock, ranked };
  }

  function visibleHeadings(): string[] {
    return screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent ?? "");
  }

  it("filters cards and mocked map through family, type, exact code, and badge while keeping original ranks", () => {
    const { fetchMock } = renderZoningResults();
    const family = screen.getByLabelText("Zoning family") as HTMLSelectElement;
    const type = screen.getByLabelText("District type") as HTMLSelectElement;
    const exact = screen.getByLabelText("Exact published code") as HTMLSelectElement;

    expect(screen.getByTestId("mock-map-keys").textContent).toBe(
      "rank-1,rank-2,rank-3,rank-4,rank-5",
    );
    expect(family.getAttribute("aria-describedby")).toBe("shortlist-zoning-disclaimer");

    fireEvent.change(family, { target: { value: "commercial" } });
    expect(screen.getByTestId("mock-map-keys").textContent).toBe("rank-1,rank-2,rank-3");
    expect(visibleHeadings()).toEqual(["1 B Street", "2 C One Street", "3 C Two Street"]);

    fireEvent.change(type, { target: { value: "C1" } });
    expect(screen.getByTestId("mock-map-keys").textContent).toBe("rank-2,rank-3");

    fireEvent.change(exact, { target: { value: "zoning-code:C1-2" } });
    expect(screen.getByTestId("mock-map-keys").textContent).toBe("rank-3");
    expect(visibleHeadings()).toEqual(["3 C Two Street"]);
    expect(document.getElementById("shortlist-card-rank-3")?.textContent).toContain("03");

    fireEvent.click(screen.getByRole("button", { name: /^Broad family alignment/ }));
    expect(screen.getByTestId("mock-map-keys").textContent).toBe("rank-3");
    expect(
      screen.getByRole("button", { name: /^Broad family alignment/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clears incompatible descendants, exposes unresolved records, and resets every filter", () => {
    renderZoningResults();
    const family = screen.getByLabelText("Zoning family") as HTMLSelectElement;
    const type = screen.getByLabelText("District type") as HTMLSelectElement;
    const exact = screen.getByLabelText("Exact published code") as HTMLSelectElement;

    fireEvent.change(family, { target: { value: "commercial" } });
    fireEvent.change(type, { target: { value: "C1" } });
    fireEvent.change(exact, { target: { value: "zoning-code:C1-2" } });
    fireEvent.change(family, { target: { value: "residential" } });
    expect(type.value).toBe("");
    expect(exact.value).toBe("");
    expect(screen.getByTestId("mock-map-keys").textContent).toBe("rank-4");

    fireEvent.change(family, { target: { value: "zoning:unresolved" } });
    expect(type.disabled).toBe(true);
    expect(exact.disabled).toBe(true);
    expect(screen.getByTestId("mock-map-keys").textContent).toBe("rank-5");
    expect(visibleHeadings()).toEqual(["5 Unknown Street"]);

    const resetButtons = screen.getAllByRole("button", { name: "Reset all filters" });
    fireEvent.click(resetButtons[resetButtons.length - 1]);
    expect(family.value).toBe("");
    expect(screen.getByTestId("mock-map-keys").textContent).toBe(
      "rank-1,rank-2,rank-3,rank-4,rank-5",
    );
    expect(screen.getByText("Showing 5 of 5 ranked candidates")).toBeTruthy();
  });

  it("combines filters into an accessible zero state with a working reset", () => {
    renderZoningResults();
    fireEvent.click(screen.getByRole("button", { name: /^No broad family alignment/ }));
    fireEvent.change(screen.getByLabelText("Zoning family"), {
      target: { value: "residential" },
    });
    expect(screen.getByTestId("mock-map-keys").textContent).toBe("");
    expect(screen.getByText("No records match these filters")).toBeTruthy();
    const resetButtons = screen.getAllByRole("button", { name: "Reset all filters" });
    fireEvent.click(resetButtons[resetButtons.length - 1]);
    expect(screen.queryByText("No records match these filters")).toBeNull();
    expect(screen.getByTestId("mock-map-keys").textContent).toBe(
      "rank-1,rank-2,rank-3,rank-4,rank-5",
    );
  });

  it("keeps CSV membership and order on the full ranked shortlist after filtering", () => {
    const { ranked } = renderZoningResults();
    fireEvent.change(screen.getByLabelText("Zoning family"), {
      target: { value: "residential" },
    });
    const OriginalURL = URL;
    class TestURL extends OriginalURL {
      static createObjectURL = vi.fn(() => "blob:test");
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", TestURL);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Download the full shortlist (CSV)" }));
    expect(shortlistCsvMock).toHaveBeenCalledWith(
      ranked,
      expect.any(Object),
      expect.any(Object),
      "60619",
    );
  });
});

// ── Precomputed exact-match PINs (lib/shortlist-parcel-identity.ts) ─────────

describe("SiteShortlistResults — a precomputed exact-match PIN behaves like a known PIN, honestly labeled", () => {
  const CHECKED_AT = "2026-08-16T03:58:31.254Z";

  function precomputed(overrides: Partial<DecoratedShortlistCandidate> = {}) {
    return candidate({
      key: "site:precomputed",
      pin: "16264270400000",
      address: "3040 S HOMAN AVE",
      pinProvenance: {
        source: "coordinate_exact_precomputed",
        checkedAt: CHECKED_AT,
        countyAddress: "3040 S HOMAN AVE, CHICAGO, IL 60623",
      },
      ...overrides,
    });
  }

  function batchEnrichmentMock() {
    return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        items: [
          {
            key: "site:precomputed",
            countyClass: "517",
            classGloss: "One-story commercial building",
            countyClassStatus: "available",
            lotAreaSqft: 3125,
            lotAreaStatus: "available",
            assessorBuildingSqft: 1800,
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
      }),
    }));
  }

  function renderPrecomputed(fetchMock: ReturnType<typeof batchEnrichmentMock>) {
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SiteShortlistResults
        zip="60623"
        criteria={baseCriteria()}
        scored={true}
        source={null}
        buildId="build-1"
        ranked={[precomputed()]}
        boundary={null}
        centroid={{ lat: 41.84, lon: -87.71 }}
      />,
    );
  }

  it("joins the load-time enrichment batch and shows County facts on the CARD FACE with no resolve-parcel call", async () => {
    const fetchMock = batchEnrichmentMock();
    renderPrecomputed(fetchMock);

    // The batch keys off candidate.pin, so the precomputed PIN is in it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/shortlist/enrich");
    expect(String(init?.body)).toContain("16264270400000");

    await waitFor(() => expect(screen.getByText(/\$6,900/)).toBeTruthy());
    expect(screen.getByText(/~\$27,600/)).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(([called]) => String(called).includes("/api/shortlist/resolve-parcel")),
    ).toHaveLength(0);
  });

  it("labels the card PIN as an exact current-County match with its check date — never as a snapshot publication", async () => {
    renderPrecomputed(batchEnrichmentMock());
    await waitFor(() => expect(screen.getByText(/\$6,900/)).toBeTruthy());
    const label = screen.getByText(/PIN 16-26-427-040-0000/);
    expect(label.textContent).toContain("resolved from current County parcel");
    expect(label.textContent).toContain("checked Aug 15, 2026");
    expect(label.textContent).not.toContain("saved shortlist snapshot");
  });

  it("opens Parcel details straight from the batch facts — zero extra fetches, no resolution round trip", async () => {
    const fetchMock = batchEnrichmentMock();
    renderPrecomputed(fetchMock);
    await waitFor(() => expect(screen.getByText(/\$6,900/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Parcel details" }));
    const dialog = await screen.findByRole("dialog", { name: "3040 S HOMAN AVE" });
    await waitFor(() => expect(dialog.textContent).toContain("$6,900"));
    expect(dialog.textContent).toContain("3,125 sq ft");
    expect(dialog.textContent).toContain("current County parcel resolved by exact map-point intersection");
    expect(dialog.textContent).toContain("checked Aug 15, 2026");
    expect(dialog.textContent).not.toContain("published in the saved shortlist snapshot");
    // The whole point of the precompute: opening a card costs nothing extra.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still calls a genuinely published PIN a saved-snapshot PIN", async () => {
    const fetchMock = batchEnrichmentMock();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SiteShortlistResults
        zip="60623"
        criteria={baseCriteria()}
        scored={true}
        source={null}
        buildId="build-1"
        ranked={[precomputed({ pinProvenance: { source: "saved_snapshot" } })]}
        boundary={null}
        centroid={{ lat: 41.84, lon: -87.71 }}
      />,
    );
    await waitFor(() => expect(screen.getByText(/\$6,900/)).toBeTruthy());
    const label = screen.getByText(/PIN 16-26-427-040-0000/);
    expect(label.textContent).not.toContain("resolved from current County parcel");

    fireEvent.click(screen.getByRole("button", { name: "Parcel details" }));
    const dialog = await screen.findByRole("dialog", { name: "3040 S HOMAN AVE" });
    expect(dialog.textContent).toContain("published in the saved shortlist snapshot");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
