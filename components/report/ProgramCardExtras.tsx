"use client";

// ─── Program-card content extras (spec v2 amendment; reordered gate round 3
// BLOCKER 11 RULING) ───────────────────────────────────────────────────────
// "Can combine with" / next-step+contact / "What to expect" / "Verify at
// the source" — shared by BOTH ReportDisplay forks so this surface can't
// diverge. Every field is derived at generation time from real catalog
// data (see buildWorksWith/buildNextStep/buildPrimaryContact/
// buildVerifySources/buildExpectations in lib/report-engine.ts); this
// component only renders what's present — honest omission, never a
// placeholder block.
//
// Gate round 3 BLOCKER 11 RULING (board wins over spec v2 prose on
// ordering): cost signals MOVED OUT to ProgramCardFace, which now renders
// it right after the glance row per the board's SBIF card sequence —
// see that file's header comment. Next-step+contact MOVED IN here from
// ProgramCardFace, positioned between "Can combine with" and "What to
// expect," matching the board exactly. This component renders entirely
// AFTER ReasonChips in both forks (see app/report/page.tsx and
// components/report/ReportDisplay.tsx's shared render order), which is
// why next-step+contact had to move here rather than stay in Face —
// the board places it after "Can combine with," which is itself after
// the "Why this is shown" chips.

import { ExternalLink } from "lucide-react";
import type { ReportItem } from "@/lib/report-engine";

export function ProgramCardExtras({ item }: { item: ReportItem }) {
  const hasWorksWith = Boolean(item.worksWith?.length);
  const hasNextStep = Boolean(item.nextStep || item.primaryContact);
  const hasExpectations = Boolean(item.expectations);
  const hasVerifySources = Boolean(item.verifySources?.length);
  if (!hasWorksWith && !hasNextStep && !hasExpectations && !hasVerifySources) return null;

  return (
    <div className="space-y-2.5">
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

      {/* Next step + contact — MOVED IN from ProgramCardFace (gate round 3
          BLOCKER 11 RULING: board places this after "Can combine with",
          which only exists after ReasonChips in the render order, so it
          could not stay in Face). Same fields (buildNextStep/
          buildPrimaryContact), only the position changed. */}
      {hasNextStep && (
        <div className="flex flex-col gap-1 border-t border-[#0C1B33]/8 pt-2.5">
          {item.nextStep && (
            <span className="text-[11.5px] leading-relaxed text-[#0C1B33]/60">
              <span className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/35 mr-1.5">
                Next step
              </span>
              {item.nextStep}
            </span>
          )}
          {item.primaryContact && (
            <span className="text-[11px] text-[#0C1B33]/50">
              {item.primaryContact.agency}
              {item.primaryContact.phone ? ` · ${item.primaryContact.phone}` : ""}
              {item.primaryContact.email ? ` · ${item.primaryContact.email}` : ""}
            </span>
          )}
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
