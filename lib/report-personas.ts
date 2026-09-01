// ─── Persona lens over a generated report (Tier 1b, audit BM4 + spec v2) ─
// Pure, client-safe transforms that re-order, filter, and collapse EXISTING
// report content for a chosen visitor persona. No regeneration, no
// eligibility claims — a lens over the same snapshot.
//
// The canonical persona tags live in the static program dataset
// (data/programs-internal.json `personas`, exported to
// public/data/programs-public.json). This module keeps a lightweight mirror
// (PROGRAM_PERSONA_TAGS) so the lens works synchronously on the client even
// when the caller has not loaded the full program list (e.g. a saved
// workspace report). A test asserts the mirror and the dataset never drift
// (lib/__tests__/report-personas.test.ts).
//
// HARD RELEVANCE FILTER (owner ruling, binding): a persona view's visible
// program set is goal-matched ∩ persona-tagged, plus the pinned
// protection/informational overlays (industrialCorridors, highUnemployment
// — context, not programs). Everything else — including the "Other
// Programs Mapped" / "Additional Programs to Explore" tiers in full —
// folds into ONE collapsed "Also at this address (N)" disclosure. Nothing
// is ever deleted: the disclosure carries every de-prioritized item, and
// switching to "All" restores the canonical, unfiltered order. A visible
// set that comes up empty renders explicit empty-state copy in place of
// the section, never a blank page and never a fallback to the unfiltered
// list.

// VISIBLE PROGRAM-CARD BUDGET (owner ruling, binding): the developer and
// supporter lenses show at most SIX program cards on the face of the board.
// This is a further narrowing of the SAME lens mechanism as the hard filter
// above — it never deletes: the programs past the budget move into the one
// "Also at this address (N)" disclosure and are counted there, exactly like
// the out-of-lens pool. See PERSONA_VISIBLE_PROGRAM_BUDGET.

import {
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  GOAL_MATCH_PROGRAMS_SECTION_ID,
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
  OTHER_CONFIRMED_PROGRAMS_SECTION_ID,
  CONFIRMED_PROGRAMS_SECTION_ID,
  SECTION_IDS,
} from "@/lib/report-engine";
import type {
  ActionRoadmapItem,
  GeneratedReport,
  ReportItem,
  ReportSection,
} from "@/lib/report-engine";
import { CAPITAL_PARTNER_SECTION_ID, CAPITAL_PARTNER_SECTION_TITLE } from "@/lib/capital-partner-report";
import {
  DEFAULT_PERSONA,
  personaDescriptor,
  type PersonaId,
} from "@/lib/personas";
import {
  isSupportOrganizationSectionTitle,
  SUPPORT_ORGANIZATIONS_SECTION_ID,
} from "@/lib/support-organization-copy";
import { inferSupportLanes, type LocalSupportLane } from "@/lib/local-business-support";
import { startHereActionsInOrder, type StartHere } from "@/lib/start-here";

/** Section title for the collapsed "everything else" disclosure. */
export const ALSO_AT_ADDRESS_TITLE = "Also at this address";

const CONFIRMED_SECTION_TITLES = new Set([
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
]);

/**
 * Tiers that are, by construction, NOT the goal-matched pool — the engine
 * only ever puts a program in "Other Programs Mapped" or "Additional
 * Programs to Explore" when it did NOT win the goal-match partition (see
 * `generateLocationIncentives`). Under a persona lens these tiers fold
 * entirely into the "Also at this address" disclosure; the pinned
 * protection/informational overlays are the one exception (context, not
 * programs, per owner ruling).
 */
const FULLY_DEMOTED_SECTION_IDS = new Set<string>([
  OTHER_CONFIRMED_PROGRAMS_SECTION_ID,
  SECTION_IDS.additionalProgramsToExplore,
]);
const FULLY_DEMOTED_SECTION_TITLES = new Set([
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
  "Additional Programs to Explore",
]);

function isFullyDemotedTier(section: ReportSection): boolean {
  return section.id
    ? FULLY_DEMOTED_SECTION_IDS.has(section.id)
    : FULLY_DEMOTED_SECTION_TITLES.has(section.title);
}

/**
 * DRAFT persona tags mirrored from data/programs-internal.json (exported to
 * public/data/programs-public.json). Editorial, descriptive — review with
 * SECCC staff before treating as truth. Untagged programs (or [] here)
 * appear in the "All" lens only.
 */
export const PROGRAM_PERSONA_TAGS: Record<string, PersonaId[]> = {
  tif: ["growing", "developer"],
  federalOZ: ["developer"],
  illinoisOZ: ["developer"],
  enterprise: ["growing", "developer"],
  sbif: ["starting", "growing"],
  edge: ["growing", "developer"],
  rev: ["developer"],
  micro: ["developer"],
  dataCenter: ["developer"],
  ssa: ["supporter", "growing"],
  // highUnemployment — pinned protection/informational overlay (context, not
  // a program): always visible, every lens. See PINNED_OVERLAY_PROGRAM_IDS.
  class7a: ["growing", "developer"],
  catalystGrant: ["supporter", "starting", "growing"],
  cpace: ["growing", "developer"],
  smallBizSource: ["supporter", "starting", "growing"],
  landBank: ["developer"],
  nof: ["supporter", "starting", "growing"],
  nmtcEligible: ["developer"],
  qct: ["developer"],
  landmarkDistricts: ["supporter", "growing", "developer"],
  nrhpDistricts: ["developer"],
  microMarketRecovery: ["supporter", "growing", "developer"],
  // industrialCorridors — pinned protection overlay (context, not a
  // program): always visible, every lens. See PINNED_OVERLAY_PROGRAM_IDS.
  ccsa: ["supporter", "starting", "growing"],
  hubzone: ["starting", "growing"],
  energyCommunityBonus: ["developer"],
  iraCleanElectricity: ["developer"],
  electivePay: ["developer"],
  sec179d: ["growing", "developer"],
  hudSection108: ["developer"],
  cdfiBond: ["developer"],
  sba7a504: ["starting", "growing", "developer"],
  sbaMicroloan: ["starting", "growing"],
  sbaDisasterEidl: ["starting", "growing"],
  chips48d: ["developer"],
  ssbciAdvantageIL: ["starting", "growing"],
  edaBuildToScale: ["growing", "developer"],
  bmec: ["growing", "developer"],
  aim: ["growing", "developer"],
  quantumEZ: ["developer"],
  hib: ["developer"],
  innovationVoucher: ["supporter", "starting", "growing"],
  economicEmpowermentCenters: ["supporter", "starting"],
  filmCredit: ["growing"],
  liveTheaterCredit: ["growing"],
  cannabisR3: ["starting"],
  r3Grants: ["starting"],
  class6b: ["growing", "developer"],
  class6bSer: ["growing", "developer"],
  class7b: ["growing", "developer"],
  class7c: ["growing", "developer"],
  class8: ["growing", "developer"],
  class8aMicro: ["developer"],
  classC: ["developer"],
  classL: ["growing", "developer"],
  ahsap: ["developer"],
  cookCannabisGrant: ["starting"],
  investInCook: ["growing", "developer"],
  cookBrownfield: ["developer"],
  cdgSmall: ["starting", "growing"],
  cdgMedium: ["growing", "developer"],
  cdgLarge: ["developer"],
  workforceSolutions: ["supporter", "growing"],
  climateInfrastructureFund: ["developer"],
  comedEvRebate: ["growing"],
  comedSmallBizEfficiency: ["starting", "growing"],
  comedDgSolar: ["growing", "developer"],
  peoplesGasEfficiency: ["growing"],
  kivaChicago: ["starting"],
  greenwoodArcher: ["supporter", "starting", "growing"],
  alliesCommunityBusiness: ["supporter", "starting", "growing"],
};

/**
 * Protection/informational overlays — "context, not programs" (owner
 * ruling). Pinned visible in every persona lens regardless of persona tag
 * or goal-match status.
 */
export const PINNED_OVERLAY_PROGRAM_IDS = new Set(["industrialCorridors", "highUnemployment"]);

function isPinnedOverlayItem(item: ReportItem): boolean {
  return Boolean(item.programId && PINNED_OVERLAY_PROGRAM_IDS.has(item.programId));
}

/**
 * OWNER RULING (Billy, 2026-08-31, binding): the developer and supporter
 * lenses render at most **N = 6** visible program cards. Starting/growing
 * are deliberately UNBUDGETED this round (no entry here = no cap), and the
 * "All" (full record) view is exempt by construction — it never runs the
 * lens at all.
 *
 * This is a narrowing of the same lens mechanism as the hard relevance
 * filter, not a generator change and not a deletion: every program past
 * the budget moves into the ONE "Also at this address (N)" disclosure and
 * is counted in its N, so the full record stays exactly one gesture away
 * and the disclosure's "nothing has been removed" copy stays literally
 * true (see `personaAlsoAtAddressDescription`, which names the budgeted
 * overflow explicitly rather than mislabelling it "outside the lens").
 *
 * Enforced by lib/__tests__/report-personas.test.ts ("Owner ruling
 * 2026-08-31: visible program-card budget").
 */
export const PERSONA_VISIBLE_PROGRAM_BUDGET: Partial<
  Record<Exclude<PersonaId, "all">, number>
> = {
  developer: 6,
  supporter: 6,
};

/** One entry in the budget ranking — the visible item plus the ONE piece of
 *  structured context the ranking needs that the item itself cannot carry:
 *  whether the canonical tier it came from was the goal-matched partition
 *  (`GOAL_MATCH_PROGRAMS_SECTION_ID`, built by `generateLocationIncentives`
 *  from `isProjectGoalMatch`). Derived from the section, never re-guessed
 *  from prose. */
interface PersonaProgramEntry {
  item: ReportItem;
  goalMatched: boolean;
}

function isGoalMatchTier(section: ReportSection): boolean {
  return section.id
    ? section.id === GOAL_MATCH_PROGRAMS_SECTION_ID
    : section.title === GOAL_MATCH_PROGRAMS_SECTION_TITLE;
}

/**
 * Days until this program's next published funding window, or null when the
 * item carries no usable window fact. NEVER invents one: the only source is
 * `item.nextWindow.expected` — the structured date `programReportItem()`
 * copies straight off the catalog record (see ReportItem.nextWindow). An
 * absent, unparseable, or already-past date all return null, i.e. NEUTRAL —
 * a program with no published window is never presented as more or less
 * urgent than one that has one, it simply does not participate in the
 * proximity comparison (see `resequenceByWindowProximity`).
 */
function windowProximityDays(item: ReportItem, now: number): number | null {
  const expected = item.nextWindow?.expected;
  if (!expected) return null;
  const parsed = Date.parse(expected);
  if (Number.isNaN(parsed)) return null;
  const days = Math.round((parsed - now) / 86_400_000);
  // A window that has already closed is not an "actionable window" — treated
  // as neutral rather than as maximum urgency.
  return days >= 0 ? days : null;
}

/**
 * Re-sequence ONLY the entries that carry a real window date, in place,
 * among the slots those entries already occupy. Entries with no window fact
 * keep their exact position — this is what "if window data is absent treat
 * as neutral" means mechanically: absent data can neither promote nor demote
 * an item, it just leaves it where the engine's own ordering put it.
 */
function resequenceByWindowProximity(
  entries: PersonaProgramEntry[],
  now: number,
): PersonaProgramEntry[] {
  const slots: number[] = [];
  const dated: { entry: PersonaProgramEntry; days: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const days = windowProximityDays(entry.item, now);
    if (days === null) return;
    slots.push(index);
    dated.push({ entry, days, index });
  });
  if (dated.length < 2) return entries;
  dated.sort((a, b) => a.days - b.days || a.index - b.index);
  const out = entries.slice();
  dated.forEach((candidate, i) => {
    out[slots[i]] = candidate.entry;
  });
  return out;
}

/**
 * The owner's ranking for WHICH programs keep a visible card when the budget
 * bites, built only from structured fields that already exist:
 *
 *   0. Pinned protection/informational overlays (industrialCorridors,
 *      highUnemployment). "Context, not programs" — always visible in every
 *      lens, so they can never be budgeted out. There are exactly two such
 *      ids and every budget is ≥ 2, so this stratum can never crowd out the
 *      real ranking.
 *   1. Goal-matched programs — the item came from the engine's goal-match
 *      partition, so the user's own selected goals put it there.
 *   2. Persona-tag-only matches — relevant to the audience, not tied to a
 *      stated goal.
 *
 * Within each stratum: funding-window proximity (sooner first) among the
 * entries that actually publish a window; everything else holds its engine
 * order. Stable throughout — equal-ranked entries never swap.
 */
function rankPersonaProgramsForBudget(
  entries: PersonaProgramEntry[],
  now: number,
): PersonaProgramEntry[] {
  const stratum = (entry: PersonaProgramEntry) =>
    isPinnedOverlayItem(entry.item) ? 0 : entry.goalMatched ? 1 : 2;
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => stratum(a.entry) - stratum(b.entry) || a.index - b.index)
    .map(({ entry }) => entry);
  return [0, 1, 2].flatMap((tier) =>
    resequenceByWindowProximity(
      ordered.filter((entry) => stratum(entry) === tier),
      now,
    ),
  );
}

/**
 * Split a persona's hard-filtered program set into the visible cards and the
 * budget overflow. Under budget (or unbudgeted persona) this is a pure
 * pass-through — the ranking never runs, so a report that already fits is
 * byte-for-byte what it was before this ruling.
 *
 * When the budget DOES bite, the ranking above decides *which* items stay;
 * the survivors then render in their original engine order, so the cap
 * removes cards without silently reshuffling the ones it kept.
 */
export function applyVisibleProgramBudget(
  entries: PersonaProgramEntry[],
  budget: number | undefined,
  now: number = Date.now(),
): { visible: ReportItem[]; overflow: ReportItem[] } {
  if (budget === undefined || entries.length <= budget) {
    return { visible: entries.map(({ item }) => item), overflow: [] };
  }
  const keep = new Set(
    rankPersonaProgramsForBudget(entries, now)
      .slice(0, budget)
      .map(({ item }) => item),
  );
  return {
    visible: entries.filter(({ item }) => keep.has(item)).map(({ item }) => item),
    overflow: entries.filter(({ item }) => !keep.has(item)).map(({ item }) => item),
  };
}

/** A lookup from program id to persona tags. */
export type PersonaTagLookup = (programId: string) => PersonaId[];

const defaultLookup: PersonaTagLookup = (id) => PROGRAM_PERSONA_TAGS[id] ?? [];

export function programMatchesPersona(
  programId: string | undefined,
  persona: PersonaId,
  lookup: PersonaTagLookup = defaultLookup,
): boolean {
  // Gate finding 9/10: "looking" has no goal yet to match programs
  // against — it is a screening-overview lens, not a filtered one (see
  // its PERSONA_CHIPS descriptor). Treated the same as "all" here so
  // applyPersonaLens's hard filter never collapses anything into "Also at
  // this address" for it, and reorderActionRoadmap/reorderStartHere never
  // reprioritize by a persona tag that doesn't apply yet.
  if (persona === DEFAULT_PERSONA || persona === "looking") return true;
  if (!programId) return false;
  return lookup(programId).includes(persona);
}

// ─── Support-network ordering (lane-based, spec v2 deliverable 3) ────────
// Rewritten off the structured LocalSupportLane taxonomy
// (lib/local-business-support.ts) instead of a bespoke keyword regex, so
// this stays in sync with the same lane inference the support-org matching
// API already uses.

/** Persona → lane-preference order (first match wins; lower = earlier). */
const PERSONA_LANE_PREFERENCE: Record<Exclude<PersonaId, "all">, LocalSupportLane[]> = {
  starting: ["business_navigation", "legal_support", "workforce"],
  growing: ["business_navigation", "capital_readiness", "small_business_capital"],
  supporter: ["corridor_place_based", "business_navigation", "property_community_development"],
  developer: ["property_community_development", "capital_readiness", "small_business_capital"],
  looking: ["business_navigation", "legal_support", "workforce"],
};

/** Shim a flattened report item into the shape `inferSupportLanes` reads —
 *  it only inspects primaryType/programSubtype/supportTypes/serviceGeography
 *  and relationships, none of which survive onto a rendered ReportItem, so
 *  the item's own label/value/detail (where an org's type is usually named,
 *  e.g. "Chicago SBDC", "CDFI lender") stand in for them. */
function inferItemSupportLanes(item: ReportItem): LocalSupportLane[] {
  return inferSupportLanes({
    name: item.label,
    relationships: [],
    primaryType: [item.label, item.value].filter(Boolean).join(" "),
    supportTypes: item.detail,
    sourceUrls: [],
  });
}

function orgWeight(lanes: LocalSupportLane[], persona: PersonaId): number {
  const preference = PERSONA_LANE_PREFERENCE[persona as Exclude<PersonaId, "all">] ?? [];
  for (let i = 0; i < preference.length; i++) {
    if (lanes.includes(preference[i])) return i;
  }
  return preference.length;
}

function reorderSupportNetwork(
  section: ReportSection,
  persona: PersonaId,
): ReportSection {
  const items = section.items ?? [];
  if (items.length <= 2) return section;
  // The first item is a summary card ("N organizations") — keep it pinned.
  const [head, ...rest] = items;
  const isSummary = !head.programId && !head.url && /organizations?$/.test(head.value ?? "");
  const pinned = isSummary ? [head] : [];
  const orgs = isSummary ? rest : items;
  const ordered = orgs
    .map((item, index) => ({ item, index, weight: orgWeight(inferItemSupportLanes(item), persona) }))
    .sort((a, b) => a.weight - b.weight || a.index - b.index) // stable within a weight
    .map((entry) => entry.item);
  return { ...section, items: [...pinned, ...ordered] };
}

// ─── Persona section order (guidepost anatomy, spec v2) ─────────────────
// Fixed three-part anatomy — PART 01 Site & Standing / PART 02 Capital &
// Programs / PART 03 Partners & Next Steps — same order always. Personas
// change what fills each part (via bucket order within it), never the
// parts themselves. Guidepost anatomy renders for every REAL persona lens;
// never for "all" (lib/personas.ts `hasGuidepostAnatomy`).

export type GuidepostPart = 1 | 2 | 3;

// Gate round 3 nit: exported (was private) so lib/report-engine.ts's
// ReportSection.guidepostBucket can be typed as this directly via a
// TYPE-ONLY import (erased at compile time, no runtime cycle — see that
// file's own import-site comment), killing the `as SectionBucketKey |
// undefined` casts this file used to need at every guidepostBucket read.
export type SectionBucketKey =
  | "siteFacts"
  | "logisticsAccess"
  | "civicRepresentation"
  | "neighborhoodContext"
  | "zoning"
  | "programs"
  | "documentReadiness"
  | "financing"
  | "organizations"
  | "rest";

/** Exported for the owner ruling 2026-08-31 cap guard, which has to prove
 *  each capped lens inventory still spans all three guidepost parts. */
export const BUCKET_PART: Record<SectionBucketKey, GuidepostPart> = {
  siteFacts: 1,
  logisticsAccess: 1,
  civicRepresentation: 1,
  neighborhoodContext: 1,
  zoning: 1,
  programs: 2,
  documentReadiness: 2,
  financing: 2,
  organizations: 3,
  rest: 2,
};

function sectionBucketKey(section: ReportSection): SectionBucketKey {
  const id = section.id;
  const title = section.title;
  if (title === ALSO_AT_ADDRESS_TITLE) return "programs";
  if (id === SECTION_IDS.siteFacts || title === "Site Facts") return "siteFacts";
  if (id === SECTION_IDS.logisticsAccess || title === "Logistics Access") return "logisticsAccess";
  if (id === SECTION_IDS.civicRepresentation || title === "Civic Representation") return "civicRepresentation";
  // Gate finding 19 (regression, real bug this fixes): this was title-only
  // — no `id` check — even though the engine has stamped a real
  // `SECTION_IDS.neighborhoodEconomicContext` on this section all along.
  // Harmless while every persona's title matched the canonical string, but
  // gate finding 19's own title overrides rename this section for
  // developer/supporter — a title-only check would have silently
  // misclassified the section it had JUST renamed, bucketing it into
  // "rest" (wrong guidepost PART) on the very next call. id-first fixes it
  // permanently, the same way every other bucket check here already is.
  if (id === SECTION_IDS.neighborhoodEconomicContext || title === "Neighborhood Economic Context") return "neighborhoodContext";
  if (id === SECTION_IDS.zoningUseStartingPoint || title === "Zoning & Use Starting Point") return "zoning";
  if (
    id === GOAL_MATCH_PROGRAMS_SECTION_ID ||
    id === CONFIRMED_PROGRAMS_SECTION_ID ||
    title === GOAL_MATCH_PROGRAMS_SECTION_TITLE ||
    title === CONFIRMED_PROGRAMS_SECTION_TITLE ||
    // A fully-demoted tier (Other Programs Mapped / Additional Programs to
    // Explore) that survives the lens at all only does so via a pinned
    // overlay item — it belongs with the rest of the program story, not
    // wherever "rest" would otherwise place it.
    isFullyDemotedTier(section)
  ) {
    return "programs";
  }
  // Gate finding 19 (regression, real bug this fixes): "documentReadiness"
  // has been listed in SectionBucketKey and in every PERSONA_SECTION_ORDER
  // array since this file's earliest phase, but this function never
  // actually returned it — no branch existed at all. Every "documentReadiness"
  // entry in every ordering array has been silently inert this whole time;
  // gate finding 19's own title override for it would have been equally
  // dead without this fix. The real section (lib/report-engine.ts, "Document
  // Readiness Checklist") already carries SECTION_IDS.documentReadinessChecklist.
  if (id === SECTION_IDS.documentReadinessChecklist || title === "Document Readiness Checklist") return "documentReadiness";
  if (id === CAPITAL_PARTNER_SECTION_ID || title === CAPITAL_PARTNER_SECTION_TITLE) return "financing";
  if (isSupportOrganizationSectionTitle(title) || id === SUPPORT_ORGANIZATIONS_SECTION_ID) return "organizations";
  return "rest";
}

/** Per-persona bucket order within the fixed 3-part anatomy. "programs"
 *  always carries the ALSO_AT_ADDRESS disclosure right behind it (same
 *  bucket — see sectionBucketKey), so the collapsed line never drifts away
 *  from the list it collapsed. */
export const PERSONA_SECTION_ORDER: Record<Exclude<PersonaId, "all">, SectionBucketKey[]> = {
  // Round-2 render-truth audit: these are closed inventories copied from the
  // R5 Final boards, not preference weights over a kitchen-sink section list.
  // Bespoke board sections (executive summary, charts, document readiness,
  // contact sheet, and the looking overview) mount in the shared UI
  // components; this list covers only canonical ReportSection buckets.
  //
  // OWNER RULING 2026-08-31 (binding): no persona-lensed report may render
  // more than FOUR canonical sections, and the four must still span all
  // three guidepost parts — the PART 01 Site & Standing / PART 02 Capital &
  // Programs / PART 03 Partners & Next Steps anatomy stays whole, it just
  // stops being padded. The "All" (full record) view is explicitly EXEMPT:
  // it remains the complete report and the transparency-floor escape hatch
  // ("full record one gesture away"). Buckets dropped from the lens
  // inventories here — logisticsAccess, civicRepresentation, and zoning for
  // every persona, plus neighborhoodContext for every persona except
  // supporter — are NOT deleted from the canonical report; every one of
  // them still renders in full on All. This is a lens narrowing, not a
  // generator change, exactly like the hard relevance filter above.
  // Enforced by lib/__tests__/report-personas.test.ts ("Owner ruling
  // 2026-08-31: persona lenses cap at four canonical sections").
  starting: ["siteFacts", "programs", "financing", "organizations"],
  growing: ["siteFacts", "programs", "financing", "organizations"],
  supporter: ["neighborhoodContext", "programs", "financing", "organizations"],
  developer: ["siteFacts", "programs", "financing", "organizations"],
  looking: ["civicRepresentation"],
};

/**
 * Board-law allowlist for canonical engine sections. Anything outside this
 * inventory is still present in the canonical All report, but cannot leak
 * through a persona lens as a late "rest" bucket. This closes the audit's
 * project-intake/deadline/document/zone-interaction leak at its source.
 */
function sectionBelongsOnPersonaBoard(
  section: ReportSection,
  persona: Exclude<PersonaId, "all">,
): boolean {
  return PERSONA_SECTION_ORDER[persona].includes(sectionBucketKey(section));
}

/**
 * SSA/CCSA rows are civic facts on the boards, not additional program cards.
 * The canonical engine keeps their programId for the All-view cross-links;
 * persona views remove that program identity so generic program walkers can
 * never mistake a civic fact for a hard-filtered visible program.
 */
function asPersonaBoardFacts(section: ReportSection): ReportSection {
  const bucket = sectionBucketKey(section);
  if (bucket === "siteFacts") {
    return {
      ...section,
      // The canonical Site Facts section also carries narrative rollups for
      // civic representation, transportation, and nearby site signals. Each
      // has its own blessed board section (or no board slot), so retaining
      // those rollups here duplicates content and breaks the compact tile grid.
      items: section.items.filter(
        (item) => !/civic representation|transportation & site access|site signals/i.test(item.label),
      ),
    };
  }
  if (bucket === "zoning") {
    return {
      ...section,
      // The board's zoning section is the mapped classification plus the
      // shared zoning handoff/caveat, not the canonical ZBA-source diagnostic.
      items: section.items.filter((item) =>
        /city zoning classification|zoning classification/i.test(item.label),
      ),
    };
  }
  if (bucket !== "civicRepresentation") return section;
  return {
    ...section,
    items: section.items.map((item) =>
      item.programId ? { ...item, programId: undefined } : item,
    ),
  };
}

/**
 * Gate round 2, BLOCKER 23 (regression, real bug this fixes): the
 * guidepost bucket used to be re-derived from scratch every time
 * `guidepostPartForSection` was called — including in the UI render loop,
 * where it runs on `lensed.sections`, i.e. AFTER gate finding 19's
 * `applyPersonaSectionTitles` has already overwritten `.title`.
 * `sectionBucketKey`'s id-first checks protect any section that carries a
 * real `id`, but a LEGACY section with no `id` (a saved report persisted
 * before that field existed — see `ReportSection.id`'s own doc comment)
 * is classifiable by title alone, and a title-only classification
 * silently breaks the moment that exact title is renamed. Fixed by
 * resolving the bucket exactly ONCE, here, against the PRISTINE section
 * (before any title override has touched it) and stamping it onto the
 * section object as `guidepostBucket` — every downstream consumer
 * (`applyPersonaSectionTitles`, `guidepostPartForSection`) reads this
 * stamped value instead of re-deriving.
 */
function reorderSectionsForPersona(sections: ReportSection[], persona: PersonaId): ReportSection[] {
  if (persona === DEFAULT_PERSONA) return sections;
  const order = PERSONA_SECTION_ORDER[persona as Exclude<PersonaId, "all">];
  if (!order) return sections;
  return sections
    .map((section, index) => {
      const bucket = sectionBucketKey(section);
      const stamped: ReportSection = { ...section, guidepostBucket: bucket };
      const position = order.indexOf(bucket);
      return { section: stamped, index, position: position === -1 ? order.length : position };
    })
    .sort((a, b) => a.position - b.position || a.index - b.index)
    .map((entry) => entry.section);
}

/**
 * Gate finding 19 — per-persona section titles. Exact strings copied from
 * the four R5 board files (re-read in full for this pass; every section
 * header they render is the source of truth): R5DeveloperFinal,
 * R5OwnerFinal (shared by "starting"/"growing" — both render under the one
 * "Business owner" board), R5SupporterFinal, R5LookingFinal. A persona/
 * bucket pair with no entry means the board's title already equals the
 * current one, or the board doesn't show that section at all — both
 * intentionally left unmapped rather than forced.
 *
 * Two things this deliberately does NOT cover, both real, both out of this
 * map's mechanism (a bucket→title lookup over generic ReportSection
 * objects, keyed the same way reorderSectionsForPersona already buckets
 * them):
 *   - Chart headers ("Incentive horizon," "Funding windows") — these are
 *     bespoke chart components with no ReportSection/id of their own, not
 *     generic titled sections this override can reach.
 *   - "Contact sheet" — components/report/ContactSheet.tsx's own hardcoded
 *     <h3>, not a ReportSection.title; its CSS already uppercases the
 *     rendered text ("CONTACT SHEET") regardless of the source string's
 *     casing, so the board's lowercase "Contact sheet" vs the component's
 *     "Contact Sheet" is not a visible mismatch this map could fix anyway.
 *
 * Owner ruling 2026-08-31 (the four-section cap above): an override only
 * ever fires for a bucket the persona's PERSONA_SECTION_ORDER still admits
 * — `applyPersonaSectionTitles` runs on the already-lensed list, and
 * `sectionBelongsOnPersonaBoard` dropped the other sections one step
 * earlier — so the cap left some of this map unreachable. Removed here:
 * `logisticsAccess` and `zoning`, the two buckets now in NO persona's
 * order at all. Deliberately kept: the `civicRepresentation` and
 * `neighborhoodContext` entries, whose buckets are still live for
 * "looking" and "supporter" respectively; this map is read per persona AND
 * per bucket, and pruning a live bucket persona-by-persona would turn one
 * board-inventory decision into a second, duplicate source of truth. Also
 * untouched: `documentReadiness`, already inert before this ruling (that
 * bucket has never been in a PERSONA_SECTION_ORDER array) and pinned as
 * such by an existing test.
 */
const PERSONA_SECTION_TITLE_OVERRIDES: Partial<Record<Exclude<PersonaId, "all">, Partial<Record<SectionBucketKey, string>>>> = {
  starting: {
    siteFacts: "Site facts",
    civicRepresentation: "Civic representation",
    programs: "Programs for your goal",
    documentReadiness: "Document readiness",
    financing: "Financing resources",
  },
  growing: {
    siteFacts: "Site facts",
    civicRepresentation: "Civic representation",
    programs: "Programs for your goal",
    documentReadiness: "Document readiness",
    financing: "Financing resources",
  },
  developer: {
    siteFacts: "Site facts & county records",
    civicRepresentation: "Civic representation",
    neighborhoodContext: "Neighborhood context",
    programs: "Capital-relevant programs",
    financing: "Financing resources",
  },
  supporter: {
    neighborhoodContext: "Neighborhood context",
    civicRepresentation: "Civic representation",
    programs: "Programs for the goal",
    documentReadiness: "Document readiness",
    financing: "Financing resources",
  },
  looking: {
    civicRepresentation: "Civic representation",
  },
};

/**
 * Applies PERSONA_SECTION_TITLE_OVERRIDES to an already-lensed, already-
 * reordered section list — a pure display transform (never touches `id`,
 * never runs at generation time), consistent with the "lens, never
 * generator" rule. Skips any section already `collapsedByPersona`
 * (the "Also at this address" disclosure keeps its own fixed title, never
 * inherits the "programs" bucket's override) so TOC/anchor state, which
 * is keyed by `id` and unaffected by this function, never drifts from
 * what a reader actually sees.
 */
function applyPersonaSectionTitles(sections: ReportSection[], persona: PersonaId): ReportSection[] {
  if (persona === DEFAULT_PERSONA) return sections;
  const overrides = PERSONA_SECTION_TITLE_OVERRIDES[persona as Exclude<PersonaId, "all">];
  if (!overrides) return sections;
  // Regression, real bug this fixes: sectionBucketKey buckets MULTIPLE
  // distinct titled sections into "programs" together (CONFIRMED_
  // PROGRAMS_SECTION_TITLE / GOAL_MATCH_PROGRAMS_SECTION_TITLE /
  // OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE can all legitimately coexist as
  // separate, non-collapsed sections when items survive the persona
  // filter in more than one tier) — an unconditional per-bucket override
  // renamed every one of them to the SAME string, producing two
  // identically-titled sections on one report and breaking every
  // find-by-original-title lookup downstream. Each R5 board shows exactly
  // ONE section per bucket, so the override applies to the FIRST matching
  // section only; any additional section in the same bucket keeps its own
  // real title.
  const appliedBuckets = new Set<SectionBucketKey>();
  return sections.map((section) => {
    if (section.collapsedByPersona) return section;
    // Gate round 2, BLOCKER 23: prefer the bucket reorderSectionsForPersona
    // already stamped on this section (resolved against the pristine,
    // pre-override section) — this function runs strictly after that one
    // in the applyPersonaLens pipeline, so the stamp is always present in
    // production. Falls back to a fresh derivation only for direct/
    // unit-test calls that skip the full pipeline.
    const bucket = section.guidepostBucket ?? sectionBucketKey(section);
    const overrideTitle = overrides[bucket];
    if (!overrideTitle || overrideTitle === section.title || appliedBuckets.has(bucket)) return section;
    appliedBuckets.add(bucket);
    return { ...section, title: overrideTitle };
  });
}

/**
 * Which guidepost PART a (already persona-lensed) section belongs in, for
 * the shared band-rendering component. Returns null for "all" (no
 * guidepost).
 *
 * Gate round 2, BLOCKER 23: prefers `section.guidepostBucket` — the
 * bucket `reorderSectionsForPersona` already resolved once against the
 * PRISTINE section (id-first, title-fallback) before gate finding 19's
 * title override touched it — over a fresh re-derivation. Falling back
 * to `sectionBucketKey(section)` (title-current) only when the stamp is
 * absent keeps this safe for direct/unit-test callers that construct a
 * section by hand and never ran it through `applyPersonaLens`.
 */
export function guidepostPartForSection(
  section: ReportSection,
  persona: PersonaId,
): GuidepostPart | null {
  if (persona === DEFAULT_PERSONA) return null;
  const bucket = section.guidepostBucket ?? sectionBucketKey(section);
  return BUCKET_PART[bucket];
}

// ─── Confirmed-program partitioning ──────────────────────────────────

function isProgramItem(item: ReportItem): boolean {
  return Boolean(item.programId);
}

function uniqueProgramCount(items: ReportItem[]): number {
  const seen = new Set<string>();
  for (const item of items) {
    if (item.programId) seen.add(item.programId);
  }
  return seen.size;
}

/**
 * Explicit empty-state copy (owner ruling guardrail): when a persona's
 * goal-matched ∩ persona-tagged set comes up empty for a section that DID
 * have content, the section header stays (so the reader isn't left
 * wondering whether the section silently vanished) with this description in
 * place of items — never a blank page, never a fallback to the unfiltered
 * list.
 */
export function personaEmptyProgramsDescription(persona: PersonaId): string {
  return `No programs at this address matched both your selected goal and the ${personaDescriptor(
    persona,
  )} lens. See "Also at this address" below for the full list — nothing has been removed.`;
}

/**
 * Copy for the ONE "Also at this address" disclosure. Two shapes, because
 * after the visible program-card budget (owner ruling 2026-08-31) the pool
 * can hold two genuinely different kinds of program and calling them all
 * "outside the lens" would be false:
 *   - out-of-lens items (the hard relevance filter's own pool), and
 *   - budgeted overflow — programs the lens DID match but that fell past
 *     the visible card budget.
 * Both are disclosed, counted in the same N, and restorable in full; the
 * "nothing is removed" promise is stated in every shape.
 */
export function personaAlsoAtAddressDescription(
  persona: PersonaId,
  total: number,
  overflow = 0,
): string {
  const descriptor = personaDescriptor(persona);
  const restorable = "Nothing is removed; switch to All to see everything together.";
  if (overflow <= 0) {
    return `${total} other program${total === 1 ? "" : "s"} tied to this address — outside the ${descriptor} lens. ${restorable}`;
  }
  const matches = `${overflow} further ${descriptor} match${overflow === 1 ? "" : "es"} past this view's visible card budget`;
  if (overflow >= total) {
    return `${total} more program${total === 1 ? "" : "s"} tied to this address — ${matches}. ${restorable}`;
  }
  return `${total} other program${total === 1 ? "" : "s"} tied to this address — ${matches}, the rest outside the ${descriptor} lens. ${restorable}`;
}

export interface PersonaLensResult {
  /** The lensed report. Identical reference to the input when persona = "all". */
  report: GeneratedReport;
  /** Unique confirmed programs in the canonical ("All") view. */
  matchedBefore: number;
  /** Unique confirmed programs surfaced by the active persona. */
  matchedAfter: number;
}

/**
 * Re-order, hard-filter, and collapse a report for a persona lens. Pure:
 * returns a new report (or the same reference for "all"). Never deletes
 * content — programs the lens excludes move into the collapsed "Also at
 * this address" section, restorable in full by switching back to "All".
 */
export function applyPersonaLens(
  report: GeneratedReport,
  persona: PersonaId,
  lookup: PersonaTagLookup = defaultLookup,
): PersonaLensResult {
  const confirmedItems = (report.sections ?? [])
    .filter((s) => CONFIRMED_SECTION_TITLES.has(s.title))
    .flatMap((s) => s.items ?? []);
  const matchedBefore = uniqueProgramCount(confirmedItems);

  if (persona === DEFAULT_PERSONA) {
    return { report, matchedBefore, matchedAfter: matchedBefore };
  }

  const matchedIds = new Set<string>();
  const nextSections: ReportSection[] = [];
  const alsoItems: ReportItem[] = [];
  let personaProgramSection: ReportSection | null = null;
  const personaProgramEntries: PersonaProgramEntry[] = [];
  let confirmedProgramTierHadItems = false;
  const boardPersona = persona as Exclude<PersonaId, "all">;

  for (const section of report.sections ?? []) {
    if (isSupportOrganizationSectionTitle(section.title)) {
      // Owner/supporter/developer boards consume this data through the ONE
      // Contact Sheet surface. Looking has no contact sheet at all.
      if (sectionBelongsOnPersonaBoard(section, boardPersona)) {
        nextSections.push(reorderSupportNetwork(section, persona));
      }
      continue;
    }

    const isFullyDemoted = isFullyDemotedTier(section);
    const isConfirmedTier = !isFullyDemoted && CONFIRMED_SECTION_TITLES.has(section.title);

    if (!isConfirmedTier && !isFullyDemoted) {
      if (sectionBelongsOnPersonaBoard(section, boardPersona)) {
        nextSections.push(asPersonaBoardFacts(section));
      }
      continue;
    }

    const items = section.items ?? [];
    if (isConfirmedTier && items.length > 0) confirmedProgramTierHadItems = true;
    const primary: ReportItem[] = [];
    const secondary: ReportItem[] = [];

    for (const item of items) {
      const visible = isFullyDemoted
        // Out-of-goal / discovery tiers carry nothing goal-matched by
        // construction: only the pinned protection/informational overlays
        // survive here under a persona lens.
        ? isProgramItem(item) && isPinnedOverlayItem(item)
        // Confirmed / goal-matched tier: goal-matched (by which section
        // this is) ∩ persona-tagged, plus pinned overlays. Canonical lead
        // notes are not program cards and appear on no persona board.
        : !isProgramItem(item)
          ? false
          : isPinnedOverlayItem(item) || programMatchesPersona(item.programId, persona, lookup);

      if (visible) {
        primary.push(item);
        if (item.programId) matchedIds.add(item.programId);
      } else if (isProgramItem(item)) {
        secondary.push(item);
      }
    }

    // A persona lens renders ONLY the visible set — never a partial preview
    // of the excluded pool. Zero visible items still keeps the confirmed
    // tier's section header, with explicit empty-state copy in place of a
    // program list (guardrail: never a blank page). A fully-demoted tier
    // with zero pinned survivors simply disappears — there was never a
    // "primary story" here to leave a placeholder for, and its content
    // still lives on in full inside the disclosure below.
    const programsBelongOnBoard = sectionBelongsOnPersonaBoard(section, boardPersona);
    if (programsBelongOnBoard) {
      if (!personaProgramSection || (isConfirmedTier && isFullyDemotedTier(personaProgramSection))) {
        personaProgramSection = section;
      }
      // Owner ruling 2026-08-31 (visible card budget): the goal-match fact
      // is carried here, from the canonical TIER this item arrived in — the
      // only structured signal for it that survives onto a ReportItem.
      const goalMatched = isGoalMatchTier(section);
      for (const item of primary) {
        if (
          !item.programId ||
          !personaProgramEntries.some(
            (candidate) => candidate.item.programId === item.programId,
          )
        ) {
          personaProgramEntries.push({ item, goalMatched });
        }
      }
    }
    if (programsBelongOnBoard) alsoItems.push(...secondary);
  }

  // Owner ruling 2026-08-31 (Billy): cap the VISIBLE program cards for the
  // budgeted personas. Overflow is disclosed, never dropped — it leads the
  // "Also at this address" pool below (nearest misses first) and is counted
  // in that disclosure's N.
  const { visible: personaProgramItems, overflow: budgetOverflowItems } =
    applyVisibleProgramBudget(
      personaProgramEntries,
      PERSONA_VISIBLE_PROGRAM_BUDGET[boardPersona],
    );
  if (budgetOverflowItems.length > 0) alsoItems.unshift(...budgetOverflowItems);

  // Every R5 board has exactly one program section. Canonical reports can
  // split programs across goal-matched, confirmed, and fully-demoted tiers;
  // merge the visible items into one board section so tier artifacts cannot
  // create duplicate section headings or repeated PART bands.
  if (personaProgramSection) {
    const allowedProgramLabels = new Set(personaProgramItems.map((item) => item.label));
    const hardFilteredProgramItems = personaProgramItems.map((item) => {
      if (!item.worksWith?.length) return item;
      const worksWith = item.worksWith.filter((entry) =>
        allowedProgramLabels.has(entry.label),
      );
      return {
        ...item,
        worksWith: worksWith.length > 0 ? worksWith : undefined,
      };
    });
    nextSections.push({
      ...personaProgramSection,
      items: hardFilteredProgramItems,
      ...(personaProgramItems.length === 0 && confirmedProgramTierHadItems
        ? { description: personaEmptyProgramsDescription(persona) }
        : {}),
    });
  }

  if (alsoItems.length > 0) {
    nextSections.push({
      id: "persona-also-at-this-address",
      title: ALSO_AT_ADDRESS_TITLE,
      description: personaAlsoAtAddressDescription(
        persona,
        alsoItems.length,
        budgetOverflowItems.length,
      ),
      items: alsoItems,
      collapsedByPersona: true,
    });
  }

  const orderedSections = applyPersonaSectionTitles(reorderSectionsForPersona(nextSections, persona), persona);
  const nextRoadmap = reorderActionRoadmap(report.actionRoadmap, persona, lookup);
  const nextStartHere = reorderStartHere(report.startHere, persona, lookup);

  const nextReport: GeneratedReport = {
    ...report,
    sections: orderedSections,
    ...(nextRoadmap ? { actionRoadmap: nextRoadmap } : {}),
    ...(nextStartHere ? { startHere: nextStartHere } : {}),
  };

  return { report: nextReport, matchedBefore, matchedAfter: matchedIds.size };
}

/**
 * The names of the programs the current persona lens actually renders as
 * visible (goal-matched ∩ persona-tagged ∪ pinned overlays), in the SAME
 * order the lensed report's cards render them. Backs the executive-summary
 * "Programs matched here" row — the panel and the body read this off the
 * identical lensed section list, so they can never disagree (spec v2
 * amendment; enforcing test: panel names ≡ rendered card set, in order).
 *
 * Gate finding 1 (regression, real bug this fixes): this used to scan
 * every non-collapsed section for a `programId`, which also picked up
 * Civic Representation's SSA/CCSA rows (they carry `programId` so the
 * "Local support" copy could program-link them) — genuinely wrong for a
 * panel titled "Programs matched here." Gated on
 * `sectionBucketKey(section) === "programs"` so only the actual program
 * tiers (goal-match/confirmed/other-confirmed/additional/also-at-address)
 * ever contribute.
 */
export function visiblePersonaProgramNames(
  lensed: GeneratedReport,
): { programId: string; label: string }[] {
  return visiblePersonaProgramItems(lensed).map(({ programId, label }) => ({ programId, label }));
}

/**
 * Owner ruling 2026-08-23 (persona-parity punch-list Q1): the executive
 * summary fills to three program names even when the strict persona card set
 * contains fewer than three. Strict visible matches always lead; the remaining
 * slots come, in lens order, from the one collapsed "Also at this address"
 * section. This reads only the already-lensed report — never the canonical
 * report — and does not promote the fill programs into the visible card set.
 */
export function personaSummaryProgramNames(
  lensed: GeneratedReport,
): { programId: string; label: string }[] {
  const results = visiblePersonaProgramNames(lensed);
  const seen = new Set(results.map(({ programId }) => programId));

  for (const section of lensed.sections ?? []) {
    // `collapsedByPersona` is itself the typed contract for the one
    // program-only disclosure produced by applyPersonaLens. Do not
    // re-classify it by id/title here: saved or normalized report shapes can
    // legitimately alter those display fields, while the marker is the
    // authoritative signal the renderers also use.
    if (!section.collapsedByPersona) continue;
    for (const item of section.items ?? []) {
      if (!item.programId || seen.has(item.programId)) continue;
      seen.add(item.programId);
      results.push({ programId: item.programId, label: item.label });
      if (results.length === 3) return results;
    }
  }

  return results.slice(0, 3);
}

/**
 * Same visible-program resolution as visiblePersonaProgramNames (gate
 * finding 1's "programs" bucket gate applies here too), but also carries
 * the full ReportItem each name came from. Gate finding 7 needs this: the
 * Brief's BriefProgramRow must read whyLine/amount/window off the SAME
 * lensed item the program card itself renders, not a re-derived summary.
 */
export function visiblePersonaProgramItems(
  lensed: GeneratedReport,
): { programId: string; label: string; item: ReportItem }[] {
  const seen = new Set<string>();
  const results: { programId: string; label: string; item: ReportItem }[] = [];
  for (const section of lensed.sections ?? []) {
    if (section.collapsedByPersona) continue;
    if (sectionBucketKey(section) !== "programs") continue;
    for (const item of section.items ?? []) {
      if (!item.programId || seen.has(item.programId)) continue;
      seen.add(item.programId);
      results.push({ programId: item.programId, label: item.label, item });
    }
  }
  return results;
}

/** Stable reorder so persona-relevant program actions lead (all kept, expanded).
 *  This is the legacy path: it runs unconditionally (independent of
 *  `startHere`) because report-rendering surfaces still read `actionRoadmap`
 *  directly and must keep seeing it persona-ordered. */
function reorderActionRoadmap(
  roadmap: ActionRoadmapItem[] | undefined,
  persona: PersonaId,
  lookup: PersonaTagLookup,
): ActionRoadmapItem[] | undefined {
  if (!roadmap || roadmap.length === 0) return roadmap;
  return roadmap
    .map((item, index) => ({
      item,
      index,
      match: programMatchesPersona(item.programId, persona, lookup) ? 0 : 1,
    }))
    .sort((a, b) => a.match - b.match || a.index - b.index)
    .map((entry) => entry.item);
}

/**
 * Persona-consistent counterpart to `reorderActionRoadmap`, applied to the
 * canonical `startHere` model when a report carries one. Additive: reports
 * without `startHere` are untouched (the legacy `actionRoadmap` reorder above
 * remains their only persona-ordering signal).
 *
 * The discovery-only boundary from `buildStartHere` (lib/start-here.ts) is
 * absolute and persona-independent: when `primary.kind === "confirm-zoning-use"`,
 * an unresolved zoning/use question is leading the report and must never be
 * displaced by a persona-matched financing action, so this is a no-op in
 * that case.
 */
function reorderStartHere(
  startHere: StartHere | undefined,
  persona: PersonaId,
  lookup: PersonaTagLookup,
): StartHere | undefined {
  if (!startHere) return startHere;
  if (startHere.primary.kind === "confirm-zoning-use") return startHere;

  const actions = startHereActionsInOrder(startHere);
  if (actions.length <= 1) return startHere;

  const [primary, ...secondary] = actions
    .map((action, index) => ({
      action,
      index,
      match: programMatchesPersona(action.programId, persona, lookup) ? 0 : 1,
    }))
    .sort((a, b) => a.match - b.match || a.index - b.index)
    .map((entry) => entry.action);

  return { ...startHere, primary, secondary };
}

// ─── Analytics: exactly-once emission per selection ──────────────────

export interface PersonaSelectedEvent {
  persona: PersonaId;
  reportType: string;
  matchedProgramsBefore: number;
  matchedProgramsAfter: number;
}

/**
 * Build the `persona_chip_selected` payload for a lens change, or null when the
 * persona did not actually change. Emitting only on a real change is what makes
 * the event fire exactly once per selection (no effect-driven double-fire —
 * cf. the PR #51 snapshot bug).
 */
export function personaSelectionEvent(
  previous: PersonaId,
  next: PersonaId,
  report: GeneratedReport,
  lookup: PersonaTagLookup = defaultLookup,
): PersonaSelectedEvent | null {
  if (next === previous) return null;
  const { matchedBefore, matchedAfter } = applyPersonaLens(report, next, lookup);
  return {
    persona: next,
    reportType: report.reportType,
    matchedProgramsBefore: matchedBefore,
    matchedProgramsAfter: matchedAfter,
  };
}
