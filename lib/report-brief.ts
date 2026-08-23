// ─── The Brief (persona spec v2, item 5) ─────────────────────────────────
// A one-page, forwardable, print-ready summary of a report — the "hand
// this to whoever can help" artifact. Two questions (business stage,
// current priority) shape the SEEKING line and the stage-progress
// indicator; everything else is read off the SAME already-lensed report
// the online view renders — no separate generation path, no new eligibility
// claims. Pure data assembly lives here; rendering lives in
// components/report/BriefPage.tsx and the /report/brief route.

import { visiblePersonaProgramItems } from "@/lib/report-personas";
import { buildContactSheetRows } from "@/lib/report-contact-sheet";
import { SECTION_IDS } from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";
import type { PersonaId } from "@/lib/personas";

export const BRIEF_STAGE_OPTIONS = [
  { id: "exploring", label: "Exploring an idea" },
  { id: "launch-ready", label: "Getting launch-ready" },
  { id: "operating", label: "Open & operating" },
  { id: "growing", label: "Growing & expanding" },
] as const;

export type BriefStage = (typeof BRIEF_STAGE_OPTIONS)[number]["id"];

export const BRIEF_PRIORITY_OPTIONS = [
  { id: "financing", label: "Securing financing", seekingLabel: "financing" },
  { id: "space", label: "Finding or securing space", seekingLabel: "space" },
  { id: "renovation", label: "Renovation & build-out", seekingLabel: "build-out financing" },
  { id: "navigating", label: "Navigating programs & permits", seekingLabel: "program guidance" },
] as const;

export type BriefPriority = (typeof BRIEF_PRIORITY_OPTIONS)[number]["id"];

export function isBriefStage(value: unknown): value is BriefStage {
  return BRIEF_STAGE_OPTIONS.some((o) => o.id === value);
}

export function isBriefPriority(value: unknown): value is BriefPriority {
  return BRIEF_PRIORITY_OPTIONS.some((o) => o.id === value);
}

export function briefStageLabel(stage: BriefStage): string {
  return BRIEF_STAGE_OPTIONS.find((o) => o.id === stage)?.label ?? "";
}

export function briefSeekingLine(priority: BriefPriority): string {
  return BRIEF_PRIORITY_OPTIONS.find((o) => o.id === priority)?.seekingLabel ?? "";
}

const MAX_BRIEF_PROGRAMS = 3;
const MAX_BRIEF_CONTACTS = 3;

export interface BriefProgramRow {
  programId: string;
  name: string;
  /**
   * Gate finding 7: left-block/right-stack card fields, read from the SAME
   * lensed ReportItem the online program card renders — never re-derived
   * or invented for the Brief specifically. `whyLine` is the first
   * published match reason (item.matchExplanation.whyItAppears[0]);
   * `window` is the program's own nextWindow, preferring the published
   * note (already full prose) and falling back to the bare expected date.
   * `amount` is ALWAYS null: it was meant to read Program.benefitRange,
   * but that value (under any key name) is explicitly blocked from ever
   * reaching the canonical serialized report by the pre-existing
   * PRIVATE_MATCH_FIELDS guard in lib/__tests__/public-report-safety.
   * test.ts — it collides with the internal confidence-engine ranking
   * shape's own `benefitRange` field. Kept as a typed field so a future
   * real, non-blocklisted amount source can populate it later. Any field
   * may be absent — a program without a resolved reason/window simply
   * doesn't carry it, never a placeholder.
   */
  whyLine: string | null;
  amount: string | null;
  window: string | null;
}

/** Local UI state for the Brief's two-question ask + open/closed state —
 *  a single state slot (both forks) so the ordinal-seeded test harness only
 *  gains one new entry, not three. See report-page-live-renderer.test.tsx's
 *  maintenance warning on adding useState calls. */
export interface BriefUiState {
  askOpen: boolean;
  open: boolean;
  stage: BriefStage | null;
  priority: BriefPriority | null;
}

export const DEFAULT_BRIEF_UI_STATE: BriefUiState = {
  askOpen: false,
  open: false,
  stage: null,
  priority: null,
};

export interface BriefData {
  address: string | null;
  goalLabel: string | null;
  zoneClass: string | null;
  zoneType: string | null;
  siteFacts: { label: string; value: string }[];
  programs: BriefProgramRow[];
  overflowCount: number;
  contacts: { name: string; detail: string }[];
  stage: BriefStage;
  priority: BriefPriority;
  /** Derivable only — never a free-text field. Set only when the report
   *  arrived through a facilitated/attributed source the report already
   *  carries (e.g. a chamber-facilitated session); otherwise omitted. */
  preparedVia: string | null;
  generatedDate: string;
  /** The REPORT's real freshness (lensed.generatedAt), never today's date.
   *  Null only when the report itself carries no parseable generatedAt —
   *  the footer omits the clause entirely rather than guessing. */
  dataVerifiedMonth: string | null;
}

/**
 * Assembles the Brief from the SAME lensed report + persona the online
 * view is already showing — no second generation path. 3-3-3 caps
 * (programs / contacts / site-facts rows): omission over compression —
 * when there is more than 3, the extra items are named only as a count
 * ("+N more mapped — in the full report"), never crammed smaller to fit.
 */
export function buildBriefData(
  lensed: GeneratedReport,
  persona: PersonaId,
  stage: BriefStage,
  priority: BriefPriority,
): BriefData {
  const programNames = visiblePersonaProgramItems(lensed);
  const programs: BriefProgramRow[] = programNames.slice(0, MAX_BRIEF_PROGRAMS).map((p) => ({
    programId: p.programId,
    name: p.label,
    whyLine: p.item.matchExplanation?.whyItAppears?.[0] ?? null,
    // `amount` stays permanently null: Program.benefitRange cannot flow
    // onto ReportItem under any key (public-report-safety.test.ts's
    // PRIVATE_MATCH_FIELDS guard blocks both the key name and its literal
    // value — see the doc comment on ReportItem.nextWindow). Kept as a
    // typed field so a future real, non-blocklisted amount source can
    // populate it without another BriefProgramRow schema change.
    amount: null,
    window: p.item.nextWindow?.note ?? (p.item.nextWindow?.expected ? `Expected ${p.item.nextWindow.expected}` : null),
  }));

  const contactRows = buildContactSheetRows(lensed, persona).slice(0, MAX_BRIEF_CONTACTS);

  // Gate finding 18 (minor, regression): this used to select by
  // `s.title === "Site Facts"`, reintroducing the English-title coupling
  // PR #156 (853c948) removed elsewhere — a renamed/localized section
  // title would silently break the Brief's site-facts column.
  // lib/report-personas.ts:288's sectionBucketKey does this correctly
  // (`id === SECTION_IDS.siteFacts || title === "Site Facts"`, id first);
  // matched here.
  const siteFactsSection = lensed.sections?.find(
    (s) => s.id === SECTION_IDS.siteFacts || s.title === "Site Facts",
  );
  const siteFacts = (siteFactsSection?.items ?? [])
    .filter((item) => !item.programId)
    .slice(0, 3)
    .map((item) => ({ label: item.label, value: item.value }));

  // Gate finding 14: "data verified" must be the REPORT's real freshness
  // (when this snapshot was actually generated), never today's date — a
  // Brief built from a report generated last month must say so, not claim
  // today's vintage. `generatedDate` (the Brief artifact itself) is
  // legitimately today; `dataVerifiedMonth` is not.
  const now = new Date();
  const dataVerifiedDate = new Date(lensed.generatedAt);
  const dataVerifiedMonth = Number.isNaN(dataVerifiedDate.getTime())
    ? null
    : dataVerifiedDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });

  return {
    address: lensed.metadata?.address ?? null,
    goalLabel: lensed.metadata?.projectGoals?.[0] ?? lensed.metadata?.projectType ?? null,
    zoneClass: lensed.metadata?.zoneClass ?? null,
    zoneType: lensed.metadata?.zoneType ?? null,
    siteFacts,
    programs,
    overflowCount: Math.max(0, programNames.length - programs.length),
    contacts: contactRows.map((row) => ({ name: row.name, detail: row.whyLine })),
    stage,
    priority,
    // "Prepared via" is derivable-only: this report has no facilitated-
    // session/practitioner-validation field surfaced to the public report
    // shape today, so it is always omitted rather than guessed. The field
    // stays typed so a future real source (e.g. a chamber referral code
    // already threaded through analytics) can populate it without a
    // Brief-specific schema change.
    preparedVia: null,
    generatedDate: now.toISOString().slice(0, 10),
    dataVerifiedMonth,
  };
}
