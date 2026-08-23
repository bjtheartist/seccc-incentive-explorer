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
import { visiblePersonaProgramNames } from "@/lib/report-personas";

export function personaProgramSupplementCount(persona: PersonaId): number {
  if (persona === "starting" || persona === "growing") return 2;
  if (persona === "supporter" || persona === "developer") return 1;
  return 0;
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
  const number = (offset = 0) => String(firstSectionNumber + offset).padStart(2, "0");
  const visibleProgramIds = new Set(
    visiblePersonaProgramNames(lensedReport).map((program) => program.programId),
  );
  const chartReport: GeneratedReport = {
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
  if (persona === "starting" || persona === "growing") {
    const hasFundingWindows = Boolean(buildFundingWindowChartData(chartReport));
    return (
      <>
        {hasFundingWindows && (
          <PersonaReportSection
            number={number()}
            title="Funding windows"
            testId="funding-windows-section"
          >
            <FundingWindowChart report={chartReport} showEmailOffer={false} />
          </PersonaReportSection>
        )}
        <DocumentsToGather report={report} sectionNumber={number(1)} />
      </>
    );
  }
  if (persona === "supporter") {
    return <DocumentsToGather report={report} sectionNumber={number()} />;
  }
  if (persona === "developer") {
    if (!buildIncentiveHorizonChartData(chartReport)) return null;
    return (
      <PersonaReportSection
        number={number()}
        title="Incentive horizon"
        testId="incentive-horizon-section"
      >
        <IncentiveHorizonChart report={chartReport} />
      </PersonaReportSection>
    );
  }
  return null;
}

export function personaContactSectionNumber(persona: PersonaId): string {
  if (persona === "supporter") return "07";
  return "09";
}
