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

/** A lookup from program id to persona tags. */
export type PersonaTagLookup = (programId: string) => PersonaId[];

const defaultLookup: PersonaTagLookup = (id) => PROGRAM_PERSONA_TAGS[id] ?? [];

export function programMatchesPersona(
  programId: string | undefined,
  persona: PersonaId,
  lookup: PersonaTagLookup = defaultLookup,
): boolean {
  if (persona === DEFAULT_PERSONA) return true;
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

type SectionBucketKey =
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

const BUCKET_PART: Record<SectionBucketKey, GuidepostPart> = {
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
  if (title === "Neighborhood Economic Context") return "neighborhoodContext";
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
  if (id === CAPITAL_PARTNER_SECTION_ID || title === CAPITAL_PARTNER_SECTION_TITLE) return "financing";
  if (isSupportOrganizationSectionTitle(title) || id === SUPPORT_ORGANIZATIONS_SECTION_ID) return "organizations";
  return "rest";
}

/** Per-persona bucket order within the fixed 3-part anatomy. "programs"
 *  always carries the ALSO_AT_ADDRESS disclosure right behind it (same
 *  bucket — see sectionBucketKey), so the collapsed line never drifts away
 *  from the list it collapsed. */
const PERSONA_SECTION_ORDER: Record<Exclude<PersonaId, "all">, SectionBucketKey[]> = {
  // Owner ruling: Site facts FIRST in part 01, zoning LAST in part 01.
  starting: ["siteFacts", "logisticsAccess", "civicRepresentation", "zoning", "programs", "documentReadiness", "financing", "organizations", "rest"],
  growing: ["siteFacts", "logisticsAccess", "civicRepresentation", "zoning", "programs", "documentReadiness", "financing", "organizations", "rest"],
  supporter: ["neighborhoodContext", "civicRepresentation", "zoning", "programs", "financing", "organizations", "siteFacts", "logisticsAccess", "rest"],
  developer: ["siteFacts", "logisticsAccess", "civicRepresentation", "zoning", "programs", "financing", "organizations", "neighborhoodContext", "rest"],
};

function reorderSectionsForPersona(sections: ReportSection[], persona: PersonaId): ReportSection[] {
  if (persona === DEFAULT_PERSONA) return sections;
  const order = PERSONA_SECTION_ORDER[persona as Exclude<PersonaId, "all">];
  if (!order) return sections;
  return sections
    .map((section, index) => {
      const bucket = sectionBucketKey(section);
      const position = order.indexOf(bucket);
      return { section, index, position: position === -1 ? order.length : position };
    })
    .sort((a, b) => a.position - b.position || a.index - b.index)
    .map((entry) => entry.section);
}

/** Which guidepost PART a (already persona-lensed) section belongs in, for
 *  the shared band-rendering component. Returns null for "all" (no
 *  guidepost). */
export function guidepostPartForSection(
  section: ReportSection,
  persona: PersonaId,
): GuidepostPart | null {
  if (persona === DEFAULT_PERSONA) return null;
  return BUCKET_PART[sectionBucketKey(section)];
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

  for (const section of report.sections ?? []) {
    if (isSupportOrganizationSectionTitle(section.title)) {
      nextSections.push(reorderSupportNetwork(section, persona));
      continue;
    }

    const isFullyDemoted = isFullyDemotedTier(section);
    const isConfirmedTier = !isFullyDemoted && CONFIRMED_SECTION_TITLES.has(section.title);

    if (!isConfirmedTier && !isFullyDemoted) {
      nextSections.push(section);
      continue;
    }

    const items = section.items ?? [];
    const primary: ReportItem[] = [];
    const secondary: ReportItem[] = [];

    for (const item of items) {
      const visible = isFullyDemoted
        // Out-of-goal / discovery tiers carry nothing goal-matched by
        // construction: only the pinned protection/informational overlays
        // survive here under a persona lens.
        ? isProgramItem(item) && isPinnedOverlayItem(item)
        // Confirmed / goal-matched tier: goal-matched (by which section
        // this is) ∩ persona-tagged, plus pinned overlays. Non-program
        // items (lead notes) stay with the primary group, as before.
        : !isProgramItem(item)
          ? true
          : isPinnedOverlayItem(item) || programMatchesPersona(item.programId, persona, lookup);

      if (visible) {
        primary.push(item);
        if (item.programId) matchedIds.add(item.programId);
      } else {
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
    if (primary.length > 0) {
      nextSections.push({ ...section, items: primary });
    } else if (isConfirmedTier && items.length > 0) {
      nextSections.push({ ...section, items: [], description: personaEmptyProgramsDescription(persona) });
    }
    alsoItems.push(...secondary);
  }

  if (alsoItems.length > 0) {
    nextSections.push({
      title: ALSO_AT_ADDRESS_TITLE,
      description: `${alsoItems.length} other program${alsoItems.length === 1 ? "" : "s"} tied to this address — outside the ${personaDescriptor(
        persona,
      )} lens. Nothing is removed; switch to All to see everything together.`,
      items: alsoItems,
      collapsedByPersona: true,
    });
  }

  const orderedSections = reorderSectionsForPersona(nextSections, persona);
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
