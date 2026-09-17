"use client";

import { ArrowRight, ChevronRight, ExternalLink } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import {
  DOCUMENT_PREPARATION_COST_CAVEAT,
  DOCUMENT_PREPARATION_COST_LEGEND,
} from "@/lib/document-preparation-cost";
import {
  buildProgramLinkedDocumentsToGather,
  documentOwnerLabel,
  type DocumentToGatherRow,
} from "@/lib/report-documents-to-gather";
import type { GeneratedReport } from "@/lib/report-engine";
import { PersonaReportSection } from "@/components/report/PersonaReportChrome";
import { PreparationCostBadge } from "@/components/report/PreparationCostBadge";

const PREP_LABELS = { "?": "Undetermined", "$": "Usually low / no fee", "$$": "May need fees / help", "$$$": "Specialist work" };
const PREPARATION_COST_LEGEND_LINE = DOCUMENT_PREPARATION_COST_LEGEND.map(
  (entry) => `${entry.tier} = ${entry.label.toLowerCase()}`,
).join("; ");

interface DocumentPacket {
  id: string;
  label: string;
  sourceUrl?: string;
  rows: DocumentToGatherRow[];
}

export function DocumentsToGather({ report, sectionNumber = "" }: { report: GeneratedReport; sectionNumber?: string }) {
  const rows = buildProgramLinkedDocumentsToGather(report);
  if (rows.length === 0) return null;
  const programItems = new Map(report.sections.flatMap((section) => section.items).filter((item) => item.programId).map((item) => [item.programId!, item]));
  const packets = new Map<string, DocumentPacket>();
  for (const row of rows) {
    const references = row.source === "shared" || !row.programReferences?.length
      ? [{ programId: "shared-preparation", label: "Shared Business File preparation" }]
      : row.programReferences;
    for (const reference of references) {
      const item = programItems.get(reference.programId);
      const packet = packets.get(reference.programId) ?? {
        id: reference.programId, label: reference.label, sourceUrl: item?.sourceUrl || item?.url, rows: [],
      };
      packet.rows.push(row);
      packets.set(packet.id, packet);
    }
  }

  return (
    <PersonaReportSection number={sectionNumber} title="Document readiness" testId="documents-to-gather">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-lg text-[11px] leading-relaxed text-[#5A6478]">Keep each checklist with its program. Open a document for its source and preparation cost context.</p>
        <details className="max-w-sm text-[10px] text-[#5A6478]">
          <summary className="cursor-pointer text-[#2563EB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">About preparation costs</summary>
          <p className="mt-2 leading-relaxed">{PREPARATION_COST_LEGEND_LINE}.</p>
        </details>
      </div>
      <div className="grid items-start gap-4 md:grid-cols-2">
        {Array.from(packets.values()).map((packet) => (
          <details key={packet.id} open data-testid="document-program-packet" data-program-id={packet.id} className="group/packet min-w-0 border border-[#D8DDE6] bg-white">
            <summary className="flex cursor-pointer list-none items-center gap-3 bg-[#F7F9FC] px-4 py-4 select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
              <span className="min-w-0 flex-1">
                <span className="mb-1 block font-mono-bureau text-[8px] uppercase tracking-[0.14em] text-[#5A6478]">{packet.id === "shared-preparation" ? "Prepare once" : "Documents for"}</span>
                <span className="block font-editorial text-[20px] leading-snug text-[#0C1B33]">{packet.label}</span>
              </span>
              <span className="shrink-0 font-mono-bureau text-[9px] text-[#2563EB]">{packet.rows.length} {packet.rows.length === 1 ? "doc" : "docs"}</span>
              <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-[#5A6478] transition-transform group-open/packet:rotate-90 motion-reduce:transition-none" />
            </summary>
            <div className="px-4 pb-4">
              <p className="border-b border-[#D8DDE6] py-3 text-[10.5px] leading-relaxed text-[#5A6478]">{packet.id === "shared-preparation" ? "Shared preparation, not a program-specific requirement." : "Listed in this program’s published checklist."}</p>
              <ul className="divide-y divide-[#D8DDE6]">
                {packet.rows.map((row) => (
                  <li key={row.id}>
                    <details className="group/document" data-testid="document-readiness-row">
                      <summary className="flex cursor-pointer list-none items-center gap-3 py-4 select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-medium leading-relaxed text-[#0C1B33]">{row.title}</span>
                          <span className="mt-2 flex flex-wrap items-center gap-2">
                            <PreparationCostBadge signal={row.preparationCost} label={PREP_LABELS[row.preparationCost.tier]} showLabelOnMobile />
                            {row.owner && row.estimatedWeeks && <span className="font-mono-bureau text-[9px] text-[#5A6478]">{documentOwnerLabel(row.owner)} · {row.estimatedWeeks}</span>}
                          </span>
                        </span>
                        <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-[#5A6478] transition-transform group-open/document:rotate-90 motion-reduce:transition-none" />
                      </summary>
                      <div className="mb-3 space-y-3 border border-[#E4ECF7] bg-[#F7F9FC] p-3 text-[11px] leading-relaxed text-[#5A6478]">
                        {row.source === "shared" && <p>{row.description}</p>}
                        <div data-testid="document-program-connection">
                          <span className="mb-1 block font-mono-bureau text-[8px] uppercase tracking-[0.14em] text-[#2563EB]">Why this is here</span>
                          <p>{row.whyLine}</p>
                          {row.programReferences?.map((program) => <span key={program.programId} data-program-id={program.programId} className="mt-1 mr-2 inline-block text-[#0C1B33]">{program.label}</span>)}
                        </div>
                        <div><span className="mb-1 block font-mono-bureau text-[8px] uppercase tracking-[0.14em]">Preparation cost</span><p>{row.preparationCost.basis}</p></div>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
              {packet.sourceUrl && <a href={packet.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-[#2563EB] hover:underline">Open program source<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
            </div>
          </details>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#D8DDE6] pt-3">
        <div className="min-w-0 flex-1"><p className="text-[11px] leading-relaxed text-[#5A6478]">Confirm the current checklist with each program administrator before applying.</p><p className="mt-1 text-[10px] leading-relaxed text-[#5A6478]">{DOCUMENT_PREPARATION_COST_CAVEAT}</p></div>
        <a href="/workspace/business-file" onClick={() => trackEvent("documents_to_gather_tracked", { reportType: report.reportType, source: "documents_to_gather", address: report.metadata?.address || null })} className="inline-flex items-center gap-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#2563EB] hover:underline">Track in Business File<ArrowRight className="h-3 w-3" aria-hidden="true" /></a>
      </div>
    </PersonaReportSection>
  );
}
