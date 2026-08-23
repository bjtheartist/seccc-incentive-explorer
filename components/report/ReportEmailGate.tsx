"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Download,
  Loader2,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import {
  deliverReportByEmail,
  type ReportEmailIdentity,
} from "@/lib/report-email";
import type { GeneratedReport } from "@/lib/report-engine";
import { projectGoalsAreComplete, selectedProjectGoals } from "@/lib/report-wizard-config";
import { ProjectGoalSelector } from "@/components/report/ProjectGoalSelector";
import { PERSONA_CHIPS, storePersona, type PersonaId } from "@/lib/personas";
import { inferPersonaFromIntake } from "@/lib/persona-inference";

interface ReportEmailGateProps {
  report: GeneratedReport;
  source: string;
  onPrepareReport: (
    projectGoals: string[],
    customGoal: string,
  ) => Promise<GeneratedReport | null>;
  onReportReady: (
    deliveredReport: GeneratedReport,
    identity?: ReportEmailIdentity,
  ) => void;
}

type DeliveryStatus = "idle" | "preparing" | "sending";
type PdfStatus = "idle" | "building";

export function ReportEmailGate({
  report,
  source,
  onPrepareReport,
  onReportReady,
}: ReportEmailGateProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [projectGoals, setProjectGoals] = useState(() =>
    selectedProjectGoals({
      projectGoals: report.metadata?.projectGoals,
      projectType: report.metadata?.projectType,
    }),
  );
  const [customGoal, setCustomGoal] = useState(report.metadata?.customGoal || "");
  // Persona intake (owner ruling A1): inferred once from what the visitor
  // already told the report (industry/goals/reportType), pre-selected — a
  // chip row, never a blocking question. Confirming or correcting it costs
  // one optional tap and never gates submit or "Continue Without Email".
  const [inferredPersona] = useState<PersonaId>(() =>
    inferPersonaFromIntake({
      industry: report.metadata?.industry,
      projectGoals: report.metadata?.projectGoals,
      projectType: report.metadata?.projectType,
      reportType: report.reportType,
    }),
  );
  const [persona, setPersona] = useState<PersonaId>(inferredPersona);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [wantsHelp, setWantsHelp] = useState(false);
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<DeliveryStatus>("idle");
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>("idle");
  const [error, setError] = useState("");

  const isBusy = status !== "idle";
  const isPdfBusy = pdfStatus !== "idle";
  const goalsAreComplete = projectGoalsAreComplete({ projectGoals, customGoal });
  const canSubmit = Boolean(goalsAreComplete && email.trim().includes("@") && !isBusy);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  /**
   * Persists the visitor's chosen lens for the report view to pick up (the
   * report's own persona state resolves from `?persona=` or this same
   * sessionStorage key on mount — see lib/personas.ts `resolveInitialPersona`)
   * and fires exactly one intake-inference event, capturing whether the
   * pre-selected chip was confirmed, corrected, or the row went untouched.
   */
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setError("");
    setStatus("preparing");
    try {
      const preparedReport = await onPrepareReport(projectGoals, customGoal);
      if (!preparedReport) throw new Error("We could not prepare the report. Please try again.");

      const identity: ReportEmailIdentity = {
        email: email.trim().toLowerCase(),
        name: name.trim() || undefined,
        wantsHelp,
        projectType: projectGoals[0],
        projectGoals,
        customGoal: customGoal.trim() || undefined,
      };

      setStatus("sending");
      await deliverReportByEmail({
        report: preparedReport,
        ...identity,
        source: "report_email_gate",
        website,
      });

      trackEvent("report_emailed", {
        reportType: preparedReport.reportType,
        source: "report_email_gate",
        address: preparedReport.metadata?.address || null,
        lat: preparedReport.metadata?.lat ?? null,
        lon: preparedReport.metadata?.lon ?? null,
        metadata: {
          entrySource: source,
          projectType: projectGoals[0],
          projectGoals,
          wantsHelp,
        },
      });
      if (wantsHelp) {
        trackEvent("inquiry_submitted", {
          reportType: preparedReport.reportType,
          source: "report_email_gate",
          address: preparedReport.metadata?.address || null,
          metadata: { projectType: projectGoals[0], projectGoals, entrySource: source },
        });
      }

      commitPersonaSelection(preparedReport);
      onReportReady(preparedReport, identity);
    } catch (deliveryError) {
      setError(
        deliveryError instanceof Error
          ? deliveryError.message
          : "We could not email the report. Please try again.",
      );
      setStatus("idle");
    }
  };

  const handleContinueWithoutEmail = async () => {
    if (!goalsAreComplete || isBusy) return;
    setError("");
    setStatus("preparing");
    try {
      const preparedReport = await onPrepareReport(projectGoals, customGoal);
      if (!preparedReport) throw new Error("We could not prepare the report. Please try again.");

      trackEvent("report_email_gate_skipped", {
        reportType: preparedReport.reportType,
        source: "report_email_gate",
        address: preparedReport.metadata?.address || null,
        metadata: { projectType: projectGoals[0], projectGoals, entrySource: source },
      });
      commitPersonaSelection(preparedReport);
      onReportReady(preparedReport);
    } catch (preparationError) {
      setError(
        preparationError instanceof Error
          ? preparationError.message
          : "We could not prepare the report. Please try again.",
      );
      setStatus("idle");
    }
  };

  /**
   * Instant PDF path (WP2). Deliberately gated on nothing: no email, no name,
   * no project goals. Analytics showed 110 visitors skipping this gate against
   * 2 PDF downloads, so the download has to be reachable in one click for
   * someone who will never type an address into a form. When a goal *is*
   * already selected we refine first so the file matches the online report,
   * and any preparation failure still falls back to the report we were handed
   * — the download must not be the thing that breaks.
   */
  const handleDownloadPdf = async () => {
    if (isBusy || isPdfBusy) return;
    setError("");
    setPdfStatus("building");
    try {
      const preparedReport = goalsAreComplete
        ? (await onPrepareReport(projectGoals, customGoal)) ?? report
        : report;

      const { generateReportPdf } = await import("@/lib/pdf-report");
      generateReportPdf(preparedReport);

      trackEvent("report_pdf_downloaded", {
        reportType: preparedReport.reportType,
        source: "report_email_gate",
        address: preparedReport.metadata?.address || null,
        lat: preparedReport.metadata?.lat ?? null,
        lon: preparedReport.metadata?.lon ?? null,
        metadata: {
          entrySource: source,
          projectType: projectGoals[0] || null,
          projectGoals,
          emailProvided: false,
        },
      });
    } catch (pdfError) {
      setError(
        pdfError instanceof Error
          ? pdfError.message
          : "We could not build the PDF. Please try again.",
      );
    } finally {
      setPdfStatus("idle");
    }
  };

  return (
    <dialog
      ref={dialogRef}
      data-testid="report-email-gate"
      aria-labelledby="report-email-gate-title"
      aria-describedby="report-email-gate-description"
      onCancel={(event) => event.preventDefault()}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto border border-[#0C1B33]/12 bg-white p-0 text-[#0C1B33] shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-[2px] print:hidden"
    >
      <header className="bg-[#0C1B33] px-5 py-5 text-white sm:px-7 sm:py-6">
        <p className="font-mono-bureau text-[9px] uppercase text-white/55">
          Chicago Incentive Explorer
        </p>
        <h2
          id="report-email-gate-title"
          className="mt-2 font-editorial text-3xl leading-tight sm:text-4xl"
        >
          Your report is ready
        </h2>
        {report.metadata?.address && (
          <p className="mt-2 text-[13px] leading-relaxed text-white/65">
            {report.metadata.address}
          </p>
        )}
      </header>

      <div className="px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex items-start gap-3 border-b border-[#0C1B33]/10 pb-4">
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-[#2563EB]" aria-hidden="true" />
          <div>
            <h3 className="text-[16px] font-semibold">Choose how to open it</h3>
            <p
              id="report-email-gate-description"
              className="mt-1.5 text-[13px] leading-relaxed text-[#0C1B33]/60"
            >
              Select up to three project goals. Download the PDF instantly, have it
              emailed, or continue to the online report.
            </p>
          </div>
        </div>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          {/* Persona intake (owner ruling A1): inferred, pre-selected, always
              optional — never a blocking question, never gates submit. */}
          <div data-testid="report-email-gate-persona-row">
            <span className="mb-2 block font-mono-bureau text-[10px] uppercase text-[#0C1B33]/55">
              Which best describes you? (Optional)
            </span>
            <div className="flex flex-wrap gap-2">
              {PERSONA_CHIPS.map((chip) => {
                const selected = chip.id === persona;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={isBusy}
                    onClick={() => setPersona(chip.id)}
                    className={`font-mono-bureau text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-55 ${
                      selected
                        ? "border-[#2563EB] text-[#2563EB] bg-[#2563EB]/[0.06]"
                        : "border-[#0C1B33]/18 text-[#0C1B33]/50 hover:border-[#2563EB]/40 hover:text-[#2563EB]"
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          <ProjectGoalSelector
            goals={projectGoals}
            customGoal={customGoal}
            onChange={(goals, custom) => {
              setProjectGoals(goals);
              setCustomGoal(custom);
            }}
            disabled={isBusy}
            required
            compact
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block font-mono-bureau text-[10px] uppercase text-[#0C1B33]/55">
                Name (Optional)
              </span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                disabled={isBusy}
                className="min-h-12 w-full border border-[#0C1B33]/18 bg-white px-4 py-3 text-[14px] outline-none placeholder:text-[#0C1B33]/30 focus:border-[#2563EB] disabled:opacity-55"
                placeholder="Your name"
              />
            </label>

            <label className="block">
              <span className="mb-2 block font-mono-bureau text-[10px] uppercase text-[#0C1B33]/55">
                Email Address (Optional)
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                disabled={isBusy}
                className="min-h-12 w-full border border-[#0C1B33]/18 bg-white px-4 py-3 text-[14px] outline-none placeholder:text-[#0C1B33]/30 focus:border-[#2563EB] disabled:opacity-55"
                placeholder="name@example.com"
              />
            </label>
          </div>

          <label className="flex cursor-pointer items-start gap-3 border-y border-[#0C1B33]/8 py-3.5">
            <input
              type="checkbox"
              checked={wantsHelp}
              onChange={(event) => setWantsHelp(event.target.checked)}
              disabled={isBusy}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#2563EB]"
            />
            <span className="text-[13px] leading-relaxed text-[#0C1B33]/65">
              I would like the Southeast Chicago Chamber to follow up with me
              about incentive support.
            </span>
          </label>

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

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 border border-red-200 bg-red-50 px-4 py-3 text-[13px] leading-relaxed text-red-700"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {/* Instant download sits above the email row, not inside it: the
              email option keeps its own styling and both choices stay on
              screen together. */}
          <button
            type="button"
            data-testid="report-pdf-download"
            onClick={handleDownloadPdf}
            disabled={isBusy || isPdfBusy}
            className="flex min-h-12 w-full items-center justify-center gap-2 bg-[#2563EB] px-5 py-3 text-[13px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPdfBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Preparing...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" aria-hidden="true" />
                Download PDF
              </>
            )}
          </button>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex min-h-12 w-full items-center justify-center gap-2 border border-[#0C1B33]/18 bg-transparent px-5 py-3 text-[13px] font-semibold text-[#0C1B33] transition-colors hover:border-[#0C1B33]/35 hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {status === "preparing" ? "Preparing..." : "Emailing..."}
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  Email and View Report
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleContinueWithoutEmail}
              disabled={!goalsAreComplete || isBusy}
              className="flex min-h-12 w-full items-center justify-center gap-2 border border-[#0C1B33]/18 bg-transparent px-5 py-3 text-[13px] font-semibold text-[#0C1B33] transition-colors hover:border-[#0C1B33]/35 hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue Without Email
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-[#0C1B33]/45">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Email is optional. When provided, we use it to deliver the report
              and protect the service from abuse. Chamber follow-up happens only
              when you request it.
            </span>
          </p>
        </form>
      </div>
    </dialog>
  );
}
