"use client";

// ─── "Programs matched here" (spec v2 late amendment to the executive
// summary / disclosure panel) ─────────────────────────────────────────
// Names the VISIBLE (goal-matched ∩ persona-tagged ∪ pinned overlays)
// programs as anchor links into Capital & Programs, reading off the exact
// same lensed section list the program cards below render — so the panel
// and the body can never disagree (enforced by
// visiblePersonaProgramNames() and its own test coverage in
// lib/__tests__/report-personas.test.ts).

import { visiblePersonaProgramNames } from "@/lib/report-personas";
import { DEFAULT_PERSONA, type PersonaId } from "@/lib/personas";
import type { GeneratedReport } from "@/lib/report-engine";

export function ProgramsMatchedHere({
  report: lensed,
  persona,
  programsAnchor,
}: {
  /** The already-lensed report. */
  report: GeneratedReport;
  persona: PersonaId;
  /** Anchor id of the Capital & Programs section this scrolls into. */
  programsAnchor: string;
}) {
  if (persona === DEFAULT_PERSONA) return null;
  const names = visiblePersonaProgramNames(lensed);
  if (names.length === 0) return null;

  return (
    <div
      data-testid="programs-matched-here"
      className="mt-3 border-t border-[#0C1B33]/8 pt-3"
    >
      <span className="font-mono-bureau text-[9px] tracking-[0.14em] uppercase text-[#0C1B33]/45">
        Programs matched here
      </span>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[#0C1B33]">
        {names.map((program, index) => (
          <span key={program.programId}>
            {index > 0 && " · "}
            <a href={`#${programsAnchor}`} className="text-[#2563EB] hover:underline">
              {program.label}
            </a>
          </span>
        ))}{" "}
        <span className="text-[#0C1B33]/45">— details below</span>
      </p>
    </div>
  );
}
