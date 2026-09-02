"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { AlertCircle, Loader2 } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import type { GeneratedReport } from "@/lib/report-engine";
import type { WizardState } from "@/lib/report-wizard-config";
import { projectGoalDisplayLabel } from "@/lib/report-wizard-config";
import {
  dedupeGoalIds,
  GATE_GOAL_CHIPS,
  GATE_LOOKING_CHIP_ID,
  gateGoalChipsToGoalIds,
  gateGoalSelectionIsComplete,
  goalIdsToGateChipIds,
  MAX_GATE_GOAL_CHIPS,
  toggleGateGoalChip,
  unmatchedGoalIds,
} from "@/lib/gate-goal-groups";
import { GATE_PERSONA_CHIPS } from "@/lib/gate-persona-groups";
import {
  DEFAULT_PERSONA,
  loadStoredPersona,
  personaFromSearch,
  storePersona,
  type PersonaId,
} from "@/lib/personas";
import { inferPersonaFromIntake } from "@/lib/persona-inference";
import { submitSupportRequest } from "@/lib/support-lead";
import { SaveReportModal } from "@/components/workspace/SaveReportModal";
import { storePendingReport } from "@/components/workspace/PendingReportSaver";

interface ReportEmailGateProps {
  report: GeneratedReport;
  source: string;
  wizardState?: WizardState;
  onPrepareReport: (
    projectGoals: string[],
    customGoal: string,
  ) => Promise<GeneratedReport | null>;
  onReportReady: (deliveredReport: GeneratedReport) => void;
  /**
   * Fired alongside `storePersona` in `commitPersonaSelection` (both the
   * View and Save paths), with the visitor's final persona choice —
   * inferred-and-unconfirmed, or explicitly tapped. Lets the caller
   * propagate the choice into a LIVE view's persona state, not just
   * sessionStorage: `storePersona` alone only reaches a FUTURE mount (a
   * fresh page load re-reading storage), never a `ReportDisplay` instance
   * that is already mounted as this gate's sibling when the gate closes —
   * which is exactly what leaves a just-gated report rendering
   * `DEFAULT_PERSONA` (no guidepost PART bands) without this. Optional so
   * every existing direct-render test of this component (none of which
   * care about a live sibling view) keeps compiling unchanged.
   */
  onPersonaCommitted?: (persona: PersonaId) => void;
}

type ActionStatus = "idle" | "preparing";
type SupportStatus = "idle" | "sending" | "sent" | "error";

/**
 * The existing report's goal ids, read the SAME uncapped way
 * `app/report/page.tsx`'s `handlePrepareGatedReport` now reads them (gate
 * review round 1, BLOCKER 1/2) — never through `selectedProjectGoals()`,
 * which slices to 3 and would silently re-drop a 4th id on every reseed of
 * an already gate-prepared report.
 */
function existingGoalIdsFor(report: GeneratedReport): string[] {
  const goals = report.metadata?.projectGoals;
  if (goals && goals.length > 0) return dedupeGoalIds(goals);
  const projectType = report.metadata?.projectType;
  return projectType ? [projectType] : [];
}

export function ReportEmailGate({
  report,
  source,
  wizardState,
  onPrepareReport,
  onReportReady,
  onPersonaCommitted,
}: ReportEmailGateProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { status: authStatus } = useSession();

  // Persona intake (owner ruling A1, carried into the redesign): inferred
  // once from what the visitor already told the report, pre-selected.
  // Gate review round 1, finding 11: persona IS part of the mandatory
  // predicate below (`canProceed`) — it just never blocks in PRACTICE,
  // because inference always resolves to one of the four real gate chips,
  // never empty. `personaTouched` tracks whether the visitor actually
  // tapped a chip, so analytics can honestly report "inferred" (untouched)
  // vs. "confirmed"/"corrected" (a real tap) instead of always claiming
  // "confirmed" for a chip nobody touched. `personaSeed.source` below keeps
  // URL/storage-prefilled untouched rows distinguishable from a real
  // inference acceptance without changing that established outcome vocabulary.
  const [inferredPersona] = useState<PersonaId>(() =>
    inferPersonaFromIntake({
      industry: report.metadata?.industry,
      projectGoals: report.metadata?.projectGoals,
      projectType: report.metadata?.projectType,
      reportType: report.reportType,
    }),
  );
  // Gate review follow-up round 1, MAJOR-1: a sender-framed `?persona=`
  // share link (`handleShareReport`, app/report/page.tsx) hits this gate
  // exactly like any other site-incentives report — `reportRequiresEmailGate`
  // does not carve out an exception for one. Before this fix, the gate's
  // pre-selected chip always came from `inferredPersona` (pure intake
  // inference), so a recipient who read the sender's "shared as Developer"
  // notice, picked a goal, and clicked View without touching the
  // pre-selected row silently got their OWN inferred persona instead —
  // the notice's "the lens this link was shared with" claim became false
  // the moment the gate closed. Seeding with the SAME URL-then-sessionStorage
  // precedence used by `resolveInitialPersona` in the live view
  // (app/report/page.tsx's `ReportWizardPage`) keeps both surfaces in agreement
  // while retaining the seed's provenance for telemetry: the gate chip shows
  // the sender's lens, the visitor can still change it, and an untouched row
  // propagates the framed lens truthfully instead of overwriting it.
  const [personaSeed] = useState<{
    persona: PersonaId;
    source: "url" | "storage" | "inference";
  }>(() => {
    const fromUrl = personaFromSearch(
      typeof window !== "undefined" ? window.location.search : null,
    );
    if (fromUrl !== DEFAULT_PERSONA) return { persona: fromUrl, source: "url" };
    const fromStorage = loadStoredPersona();
    if (fromStorage !== DEFAULT_PERSONA) return { persona: fromStorage, source: "storage" };
    return { persona: inferredPersona, source: "inference" };
  });
  const [persona, setPersona] = useState<PersonaId>(personaSeed.persona);
  const [personaTouched, setPersonaTouched] = useState(false);

  // Gate review round 1, BLOCKER 2 + gate review round 2, NEW-1/NEW-2/
  // NEW-5 (ruling #2/#3): the gate must never destroy — NOR silently
  // ADD TO — goals the visitor already entered (a completed wizard run, a
  // refine, a shared link with goals baked in — `reportRequiresEmailGate`
  // fires for every site-incentives/location-incentives report, including
  // those). `originalGoalIds` is the visitor's ORIGINAL array, frozen
  // verbatim (order included) at mount — it is what actually gets
  // resubmitted until a real chip toggle happens (see `projectGoalIds`
  // below), never re-derived from the coarser chip mapping. Seeding chips
  // for DISPLAY only — via `goalIdsToGateChipIds`/`unmatchedGoalIds` — is
  // a SEPARATE, display-only concern: pre-pressing "Expand or buy
  // equipment" for a report that only ever had "expansion" is honest
  // DISPLAY (the closest chip), but re-deriving "equipment" from that
  // press and sending it back would be inventing data the visitor never
  // chose — exactly what NEW-1 caught. `customGoal` is preserved verbatim
  // and resent on every prepare call — never hardcoded empty.
  const [originalGoalIds] = useState<string[]>(() => existingGoalIdsFor(report));
  const [selectedGoalChips, setSelectedGoalChips] = useState<string[]>(() =>
    goalIdsToGateChipIds(originalGoalIds),
  );
  // Gate review round 3, MAJOR finding R3-5: the LIVE passthrough state
  // used for emission, cleared while "Just looking around" is active.
  // `originalPassthroughGoalIds` (below) is the frozen, never-mutated
  // source of truth used to RESTORE it — without this, seeding
  // `["other"]` + custom text, tapping "Just looking around," then
  // un-tapping it left the box permanently disabled with no way back
  // short of a reload.
  const [passthroughGoalIds, setPassthroughGoalIds] = useState<string[]>(() =>
    unmatchedGoalIds(originalGoalIds),
  );
  const [originalPassthroughGoalIds] = useState<string[]>(() => unmatchedGoalIds(originalGoalIds));
  // NEW-2/ruling #3: seeded state above MAX_GATE_GOAL_CHIPS (e.g. a
  // legacy 3-goal wizard run) is legal and must stay recoverable — the
  // visitor may freely deselect/reselect any of THOSE chips without a
  // re-add getting silently and permanently blocked. Frozen at mount, so
  // a fresh visitor (0 or ≤2 seeded) keeps the normal 2-chip cap for new
  // growth, while a legacy 3-seed session gets a 3-chip cap for its
  // entire lifetime (a deliberately small amount of extra headroom for a
  // 4th, never-seeded pick — the simplest fix that guarantees no seeded
  // chip is ever strandable, at the cost of not distinguishing "a
  // re-added seeded chip" from "a brand-new 3rd/4th pick" once above 2).
  const [goalChipCap] = useState<number>(() =>
    Math.max(MAX_GATE_GOAL_CHIPS, goalIdsToGateChipIds(originalGoalIds).length),
  );
  // Ruling #2: flips true on the visitor's FIRST real chip toggle (any
  // chip, including "Just looking around") — only then does emission
  // switch from "resend the original array verbatim" to "derive ids from
  // whatever's currently pressed."
  const [hasToggledGoals, setHasToggledGoals] = useState(false);
  const [customGoal] = useState(report.metadata?.customGoal || "");

  const [supportName, setSupportName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [wantsSupport, setWantsSupport] = useState(false);
  const [website, setWebsite] = useState("");
  const [supportStatus, setSupportStatus] = useState<SupportStatus>("idle");
  const [supportError, setSupportError] = useState("");
  const [supportEmailError, setSupportEmailError] = useState("");
  // Once a support-submission failure has been shown once, a second click
  // of View/Save proceeds without blocking again (gate review round 1,
  // finding 3: surface the failure, but "never blocks the report" still
  // has to mean something after the visitor has SEEN the failure).
  const [supportGaveUp, setSupportGaveUp] = useState(false);

  const [viewStatus, setViewStatus] = useState<ActionStatus>("idle");
  const [saveStatus, setSaveStatus] = useState<ActionStatus>("idle");
  const [saveModalReport, setSaveModalReport] = useState<GeneratedReport | null>(null);
  const [error, setError] = useState("");

  const isBusy = viewStatus !== "idle" || saveStatus !== "idle";
  // Ruling #2: before any real toggle, "complete" means the report already
  // had a real goal to resubmit verbatim — not whatever the display chips
  // happen to derive to (avoids the same silent-add the emission fix
  // avoids). After a toggle, the normal chip/passthrough completeness
  // rule applies.
  const selectionComplete = hasToggledGoals
    ? gateGoalSelectionIsComplete(selectedGoalChips) || passthroughGoalIds.length > 0
    : originalGoalIds.length > 0;
  // Persona is genuinely part of the predicate (finding 11) even though it
  // is never actually falsy — `persona` always holds a real, chip-backed
  // PersonaId from the moment this component mounts.
  const canProceed = Boolean(persona) && selectionComplete && !isBusy;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      return () => {
        if (dialog.open) dialog.close();
      };
    }
    // Gate review round 2, MINOR NEW-7: jsdom (this repo's test
    // environment) does not implement HTMLDialogElement.showModal(), and
    // this fallback (the plain `open` attribute, no backdrop/focus trap)
    // is what keeps a closed — hence accessibility-hidden — <dialog> from
    // silently swallowing every control inside it during
    // @testing-library/react interaction tests. That same fallback would
    // be a real, bypassable gate (no modal semantics at all) if it ever
    // ran in production, so it is guarded to test environments only. A
    // real production browser missing `showModal()` is left with a
    // CLOSED, non-interactive dialog and a logged error, never a silently
    // downgraded one — the correct failure mode for a gate is "does not
    // render," not "renders unenforced."
    if (process.env.NODE_ENV !== "production") {
      dialog.setAttribute("open", "");
      return () => {
        if (dialog.open) dialog.removeAttribute("open");
      };
    }
    console.error(
      "ReportEmailGate: HTMLDialogElement.showModal() is unavailable — the gate cannot render safely in this browser.",
    );
    return undefined;
  }, []);

  const commitPersonaSelection = (preparedReport: GeneratedReport) => {
    storePersona(persona);
    onPersonaCommitted?.(persona);
    const outcome = !personaTouched
      ? "inferred"
      : persona === inferredPersona
        ? "confirmed"
        : "corrected";
    trackEvent("persona_intake_inferred", {
      reportType: preparedReport.reportType,
      source: "report_email_gate",
      metadata: {
        inferredPersona,
        selectedPersona: persona,
        personaSeedSource: personaSeed.source,
        outcome,
      },
    });
  };

  const toggleGoalChip = (chipId: string) => {
    if (isBusy) return;
    // Ruling #2: ANY real chip toggle switches emission from "the original
    // array, verbatim" to "derived from whatever's pressed" — see
    // `projectGoalIds` below.
    setHasToggledGoals(true);

    const next = toggleGateGoalChip(selectedGoalChips, chipId, goalChipCap);
    const wasLookingSelected = selectedGoalChips.includes(GATE_LOOKING_CHIP_ID);
    const isLookingSelectedNow = next.includes(GATE_LOOKING_CHIP_ID);
    // Gate review round 3, MAJOR finding R3-5: an explicit "Just looking
    // around" tap is an unambiguous "no goal filter" signal — it clears
    // any passed-through, chip-less ids from the report's existing
    // metadata the same way it overrides the visible chips (spec §A:
    // exclusive of the other 7). But that must be RECOVERABLE: whenever
    // looking gets deselected again — either by tapping it a second time,
    // or implicitly, by picking a substantive chip while looking was
    // active — the original pass-through ids come back. Without this,
    // tapping looking then changing your mind left the gate permanently
    // disabled for any report seeded with a chip-less goal, with no way
    // back short of a reload.
    if (isLookingSelectedNow && !wasLookingSelected) {
      setPassthroughGoalIds([]);
    } else if (wasLookingSelected && !isLookingSelectedNow) {
      setPassthroughGoalIds(originalPassthroughGoalIds);
    }
    setSelectedGoalChips(next);
  };

  const selectPersonaChip = (chipId: string) => {
    if (isBusy) return;
    const chip = GATE_PERSONA_CHIPS.find((c) => c.id === chipId);
    if (!chip) return;
    setPersonaTouched(true);
    setPersona((current) =>
      chip.personaIds.includes(current)
        ? current
        : chip.personaIds.includes(inferredPersona)
          ? inferredPersona
          : chip.defaultPersonaId,
    );
  };

  /**
   * Gate review round 2, NEW-1/NEW-5, ruling #2: before any real chip
   * toggle, resubmit the visitor's ORIGINAL goal-id array verbatim — same
   * ids, same order — so an untouched gate never regenerates the report
   * (`app/report/page.tsx`'s JSON.stringify comparison matches exactly)
   * and never silently adds an id a pre-pressed-but-untouched chip merely
   * IMPLIES (e.g. `["expansion"]` pre-presses "Expand or buy equipment"
   * for display, but must never emit the chip's other id, `equipment`,
   * unless the visitor actually interacts). Only after a toggle does this
   * switch to the chip-derived mapping plus any pass-through ids.
   */
  const projectGoalIds = () =>
    hasToggledGoals
      ? dedupeGoalIds([...gateGoalChipsToGoalIds(selectedGoalChips), ...passthroughGoalIds])
      : originalGoalIds;

  /**
   * Real send for the support opt-in (spec §D). Assumes the caller has
   * already validated `wantsSupport` + a real-looking email — see
   * `validateSupportBoxOrShowError` and `submitSupportBoxIfNeeded` below,
   * which is what every entry point actually calls.
   */
  const submitSupportBox = async (preparedReport: GeneratedReport): Promise<boolean> => {
    setSupportStatus("sending");
    setSupportError("");
    try {
      const goalIds = projectGoalIds();
      const projectGoal = goalIds.map((id) => projectGoalDisplayLabel(id, customGoal)).join(", ");
      const outcome = await submitSupportRequest({
        name: supportName.trim() || undefined,
        email: supportEmail.trim(),
        address: preparedReport.metadata?.address,
        reportTitle: preparedReport.title,
        reportType: preparedReport.reportType,
        projectGoal: projectGoal || undefined,
        source: "report_email_gate",
        website,
      });
      trackEvent("inquiry_submitted", {
        reportType: preparedReport.reportType,
        source: "report_email_gate",
        address: preparedReport.metadata?.address || null,
        metadata: {
          projectGoals: goalIds,
          entrySource: source,
          notified: outcome.notified === true,
          notificationState: outcome.notificationState || null,
        },
      });
      // Owner ruling (Billy, 2026-09-01): the request row was stored, but if
      // the Chamber-inbox alert did not actually go out, the 48-hour promise
      // the visitor just read has no one on the other end of it. Surface that
      // loudly through the SAME first-click-stops / second-click-continues
      // doctrine every other support failure here uses — with copy that tells
      // the visitor the one action that guarantees a human sees them: email
      // the Chamber directly.
      //
      // Audit finding 3: this fires ONLY on a genuine `failed`. When the
      // server reports `unconfigured` (no Resend key or no help inbox — a
      // preview deploy, or a prod env rotation) the lead is captured, the gap
      // is logged and recorded on the row server-side, and the visitor is
      // told nothing alarming about a send that was never attempted.
      if (outcome.notificationState === "failed") {
        setSupportStatus("error");
        setSupportError(
          outcome.contact
            ? `Your request was saved, but our alert to the Chamber team did not go through. To make sure a real person follows up, email us directly at ${outcome.contact}. Your report is still ready — continue below.`
            : "Your request was saved, but our alert to the Chamber team did not go through. To make sure a real person follows up, contact the Southeast Chicago Chamber of Commerce directly. Your report is still ready — continue below.",
        );
        return false;
      }
      setSupportStatus("sent");
      return true;
    } catch (supportSubmitError) {
      setSupportStatus("error");
      setSupportError(
        supportSubmitError instanceof Error
          ? supportSubmitError.message
          : "We could not send your request. Please try again.",
      );
      return false;
    }
  };

  /**
   * Gate review round 1, BLOCKER 3(a), orchestrator ruling: an invalid or
   * blank email while the box is checked BLOCKS the primary action with a
   * visible inline error on the email field — it does not silently skip a
   * promise the visitor just read. Checked synchronously, before any
   * report preparation, so an invalid box never even spends the (async)
   * prepare call.
   */
  const supportEmailIsValid = (): boolean => {
    if (!wantsSupport) return true;
    return supportEmail.trim().includes("@");
  };

  const validateSupportBoxOrShowError = (): boolean => {
    if (supportEmailIsValid()) {
      setSupportEmailError("");
      return true;
    }
    setSupportEmailError("Enter an email so we know where to follow up.");
    return false;
  };

  /**
   * Gate review round 1, BLOCKER 3(b)/(c), orchestrator ruling: the
   * request is AWAITED before either `onReportReady` (which unmounts this
   * dialog) or the unauthenticated Save redirect fires, so a real failure
   * is surfaced (role="alert", still mounted) instead of being killed by
   * navigation or unmount. Once shown once (`supportGaveUp`), a second
   * click proceeds without retrying — "never blocks the report" has to
   * mean something once the visitor has actually SEEN the failure.
   * Assumes `validateSupportBoxOrShowError` already passed. Returns false
   * when the caller must stop (a failure was just surfaced for the first
   * time).
   */
  const submitSupportBoxIfNeeded = async (
    preparedReport: GeneratedReport,
  ): Promise<boolean> => {
    if (!wantsSupport || supportStatus === "sent" || supportGaveUp) return true;

    const ok = await submitSupportBox(preparedReport);
    if (!ok) {
      setSupportGaveUp(true);
      return false;
    }
    return true;
  };

  const prepareReport = async (): Promise<GeneratedReport | null> => {
    const preparedReport = await onPrepareReport(projectGoalIds(), customGoal);
    if (!preparedReport) throw new Error("We could not prepare the report. Please try again.");
    return preparedReport;
  };

  const handleViewReport = async () => {
    if (!canProceed) return;
    setError("");
    if (!validateSupportBoxOrShowError()) return;
    setViewStatus("preparing");
    try {
      const preparedReport = await prepareReport();
      if (!preparedReport) return;

      const canContinue = await submitSupportBoxIfNeeded(preparedReport);
      if (!canContinue) return;

      trackEvent("report_email_gate_skipped", {
        reportType: preparedReport.reportType,
        source: "report_email_gate",
        address: preparedReport.metadata?.address || null,
        metadata: { projectGoals: projectGoalIds(), entrySource: source },
      });
      commitPersonaSelection(preparedReport);
      onReportReady(preparedReport);
    } catch (viewError) {
      setError(
        viewError instanceof Error
          ? viewError.message
          : "We could not prepare the report. Please try again.",
      );
    } finally {
      setViewStatus("idle");
    }
  };

  /**
   * Save my report (spec §E), wired to the exact same authenticated-vs-not
   * fork both ReportDisplay copies already implement for their own Save
   * button (app/report/page.tsx's private ReportDisplay and
   * components/report/ReportDisplay.tsx): authenticated visitors get the
   * SaveReportModal in place; everyone else gets their report stashed via
   * storePendingReport and is sent to /login?callbackUrl=/workspace?savePending=1,
   * which replays the same modal after sign-in (components/workspace/PendingReportSaver.tsx).
   */
  const handleSaveReport = async () => {
    if (!canProceed) return;
    setError("");
    if (!validateSupportBoxOrShowError()) return;
    setSaveStatus("preparing");
    try {
      const preparedReport = await prepareReport();
      if (!preparedReport) return;

      const canContinue = await submitSupportBoxIfNeeded(preparedReport);
      if (!canContinue) return;

      commitPersonaSelection(preparedReport);

      trackEvent("save_report_clicked", {
        reportType: preparedReport.reportType,
        source: "report_email_gate",
        address: preparedReport.metadata?.address || null,
      });

      if (authStatus === "authenticated") {
        setSaveModalReport(preparedReport);
        return;
      }

      storePendingReport({ reportData: preparedReport, wizardState });
      window.location.assign(
        `/login?callbackUrl=${encodeURIComponent("/workspace?savePending=1")}`,
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "We could not prepare the report. Please try again.",
      );
    } finally {
      setSaveStatus("idle");
    }
  };

  return (
    <dialog
      ref={dialogRef}
      data-testid="report-email-gate"
      aria-labelledby="report-email-gate-title"
      onCancel={(event) => event.preventDefault()}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto border border-[#0C1B33]/12 bg-white p-0 text-[#0C1B33] shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-[2px] print:hidden"
    >
      <header className="bg-[#0C1B33] px-5 py-5 text-white sm:px-[26px] sm:py-5">
        <p className="font-mono-bureau text-[8.5px] uppercase tracking-[0.14em] text-white/55">
          Chicago Incentive Explorer
        </p>
        <h2
          id="report-email-gate-title"
          className="mt-1.5 font-editorial text-[26px] leading-tight"
        >
          Your report is ready
        </h2>
        {report.metadata?.address && (
          <p className="mt-1 text-[12.5px] text-white/65">{report.metadata.address}</p>
        )}
      </header>

      <div className="flex flex-col gap-4 px-5 py-[22px] sm:px-[26px]">
        {/* Persona row (mandatory per spec — see the pre-selection note above). */}
        <div data-testid="report-email-gate-persona-row">
          <span className="mb-2 block font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]">
            Which best describes you?
          </span>
          <div className="flex flex-wrap gap-1.5">
            {GATE_PERSONA_CHIPS.map((chip) => {
              const selected = chip.personaIds.includes(persona);
              return (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={isBusy}
                  onClick={() => selectPersonaChip(chip.id)}
                  className={`font-mono-bureau text-[9px] tracking-[0.12em] uppercase px-3 py-1.5 border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-55 ${
                    selected
                      ? "border-[#2563EB] text-[#2563EB] bg-[#2563EB]/[0.06]"
                      : "border-[#0C1B33]/18 text-[#0C1B33]/55 hover:border-[#2563EB]/40 hover:text-[#2563EB]"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Goals row (mandatory, ≥1 of 8 grouped chips — spec §A). */}
        <div data-testid="report-email-gate-goal-row">
          <span className="mb-2 block font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]">
            What brings you here? (Pick up to 2 — or just looking)
          </span>
          <div className="flex flex-wrap gap-2">
            {GATE_GOAL_CHIPS.map((chip) => {
              const selected = selectedGoalChips.includes(chip.id);
              const isLooking = chip.id === GATE_LOOKING_CHIP_ID;
              return (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={isBusy}
                  onClick={() => toggleGoalChip(chip.id)}
                  className={`text-[12.5px] px-3.5 py-2.5 border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-55 ${
                    isLooking ? "border-dashed" : "border-solid"
                  } ${
                    selected
                      ? "border-[#2563EB] bg-[#2563EB]/[0.06] text-[#0C1B33]"
                      : isLooking
                        ? "border-[#5A6478] bg-[#FAF9F6] text-[#5A6478]"
                        : "border-[#D8DDE6] bg-white text-[#0C1B33] hover:border-[#0C1B33]/35"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 border border-red-200 bg-red-50 px-4 py-3 text-[13px] leading-relaxed text-red-700"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Primary action — VIEW MY REPORT (spec anatomy item 4). */}
        <div>
          <button
            type="button"
            data-testid="report-email-gate-view"
            onClick={handleViewReport}
            disabled={!canProceed}
            className="flex w-full items-center justify-center gap-2 bg-[#0C1B33] px-[13px] py-[13px] font-mono-bureau text-[10.5px] uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#0C1B33]/85 disabled:cursor-not-allowed disabled:bg-[#C6CCD8] disabled:hover:bg-[#C6CCD8]"
          >
            {viewStatus === "preparing" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Preparing...
              </>
            ) : (
              "View my report"
            )}
          </button>
          {!selectionComplete && (
            <p
              data-testid="report-email-gate-helper"
              className="mt-1.5 text-center text-[10.5px] text-[#5A6478]"
            >
              Pick what brings you here to continue
            </p>
          )}
        </div>

        {/* Want a hand? (Optional) — spec anatomy item 5. */}
        <div className="flex flex-col gap-2.5 border border-[#E4ECF7] bg-[#EFF3FB] px-[15px] py-[13px]">
          <span className="font-mono-bureau text-[8.5px] uppercase tracking-[0.14em] text-[#5A6478]">
            Want a hand? (Optional)
          </span>
          <div className="flex gap-2">
            <input
              type="text"
              value={supportName}
              onChange={(event) => setSupportName(event.target.value)}
              autoComplete="name"
              disabled={isBusy}
              placeholder="Name"
              className="min-w-0 flex-1 border border-[#D8DDE6] bg-white px-3 py-2.5 text-[12px] outline-none placeholder:text-[#0C1B33]/40 focus:border-[#2563EB] disabled:opacity-55"
            />
            <input
              type="email"
              value={supportEmail}
              onChange={(event) => {
                setSupportEmail(event.target.value);
                if (supportEmailError) setSupportEmailError("");
              }}
              autoComplete="email"
              disabled={isBusy}
              placeholder="you@business.com"
              aria-invalid={Boolean(supportEmailError)}
              className={`min-w-0 flex-[1.4] border bg-white px-3 py-2.5 text-[12px] outline-none placeholder:text-[#0C1B33]/40 focus:border-[#2563EB] disabled:opacity-55 ${
                supportEmailError ? "border-red-400" : "border-[#D8DDE6]"
              }`}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={wantsSupport}
              onChange={(event) => {
                setWantsSupport(event.target.checked);
                if (!event.target.checked) setSupportEmailError("");
              }}
              disabled={isBusy}
              className="h-3.5 w-3.5 shrink-0 accent-[#2563EB]"
            />
            <span className="text-[12px] text-[#0C1B33]">
              I&rsquo;d like 1-on-1 support working through this report
            </span>
          </label>
          <p className="text-[10px] text-[#5A6478]">
            A real person from the Southeast Chicago Chamber of Commerce will follow up within 48
            hours.
          </p>
          {supportEmailError && (
            <p role="alert" className="text-[10px] text-red-600">
              {supportEmailError}
            </p>
          )}
          {supportStatus === "error" && supportError && (
            <p role="alert" className="text-[10px] text-red-600">
              {supportError}
            </p>
          )}
          <label className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
            Website
            <input
              type="text"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              tabIndex={-1}
              autoComplete="off"
            />
          </label>
        </div>

        {/* Come back anytime — spec anatomy item 6. */}
        <div className="flex items-center justify-between gap-2.5 border-t border-[#E4ECF7] pt-3">
          <div>
            <p className="text-[11.5px] font-semibold text-[#0C1B33]">Come back anytime</p>
            <p className="text-[10.5px] text-[#5A6478]">
              Save this report and pick up right where you left off.
            </p>
          </div>
          <button
            type="button"
            data-testid="report-email-gate-save"
            onClick={handleSaveReport}
            disabled={!canProceed}
            className="whitespace-nowrap border border-[#0C1B33]/25 px-[13px] py-2 font-mono-bureau text-[9.5px] uppercase tracking-[0.1em] text-[#0C1B33] transition-colors hover:border-[#0C1B33]/45 disabled:cursor-not-allowed disabled:border-[#C6CCD8] disabled:text-[#C6CCD8]"
          >
            {saveStatus === "preparing" ? "Saving..." : "Save my report"}
          </button>
        </div>

        {/* Footer — spec anatomy item 7. Gate review round 1, BLOCKER 4:
            the board's own "window reminders" clause claims a mechanism
            that does not exist anywhere in this repo (no scheduled
            reminder-send infra — see FundingWindowChart.tsx's own doc
            comment). The claim-surface rule outranks the board here:
            this copy names only what actually lives inside the report. */}
        <p className="text-center text-[11px] text-[#5A6478]">
          PDF &amp; email tools live inside the report — where you can see what they&rsquo;re
          about
        </p>
      </div>

      {saveModalReport && (
        <SaveReportModal
          reportData={saveModalReport}
          wizardState={wizardState}
          onClose={() => setSaveModalReport(null)}
        />
      )}
    </dialog>
  );
}
