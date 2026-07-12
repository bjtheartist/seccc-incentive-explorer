// ─── Persona lens over a generated report (Tier 1b, audit BM4) ───────
// Pure, client-safe transforms that re-order and collapse EXISTING report
// content for a chosen visitor persona. No regeneration, no eligibility
// claims — a lens over the same snapshot.
//
// The canonical persona tags live in the static program dataset
// (public/data/programs.json `personas`). This module keeps a lightweight
// mirror (PROGRAM_PERSONA_TAGS) so the lens works synchronously on the client
// even when the caller has not loaded the full program list (e.g. a saved
// workspace report). A test asserts the mirror and the dataset never drift
// (lib/__tests__/report-personas.test.ts).

import {
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
} from "@/lib/report-engine";
import type {
  ActionRoadmapItem,
  GeneratedReport,
  ReportItem,
  ReportSection,
} from "@/lib/report-engine";
import {
  DEFAULT_PERSONA,
  personaDescriptor,
  type PersonaId,
} from "@/lib/personas";

/** Section title for the collapsed "everything else" disclosure. */
export const ALSO_AT_ADDRESS_TITLE = "Also at this address";

const CONFIRMED_SECTION_TITLES = new Set([
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
]);

const SUPPORT_NETWORK_TITLE = "Your Support Network";

/**
 * DRAFT persona tags mirrored from public/data/programs.json.
 * Editorial, descriptive — review with SECCC staff before treating as truth.
 * Untagged programs (or [] here) appear in the "All" lens only.
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
  ssa: ["growing"],
  // highUnemployment — informational overlay, All lens only.
  class7a: ["growing", "developer"],
  catalystGrant: ["starting", "growing"],
  cpace: ["growing", "developer"],
  smallBizSource: ["starting", "growing"],
  landBank: ["developer"],
  nof: ["starting", "growing"],
  nmtcEligible: ["developer"],
  qct: ["developer"],
  landmarkDistricts: ["growing", "developer"],
  nrhpDistricts: ["developer"],
  microMarketRecovery: ["growing", "developer"],
  // industrialCorridors — protection overlay, All lens only.
  ccsa: ["starting", "growing"],
  hubzone: ["starting", "growing"],
  energyCommunityBonus: ["developer"],
  iraCleanElectricity: ["developer"],
  electivePay: ["developer"],
  sec179d: ["growing", "developer"],
  hudSection108: ["developer"],
  cdfiBond: ["developer"],
  sba7a504: ["starting", "growing", "developer"],
  sbaDisasterEidl: ["starting", "growing"],
  chips48d: ["developer"],
  ssbciAdvantageIL: ["starting", "growing"],
  edaBuildToScale: ["growing", "developer"],
  bmec: ["growing", "developer"],
  aim: ["growing", "developer"],
  quantumEZ: ["developer"],
  hib: ["developer"],
  innovationVoucher: ["starting", "growing"],
  economicEmpowermentCenters: ["starting"],
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
  workforceSolutions: ["growing"],
  climateInfrastructureFund: ["developer"],
  comedEvRebate: ["growing"],
  comedSmallBizEfficiency: ["starting", "growing"],
  comedDgSolar: ["growing", "developer"],
  peoplesGasEfficiency: ["growing"],
  kivaChicago: ["starting"],
  greenwoodArcher: ["starting", "growing"],
  alliesCommunityBusiness: ["starting", "growing"],
};

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

// ─── Support-network ordering ────────────────────────────────────────
// Reorder advising vs. capital organizations by persona. Keyword-based over
// the org role/label the report already carries (no new data).

const CAPITAL_KEYWORDS = [
  "loan",
  "lend",
  "lender",
  "capital",
  "cdfi",
  "financ",
  "fund",
  "bank",
  "credit union",
  "microloan",
];
const ADVISING_KEYWORDS = [
  "advis",
  "counsel",
  "technical assistance",
  "sbdc",
  "score",
  "chamber",
  "development corp",
  "edo",
  "bso",
  "incubat",
  "accelerat",
  "mentor",
];

type OrgKind = "capital" | "advising" | "other";

function orgKind(item: ReportItem): OrgKind {
  const haystack = `${item.label ?? ""} ${item.value ?? ""} ${item.detail ?? ""}`.toLowerCase();
  if (CAPITAL_KEYWORDS.some((k) => haystack.includes(k))) return "capital";
  if (ADVISING_KEYWORDS.some((k) => haystack.includes(k))) return "advising";
  return "other";
}

/** Ranking weight (lower = earlier) for an org given the active persona. */
function orgWeight(kind: OrgKind, persona: PersonaId): number {
  // "developer"/"growing" surface finance first; "starting" surfaces advising.
  const capitalFirst = persona === "developer" || persona === "growing";
  if (kind === "capital") return capitalFirst ? 0 : 1;
  if (kind === "advising") return capitalFirst ? 1 : 0;
  return 2;
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
    .map((item, index) => ({ item, index, weight: orgWeight(orgKind(item), persona) }))
    .sort((a, b) => a.weight - b.weight || a.index - b.index) // stable within a weight
    .map((entry) => entry.item);
  return { ...section, items: [...pinned, ...ordered] };
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

export interface PersonaLensResult {
  /** The lensed report. Identical reference to the input when persona = "all". */
  report: GeneratedReport;
  /** Unique confirmed programs in the canonical ("All") view. */
  matchedBefore: number;
  /** Unique confirmed programs surfaced by the active persona. */
  matchedAfter: number;
}

/**
 * Re-order and collapse a report for a persona lens. Pure: returns a new
 * report (or the same reference for "all"). Never drops content — programs the
 * lens de-prioritizes move into a collapsed "Also at this address" section.
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
  // Refined reports carry TWO confirmed sections ("Best Matches for Your Goal"
  // + "Other Programs Tied to This Address") — persona and goal are orthogonal
  // lenses, so both are partitioned and their out-of-lens programs pool into a
  // SINGLE combined "Also at this address" disclosure after the last one.
  const alsoItems: ReportItem[] = [];
  let lastConfirmedIndex = -1;

  for (const section of report.sections ?? []) {
    if (section.title === SUPPORT_NETWORK_TITLE) {
      nextSections.push(reorderSupportNetwork(section, persona));
      continue;
    }

    if (!CONFIRMED_SECTION_TITLES.has(section.title)) {
      nextSections.push(section);
      continue;
    }

    const items = section.items ?? [];
    const primary: ReportItem[] = [];
    const secondary: ReportItem[] = [];
    let matchedProgramCount = 0;

    for (const item of items) {
      // Non-program items (lead notes) always stay with the primary group.
      if (!isProgramItem(item)) {
        primary.push(item);
        continue;
      }
      if (programMatchesPersona(item.programId, persona, lookup)) {
        primary.push(item);
        matchedProgramCount += 1;
        if (item.programId) matchedIds.add(item.programId);
      } else {
        secondary.push(item);
      }
    }

    // Nothing in this section matches the lens → leave it untouched rather than
    // collapse the whole thing (a persona with zero hits still sees its list).
    if (matchedProgramCount === 0 || secondary.length === 0) {
      nextSections.push(section);
      lastConfirmedIndex = nextSections.length - 1;
      continue;
    }

    nextSections.push({ ...section, items: primary });
    lastConfirmedIndex = nextSections.length - 1;
    alsoItems.push(...secondary);
  }

  if (alsoItems.length > 0) {
    nextSections.splice(lastConfirmedIndex + 1, 0, {
      title: ALSO_AT_ADDRESS_TITLE,
      description: `Other programs tied to this address — outside the ${personaDescriptor(
        persona,
      )} lens. Nothing is removed; switch to All to rank them first.`,
      items: alsoItems,
      collapsedByPersona: true,
    });
  }

  const nextRoadmap = reorderActionRoadmap(report.actionRoadmap, persona, lookup);

  const nextReport: GeneratedReport = {
    ...report,
    sections: nextSections,
    ...(nextRoadmap ? { actionRoadmap: nextRoadmap } : {}),
  };

  return { report: nextReport, matchedBefore, matchedAfter: matchedIds.size };
}

/** Stable reorder so persona-relevant program actions lead (all kept, expanded). */
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
