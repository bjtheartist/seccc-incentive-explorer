"use client";

// ─── The Brief — two-question ask (spec v2 item 5, R5StageAsk) ──────────
// Stage, then priority. Both feed the Brief directly: stage becomes the
// header's stage-progress indicator, priority becomes the "Seeking" line.
// Never a blocking gate on the report itself — this only opens when the
// reader chooses to build a Brief.

import { useState } from "react";
import {
  BRIEF_PRIORITY_OPTIONS,
  BRIEF_STAGE_OPTIONS,
  type BriefPriority,
  type BriefStage,
} from "@/lib/report-brief";

export function BriefStageAsk({
  onComplete,
  onCancel,
}: {
  onComplete: (stage: BriefStage, priority: BriefPriority) => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<BriefStage | null>(null);
  const [priority, setPriority] = useState<BriefPriority | null>(null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="brief-stage-ask-title"
      data-testid="brief-stage-ask"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 print:hidden"
    >
      <div className="w-full max-w-md border-2 border-[#0C1B33] bg-white p-6 sm:p-7">
        <p className="font-mono-bureau text-[9px] tracking-[0.14em] uppercase text-[#2563EB]">
          Two questions before your brief
        </p>
        <h2 id="brief-stage-ask-title" className="mt-2 font-editorial text-xl leading-tight">
          What stage is the business in?
        </h2>
        <p className="mt-1.5 text-[12px] text-[#0C1B33]/60 leading-relaxed">
          This goes on the brief so whoever receives it understands your context instantly.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {BRIEF_STAGE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={stage === option.id}
              onClick={() => setStage(option.id)}
              className={`min-h-11 border px-3.5 py-2.5 text-left text-[13px] transition-colors ${
                stage === option.id
                  ? "border-2 border-[#2563EB] bg-[#EFF3FB] font-semibold"
                  : "border-[#D8DDE6] hover:border-[#0C1B33]/30"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <h2 className="mt-5 font-editorial text-xl leading-tight">
          What&rsquo;s your priority right now?
        </h2>
        <p className="mt-1.5 text-[12px] text-[#0C1B33]/60 leading-relaxed">
          This becomes the &ldquo;Seeking&rdquo; line — it tells every reader what help you&rsquo;re looking for.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {BRIEF_PRIORITY_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={priority === option.id}
              onClick={() => setPriority(option.id)}
              className={`min-h-11 border px-3.5 py-2.5 text-left text-[13px] transition-colors ${
                priority === option.id
                  ? "border-2 border-[#2563EB] bg-[#EFF3FB] font-semibold"
                  : "border-[#D8DDE6] hover:border-[#0C1B33]/30"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="font-mono-bureau text-[10px] tracking-[0.1em] uppercase text-[#0C1B33]/45 hover:text-[#0C1B33]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!stage || !priority}
            onClick={() => stage && priority && onComplete(stage, priority)}
            className="min-h-11 bg-[#2563EB] px-5 py-3 font-mono-bureau text-[10.5px] tracking-[0.1em] uppercase text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Build my brief
          </button>
        </div>
      </div>
    </div>
  );
}
