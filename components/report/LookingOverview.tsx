"use client";

// ─── "Just looking" overview (gate finding 9/10, R5LookingFinal board) ───
// Location snapshot, What's notable, Explore by interest, and the
// full-picture line — shared by both report forks. Every value comes from
// lib/report-looking-overview.ts's pure builders, which read only data the
// engine already resolved elsewhere in this same lensed report.

import {
  buildLocationSnapshot,
  buildWhatsNotable,
  EXPLORE_BY_INTEREST_OPTIONS,
} from "@/lib/report-looking-overview";
import type { GeneratedReport } from "@/lib/report-engine";

function personaHref(persona: string): string {
  if (typeof window === "undefined") return `?persona=${persona}`;
  const url = new URL(window.location.href);
  url.searchParams.set("persona", persona);
  return url.pathname + url.search;
}

/**
 * PART 01 — "Location snapshot": zoning/zone-count/program-count/data-
 * verified stat row. Does NOT also render "Programs matched here" — both
 * forks already render that cross-link (components/report/
 * ProgramsMatchedHere.tsx) for every real persona lens including
 * "looking", right under the Verdict Card; duplicating it here would
 * print the same cross-link twice on one page.
 */
export function LocationSnapshotPanel({ report: lensed }: { report: GeneratedReport }) {
  const snapshot = buildLocationSnapshot(lensed);
  const tiles = [
    snapshot.zoneClass ? { label: "Zoning", value: snapshot.zoneClass } : null,
    snapshot.mappedZoneCount != null ? { label: "Mapped zones", value: String(snapshot.mappedZoneCount) } : null,
    { label: "Programs", value: String(snapshot.programCount) },
    snapshot.dataVerified ? { label: "Data verified", value: snapshot.dataVerified } : null,
  ].filter((t): t is { label: string; value: string } => t !== null);
  if (tiles.length === 0) return null;

  return (
    <div data-testid="location-snapshot" className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label}>
          <span className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/35 block">
            {tile.label}
          </span>
          <span className="text-[15px] font-semibold text-[#0C1B33]">{tile.value}</span>
        </div>
      ))}
    </div>
  );
}

/** PART 02 — "What's notable": up to 3 real highlighted facts. */
export function WhatsNotablePanel({ report: lensed }: { report: GeneratedReport }) {
  const facts = buildWhatsNotable(lensed);
  if (facts.length === 0) return null;
  return (
    <div data-testid="whats-notable" className="mt-3 space-y-3">
      {facts.map((fact, index) => (
        <div key={index} className="border-l-2 border-[#2563EB]/30 pl-3">
          <span className="block text-[13px] font-semibold text-[#0C1B33]">{fact.label}</span>
          <span className="block text-[11.5px] text-[#0C1B33]/50">{fact.detail}</span>
        </div>
      ))}
    </div>
  );
}

/** PART 03 — "Explore by interest" + the full-picture line. */
export function ExploreByInterestPanel({ report: lensed }: { report: GeneratedReport }) {
  return (
    <div data-testid="explore-by-interest" className="mt-3 space-y-4">
      <div className="flex flex-wrap gap-2">
        {EXPLORE_BY_INTEREST_OPTIONS.map((option) => (
          <a
            key={option.persona}
            href={personaHref(option.persona)}
            className="font-mono-bureau text-[10px] tracking-[0.08em] uppercase text-[#0C1B33]/60 border border-[#0C1B33]/15 px-3 py-2 hover:border-[#2563EB]/40 hover:text-[#2563EB] transition-colors"
          >
            {option.label}
          </a>
        ))}
      </div>
      <a
        href={personaHref("all")}
        data-testid="full-picture-line"
        className="flex items-center gap-1.5 text-[12.5px] text-[#2563EB] hover:underline"
      >
        <span aria-hidden="true">&#9656;</span>
        Every program, zone, and detail at this address
      </a>
      {lensed.generatedAt && !Number.isNaN(new Date(lensed.generatedAt).getTime()) && (
        <p className="text-[9.5px] text-[#0C1B33]/35">
          Verified {new Date(lensed.generatedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
        </p>
      )}
    </div>
  );
}
