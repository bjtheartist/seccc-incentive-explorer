"use client";

// ─── Persona Chips (Tier 1b, audit BM4) ──────────────────────────────
// ONE shared component wired into BOTH ReportDisplay forks (the live copy in
// app/report/page.tsx and components/report/ReportDisplay.tsx), the same way
// RefineValuePanel is shared. The forks stay diverged (audit RF2 is a separate
// refactor); sharing this row keeps the persona surface from diverging.
//
// The chips are a viewing lens over the instant snapshot: selecting one
// re-ranks and collapses existing content (see lib/report-personas). Copy is
// descriptive, never determinative — no eligibility claims.

import { trackEvent } from "@/lib/analytics-events";
import { PERSONA_CHIPS, type PersonaId } from "@/lib/personas";
import {
  personaSelectionEvent,
  type PersonaTagLookup,
} from "@/lib/report-personas";
import type { GeneratedReport } from "@/lib/report-engine";

export function PersonaChips({
  persona,
  onSelect,
  report,
  lookup,
}: {
  persona: PersonaId;
  onSelect: (next: PersonaId) => void;
  /** The canonical ("All") report — used to compute match counts for analytics. */
  report: GeneratedReport;
  /** Optional program→persona lookup override (defaults to the static tags). */
  lookup?: PersonaTagLookup;
}) {
  const handleSelect = (next: PersonaId) => {
    // Emit exactly once per real selection. Firing from the click handler
    // (never an effect) and guarding on an actual change is what prevents the
    // double-fire class of bug (cf. PR #51 snapshot double-fire).
    const event = personaSelectionEvent(persona, next, report, lookup);
    if (event) {
      trackEvent("persona_chip_selected", {
        reportType: event.reportType,
        address: report.metadata?.address ?? null,
        metadata: {
          persona: event.persona,
          matchedProgramsBefore: event.matchedProgramsBefore,
          matchedProgramsAfter: event.matchedProgramsAfter,
        },
      });
    }
    onSelect(next);
  };

  return (
    <div className="persona-chips px-5 sm:px-12 md:px-16 py-4 border-b border-[#0C1B33]/8 flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
      <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/40">
        Viewing As
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {PERSONA_CHIPS.map((chip, index) => {
          const selected = chip.id === persona;
          // "starting" and "growing" render under one "Business owner" group
          // label — copy only; the ids, URL/storage vocabulary, and
          // PROGRAM_PERSONA_TAGS are untouched (Tier 1b BM4 review).
          const isGroupStart = chip.group && PERSONA_CHIPS[index - 1]?.group !== chip.group;
          return (
            <span key={chip.id} className="flex items-center gap-2">
              {isGroupStart && (
                <span className="font-mono-bureau text-[8px] tracking-[0.1em] uppercase text-[#0C1B33]/30">
                  {chip.group}:
                </span>
              )}
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => handleSelect(chip.id)}
                className={`font-mono-bureau text-[9px] tracking-[0.15em] uppercase px-3 py-1.5 border transition-colors cursor-pointer ${
                  selected
                    ? "border-[#2563EB] text-[#2563EB] bg-[#2563EB]/[0.06]"
                    : "border-[#0C1B33]/15 text-[#0C1B33]/50 hover:border-[#2563EB]/40 hover:text-[#2563EB]"
                }`}
              >
                {chip.label}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
