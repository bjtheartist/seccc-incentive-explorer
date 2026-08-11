"use client";

import { CalendarOff, ExternalLink } from "lucide-react";

import { resolveAvailability, type ProgramAvailability } from "@/lib/program-gating";
import type { Program } from "@/lib/types";
import { resolveConservativeProgramAvailability } from "./programAvailability";
import { useLiveNow } from "./useLiveNow";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#2563EB]/60 mb-3">
      {children}
    </div>
  );
}

function statusLabel(availability: ProgramAvailability | null): string {
  if (!availability) return "Check current status";
  if (availability.state === "lapsed-notice") return "Program status";
  if (availability.state === "expired") return "Availability ended";
  return "Application status";
}

export function ProgramApplicationSection({
  program,
  now,
}: {
  program: Program;
  /** Fixed reference time for deterministic rendering in tests and previews. */
  now?: Date;
}) {
  const liveNow = useLiveNow();
  const referenceTime = now ?? liveNow;
  const availability = now
    ? resolveAvailability(program, now)
    : resolveConservativeProgramAvailability(program, referenceTime);

  if (availability?.state === "active") {
    if (program.howToApply.length === 0) return null;

    // The dated deadline renders from availability.nextWindow — the mechanism
    // resolveAvailability computes from `deadlines[]`, which drops a date the
    // moment it passes. The audit found the CCSAP quarterly deadline hardcoded
    // into howToApply prose, where it would keep instructing users to hit a
    // passed date forever; the durable fix is that copy stays undated and this
    // callout is the only place a date appears.
    const nextWindow = availability.nextWindow;
    const nextWindowDate = nextWindow?.date
      ? new Date(`${nextWindow.date}T12:00:00-06:00`).toLocaleDateString("en-US", {
          timeZone: "America/Chicago",
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : null;

    return (
      <section className="py-12 border-t border-[#0C1B33]/10">
        <SectionLabel>How to apply</SectionLabel>
        {nextWindowDate && (
          <div className="mb-6 border-l-2 border-[#0C1B33] bg-white rounded-r-lg px-5 py-4">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/50 mb-1.5">
              Next deadline
            </div>
            <p className="text-[15px] text-[#0C1B33]/85 leading-relaxed">
              {nextWindow?.label ? `${nextWindow.label} — ` : ""}
              {nextWindowDate}. Confirm with the administering agency before relying on it.
            </p>
          </div>
        )}
        <ol className="space-y-4">
          {program.howToApply.map((step, i) => (
            <li
              key={i}
              className="flex gap-4 text-base text-[#0C1B33]/75 leading-relaxed"
            >
              <span className="mt-0.5 w-7 h-7 rounded-full bg-[#2563EB]/10 text-[#2563EB] flex items-center justify-center text-[12px] font-medium shrink-0">
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        {program.fastestConfirmingStep && (
          <div className="mt-6 border-l-2 border-[#2563EB] bg-[#EFF3FB] rounded-r-lg px-5 py-4">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/60 mb-1.5">
              Fastest first move
            </div>
            <p className="text-[15px] text-[#0C1B33]/80 leading-relaxed">
              {program.fastestConfirmingStep}
            </p>
          </div>
        )}
      </section>
    );
  }

  const officialUrl = program.sourceUrl || program.url;
  const note =
    availability?.note ||
    "Application timing can change. Verify current availability and instructions with the administering agency before relying on this program.";

  return (
    <section className="py-12 border-t border-[#0C1B33]/10" aria-live="polite">
      <SectionLabel>{statusLabel(availability)}</SectionLabel>
      <div className="border border-amber-200 bg-amber-50 rounded-lg p-5 flex gap-3">
        <CalendarOff className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-[15px] text-amber-900/90 leading-relaxed">{note}</p>
          {officialUrl && (
            <a
              href={officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-[#2563EB] hover:underline font-mono-bureau text-[10px] tracking-[0.12em] uppercase"
            >
              Verify current status on the official source
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
