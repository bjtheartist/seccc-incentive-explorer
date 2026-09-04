"use client";

// ─── Documents to Gather (persona spec v2, item 3 — owner + supporter) ──
// ONE shared component, both forks. Content is the REAL Business File
// foundation-task registry (lib/report-documents-to-gather.ts), not
// invented checklist copy. "Track in Business File" bridges to the actual
// workspace route where these same tasks live and can be checked off.

import { ArrowRight } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import {
  DOCUMENT_PREPARATION_COST_CAVEAT,
  DOCUMENT_PREPARATION_COST_LEGEND,
} from "@/lib/document-preparation-cost";
import {
  buildProgramLinkedDocumentsToGather,
  documentOwnerLabel,
} from "@/lib/report-documents-to-gather";
import type { GeneratedReport } from "@/lib/report-engine";
import { PersonaReportSection } from "@/components/report/PersonaReportChrome";
import { PreparationCostBadge } from "@/components/report/PreparationCostBadge";

// The legend + caveat the canonical engine sections carry in their section
// DESCRIPTION (lib/report-engine.ts, "Required Documents" and the "Document
// Readiness Checklist"). PersonaReportSection takes no description, so they
// render in this section's own footer note instead — a bare "$$$" on a report
// whose subject is incentive money must never be published without the line
// saying it measures preparation effort, not program value.
const PREPARATION_COST_LEGEND_LINE = `${DOCUMENT_PREPARATION_COST_LEGEND.map(
  (entry) => `${entry.tier} = ${entry.label.toLowerCase()}`,
).join("; ")}. ${DOCUMENT_PREPARATION_COST_CAVEAT}`;

export function DocumentsToGather({
  report,
  sectionNumber = "",
}: {
  report: GeneratedReport;
  sectionNumber?: string;
}) {
  const rows = buildProgramLinkedDocumentsToGather(report);
  if (rows.length === 0) return null;

  return (
    <PersonaReportSection
      number={sectionNumber}
      title="Document readiness"
      testId="documents-to-gather"
    >
      <ul className="divide-y divide-[#0C1B33]/8">
        {rows.map((row) => (
          <li key={row.id} className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-[#0C1B33]">
                {row.title}
                <PreparationCostBadge signal={row.preparationCost} label="Prep" />
              </span>
              {row.owner && row.estimatedWeeks && (
                <span className="font-mono-bureau text-[10px] text-[#0C1B33]/45">
                  {documentOwnerLabel(row.owner)} · {row.estimatedWeeks}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-[#0C1B33]/55 leading-relaxed">{row.description}</p>
            {row.programReferences && row.programReferences.length > 0 && (
              <div
                data-testid="document-program-connection"
                className="mt-2 border-l-2 border-[#2563EB] bg-[#EFF3FB] px-2.5 py-2"
              >
                <span className="block font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#2563EB]">
                  Why this is here
                </span>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-[#0C1B33]/65">
                  {row.whyLine}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {row.programReferences.map((program) => (
                    <span
                      key={program.programId}
                      data-program-id={program.programId}
                      className="border border-[#2563EB]/30 bg-white px-1.5 py-0.5 text-[10px] text-[#0C1B33]/70"
                    >
                      {program.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#0C1B33]/10 pt-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] leading-relaxed text-[#5A6478]">
            Readiness is tied to the programs surfaced in this view and should be confirmed with each administrator.
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-[#0C1B33]/45">
            {PREPARATION_COST_LEGEND_LINE}
          </p>
        </div>
        <a
          href="/workspace/business-file"
          onClick={() =>
            trackEvent("documents_to_gather_tracked", {
              reportType: report.reportType,
              source: "documents_to_gather",
              address: report.metadata?.address || null,
            })
          }
          className="inline-flex items-center gap-1.5 font-mono-bureau text-[10px] tracking-[0.1em] uppercase text-[#2563EB] hover:underline"
        >
          Track in Business File
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
    </PersonaReportSection>
  );
}
