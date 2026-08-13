/**
 * SHORTLIST CRITERION REGISTRY — the single source of truth for what every
 * wizard-collected Site Matchmaker criterion actually DOES to a ranked
 * shortlist.
 *
 * Born from the gpt5.6 matchmaker consult's Q4 attack on the old engine: the
 * prior scoring function awarded nearest-rail, arterial, incentive,
 * sweet-spot, and distress points on EVERY request, whether or not the
 * reader ever asked for any of them — a "no transit search" result was still
 * heavily rail-ranked. That is not criteria-relative scoring; it is a fixed
 * weighting dressed up as personalization.
 *
 * This registry is the fix: ONE table, keyed by the exact criterion the
 * wizard collects (see lib/site-matchmaker.ts's `SiteTransportationNeed`,
 * `SiteAmenityNeed`, and the standalone fields), each with a `behavior` that
 * drives FOUR different consumers from the same fact instead of four things
 * that can drift apart:
 *   1. lib/shortlist-engine.ts   — which criteria may screen, which may
 *      score, and (the point of this file) which may NEVER do either.
 *   2. The shortlist UI          — every unsupported/display-only criterion
 *      renders its own honest label instead of silently doing nothing.
 *   3. Analytics                 — which criteria were selected on a given
 *      run, independent of whether they had any ranking effect.
 *   4. Tests                     — "Registry-UI binding": every
 *      wizard-collected criterion must appear here, and every
 *      unsupported/display-only one must render its label somewhere.
 *
 * v1 BEHAVIORS (binding — see the PR2 build spec's ruling, itself drawn from
 * the consult's Q4 table):
 *   SCREEN        propertyType, the measured-area band, and the selected
 *                 CTA/Metra network's distance cutoff (against the SELECTED
 *                 system only — never "any system").
 *   SCORE         transit proximity, and ONLY when a transit need with a
 *                 network the row can be measured against was selected.
 *                 Nothing else scores in v1.
 *   DISPLAY-ONLY  measured and shown on every card, but incapable of moving
 *                 a candidate's membership or rank: expressway proximity,
 *                 school/library distance, and (only when no transit
 *                 criterion was selected) the nearest-rail fact.
 *   UNSUPPORTED   labeled in the UI, zero ranking effect, because the repo
 *                 has no committed input that actually measures the concept
 *                 the wizard names: context (vacancy density is not
 *                 neighborhood context and would be circular), pedestrian
 *                 activity (no foot-traffic input exists), walkability
 *                 (until an EPA layer lands), CTA bus (no committed
 *                 stop/frequency input), freight rail (proximity does not
 *                 establish access), bike routes (no committed/typed/current
 *                 route input), grocery (the committed City table is
 *                 stale), and parks (the export uses locator centroids,
 *                 unfit for distance scoring).
 *
 * PURE. No fs, no Next runtime — every consumer (engine, UI, scripts, tests)
 * imports this table directly.
 */

import type { SiteProjectUse } from "./site-matchmaker";

export type ShortlistCriterionBehavior = "screen" | "score" | "display-only" | "unsupported";

export interface ShortlistCriterionEntry {
  /** Stable id. Matches the wizard's own value space 1:1 (a
   *  `SiteTransportationNeed`/`SiteAmenityNeed` member, or one of the four
   *  standalone-field ids below) so a UI label lookup never needs a second
   *  translation table. */
  id: string;
  label: string;
  behavior: ShortlistCriterionBehavior;
  /** Where the underlying fact comes from — a committed export, a live
   *  request-time source, or "none" for an unsupported concept. */
  source: string;
  /** Vintage/currency caveat a reader should see alongside the fact, or
   *  null when the source is refreshed at build time with no meaningful lag. */
  vintage: string | null;
  /** The sentence rendered wherever this criterion's behavior needs
   *  explaining — a card badge, a filter tooltip, or the criteria chips. */
  explanation: string;
}

export const SHORTLIST_CRITERION_REGISTRY: readonly ShortlistCriterionEntry[] = [
  // ── Screens ──────────────────────────────────────────────────────────────
  {
    id: "project-use",
    label: "Project use",
    behavior: "display-only",
    source: "Site Matchmaker wizard, matched against the mapped zoning district family",
    vintage: null,
    explanation:
      "Combines with the mapped zoning district family to produce the badge shown on every card. It does not filter which records appear or change their order — every candidate in this ZIP that passes the other screens is ranked the same way regardless of project use.",
  },
  {
    id: "property-type",
    label: "Property type",
    behavior: "screen",
    source: "canonical universe evidence fields (hasVacantBuildingEvidence / hasVacantLandEvidence)",
    vintage: null,
    explanation:
      "A building search keeps only canonical sites carrying building evidence with a resolved PIN and a published measured area; a land search keeps sites carrying land evidence. Records that do not clear this screen never reach the ranked list, but they are counted in the funnel.",
  },
  {
    id: "square-footage",
    label: "Size band (min / max sq ft)",
    behavior: "screen",
    source: "canonical universe measured area (assessor building area or lot area)",
    vintage: null,
    explanation:
      "A closed band screens OUT any candidate with no published measurement, not just ones outside the range — a shortlist card asserts a size, so an unmeasured site cannot earn a place on one while a band is set.",
  },
  {
    id: "transportation-distance",
    label: "Transportation distance",
    behavior: "screen",
    source: "committed CTA + Metra station coordinates (public/data/rail-stations.json)",
    vintage: null,
    explanation:
      "Screens against the SELECTED network(s) only (CTA rail and/or Metra) — never against every system a station file happens to carry. Selecting a distance with no rail network chosen, or choosing bus/expressway/freight/bike, applies no distance screen at all.",
  },
  // ── Score ────────────────────────────────────────────────────────────────
  {
    id: "cta-rail",
    label: "CTA rail",
    behavior: "score",
    source: "committed CTA station coordinates (public/data/rail-stations.json)",
    vintage: null,
    explanation:
      "When selected, candidates score higher the closer they sit to the nearest CTA station — proximity to Metra is never mixed into this score, and the score is zero unless CTA rail was actually chosen.",
  },
  {
    id: "metra",
    label: "Metra",
    behavior: "score",
    source: "committed Metra station coordinates (public/data/rail-stations.json)",
    vintage: null,
    explanation:
      "When selected, candidates score higher the closer they sit to the nearest Metra station — proximity to CTA rail is never mixed into this score, and the score is zero unless Metra was actually chosen.",
  },
  // ── Display-only ─────────────────────────────────────────────────────────
  {
    id: "expressway",
    label: "Expressway proximity",
    behavior: "display-only",
    source: "named expressway centerlines (public/data/site-matchmaker-context)",
    vintage: null,
    explanation:
      "Shown as a straight-line centerline distance on every card. This is proximity, not ramp access — it never screens or scores a candidate, selected or not.",
  },
  {
    id: "schools",
    label: "Schools",
    behavior: "display-only",
    source: "Chicago Public Schools locations (public/data/school-points.json)",
    vintage: "SY2526 edition",
    explanation:
      "Shown as a straight-line distance to the nearest mapped public school. Measured and displayed for every candidate; never affects membership or order, selected or not.",
  },
  {
    id: "libraries",
    label: "Libraries",
    behavior: "display-only",
    source: "Chicago Public Library branch locations (public/data/library-points.json)",
    vintage: null,
    explanation:
      "Shown as a straight-line distance to the nearest Chicago Public Library branch. Measured and displayed for every candidate; never affects membership or order, selected or not.",
  },
  // ── Unsupported ──────────────────────────────────────────────────────────
  {
    id: "context",
    label: "Development context",
    behavior: "unsupported",
    source: "none",
    vintage: null,
    explanation:
      "No committed input measures neighborhood context independent of the vacancy inventory itself — scoring on it would be circular (denser vacancy would just mean a \"better\" context). This selection has zero effect on the shortlist.",
  },
  {
    id: "walkability",
    label: "Walkability",
    behavior: "unsupported",
    source: "none (until an EPA walkability layer is wired into this workflow)",
    vintage: null,
    explanation:
      "Not yet wired into the shortlist engine. This selection has zero effect on the shortlist.",
  },
  {
    id: "pedestrian-activity",
    label: "Pedestrian activity",
    behavior: "unsupported",
    source: "none",
    vintage: null,
    explanation:
      "No committed foot-traffic input exists — population density and walkability are not the same thing as pedestrian activity. This selection has zero effect on the shortlist.",
  },
  {
    id: "cta-bus",
    label: "CTA bus",
    behavior: "unsupported",
    source: "none",
    vintage: null,
    explanation:
      "No committed stop-location or service-frequency input exists for CTA bus. This selection has zero effect on the shortlist.",
  },
  {
    id: "freight-rail",
    label: "Freight rail",
    behavior: "unsupported",
    source: "none",
    vintage: null,
    explanation:
      "Proximity to a freight line does not establish freight access. This selection has zero effect on the shortlist.",
  },
  {
    id: "bike-routes",
    label: "Bike routes",
    behavior: "unsupported",
    source: "none",
    vintage: null,
    explanation:
      "No committed, typed, current bike-route input exists. This selection has zero effect on the shortlist.",
  },
  {
    id: "restaurants-retail",
    label: "Restaurants and retail",
    behavior: "unsupported",
    source: "none",
    vintage: null,
    explanation:
      "No committed input measures nearby restaurant/retail density in a way this engine can rank on. This selection has zero effect on the shortlist.",
  },
  {
    id: "grocery",
    label: "Grocery",
    behavior: "unsupported",
    source: "City grocery-store table (data.cityofchicago.org/3e26-zek2) — stale",
    vintage: "not maintained by the City since publication",
    explanation:
      "The committed grocery table is a dataset the City no longer maintains — openings and closings since are not reflected, so it cannot honestly rank candidates. This selection has zero effect on the shortlist.",
  },
  {
    id: "medical-health",
    label: "Medical and health",
    behavior: "unsupported",
    source: "none",
    vintage: null,
    explanation:
      "No committed input measures nearby medical/health services in a way this engine can rank on. This selection has zero effect on the shortlist.",
  },
  {
    id: "parks-open-space",
    label: "Parks and open space",
    behavior: "unsupported",
    source: "Chicago Park District locator points (data.cityofchicago.org/ejsh-fztr)",
    vintage: null,
    explanation:
      "The committed export carries one locator point per park, not a boundary — centroid-to-point distance is not a fair \"distance to a park\" and would misrank irregularly shaped or very large parks. This selection has zero effect on the shortlist.",
  },
] as const;

export type ShortlistCriterionId = (typeof SHORTLIST_CRITERION_REGISTRY)[number]["id"];

const REGISTRY_BY_ID = new Map<string, ShortlistCriterionEntry>(
  SHORTLIST_CRITERION_REGISTRY.map((entry) => [entry.id, entry]),
);

export function shortlistCriterionById(id: string): ShortlistCriterionEntry | null {
  return REGISTRY_BY_ID.get(id) ?? null;
}

export function shortlistCriteriaByBehavior(
  behavior: ShortlistCriterionBehavior,
): ShortlistCriterionEntry[] {
  return SHORTLIST_CRITERION_REGISTRY.filter((entry) => entry.behavior === behavior);
}

/**
 * Which registry ids are "live" for one submitted criteria object — i.e.
 * which criteria the reader actually selected. Used both by the engine
 * (to know which score components to compute) and by the UI (to know which
 * unsupported/display-only labels are worth surfacing for THIS request,
 * versus the full catalog).
 */
export interface SelectedShortlistCriteria {
  projectUse: SiteProjectUse | null;
  propertyType: boolean;
  squareFootage: boolean;
  transportation: readonly string[];
  transportationDistance: boolean;
  context: boolean;
  walkability: boolean;
  pedestrianActivity: boolean;
  amenities: readonly string[];
}

export function selectedShortlistCriterionIds(selection: SelectedShortlistCriteria): string[] {
  const ids: string[] = [];
  if (selection.projectUse) ids.push("project-use");
  if (selection.propertyType) ids.push("property-type");
  if (selection.squareFootage) ids.push("square-footage");
  ids.push(...selection.transportation);
  if (selection.transportationDistance) ids.push("transportation-distance");
  if (selection.context) ids.push("context");
  if (selection.walkability) ids.push("walkability");
  if (selection.pedestrianActivity) ids.push("pedestrian-activity");
  ids.push(...selection.amenities);
  return ids;
}

/**
 * REGISTRY-UI BINDING (see this file's header, point 2): the selected
 * criteria whose registry behavior is "unsupported" or "display-only",
 * resolved to their full entry so the UI can render each one's own honest
 * label and explanation. A reader who picked "Walkability" or "Grocery"
 * sees exactly why it did nothing, in the same words the registry and the
 * tests both read — never silence, and never a generic "no effect".
 */
export function selectedNonScoringCriteria(
  selection: SelectedShortlistCriteria,
): ShortlistCriterionEntry[] {
  const ids = new Set(selectedShortlistCriterionIds(selection));
  return SHORTLIST_CRITERION_REGISTRY.filter(
    (entry) =>
      ids.has(entry.id) && (entry.behavior === "unsupported" || entry.behavior === "display-only"),
  );
}
