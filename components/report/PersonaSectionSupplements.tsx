"use client";

import { CorridorInvestmentChart } from "@/components/report/CorridorInvestmentChart";
import { DocumentsToGather } from "@/components/report/DocumentsToGather";
import { FundingWindowChart } from "@/components/report/FundingWindowChart";
import { IncentiveHorizonChart } from "@/components/report/IncentiveHorizonChart";
import { PersonaReportSection } from "@/components/report/PersonaReportChrome";
import type { PersonaId } from "@/lib/personas";
import { SECTION_IDS, type GeneratedReport } from "@/lib/report-engine";
import {
  buildFundingWindowChartData,
  buildIncentiveHorizonChartData,
} from "@/lib/report-charts";
import { buildProgramLinkedDocumentsToGather } from "@/lib/report-documents-to-gather";
import { visiblePersonaProgramNames } from "@/lib/report-personas";

/** The numbered mounts PersonaProgramSupplements can put on a board, in the
 *  order they render behind the programs section. */
export type PersonaProgramSupplementKind =
  | "fundingWindows"
  | "documents"
  | "incentiveHorizon";

/**
 * The deadline-backed chart report: canonical sections (the lens drops the
 * deadline section outright) narrowed to the programs the lens still shows.
 * Shared by the renderer and the ordinal derivation so the two can never
 * disagree about whether a chart has data.
 */
function personaChartReport(
  report: GeneratedReport,
  lensedReport: GeneratedReport,
): GeneratedReport {
  const visibleProgramIds = new Set(
    visiblePersonaProgramNames(lensedReport).map((program) => program.programId),
  );
  return {
    ...report,
    sections: report.sections.map((section) =>
      section.id === SECTION_IDS.upcomingDeadlines ||
      section.title === "Upcoming Deadlines Near This Address"
        ? {
            ...section,
            items: section.items.filter(
              (item) => !item.programId || visibleProgramIds.has(item.programId),
            ),
          }
        : section,
    ),
  };
}

/**
 * Which supplement mounts ACTUALLY render for this persona on this report,
 * in board order. Every one of them is data-dependent — a report with no
 * dated programs has no funding-window chart, a report whose visible programs
 * ask for no documents has no readiness list — so this is the single source
 * of truth for both the mounts themselves and the ordinals around them.
 */
export function personaProgramSupplementKinds(
  report: GeneratedReport,
  lensedReport: GeneratedReport,
  persona: PersonaId,
): PersonaProgramSupplementKind[] {
  const chartReport = personaChartReport(report, lensedReport);
  const hasDocuments = buildProgramLinkedDocumentsToGather(lensedReport).length > 0;
  if (persona === "starting" || persona === "growing") {
    const kinds: PersonaProgramSupplementKind[] = [];
    if (buildFundingWindowChartData(chartReport)) kinds.push("fundingWindows");
    if (hasDocuments) kinds.push("documents");
    return kinds;
  }
  if (persona === "supporter") return hasDocuments ? ["documents"] : [];
  if (persona === "developer") {
    return buildIncentiveHorizonChartData(chartReport) ? ["incentiveHorizon"] : [];
  }
  return [];
}

/** How many numbered mounts the supplements add to the board — exactly the
 *  ones personaProgramSupplementKinds says will render. */
export function personaProgramSupplementCount(
  report: GeneratedReport,
  lensedReport: GeneratedReport,
  persona: PersonaId,
): number {
  return personaProgramSupplementKinds(report, lensedReport, persona).length;
}

export function PersonaNeighborhoodSupplement({
  report,
  persona,
}: {
  report: GeneratedReport;
  persona: PersonaId;
}) {
  if (persona !== "supporter") return null;
  return <CorridorInvestmentChart report={report} />;
}

export function PersonaProgramSupplements({
  report,
  lensedReport,
  persona,
  firstSectionNumber,
}: {
  /** Canonical report retains the deadline section that backs both charts. */
  report: GeneratedReport;
  /** Lensed report supplies the only program ids allowed to survive in charts. */
  lensedReport: GeneratedReport;
  persona: PersonaId;
  firstSectionNumber: number;
}) {
  const kinds = personaProgramSupplementKinds(report, lensedReport, persona);
  // Each mount's ordinal is its position in the list of mounts that actually
  // render — a skipped chart closes the gap behind it instead of leaving one.
  const number = (kind: PersonaProgramSupplementKind) =>
    String(firstSectionNumber + kinds.indexOf(kind)).padStart(2, "0");
  const chartReport = personaChartReport(report, lensedReport);
  if (persona === "starting" || persona === "growing") {
    return (
      <>
        {kinds.includes("fundingWindows") && (
          <PersonaReportSection
            number={number("fundingWindows")}
            title="Funding windows"
            testId="funding-windows-section"
          >
            <FundingWindowChart report={chartReport} showEmailOffer={false} />
          </PersonaReportSection>
        )}
        {kinds.includes("documents") && (
          <DocumentsToGather report={lensedReport} sectionNumber={number("documents")} />
        )}
      </>
    );
  }
  if (persona === "supporter") {
    if (!kinds.includes("documents")) return null;
    return <DocumentsToGather report={lensedReport} sectionNumber={number("documents")} />;
  }
  if (persona === "developer") {
    if (!kinds.includes("incentiveHorizon")) return null;
    return (
      <PersonaReportSection
        number={number("incentiveHorizon")}
        title="Incentive horizon"
        testId="incentive-horizon-section"
      >
        <IncentiveHorizonChart report={chartReport} />
      </PersonaReportSection>
    );
  }
  return null;
}

/**
 * The Contact Sheet is always the LAST numbered section on a persona board,
 * so its number is one past everything the board actually rendered ahead of
 * it. Pass the render loop's own running section counter — NOT a per-persona
 * constant.
 *
 * This used to be hardcoded per persona ("06" for starting/growing, "05" for
 * supporter/developer, and "07"/"09" before the 2026-08-31 four-section cap).
 * Section presence is data-dependent, though: a report with no capital-partner
 * financing section, or with no dated programs to chart, renders fewer
 * sections than the constant assumed, and the board numbered 01 → 02 → 03 →
 * 05 with a visible hole in it (seen live on 8701 S Bennett Ave for the
 * supporter and developer boards). Deriving from the counter closes the hole
 * by construction, for every board shape the data can produce.
 */
export function personaContactSectionNumber(sectionsRenderedBefore: number): string {
  return String(sectionsRenderedBefore + 1).padStart(2, "0");
}
