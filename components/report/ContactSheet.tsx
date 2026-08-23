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

export function ContactSheet({
  report: lensed,
  persona,
}: {
  /** The already-lensed report (persona reorder + hard filter applied). */
  report: GeneratedReport;
  persona: PersonaId;
}) {
  const rows = buildContactSheetRows(lensed, persona);
  if (rows.length === 0) return null;

  return (
    <section
      data-testid="contact-sheet"
      aria-labelledby="contact-sheet-title"
      className="border border-[#0C1B33]/10 bg-white"
    >
      <div className="border-b border-[#0C1B33]/10 px-4 py-3 sm:px-5">
        <h3
          id="contact-sheet-title"
          className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#0C1B33]/70"
        >
          Contact Sheet
        </h3>
        <p className="mt-1 text-[11px] text-[#0C1B33]/50 leading-relaxed">
          Who to reach out to next, drawn from the programs, organizations, and financing
          partners on this view.
        </p>
      </div>
      <ul className="divide-y divide-[#0C1B33]/8">
        {rows.map((row, index) => (
          <li key={`${row.kind}-${row.name}-${index}`} className="px-4 py-3 sm:px-5">
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
    </section>
  );
}
