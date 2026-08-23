"use client";

// ─── The Brief — one-page shareable (spec v2 item 5, R5HalfPager) ───────
// Reads the SAME lensed report + persona the online view already shows —
// no separate generation path. 3-3-3 caps (programs / contacts / site
// facts): omission over compression — overflow is named as a count, never
// shrunk to fit. No Documents-to-Gather block on the Brief. The screening
// sentence and the verified-date line are non-suppressible.

import {
  BRIEF_STAGE_OPTIONS,
  briefSeekingLine,
  briefStageLabel,
  buildBriefData,
  type BriefPriority,
  type BriefStage,
} from "@/lib/report-brief";
import type { GeneratedReport } from "@/lib/report-engine";
import type { PersonaId } from "@/lib/personas";
import { SITE_URL } from "@/lib/seo";

/**
 * Gate finding 17 RULING: the decoy QR glyph (a decorative SVG shaped like
 * a QR code but not a real scanning-safe encoding) is removed entirely —
 * no glyph that resembles a QR ships unless it's backed by a real,
 * spec-correct, decode-verified encoder, which this pass does not build.
 * In its place: the real domain, printed large enough to retype by hand,
 * plus the full share URL for anyone reading a digital copy.
 */
const DOMAIN = SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");

export function BriefPage({
  report: lensed,
  persona,
  stage,
  priority,
  reportUrl,
}: {
  report: GeneratedReport;
  persona: PersonaId;
  stage: BriefStage;
  priority: BriefPriority;
  reportUrl: string;
}) {
  const brief = buildBriefData(lensed, persona, stage, priority);
  const stageIndex = BRIEF_STAGE_OPTIONS.findIndex((o) => o.id === stage);

  return (
    <div data-testid="brief-page" className="brief-print-page mx-auto max-w-[820px] border border-[#0C1B33]/15 bg-white">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 bg-[#0C1B33] px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="border border-[#3B5B94] font-mono-bureau text-[9px] tracking-[0.2em] px-1.5 py-0.5">
              CIE
            </span>
            <span className="font-mono-bureau text-[9px] tracking-[0.14em] uppercase text-[#9DB4DC]">
              chicagoincentiveexplorer.com
            </span>
          </div>
          {brief.address && (
            <p className="mt-1.5 font-editorial text-lg sm:text-xl">{brief.address}</p>
          )}
          {brief.goalLabel && (
            <p className="mt-0.5 text-[11px] text-[#C7D4EA]">Goal: {brief.goalLabel}</p>
          )}
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex items-center gap-1.5" aria-label={`Stage: ${briefStageLabel(stage)}`}>
            {BRIEF_STAGE_OPTIONS.map((option, index) => (
              <span key={option.id} className="flex items-center gap-1.5">
                {index > 0 && <span className="h-px w-4 bg-white/30" />}
                {index === stageIndex ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-white" />
                    <span className="font-mono-bureau text-[9px] tracking-[0.1em] uppercase">{option.label}</span>
                  </span>
                ) : (
                  <span className="h-2 w-2 rounded-full bg-white/35" />
                )}
              </span>
            ))}
          </div>
          <span className="bg-[#2563EB] px-2.5 py-1 font-mono-bureau text-[10px] tracking-[0.1em] uppercase">
            Seeking: {briefSeekingLine(priority)}
          </span>
        </div>
      </div>

      {/* ── Three columns ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3">
        <div className="border-b border-[#D8DDE6] px-5 py-4 sm:border-b-0 sm:border-r sm:px-6">
          <p className="font-mono-bureau text-[9px] tracking-[0.14em] uppercase text-[#2563EB]">Site &amp; standing</p>
          {brief.zoneClass && (
            <div className="mt-2 flex items-baseline gap-2 border-b border-[#E4ECF7] pb-2.5">
              <span className="font-mono-bureau text-lg">{brief.zoneClass}</span>
              {brief.zoneType && <span className="text-[11px] text-[#0C1B33]/55">{brief.zoneType}</span>}
            </div>
          )}
          <p className="mt-2 text-[10px] text-[#0C1B33]/50 leading-relaxed border-b border-[#E4ECF7] pb-2.5">
            Screening read — confirm with the Zoning Board of Appeals
          </p>
          {brief.siteFacts.map((fact) => (
            <div key={fact.label} className="border-b border-[#E4ECF7] py-2">
              <p className="font-mono-bureau text-[8.5px] tracking-[0.14em] uppercase text-[#0C1B33]/50">{fact.label}</p>
              <p className="mt-0.5 text-[12px]">{fact.value}</p>
            </div>
          ))}
        </div>

        <div className="border-b border-[#D8DDE6] px-5 py-4 sm:border-b-0 sm:border-r sm:px-6">
          <p className="font-mono-bureau text-[9px] tracking-[0.14em] uppercase text-[#2563EB]">Capital &amp; programs matched</p>
          {brief.programs.map((program) => (
            <div key={program.programId} className="flex items-start justify-between gap-3 border-b border-[#E4ECF7] py-2.5">
              {/* Left block: name + why it matched (gate finding 7). */}
              <div className="min-w-0">
                <span className="font-editorial text-[14px] font-semibold block">{program.name}</span>
                {program.whyLine && (
                  <span className="mt-0.5 block text-[10.5px] text-[#0C1B33]/50 leading-snug">{program.whyLine}</span>
                )}
              </div>
              {/* Right stack: amount over window, both from the SAME
                  catalog fields the program's own card would read. */}
              {(program.amount || program.window) && (
                <div className="flex-shrink-0 text-right">
                  {program.amount && (
                    <span className="block font-mono-bureau text-[11px] font-semibold whitespace-nowrap">{program.amount}</span>
                  )}
                  {program.window && (
                    <span className="mt-0.5 block text-[9.5px] text-[#0C1B33]/45 leading-snug max-w-[140px]">{program.window}</span>
                  )}
                </div>
              )}
            </div>
          ))}
          {brief.overflowCount > 0 && (
            <p className="pt-2 text-[11px] text-[#0C1B33]/55">
              + {brief.overflowCount} more mapped at this address — in the full report
            </p>
          )}
        </div>

        <div className="px-5 py-4 sm:px-6">
          <p className="font-mono-bureau text-[9px] tracking-[0.14em] uppercase text-[#2563EB]">Who to call</p>
          {brief.contacts.map((contact) => (
            <div key={contact.name} className="border-b border-[#E4ECF7] py-2.5">
              <p className="font-editorial text-[13.5px] font-semibold">{contact.name}</p>
              <p className="mt-0.5 text-[10.5px] text-[#0C1B33]/55 leading-relaxed">{contact.detail}</p>
            </div>
          ))}
          <div className="mt-3 border border-[#0C1B33]/15 bg-[#FAF9F6] px-3 py-2.5">
            <p className="font-mono-bureau text-[8.5px] tracking-[0.12em] uppercase text-[#0C1B33]/50">
              The full living report
            </p>
            <p className="mt-1 font-editorial text-[15px] font-semibold">{DOMAIN}</p>
            <p className="mt-0.5 text-[10px] text-[#0C1B33]/55 leading-relaxed">
              Visit {DOMAIN} and search this address, or use the direct link below.
            </p>
            <a href={reportUrl} className="mt-1 block font-mono-bureau text-[10px] text-[#2563EB] hover:underline break-all">
              {reportUrl.replace(/^https?:\/\//, "")}
            </a>
          </div>
        </div>
      </div>

      {/* ── Non-suppressible footer: screening sentence + verified date ── */}
      <div className="flex flex-col gap-1 border-t-2 border-[#0C1B33] bg-[#FAF9F6] px-5 py-2.5 font-mono-bureau text-[8.5px] tracking-[0.04em] text-[#0C1B33]/60 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>SCREENING FROM PUBLIC RECORDS — NOT AN ELIGIBILITY DETERMINATION</span>
        <span>
          {brief.preparedVia ? `PREPARED VIA ${brief.preparedVia.toUpperCase()} · ` : ""}
          GENERATED {brief.generatedDate}
          {brief.dataVerifiedMonth ? ` · DATA VERIFIED ${brief.dataVerifiedMonth.toUpperCase()}` : ""}
        </span>
      </div>
    </div>
  );
}
