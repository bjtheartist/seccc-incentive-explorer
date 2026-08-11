"use client";

// ─── Stage Handoff Button ────────────────────────────────────────────
// Shared by BOTH ReportDisplay forks via ZoningReviewQuestions (the
// RefineValuePanel precedent): one component so the handoff surface
// cannot diverge between the forks.
//
// Product boundary: the generated text describes what is published and
// what is unresolved. It never concludes that a use is permitted or a
// program is eligible — see lib/stage-handoff.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Send } from "lucide-react";
import { buildZoningHandoff, type ZoningHandoffInput } from "@/lib/stage-handoff";

type ShareState = "idle" | "copied" | "shared" | "failed";

export function StageHandoffButton({ input }: { input: ZoningHandoffInput }) {
  const [state, setState] = useState<ShareState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const settle = useCallback((next: ShareState) => {
    setState(next);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState("idle"), 2500);
  }, []);

  const handleShare = useCallback(async () => {
    // The page the user is on IS the report; capture it at click time so
    // neither fork has to thread a URL prop through.
    const { subject, body } = buildZoningHandoff({
      ...input,
      reportUrl: input.reportUrl ?? (typeof window !== "undefined" ? window.location.href : null),
    });

    // Native share sheet where available (the mobile path); clipboard
    // otherwise. A share dismissed by the user is not a failure.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: subject, text: body });
        settle("shared");
        return;
      } catch (error) {
        if ((error as DOMException)?.name === "AbortError") return;
        // Fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      settle("copied");
    } catch {
      settle("failed");
    }
  }, [input, settle]);

  return (
    <div>
      <button
        type="button"
        onClick={handleShare}
        className="inline-flex items-center gap-2 border border-[#0C1B33]/20 bg-white px-3.5 py-2 text-[12px] text-[#0C1B33] transition-colors hover:border-[#2563EB] hover:text-[#2563EB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2563EB]"
      >
        {state === "copied" || state === "shared" ? (
          <Check aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <Send aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {state === "copied"
          ? "Copied — paste it to your navigator"
          : state === "shared"
            ? "Shared"
            : state === "failed"
              ? "Couldn't copy — try again"
              : "Share this question with a navigator"}
      </button>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[#0C1B33]/50" aria-live="polite">
        Creates a short summary of this address, your intended use, and the
        open zoning question — instead of forwarding the whole report.
      </p>
    </div>
  );
}
