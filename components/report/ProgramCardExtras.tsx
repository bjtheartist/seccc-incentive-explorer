"use client";

// ─── Program-card content extras (spec v2 amendment) ─────────────────────
// "Can combine with" / "What to expect" / "Verify at the source" — shared
// by BOTH ReportDisplay forks so this surface can't diverge. Every field
// is derived at generation time from real catalog data (see
// buildWorksWith/buildVerifySources/buildExpectations in
// lib/report-engine.ts); this component only renders what's present —
// honest omission, never a placeholder block.

import { ExternalLink } from "lucide-react";
import type { ReportItem } from "@/lib/report-engine";

export function ProgramCardExtras({ item }: { item: ReportItem }) {
  const hasWorksWith = Boolean(item.worksWith?.length);
  const hasExpectations = Boolean(item.expectations);
  const hasVerifySources = Boolean(item.verifySources?.length);
  const hasCostSignals = Boolean(item.costSignals?.length);
  if (!hasWorksWith && !hasExpectations && !hasVerifySources && !hasCostSignals) return null;

  return (
    <div className="space-y-2.5">
      {hasCostSignals && (
        <div>
          <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 block mb-1">
            Cost signals
          </span>
          <div className="flex flex-wrap gap-1.5">
            {item.costSignals!.map((signal) => (
              <span
                key={signal.label}
                className={
                  signal.severity === "amber"
                    ? "font-mono-bureau text-[9px] tracking-[0.06em] uppercase text-[#9A3412] bg-[#FFF7ED] border border-[#FDBA74] px-2 py-1"
                    : "font-mono-bureau text-[9px] tracking-[0.06em] uppercase text-[#2563EB] bg-[#EFF3FB] border border-[#2563EB] px-2 py-1"
                }
              >
                {signal.label}
              </span>
            ))}
          </div>
          {/* Non-suppressible per gate finding 4 — always renders alongside
              at least one real signal, never omitted or made optional. */}
          <p className="mt-1 text-[10px] text-[#0C1B33]/40 leading-relaxed">
            Signals, not estimates — actual costs depend on your project and contractor.
          </p>
        </div>
      )}

      {hasWorksWith && (
        <div>
          <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 block mb-1">
            Can combine with
          </span>
          <div className="flex flex-col gap-1.5">
            {item.worksWith!.map((entry) => (
              <div key={entry.label} className="flex flex-col">
                <span className="font-mono-bureau text-[9px] tracking-[0.06em] uppercase text-[#0C1B33]/55 border border-[#0C1B33]/15 px-2 py-1 self-start">
                  {entry.label}
                </span>
                {/* Gate finding 21 (minor): detail used to be hover-only
                    (title=), invisible on touch and in print. Rendered
                    visibly beneath the chip instead. */}
                {entry.detail && (
                  <span className="mt-0.5 text-[10px] text-[#0C1B33]/40 leading-relaxed">{entry.detail}</span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-[#0C1B33]/40 leading-relaxed">
            Stacking rules vary — confirm combinations with each administrator.
          </p>
        </div>
      )}

      {hasExpectations && (
        <div>
          <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 block mb-1">
            What to expect
          </span>
          <p className="text-[11px] text-[#0C1B33]/50 leading-relaxed">{item.expectations}</p>
        </div>
      )}

      {hasVerifySources && (
        <div className="border-t border-[#0C1B33]/8 pt-2.5">
          <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 block mb-1">
            Verify at the source
          </span>
          <div className="space-y-1">
            {item.verifySources!.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 text-[11px] text-[#2563EB] hover:underline print-url"
              >
                <span className="flex items-center gap-1.5">
                  <ExternalLink className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                  {source.label}
                </span>
                {source.dated && (
                  <span className="font-mono-bureau text-[9px] text-[#0C1B33]/35">{source.dated}</span>
                )}
              </a>
            ))}
          </div>
          <p className="mt-1.5 text-[9px] text-[#0C1B33]/35">
            Every figure above traces to a public record.
          </p>
        </div>
      )}
    </div>
  );
}
