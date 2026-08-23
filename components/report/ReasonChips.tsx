"use client";

// ─── Reason chips (gate finding 11) ───────────────────────────────────────
// The program-card "why it appears" reasons, rendered as pill chips on the
// card FACE — previously these lived only inside the collapsed "Program
// review details" accordion, mixed in as plain bullet text alongside every
// other match-explanation field. Same source (item.matchExplanation.
// whyItAppears), same order the engine already produces it in; this
// component only changes WHERE and HOW it renders, never what it says.

import type { PublicMatchExplanation } from "@/lib/types";

export function ReasonChips({ explanation }: { explanation?: PublicMatchExplanation }) {
  if (!explanation || explanation.whyItAppears.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" data-testid="reason-chips">
      {explanation.whyItAppears.map((reason, index) => (
        <span
          key={index}
          className="font-mono-bureau text-[9px] tracking-[0.04em] leading-snug text-[#0C1B33]/60 bg-[#EFF3FB] border border-[#0C1B33]/10 px-2 py-1 max-w-full"
        >
          {reason}
        </span>
      ))}
    </div>
  );
}
