"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileCheck2,
  Handshake,
  MapPin,
  Search,
  Target,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { trackEvent } from "@/lib/analytics-events";
import {
  FIRST_VISIT_GUIDE_OPEN_EVENT,
  FIRST_VISIT_GUIDE_STEPS,
  FIRST_VISIT_SPOTLIGHT_OPEN_EVENT,
  SAMPLE_REPORT_URL,
  readFirstVisitGuidePreference,
  shouldAutoOpenFirstVisitGuide,
  writeFirstVisitGuidePreference,
} from "@/lib/first-visit-guide";

type GuideScreen = "welcome" | "tour";

const STEP_ICONS = [MapPin, Target, FileCheck2, Handshake];

function WorkflowPreview({ step }: { step: number }) {
  if (step === 0) {
    return (
      <div className="space-y-4" data-testid="guide-address-preview">
        <div className="font-mono-bureau text-[9px] tracking-[0.18em] uppercase text-[#0C1B33]/45">
          Example address
        </div>
        <div className="flex min-h-14 items-center gap-3 border border-[#0C1B33]/15 bg-white px-4">
          <Search className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden="true" />
          <span className="min-w-0 truncate text-sm text-[#0C1B33]/70">
            8701 S Bennett Ave, Chicago, IL
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#0C1B33]/45">
          <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          Chicago location found
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="space-y-2" data-testid="guide-goal-preview">
        {["Open or expand a location", "Improve a property", "Hire employees", "Buy equipment"].map(
          (goal, index) => (
            <div
              key={goal}
              className={`flex min-h-11 items-center justify-between border px-3 text-[13px] ${
                index === 0
                  ? "border-[#2563EB] bg-[#2563EB]/5 text-[#0C1B33]"
                  : "border-[#0C1B33]/10 bg-white text-[#0C1B33]/55"
              }`}
            >
              {goal}
              {index === 0 && <Check className="h-4 w-4 text-[#2563EB]" aria-hidden="true" />}
            </div>
          ),
        )}
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="divide-y divide-[#0C1B33]/8 border-y border-[#0C1B33]/10" data-testid="guide-findings-preview">
        {[
          ["Incentive geography", "Mapped at address"],
          ["Zoning context", "Official district located"],
          ["Local support", "Nearby organizations"],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-3">
            <span className="text-xs text-[#0C1B33]/50">{label}</span>
            <span className="text-right font-mono-bureau text-[9px] tracking-[0.1em] uppercase text-[#2563EB]">
              {value}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="guide-next-steps-preview">
      {[
        ["01", "Verify", "Open the cited source"],
        ["02", "Prepare", "Collect required materials"],
        ["03", "Connect", "Reach local support"],
      ].map(([number, title, detail]) => (
        <div key={number} className="flex items-start gap-3 border-b border-[#0C1B33]/8 pb-3 last:border-0 last:pb-0">
          <span className="font-mono-bureau text-[10px] text-[#2563EB]">{number}</span>
          <div>
            <div className="text-sm font-semibold text-[#0C1B33]">{title}</div>
            <div className="mt-0.5 text-xs text-[#0C1B33]/45">{detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function FirstVisitGuideDialog({
  screen,
  step,
  onStart,
  onSpotlight,
  onSkip,
  onBack,
  onNext,
  onClose,
  onUseAddress,
  onTrySample,
  dialogRef,
}: {
  screen: GuideScreen;
  step: number;
  onStart: () => void;
  onSpotlight: () => void;
  onSkip: () => void;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
  onUseAddress: () => void;
  onTrySample: () => void;
  dialogRef?: RefObject<HTMLDivElement | null>;
}) {
  const currentStep = FIRST_VISIT_GUIDE_STEPS[step];
  const StepIcon = STEP_ICONS[step];
  const isLastStep = step === FIRST_VISIT_GUIDE_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-5 print:hidden" data-testid="first-visit-guide">
      <div className="absolute inset-0 bg-[#071225]/65 backdrop-blur-sm" onClick={onSkip} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-visit-guide-title"
        aria-describedby="first-visit-guide-description"
        className="relative flex max-h-[100svh] w-full flex-col overflow-hidden border border-[#0C1B33]/10 bg-white shadow-[0_28px_90px_rgba(4,13,30,0.38)] sm:max-h-[min(720px,calc(100svh-40px))] sm:max-w-[780px]"
      >
        <div className="flex min-h-14 items-center justify-between border-b border-[#0C1B33]/8 px-5 sm:px-7">
          <div className="flex items-center gap-3">
            <span className="font-editorial text-lg text-[#0C1B33]">Chicago Incentive Explorer</span>
            {screen === "tour" && (
              <span className="hidden font-mono-bureau text-[9px] tracking-[0.16em] uppercase text-[#0C1B33]/35 sm:inline">
                Guided tour
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center text-[#0C1B33]/45 transition-colors hover:bg-[#EFF3FB] hover:text-[#0C1B33]"
            aria-label="Close site tour"
            title="Close site tour"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {screen === "welcome" ? (
          <div className="overflow-y-auto px-5 py-7 sm:px-9 sm:py-9">
            <div className="mb-7 inline-flex h-11 w-11 items-center justify-center bg-[#2563EB] text-white">
              <MapPin className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="font-mono-bureau text-[9px] tracking-[0.22em] uppercase text-[#2563EB]">
              Welcome
            </p>
            <h2 id="first-visit-guide-title" tabIndex={-1} className="mt-3 max-w-2xl font-editorial text-3xl leading-tight text-[#0C1B33] sm:text-4xl">
              Find what may apply to a Chicago address
            </h2>
            <p id="first-visit-guide-description" className="mt-4 max-w-2xl text-sm leading-6 text-[#0C1B33]/60 sm:text-[15px]">
              Take a short guided tour of the core workflow, or start exploring on your own. The tour does not ask for an email and you can leave at any time.
            </p>

            <div className="mt-8 grid border-y border-[#0C1B33]/10 sm:grid-cols-3">
              {[
                ["01", "Start with a location"],
                ["02", "Review public findings"],
                ["03", "Choose a next step"],
              ].map(([number, label]) => (
                <div key={number} className="flex items-center gap-3 border-b border-[#0C1B33]/8 py-4 last:border-0 sm:border-b-0 sm:border-r sm:px-4 sm:first:pl-0 sm:last:border-r-0">
                  <span className="font-mono-bureau text-[10px] text-[#2563EB]">{number}</span>
                  <span className="text-xs font-medium text-[#0C1B33]/65">{label}</span>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={onSpotlight}
                data-autofocus="true"
                className="inline-flex min-h-12 items-center justify-center gap-2 bg-[#0C1B33] px-5 font-mono-bureau text-[10px] uppercase text-white transition-colors hover:bg-[#1E3054]"
              >
                Show me around
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onSkip}
                className="min-h-12 border border-[#0C1B33]/12 px-5 font-mono-bureau text-[10px] uppercase text-[#0C1B33]/55 transition-colors hover:border-[#0C1B33]/30 hover:text-[#0C1B33]"
              >
                Explore on my own
              </button>
              <span className="font-mono-bureau text-[9px] tracking-[0.12em] uppercase text-[#0C1B33]/30 sm:ml-auto">
                About 90 seconds
              </span>
            </div>
            <p className="mt-5 text-xs text-[#0C1B33]/40">
              Prefer not to leave this window?{" "}
              <button
                type="button"
                onClick={onStart}
                className="underline decoration-[#0C1B33]/25 underline-offset-2 transition-colors hover:text-[#0C1B33]"
              >
                Preview the four steps here instead
              </button>
              .
            </p>
          </div>
        ) : (
          <>
            <div className="h-1 bg-[#0C1B33]/8" aria-hidden="true">
              <div
                className="h-full bg-[#2563EB] transition-[width] duration-300"
                style={{ width: `${((step + 1) / FIRST_VISIT_GUIDE_STEPS.length) * 100}%` }}
              />
            </div>
            <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[0.82fr_1.18fr] md:overflow-hidden">
              <div className="border-b border-[#0C1B33]/8 bg-[#EFF3FB] p-5 sm:p-7 md:border-b-0 md:border-r md:p-8">
                <div className="mb-6 flex items-center justify-between">
                  <div className="grid h-10 w-10 place-items-center bg-[#2563EB] text-white">
                    <StepIcon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <span className="font-mono-bureau text-[9px] tracking-[0.16em] uppercase text-[#0C1B33]/40">
                    Example
                  </span>
                </div>
                <WorkflowPreview step={step} />
              </div>

              <div className="flex flex-col p-5 sm:p-8 md:overflow-y-auto md:p-9">
                <p className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#2563EB]">
                  Step {step + 1} of {FIRST_VISIT_GUIDE_STEPS.length} · {currentStep.eyebrow}
                </p>
                <h2 id="first-visit-guide-title" tabIndex={-1} className="mt-4 font-editorial text-3xl leading-tight text-[#0C1B33]">
                  {currentStep.title}
                </h2>
                <p id="first-visit-guide-description" className="mt-4 text-sm leading-6 text-[#0C1B33]/60">
                  {currentStep.description}
                </p>
                <div className="mt-6 border-l-2 border-[#2563EB] bg-[#F7F9FC] px-4 py-3 text-xs leading-5 text-[#0C1B33]/60">
                  {currentStep.takeaway}
                </div>

                <div className="mt-8 flex flex-col gap-3 sm:mt-auto sm:flex-row sm:items-center sm:pt-9">
                  {step > 0 && (
                    <button
                      type="button"
                      onClick={onBack}
                      className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#0C1B33]/12 px-4 font-mono-bureau text-[10px] tracking-[0.14em] uppercase text-[#0C1B33]/55 hover:border-[#0C1B33]/30 hover:text-[#0C1B33]"
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                      Back
                    </button>
                  )}
                  {isLastStep ? (
                    <>
                      <button
                        type="button"
                        onClick={onTrySample}
                        className="inline-flex min-h-11 items-center justify-center gap-2 bg-[#0C1B33] px-4 font-mono-bureau text-[10px] tracking-[0.14em] uppercase text-white hover:bg-[#1E3054]"
                      >
                        Try sample report
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={onUseAddress}
                        className="min-h-11 px-3 font-mono-bureau text-[10px] tracking-[0.14em] uppercase text-[#2563EB] hover:text-[#1748A8]"
                      >
                        Use my address
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={onNext}
                      data-autofocus="true"
                      className="inline-flex min-h-11 items-center justify-center gap-2 bg-[#0C1B33] px-5 font-mono-bureau text-[10px] tracking-[0.14em] uppercase text-white hover:bg-[#1E3054] sm:ml-auto"
                    >
                      Next
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function FirstVisitGuide() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<GuideScreen>("welcome");
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const autoOpenHandledRef = useRef(false);
  const stepRef = useRef(0);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const showGuide = useCallback((source: "first_visit" | "footer") => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setScreen("welcome");
    setStep(0);
    setOpen(true);
    trackEvent("first_visit_guide_viewed", { source });
  }, []);

  useEffect(() => {
    if (autoOpenHandledRef.current) return;
    if (!shouldAutoOpenFirstVisitGuide(pathname)) return;
    if (readFirstVisitGuidePreference(window.localStorage)) return;
    const timer = window.setTimeout(() => {
      autoOpenHandledRef.current = true;
      showGuide("first_visit");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname, showGuide]);

  useEffect(() => {
    const reopen = () => showGuide("footer");
    window.addEventListener(FIRST_VISIT_GUIDE_OPEN_EVENT, reopen);
    return () => window.removeEventListener(FIRST_VISIT_GUIDE_OPEN_EVENT, reopen);
  }, [showGuide]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus='true'], button");
      target?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        writeFirstVisitGuidePreference(window.localStorage, "skipped");
        trackEvent("first_visit_guide_skipped", {
          source: "escape",
          metadata: { step: stepRef.current },
        });
        setOpen(false);
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || screen !== "tour") return;
    const timer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>("#first-visit-guide-title")?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, screen, step]);

  const finish = useCallback((destination: "sample_report" | "own_address") => {
    writeFirstVisitGuidePreference(window.localStorage, "completed");
    trackEvent("first_visit_guide_completed", { source: destination });
    setOpen(false);
  }, []);

  if (!open) return null;

  return (
    <FirstVisitGuideDialog
      dialogRef={dialogRef}
      screen={screen}
      step={step}
      onStart={() => {
        setScreen("tour");
        setStep(0);
        trackEvent("first_visit_guide_started", { source: "welcome" });
        trackEvent("first_visit_guide_step_viewed", { source: "guided_tour", metadata: { step: 1 } });
      }}
      onSpotlight={() => {
        setOpen(false);
        trackEvent("first_visit_guide_started", { source: "welcome_spotlight" });
        window.setTimeout(() => {
          window.dispatchEvent(new Event(FIRST_VISIT_SPOTLIGHT_OPEN_EVENT));
        }, 0);
      }}
      onSkip={() => {
        writeFirstVisitGuidePreference(window.localStorage, "skipped");
        trackEvent("first_visit_guide_skipped", { source: "welcome", metadata: { step } });
        setOpen(false);
      }}
      onClose={() => {
        writeFirstVisitGuidePreference(window.localStorage, "skipped");
        trackEvent("first_visit_guide_skipped", { source: "close", metadata: { step } });
        setOpen(false);
      }}
      onBack={() => {
        const previousStep = Math.max(0, step - 1);
        setStep(previousStep);
        trackEvent("first_visit_guide_step_viewed", {
          source: "guided_tour",
          metadata: { step: previousStep + 1 },
        });
      }}
      onNext={() => {
        const nextStep = Math.min(FIRST_VISIT_GUIDE_STEPS.length - 1, step + 1);
        setStep(nextStep);
        trackEvent("first_visit_guide_step_viewed", {
          source: "guided_tour",
          metadata: { step: nextStep + 1 },
        });
      }}
      onTrySample={() => {
        finish("sample_report");
        router.push(SAMPLE_REPORT_URL);
      }}
      onUseAddress={() => {
        finish("own_address");
        if (pathname !== "/") {
          router.push("/#address-search");
          return;
        }
        window.setTimeout(() => {
          const container = document.getElementById("address-search");
          container?.scrollIntoView({ behavior: "smooth", block: "center" });
          container?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
        }, 0);
      }}
    />
  );
}
