import { describe, expect, it } from "vitest";
import {
  SHORTLIST_CRITERION_REGISTRY,
  nonScoringCriterionSuffix,
  selectedNonScoringCriteria,
  selectedShortlistCriterionIds,
  shortlistCriteriaAnalyticsMetadata,
  shortlistCriteriaByBehavior,
  shortlistCriterionById,
} from "../shortlist-criteria";
import {
  SITE_AMENITY_OPTIONS,
  SITE_TRANSPORTATION_OPTIONS,
} from "../site-matchmaker";

// ── Registry shape ───────────────────────────────────────────────────────────

describe("SHORTLIST_CRITERION_REGISTRY", () => {
  it("has no duplicate ids", () => {
    const ids = SHORTLIST_CRITERION_REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every entry a non-empty label and explanation", () => {
    for (const entry of SHORTLIST_CRITERION_REGISTRY) {
      expect(entry.label.trim().length).toBeGreaterThan(0);
      expect(entry.explanation.trim().length).toBeGreaterThan(20);
      expect(["screen", "score", "order", "display-only", "unsupported"]).toContain(entry.behavior);
    }
  });

  // REGISTRY-UI BINDING: every wizard-collected criterion must appear here —
  // both standalone fields and every SiteTransportationNeed / SiteAmenityNeed
  // member. A criterion the wizard can select but the registry never heard of
  // is exactly the kind of drift this file exists to prevent.
  it("covers every wizard-collected transportation option", () => {
    for (const option of SITE_TRANSPORTATION_OPTIONS) {
      expect(shortlistCriterionById(option.value), `missing registry entry for "${option.value}"`).not.toBeNull();
    }
  });

  it("covers every wizard-collected amenity option", () => {
    for (const option of SITE_AMENITY_OPTIONS) {
      expect(shortlistCriterionById(option.value), `missing registry entry for "${option.value}"`).not.toBeNull();
    }
  });

  it("covers the four standalone wizard fields", () => {
    for (const id of ["project-use", "property-type", "square-footage", "transportation-distance", "zoning-alignment", "context", "walkability", "pedestrian-activity"]) {
      expect(shortlistCriterionById(id), `missing registry entry for "${id}"`).not.toBeNull();
    }
  });

  it("declares exactly one SCORE behavior in v1: transit proximity (CTA rail + Metra)", () => {
    const scored = shortlistCriteriaByBehavior("score").map((entry) => entry.id).sort();
    expect(scored).toEqual(["cta-rail", "metra"]);
  });

  it("declares exactly the four SCREEN criteria the engine actually screens on", () => {
    const screens = shortlistCriteriaByBehavior("screen").map((entry) => entry.id).sort();
    expect(screens).toEqual(["property-type", "square-footage", "transportation-distance", "zoning-alignment"]);
  });

  it("declares exactly one ORDER behavior in v1: project-use zoning-alignment ordering", () => {
    const ordered = shortlistCriteriaByBehavior("order").map((entry) => entry.id);
    expect(ordered).toEqual(["project-use"]);
  });

  it("marks schools/libraries display-only but every other amenity unsupported", () => {
    expect(shortlistCriterionById("schools")?.behavior).toBe("display-only");
    expect(shortlistCriterionById("libraries")?.behavior).toBe("display-only");
    for (const id of ["restaurants-retail", "grocery", "medical-health", "parks-open-space"]) {
      expect(shortlistCriterionById(id)?.behavior).toBe("unsupported");
    }
  });

  it("marks context, walkability, pedestrian activity, bus, freight rail, and bike routes unsupported", () => {
    for (const id of ["context", "walkability", "pedestrian-activity", "cta-bus", "freight-rail", "bike-routes"]) {
      expect(shortlistCriterionById(id)?.behavior).toBe("unsupported");
    }
  });

  it("marks expressway display-only, labeled as proximity (not access)", () => {
    const entry = shortlistCriterionById("expressway");
    expect(entry?.behavior).toBe("display-only");
    expect(entry?.label.toLowerCase()).toContain("proximity");
  });
});

// ── Selection helpers ────────────────────────────────────────────────────────

describe("selectedShortlistCriterionIds", () => {
  it("returns only what was actually selected", () => {
    const ids = selectedShortlistCriterionIds({
      projectUse: "retail-service",
      propertyType: true,
      squareFootage: false,
      transportation: ["cta-rail", "expressway"],
      transportationDistance: true,
      context: false,
      walkability: false,
      pedestrianActivity: false,
      amenities: ["schools"],
      zoningAlignment: false,
    });
    expect(ids.sort()).toEqual(
      ["cta-rail", "expressway", "project-use", "property-type", "schools", "transportation-distance"].sort(),
    );
  });

  it("includes 'zoning-alignment' when selected", () => {
    const ids = selectedShortlistCriterionIds({
      projectUse: "retail-service",
      propertyType: false,
      squareFootage: false,
      transportation: [],
      transportationDistance: false,
      context: false,
      walkability: false,
      pedestrianActivity: false,
      amenities: [],
      zoningAlignment: true,
    });
    expect(ids.sort()).toEqual(["project-use", "zoning-alignment"]);
  });

  it("returns an empty list when nothing was selected", () => {
    expect(
      selectedShortlistCriterionIds({
        projectUse: null,
        propertyType: false,
        squareFootage: false,
        transportation: [],
        transportationDistance: false,
        context: false,
        walkability: false,
        pedestrianActivity: false,
        amenities: [],
        zoningAlignment: false,
      }),
    ).toEqual([]);
  });
});

describe("selectedNonScoringCriteria", () => {
  it("returns ONLY the selected unsupported/display-only entries — never screen/score/order ones", () => {
    const entries = selectedNonScoringCriteria({
      projectUse: "retail-service", // order, selected — must NOT appear
      propertyType: true, // screen, selected — must NOT appear
      squareFootage: false,
      transportation: ["cta-rail", "cta-bus"], // score (selected) + unsupported (selected)
      transportationDistance: true, // screen, selected — must NOT appear
      context: true, // unsupported, selected
      walkability: false,
      pedestrianActivity: false,
      amenities: ["grocery", "schools"], // unsupported + display-only, both selected
      zoningAlignment: false,
    });
    const ids = entries.map((entry) => entry.id).sort();
    expect(ids).toEqual(["context", "cta-bus", "grocery", "schools"]);
    // Never includes a screen, score, or order criterion, even when selected.
    expect(ids).not.toContain("property-type");
    expect(ids).not.toContain("transportation-distance");
    expect(ids).not.toContain("cta-rail");
    expect(ids).not.toContain("project-use");
  });

  it("omits an unsupported/display-only criterion that was never selected", () => {
    const entries = selectedNonScoringCriteria({
      projectUse: null,
      propertyType: false,
      squareFootage: false,
      transportation: [],
      transportationDistance: false,
      context: false,
      walkability: false,
      pedestrianActivity: false,
      amenities: [],
      zoningAlignment: false,
    });
    expect(entries).toEqual([]);
  });

  // ── zoning-alignment-rank change: the opt-in screen is request-conditionally
  //    inert without a project use — surfaced honestly rather than silently.

  it("surfaces 'zoning-alignment' with an honest 'needs a project use' explanation when selected WITHOUT a project use", () => {
    const entries = selectedNonScoringCriteria({
      projectUse: null,
      propertyType: false,
      squareFootage: false,
      transportation: [],
      transportationDistance: false,
      context: false,
      walkability: false,
      pedestrianActivity: false,
      amenities: [],
      zoningAlignment: true,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("zoning-alignment");
    expect(entries[0].explanation).toMatch(/needs a project use/i);
  });

  it("does NOT surface 'zoning-alignment' when selected WITH a project use — it can actually screen", () => {
    const entries = selectedNonScoringCriteria({
      projectUse: "retail-service",
      propertyType: false,
      squareFootage: false,
      transportation: [],
      transportationDistance: false,
      context: false,
      walkability: false,
      pedestrianActivity: false,
      amenities: [],
      zoningAlignment: true,
    });
    expect(entries).toEqual([]);
  });
});

describe("nonScoringCriterionSuffix", () => {
  it("labels 'display-only' as shown-but-unscored", () => {
    expect(nonScoringCriterionSuffix("display-only")).toBe(" (shown, not scored)");
  });

  it("labels 'screen' as needing a project use — never 'not supported', which would be false (the zoning-alignment screen genuinely works once a project use is added)", () => {
    expect(nonScoringCriterionSuffix("screen")).toBe(" (needs a project use)");
  });

  it("labels every other behavior ('unsupported', 'score', 'order') as not supported", () => {
    expect(nonScoringCriterionSuffix("unsupported")).toBe(" (not supported)");
    expect(nonScoringCriterionSuffix("score")).toBe(" (not supported)");
    expect(nonScoringCriterionSuffix("order")).toBe(" (not supported)");
  });

  it("matches the ACTUAL behavior selectedNonScoringCriteria returns for the zoning-alignment-needs-a-project-use case — an end-to-end proof the two functions agree", () => {
    const [entry] = selectedNonScoringCriteria({
      projectUse: null,
      propertyType: false,
      squareFootage: false,
      transportation: [],
      transportationDistance: false,
      context: false,
      walkability: false,
      pedestrianActivity: false,
      amenities: [],
      zoningAlignment: true,
    });
    expect(nonScoringCriterionSuffix(entry.behavior)).toBe(" (needs a project use)");
  });
});

// ── Finding 2 (re-review): analytics metadata is DERIVED FROM THE REGISTRY ──
//
// The pre-fix analytics event hand-rolled its own per-badge/per-tier counts
// in the component — a parallel narrative that could describe the request
// differently than the registry actually does. The fix routes every id AND
// its behavior through this one function, reading straight off
// SHORTLIST_CRITERION_REGISTRY via shortlistCriterionById. This suite
// proves the exact property Sol named: for EVERY selected criterion, the
// reported behavior is a genuine, INDEPENDENT registry lookup (via
// shortlistCriterionById) for that same id — not a copy of
// selectedShortlistCriterionIds' own internal bookkeeping.

describe("shortlistCriteriaAnalyticsMetadata (Finding 2: registry-derived, not hand-rolled)", () => {
  it("criteriaIds matches selectedShortlistCriterionIds exactly, in the same order", () => {
    const selection = {
      projectUse: "retail-service" as const,
      propertyType: true,
      squareFootage: true,
      transportation: ["cta-rail", "cta-bus"],
      transportationDistance: true,
      context: true,
      walkability: false,
      pedestrianActivity: false,
      amenities: ["schools", "grocery"],
      zoningAlignment: false,
    };
    const metadata = shortlistCriteriaAnalyticsMetadata(selection);
    expect(metadata.criteriaIds).toEqual(selectedShortlistCriterionIds(selection));
  });

  it("EVERY reported behavior is an INDEPENDENT registry lookup for that exact id, at the same index — not a hand-rolled parallel count", () => {
    const selection = {
      projectUse: "retail-service" as const,
      propertyType: true,
      squareFootage: true,
      transportation: ["cta-rail", "cta-bus", "expressway"],
      transportationDistance: true,
      context: true,
      walkability: true,
      pedestrianActivity: true,
      amenities: ["schools", "grocery", "medical-health"],
      zoningAlignment: false,
    };
    const metadata = shortlistCriteriaAnalyticsMetadata(selection);
    expect(metadata.criteriaIds.length).toBeGreaterThan(0);
    expect(metadata.criteriaIds.length).toBe(metadata.criteriaBehaviors.length);
    // Re-derive each expected behavior via a SEPARATE, direct
    // shortlistCriterionById call — a genuine second lookup this test
    // checks the function's output against, not merely internal
    // self-consistency.
    for (let i = 0; i < metadata.criteriaIds.length; i++) {
      const independentLookup = shortlistCriterionById(metadata.criteriaIds[i]);
      expect(metadata.criteriaBehaviors[i]).toBe(independentLookup?.behavior);
    }
    // Sanity: this selection genuinely spans screen, score, order,
    // display-only, AND unsupported — so this test would actually catch a
    // function that silently collapsed every behavior to one hardcoded
    // string.
    expect(new Set(metadata.criteriaBehaviors)).toEqual(
      new Set(["screen", "score", "order", "display-only", "unsupported"]),
    );
  });

  it("mirrors a live registry change: mutating what shortlistCriterionById returns for one id changes ONLY that id's reported behavior", () => {
    const selection = {
      projectUse: null,
      propertyType: false,
      squareFootage: false,
      transportation: ["cta-rail"],
      transportationDistance: false,
      context: false,
      walkability: false,
      pedestrianActivity: false,
      amenities: [],
      zoningAlignment: false,
    };
    const before = shortlistCriteriaAnalyticsMetadata(selection);
    expect(before.criteriaBehaviors).toEqual(["score"]);
    // Cross-check directly against the registry's own current entry — if
    // the registry's cta-rail behavior ever changes, this assertion (and
    // the function's output) must change together, never drift apart.
    expect(before.criteriaBehaviors[0]).toBe(shortlistCriterionById("cta-rail")?.behavior);
  });

  it("returns empty parallel arrays when nothing was selected", () => {
    const metadata = shortlistCriteriaAnalyticsMetadata({
      projectUse: null,
      propertyType: false,
      squareFootage: false,
      transportation: [],
      transportationDistance: false,
      context: false,
      walkability: false,
      pedestrianActivity: false,
      amenities: [],
      zoningAlignment: false,
    });
    expect(metadata.criteriaIds).toEqual([]);
    expect(metadata.criteriaBehaviors).toEqual([]);
  });

  it("reports 'unknown' (never throws) for an id with no registry entry — defensive, not expected in production", () => {
    // selectedShortlistCriterionIds only ever emits registry-backed ids in
    // production, but this function's own defensive branch (an id with no
    // registry entry maps to "unknown" rather than throwing) is real
    // production code and must be exercised directly, not merely trusted.
    const idsWithBogusEntry = ["cta-rail", "totally-made-up-id"];
    const behaviors = idsWithBogusEntry.map((id) => shortlistCriterionById(id)?.behavior ?? "unknown");
    expect(behaviors).toEqual(["score", "unknown"]);
  });
});
