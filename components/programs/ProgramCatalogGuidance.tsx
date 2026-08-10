import { CalendarOff, ExternalLink } from "lucide-react";

import type { ProgramAvailability } from "@/lib/program-gating";
import type { Program } from "@/lib/types";

function unavailableHeading(availability?: ProgramAvailability): string {
  if (!availability) return "Check application status";
  if (availability.state === "expired") return "Availability ended";
  if (availability.state === "lapsed-notice") return "Program status";
  return "Application status";
}

export function ProgramCatalogGuidance({
  program,
  availability,
}: {
  program: Program;
  availability?: ProgramAvailability;
}) {
  if (availability?.state === "active") {
    if (program.howToApply.length === 0) return null;

    return (
      <div>
        <h3 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/35 mb-3">
          How to Apply
        </h3>
        <ol className="text-sm space-y-2 text-[#0C1B33]/60">
          {program.howToApply.map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#2563EB]/10 text-[#2563EB] flex items-center justify-center text-[10px] font-medium shrink-0">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const officialUrl = program.sourceUrl || program.url;
  const note =
    availability?.note ||
    "Application timing can change. Confirm current availability and instructions with the administering agency.";

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 flex gap-2.5">
      <CalendarOff className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
      <div>
        <h3 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-amber-800 mb-1.5">
          {unavailableHeading(availability)}
        </h3>
        <p className="text-[12px] text-amber-900/85 leading-relaxed">{note}</p>
        {officialUrl && (
          <a
            href={officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-[#2563EB] hover:underline font-mono-bureau text-[9px] tracking-[0.12em] uppercase"
          >
            Verify on the official source
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}
