"use client";

// ─── Reason chips (gate finding 11, gate round 2 BLOCKER 11) ─────────────
// The program-card "why it appears" reasons, rendered as pill chips on the
// card FACE — previously these lived only inside the collapsed "Program
// review details" accordion, mixed in as plain bullet text alongside every
// other match-explanation field. Same source (item.matchExplanation.
// whyItAppears), same order the engine already produces it in; this
// component only changes WHERE and HOW it renders, never what it says.
//
// Gate round 2, BLOCKER 11: labeled "Why this is shown" and positioned
// AFTER ProgramCardFace in both forks, matching the R5 board's own order.
// Gate round 3 BLOCKER 11 RULING confirmed and refined the exact sequence:
// header (administrator + status/window pills) / glance row / cost
// signals / "What it funds" / Commonly required (all ProgramCardFace) /
// "Why this is shown" (this component) / Can combine with / next
// step+contact / What to expect / Verify at the source (all
// ProgramCardExtras) — this used to render FIRST, ahead of the face
// content, before round 2 moved it here.

import type { PublicMatchExplanation } from "@/lib/types";

export function ReasonChips({ explanation }: { explanation?: PublicMatchExplanation }) {
  if (!explanation || explanation.whyItAppears.length === 0) return null;
  return (
    <div className="mt-2.5" data-testid="reason-chips">
      <span className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/35 block mb-1">
        Why this is shown
      </span>
      <div className="flex flex-wrap gap-1.5">
        {explanation.whyItAppears.map((reason, index) => (
          <span
            key={index}
            className="font-mono-bureau text-[9px] tracking-[0.04em] leading-snug text-[#0C1B33]/60 bg-[#EFF3FB] border border-[#0C1B33]/10 px-2 py-1 max-w-full"
          >
            {reason}
          </span>
        ))}
      </div>
    </div>
  );
}
