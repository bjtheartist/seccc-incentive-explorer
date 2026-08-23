"use client";

// ─── Contact Sheet (spec v2 deliverable 8, the review's highest-value new
// surface) — ONE shared component wired into BOTH ReportDisplay forks.
// Consolidates program-administrator, support-organization, and
// capital-partner contacts, persona-ordered, every row carrying a
// structurally-derived why-relevant line. Printable — no interaction
// required to read it.

import { ExternalLink } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import { buildContactSheetRows } from "@/lib/report-contact-sheet";
import type { GeneratedReport } from "@/lib/report-engine";
import type { PersonaId } from "@/lib/personas";
import { PersonaReportSection } from "@/components/report/PersonaReportChrome";

export function ContactSheet({
  report: lensed,
  persona,
  sectionNumber = "",
}: {
  /** The already-lensed report (persona reorder + hard filter applied). */
  report: GeneratedReport;
  persona: PersonaId;
  sectionNumber?: string;
}) {
  const rows = buildContactSheetRows(lensed, persona);

  return (
    <PersonaReportSection
      number={sectionNumber}
      title="Contact sheet"
      testId="contact-sheet"
    >
      {rows.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-[#5A6478]">
          No direct contact was published in this report. Switch to All for the full public record and source links.
        </p>
      ) : (
        <ul className="divide-y divide-[#0C1B33]/8">
          {rows.map((row, index) => (
          <li key={`${row.kind}-${row.name}-${index}`} className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-[13px] font-medium text-[#0C1B33]">{row.name}</span>
              {row.detail && (
                <span className="font-mono-bureau text-[11px] text-[#0C1B33]/55">{row.detail}</span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-[#0C1B33]/55 leading-relaxed">{row.whyLine}</p>
            {row.url && (
              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  trackEvent("support_resource_clicked", {
                    reportType: lensed.reportType,
                    source: "contact_sheet",
                    address: lensed.metadata?.address || null,
                    metadata: { contactName: row.name, contactKind: row.kind, persona },
                  })
                }
                className="mt-1 inline-flex items-center gap-1 text-[10px] text-[#2563EB] hover:underline print-url"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                {row.url}
              </a>
            )}
          </li>
          ))}
        </ul>
      )}
    </PersonaReportSection>
  );
}
