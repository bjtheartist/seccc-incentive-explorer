"use client";

// ─── "Just looking" overview (gate finding 9/10, R5LookingFinal board) ───
// Location snapshot, What's notable, Explore by interest, and the
// full-picture line — shared by both report forks. Every value comes from
// lib/report-looking-overview.ts's pure builders, which read only data the
// engine already resolved elsewhere in this same lensed report.

import {
  buildLocationSnapshot,
  buildWhatsNotable,
  EXPLORE_BY_INTEREST_OPTIONS,
} from "@/lib/report-looking-overview";
import type { GeneratedReport } from "@/lib/report-engine";
import { PersonaReportSection } from "@/components/report/PersonaReportChrome";
import { trackEvent } from "@/lib/analytics-events";
import type { PersonaId } from "@/lib/personas";
import { personaSelectionEvent, visiblePersonaProgramItems } from "@/lib/report-personas";

/**
 * Switch the in-page lens the way PersonaChips does. These were once real
 * anchors to `?persona=…`; that full navigation remounted the page, which
 * regenerated the report from stale URL params and reverted a refined report
 * to its pre-refine snapshot. PersonaChips fires `persona_chip_selected` from
 * its own click handler rather than from the shared parent handler, so this
 * board mirrors the event with a `source` naming its own surface.
 */
function selectPersona(
  report: GeneratedReport,
  next: PersonaId,
  onSelectPersona: (next: PersonaId) => void,
): void {
  const event = personaSelectionEvent("looking", next, report);
  if (event) {
    trackEvent("persona_chip_selected", {
      reportType: event.reportType,
      source: "looking_explore_by_interest",
      address: report.metadata?.address ?? null,
      metadata: {
        persona: event.persona,
        matchedProgramsBefore: event.matchedProgramsBefore,
        matchedProgramsAfter: event.matchedProgramsAfter,
      },
    });
  }
  onSelectPersona(next);
}

/**
 * PART 01 — "Location snapshot": zoning/zone-count/program-count/data-
 * verified stat row. Does NOT also render "Programs matched here" — both
 * forks already render that cross-link (components/report/
 * ProgramsMatchedHere.tsx) for every real persona lens including
 * "looking", right under the Verdict Card; duplicating it here would
 * print the same cross-link twice on one page.
 */
export function LocationSnapshotPanel({ report: lensed }: { report: GeneratedReport }) {
  const snapshot = buildLocationSnapshot(lensed);
  const tiles = [
    snapshot.zoneClass ? { label: "Zoning", value: snapshot.zoneClass } : null,
    snapshot.mappedZoneCount != null ? { label: "Mapped zones", value: String(snapshot.mappedZoneCount) } : null,
    { label: "Programs", value: String(snapshot.programCount) },
    snapshot.dataVerified ? { label: "Data verified", value: snapshot.dataVerified } : null,
  ].filter((t): t is { label: string; value: string } => t !== null);
  if (tiles.length === 0) return null;

  return (
    <div data-testid="location-snapshot" className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label}>
          <span className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/35 block">
            {tile.label}
          </span>
          <span className="text-[15px] font-semibold text-[#0C1B33]">{tile.value}</span>
        </div>
      ))}
    </div>
  );
}

/** PART 02 — "What's notable": up to 3 real highlighted facts. */
export function WhatsNotablePanel({
  report: lensed,
  sectionNumber,
}: {
  report: GeneratedReport;
  sectionNumber?: string;
}) {
  // The looking board may draw notable facts from the canonical report, but
  // it must obey the same three-program summary boundary as the rest of the
  // board. In particular, Upcoming Deadlines must not re-introduce a fourth
  // program name outside the executive-summary set.
  const allowedProgramIds = new Set(
    visiblePersonaProgramItems(lensed)
      .slice(0, 3)
      .map((item) => item.programId)
      .filter((programId): programId is string => Boolean(programId)),
  );
  const notableReport: GeneratedReport = {
    ...lensed,
    sections: lensed.sections.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.programId || allowedProgramIds.has(item.programId),
      ),
    })),
  };
  const facts = buildWhatsNotable(notableReport);
  if (facts.length === 0) return null;
  const content = (
    <div data-testid="whats-notable" className="mt-3 space-y-3">
      {facts.map((fact, index) => (
        <div key={index} className="border-l-2 border-[#2563EB]/30 pl-3">
          <span className="block text-[13px] font-semibold text-[#0C1B33]">{fact.label}</span>
          <span className="block text-[11.5px] text-[#0C1B33]/50">{fact.detail}</span>
        </div>
      ))}
    </div>
  );
  return sectionNumber ? (
    <PersonaReportSection number={sectionNumber} title="What’s notable">
      {content}
    </PersonaReportSection>
  ) : content;
}

/** PART 03 — "Explore by interest" + the full-picture line. */
export function ExploreByInterestPanel({
  report,
  onSelectPersona,
  sectionNumber,
  fullPictureSectionNumber,
}: {
  report: GeneratedReport;
  /** Same handler the PersonaChips row uses — an in-page lens change. */
  onSelectPersona: (next: PersonaId) => void;
  sectionNumber?: string;
  fullPictureSectionNumber?: string;
}) {
  const interests = (
    <div data-testid="explore-by-interest" className="mt-3">
      <div className="flex flex-wrap gap-2">
        {EXPLORE_BY_INTEREST_OPTIONS.map((option) => (
          <button
            key={option.persona}
            type="button"
            onClick={() => selectPersona(report, option.persona, onSelectPersona)}
            className="font-mono-bureau text-[10px] tracking-[0.08em] uppercase text-[#0C1B33]/60 border border-[#0C1B33]/15 px-3 py-2 hover:border-[#2563EB]/40 hover:text-[#2563EB] transition-colors cursor-pointer"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
  const fullPicture = (
      <button
        type="button"
        onClick={() => selectPersona(report, "all", onSelectPersona)}
        data-testid="full-picture-line"
        className="flex items-center gap-1.5 border border-[#D8DDE6] bg-white px-3.5 py-2.5 text-[12.5px] text-[#5A6478] hover:border-[#2563EB] hover:text-[#2563EB] cursor-pointer"
      >
        <span aria-hidden="true">&#9656;</span>
        Every program, zone, and detail at this address
      </button>
  );
  if (!sectionNumber || !fullPictureSectionNumber) {
    return <div className="space-y-4">{interests}{fullPicture}</div>;
  }
  return (
    <>
      <PersonaReportSection number={sectionNumber} title="Explore by interest">
        {interests}
      </PersonaReportSection>
      <PersonaReportSection number={fullPictureSectionNumber} title="The full picture">
        {fullPicture}
      </PersonaReportSection>
    </>
  );
}
