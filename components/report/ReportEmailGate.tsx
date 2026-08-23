"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { AlertCircle, Loader2 } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import type { GeneratedReport } from "@/lib/report-engine";
import type { WizardState } from "@/lib/report-wizard-config";
import { projectGoalDisplayLabel } from "@/lib/report-wizard-config";
import {
  GATE_GOAL_CHIPS,
  GATE_LOOKING_CHIP_ID,
  gateGoalChipsToGoalIds,
  gateGoalSelectionIsComplete,
  toggleGateGoalChip,
} from "@/lib/gate-goal-groups";
import { GATE_PERSONA_CHIPS } from "@/lib/gate-persona-groups";
import { storePersona, type PersonaId } from "@/lib/personas";
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
}

type ActionStatus = "idle" | "preparing";
type SupportStatus = "idle" | "sending" | "sent" | "error";

export function ReportEmailGate({
  report,
  source,
  wizardState,
  onPrepareReport,
  onReportReady,
}: ReportEmailGateProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { status: authStatus } = useSession();

  // Persona intake (owner ruling A1, carried into the redesign): inferred
  // once from what the visitor already told the report, pre-selected. The
  // gate's own mandatory rule (spec anatomy item 2) is satisfied the
  // moment a real report exists, because inference always resolves to one
  // of the four real gate chips — never "all", never empty — so this
  // never actually blocks VIEW MY REPORT on its own; only the goal row
  // does (matching the blessed board's own disabled-state screenshot,
  // whose helper line names only the goal requirement).
  const [inferredPersona] = useState<PersonaId>(() =>
    inferPersonaFromIntake({
      industry: report.metadata?.industry,
      projectGoals: report.metadata?.projectGoals,
      projectType: report.metadata?.projectType,
      reportType: report.reportType,
    }),
  );
  const [persona, setPersona] = useState<PersonaId>(inferredPersona);

  const [selectedGoalChips, setSelectedGoalChips] = useState<string[]>([]);

  const [supportName, setSupportName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [wantsSupport, setWantsSupport] = useState(false);
  const [website, setWebsite] = useState("");
  const [supportStatus, setSupportStatus] = useState<SupportStatus>("idle");
  const [supportError, setSupportError] = useState("");

  const [viewStatus, setViewStatus] = useState<ActionStatus>("idle");
  const [saveStatus, setSaveStatus] = useState<ActionStatus>("idle");
  const [saveModalReport, setSaveModalReport] = useState<GeneratedReport | null>(null);
  const [error, setError] = useState("");

  const isBusy = viewStatus !== "idle" || saveStatus !== "idle";
  const selectionComplete = gateGoalSelectionIsComplete(selectedGoalChips);
  const canProceed = selectionComplete && !isBusy;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const commitPersonaSelection = (preparedReport: GeneratedReport) => {
    storePersona(persona);
    trackEvent("persona_intake_inferred", {
      reportType: preparedReport.reportType,
      source: "report_email_gate",
      metadata: {
        inferredPersona,
        selectedPersona: persona,
        outcome: persona === inferredPersona ? "confirmed" : "corrected",
      },
    });
  };

  const toggleGoalChip = (chipId: string) => {
    if (isBusy) return;
    setSelectedGoalChips((current) => toggleGateGoalChip(current, chipId));
  };

  const selectPersonaChip = (chipId: string) => {
    if (isBusy) return;
    const chip = GATE_PERSONA_CHIPS.find((c) => c.id === chipId);
    if (!chip) return;
    setPersona((current) =>
      chip.personaIds.includes(current) ? current : chip.defaultPersonaId,
    );
  };

  const projectGoalIds = () => gateGoalChipsToGoalIds(selectedGoalChips);

  /**
   * The optional support opt-in (spec §D). Submitted alongside whichever
   * primary action the visitor actually takes (View or Save) — the box
   * has no submit button of its own on the board, and the promise is
   * "a real person will follow up," never "we'll email you the report,"
   * so this never touches report delivery. Silently skipped if the box
   * wasn't checked or the email is empty/invalid: the box is entirely
   * optional and must never block the primary action it rides alongside.
   */
  const maybeSubmitSupportRequest = async (preparedReport: GeneratedReport) => {
    if (!wantsSupport) return;
    const trimmedEmail = supportEmail.trim();
    if (!trimmedEmail.includes("@")) return;

    setSupportStatus("sending");
    setSupportError("");
    try {
      const goalIds = projectGoalIds();
      const projectGoal = goalIds.map((id) => projectGoalDisplayLabel(id)).join(", ");
      await submitSupportRequest({
        name: supportName.trim() || undefined,
        email: trimmedEmail,
        address: preparedReport.metadata?.address,
        reportTitle: preparedReport.title,
        reportType: preparedReport.reportType,
        projectGoal: projectGoal || undefined,
        source: "report_email_gate",
        website,
      });
      setSupportStatus("sent");
      trackEvent("inquiry_submitted", {
        reportType: preparedReport.reportType,
        source: "report_email_gate",
        address: preparedReport.metadata?.address || null,
        metadata: { projectGoals: goalIds, entrySource: source },
      });
    } catch (supportSubmitError) {
      setSupportStatus("error");
      setSupportError(
        supportSubmitError instanceof Error
          ? supportSubmitError.message
          : "We could not send your request. Please try again.",
      );
    }
  };

  const prepareReport = async (): Promise<GeneratedReport | null> => {
    const preparedReport = await onPrepareReport(projectGoalIds(), "");
    if (!preparedReport) throw new Error("We could not prepare the report. Please try again.");
    return preparedReport;
  };

  const handleViewReport = async () => {
    if (!canProceed) return;
    setError("");
    setViewStatus("preparing");
    try {
      const preparedReport = await prepareReport();
      if (!preparedReport) return;

      trackEvent("report_email_gate_skipped", {
        reportType: preparedReport.reportType,
        source: "report_email_gate",
        address: preparedReport.metadata?.address || null,
        metadata: { projectGoals: projectGoalIds(), entrySource: source },
      });
      commitPersonaSelection(preparedReport);
      void maybeSubmitSupportRequest(preparedReport);
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
    setSaveStatus("preparing");
    try {
      const preparedReport = await prepareReport();
      if (!preparedReport) return;

      commitPersonaSelection(preparedReport);
      void maybeSubmitSupportRequest(preparedReport);

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
              onChange={(event) => setSupportEmail(event.target.value)}
              autoComplete="email"
              disabled={isBusy}
              placeholder="you@business.com"
              className="min-w-0 flex-[1.4] border border-[#D8DDE6] bg-white px-3 py-2.5 text-[12px] outline-none placeholder:text-[#0C1B33]/40 focus:border-[#2563EB] disabled:opacity-55"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={wantsSupport}
              onChange={(event) => setWantsSupport(event.target.checked)}
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

        {/* Footer — spec anatomy item 7 (email-delivery-of-report removed from the gate). */}
        <p className="text-center text-[11px] text-[#5A6478]">
          PDF, email &amp; window reminders live inside the report — where you can see what
          they&rsquo;re about
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
