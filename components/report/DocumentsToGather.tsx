"use client";

// ─── Documents to Gather (persona spec v2, item 3 — owner + supporter) ──
// ONE shared component, both forks. Content is the REAL Business File
// foundation-task registry (lib/report-documents-to-gather.ts), not
// invented checklist copy. "Track in Business File" bridges to the actual
// workspace route where these same tasks live and can be checked off.

import { ArrowRight } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import { buildDocumentsToGather, documentOwnerLabel } from "@/lib/report-documents-to-gather";
import type { GeneratedReport } from "@/lib/report-engine";

export function DocumentsToGather({ report }: { report: GeneratedReport }) {
  const rows = buildDocumentsToGather();
  if (rows.length === 0) return null;

  return (
    <section
      data-testid="documents-to-gather"
      aria-labelledby="documents-to-gather-title"
      className="border border-[#0C1B33]/10 bg-white mt-8"
    >
      <div className="border-b border-[#0C1B33]/10 px-4 py-3 sm:px-5">
        <h3
          id="documents-to-gather-title"
          className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#0C1B33]/70"
        >
          Documents to Gather
        </h3>
        <p className="mt-1 text-[11px] text-[#0C1B33]/50 leading-relaxed">
          Program-agnostic groundwork most applications ask for, regardless of which program you pursue.
        </p>
      </div>
      <ul className="divide-y divide-[#0C1B33]/8">
        {rows.map((row) => (
          <li key={row.id} className="px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-[13px] font-medium text-[#0C1B33]">{row.title}</span>
              <span className="font-mono-bureau text-[10px] text-[#0C1B33]/45">
                {documentOwnerLabel(row.owner)} · {row.estimatedWeeks}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-[#0C1B33]/55 leading-relaxed">{row.description}</p>
          </li>
        ))}
      </ul>
      <div className="border-t border-[#0C1B33]/10 px-4 py-3 sm:px-5">
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
    </section>
  );
}
