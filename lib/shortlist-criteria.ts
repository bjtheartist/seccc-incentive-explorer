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
 *   SCREEN        propertyType, the measured-area band, the selected
 *                 CTA/Metra network's distance cutoff (against the SELECTED
 *                 system only — never "any system"), and (added for the
 *                 zoning-alignment-rank change) the opt-in
 *                 `zoningAlignment: "aligned-only"` screen — itself a no-op
 *                 unless a projectUse is ALSO selected (see the
 *                 "zoning-alignment" entry below and
 *                 `SCREEN_HANDLERS["zoning-alignment"]` in
 *                 lib/shortlist-engine.ts).
 *   SCORE         transit proximity, and ONLY when a transit need with a
 *                 network the row can be measured against was selected.
 *                 Nothing else scores in v1 — a NUMERIC contribution to
 *                 `RankedShortlistCandidate.score` and the `scored` flag,
 *                 distinct from ORDER below.
 *   ORDER         projectUse — added for the zoning-alignment-rank change.
 *                 Orders by district-family alignment (`zoningBadgeFor`):
 *                 aligned, then planned-development, then not-aligned, then
 *                 unresolved. PRIMARY key on the unscored path (ahead of
 *                 record completeness); TIEBREAK on the scored path (after
 *                 transit score, before canonicalKey). Deliberately NOT
 *                 "score": it never contributes to the numeric `score` field
 *                 or flips the `scored` flag. With no projectUse selected,
 *                 every candidate ranks identically here (badge is never a
 *                 real alignment read without a use to compare against), so
 *                 the order is byte-identical to before this criterion
 *                 existed.
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

export type ShortlistCriterionBehavior = "screen" | "score" | "order" | "display-only" | "unsupported";

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
    behavior: "order",
    source: "Site Matchmaker wizard, matched against the mapped zoning district family",
    vintage: null,
    explanation:
      "Combines with the mapped zoning district family to produce the badge shown on every card, and orders results by that badge — aligned first, then site-specific (PD/PMD), then not-aligned, then unresolved. This is the PRIMARY order when no transit criterion is scored, and a TIEBREAK (after transit score) when one is. It never removes a candidate on its own — pair it with the 'Aligned zoning families only' screen to do that. With no project use selected, every candidate ranks identically here, so results are ordered exactly as if this criterion did not exist.",
  },
  {
    id: "property-type",
    label: "Property type",
    behavior: "screen",
    source: "canonical universe evidence fields (hasVacantBuildingEvidence / hasVacantLandEvidence)",
    vintage: null,
    explanation:
      "A building search keeps only canonical sites carrying building evidence; a land search keeps sites carrying land evidence; 'either' keeps sites carrying either. This is the ONLY test — a resolved PIN and a published measurement are NOT required to clear it (they are separate, non-gating funnel diagnostics in v1, shown so a reader can see how much of the field lacks them without that absence silently emptying the results). Records that do not carry the requested evidence never reach the ranked list, but they are counted in the funnel.",
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
  {
    id: "zoning-alignment",
    label: "Aligned zoning families only",
    behavior: "screen",
    source: "derived from the same `zoningBadgeFor` district-family read the card badge already publishes",
    vintage: null,
    explanation:
      "When a project use is ALSO selected, keeps only candidates whose zoning badge reads aligned or a site-specific Planned Development/PMD — a PD/PMD may or may not actually permit the project, so it is kept rather than dropped. Removes not-aligned and unresolved candidates. Broad district-family screen only — not a use determination. With NO project use selected, this criterion cannot screen and is treated as not selected by the engine — the page surfaces it as a selected-but-inert criterion rather than pretending it did something.",
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
  /** Whether `sm_zoning=aligned` was selected — independent of whether a
   *  project use was ALSO selected (that combination is what determines
   *  whether the screen can actually act; see `selectedNonScoringCriteria`
   *  below for the honest "needs a project use" surfacing when it can't). */
  zoningAlignment: boolean;
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
  if (selection.zoningAlignment) ids.push("zoning-alignment");
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
  const entries = SHORTLIST_CRITERION_REGISTRY.filter(
    (entry) =>
      ids.has(entry.id) && (entry.behavior === "unsupported" || entry.behavior === "display-only"),
  );

  // The zoning-alignment SCREEN is selected but request-conditionally inert
  // — it can only act when a project use is ALSO selected (see
  // SCREEN_HANDLERS["zoning-alignment"] in lib/shortlist-engine.ts). That is
  // a per-REQUEST fact, not a fixed registry-level behavior, so it cannot be
  // caught by the static "unsupported"/"display-only" filter above; it is
  // surfaced here explicitly, with its own honest explanation, instead of
  // silently doing nothing.
  if (selection.zoningAlignment && !selection.projectUse) {
    const zoningEntry = shortlistCriterionById("zoning-alignment");
    if (zoningEntry) {
      entries.push({
        ...zoningEntry,
        explanation:
          "Needs a project use selected to screen — with no project use chosen, this selection has no effect on the results. Broad district-family screen only — not a use determination. Select a project use to activate it.",
      });
    }
  }

  return entries;
}

/**
 * The parenthetical suffix the "Selected criteria with no ranking effect"
 * list (app/vacancy/[zip]/shortlist/page.tsx) renders after each entry's
 * label. Extracted here — rather than left as an inline ternary in the page
 * — so the THREE distinct reasons an entry can land in that list are each
 * independently testable and impossible to mismatch:
 *   - "display-only": measured and shown on the card, never scored — a
 *     fixed, permanent registry fact.
 *   - "screen" (behavior "screen" reaching this list at all is ONLY
 *     possible via `selectedNonScoringCriteria`'s zoning-alignment
 *     request-conditional injection above): a REAL, supported screen that
 *     is inert on THIS specific request because it needs a project use it
 *     was not given — calling this "(not supported)" would be false, since
 *     the criterion demonstrably IS supported once a project use is added.
 *   - everything else ("unsupported"): no committed input backs the
 *     concept at all, ever.
 */
export function nonScoringCriterionSuffix(behavior: ShortlistCriterionBehavior): string {
  if (behavior === "display-only") return " (shown, not scored)";
  if (behavior === "screen") return " (needs a project use)";
  return " (not supported)";
}

/**
 * Analytics metadata DERIVED FROM THE REGISTRY (re-review Finding 2): every
 * selected criterion's id, PAIRED with its registry-declared behavior, both
 * read directly off `SHORTLIST_CRITERION_REGISTRY` via
 * `shortlistCriterionById` — not a hand-rolled per-badge/per-tier count that
 * could silently drift from what the registry actually says a criterion
 * does. `criteriaIds[i]` and `criteriaBehaviors[i]` are the same criterion
 * at the same index, so an analytics consumer can always answer "how many
 * SCREEN criteria were selected on this run" (or SCORE, DISPLAY-ONLY,
 * UNSUPPORTED) without a second lookup table anywhere.
 *
 * The result shape only uses primitives/arrays-of-primitives because
 * `AnalyticsMetadata` (lib/analytics-events.ts) does not accept nested
 * objects.
 */
export interface ShortlistCriteriaAnalyticsMetadata {
  criteriaIds: string[];
  criteriaBehaviors: string[];
}

export function shortlistCriteriaAnalyticsMetadata(
  selection: SelectedShortlistCriteria,
): ShortlistCriteriaAnalyticsMetadata {
  const criteriaIds = selectedShortlistCriterionIds(selection);
  const criteriaBehaviors = criteriaIds.map((id) => {
    const entry = shortlistCriterionById(id);
    // Every id in criteriaIds came FROM the registry (selectedShortlistCriterionIds
    // only ever emits ids the SelectedShortlistCriteria shape maps 1:1 onto
    // registry entries for), so this is defensive, not expected to fire —
    // "unknown" would itself be a loud, greppable analytics signal of drift
    // rather than a thrown error in a client-side event handler.
    return entry?.behavior ?? "unknown";
  });
  return { criteriaIds, criteriaBehaviors };
}

// ── Record-completeness ordering (Finding 13, round 3) ──────────────────────
//
// When no SCORING criterion is selected (no transit network active),
// `lib/shortlist-engine.ts` still needs SOME deterministic order for the
// screened list. Finding 1's original sin was inventing an always-on
// "baseline" score (sweet-spot area, distress, incentive count, owner
// confidence, zoning ALIGNMENT) that silently re-introduced criteria-
// independent ranking and could move top-20 membership on its own. Finding
// 13 (round 1) tried to dodge the problem by refusing to rank at all
// (canonicalKey-only order, relabeled "not ranked") — round 3 rejected that
// as unhelpful: a reader still deserves a REASON the list is ordered one way
// rather than another, as long as that reason can never be confused with a
// fit/quality judgment.
//
// The fix: a RECORD-COMPLETENESS score — a fixed-weight, DOCUMENTED, pure
// function of which FACTS a record happens to publish, never of which
// criteria the reader selected and never of anything resembling "better
// site" (no size sweet-spot, no distress signal, no incentive count, no
// owner-confidence tier, no zoning ALIGNMENT). It answers exactly one
// question — "how much can we actually show about this record?" — which is
// why it is safe to compute for every candidate unconditionally and use
// ONLY as the ordering key for the UNSCORED path; the SCORED path (a real
// transit criterion selected) never reads it at all.
//
// Weights are constants, not a formula that could quietly drift per call
// site — every consumer reads THESE THREE numbers, not a recomputed
// judgment call:
export const RECORD_COMPLETENESS_WEIGHTS = {
  /** A published, positive measurement for the property type this row was
   *  actually screened as (see lib/shortlist-engine.ts's
   *  `screenedPropertyTypeFor`) — the single largest signal, since an
   *  unmeasured record is the thinnest kind of listing. */
  measuredArea: 2,
  /** A resolved parcel PIN — the anchor for every other lookup (CookViewer,
   *  Clerk records, county assessor data) a reader would want to verify a
   *  record with. */
  resolvedPin: 1,
  /** Resolved zoning district/status — the fact the zoning badge itself
   *  depends on; an unresolved-zoning record shows "unresolved" everywhere
   *  a badge would otherwise appear. */
  resolvedZoning: 1,
} as const;
