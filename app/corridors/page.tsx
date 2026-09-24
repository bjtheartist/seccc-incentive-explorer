import type { Metadata } from "next";
import Link from "next/link";
import {
  CORRIDOR_RESEARCH_MEASURES,
  CORRIDOR_RESEARCH_SCOPES,
} from "@/lib/corridor-research";

export const metadata: Metadata = {
  title: "Corridor Intelligence — Research Preview",
  description: "Review eight priority corridor scopes and the evidence needed for a repeatable small-business brief.",
};

export default function CorridorIntelligencePage() {
  return (
    <div className="min-h-screen bg-[#F7F8FA] text-[#0C1B33]">
      <section className="border-b border-[#0C1B33]/10 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-14 sm:px-8 sm:py-20">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
            Neighborhood Analysis · Research preview
          </span>
          <h1 className="mt-5 font-editorial text-[44px] leading-[1.02] sm:text-[62px]">
            Corridor Intelligence
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-7 text-[#0C1B33]/70">
            Start with a shared boundary and a small set of useful measures.
            These eight priority corridors are the starting point for a repeatable
            small-business brief.
          </p>
          <div className="mt-7 flex flex-wrap gap-3 text-sm">
            <a href="#priority-corridors" className="rounded-md bg-[#2563EB] px-5 py-3 font-medium text-white hover:bg-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2563EB]">
              Review the eight corridors
            </a>
            <a href="#proposed-measures" className="rounded-md border border-[#0C1B33]/20 px-5 py-3 font-medium hover:bg-[#F7F8FA] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2563EB]">
              See proposed measures
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-12 px-6 py-10 sm:px-8 sm:py-14">
        <aside aria-labelledby="evidence-status" className="border-l-4 border-[#2563EB] bg-white p-6">
          <h2 id="evidence-status" className="text-lg font-semibold">Baseline not yet measured</h2>
          <p className="mt-2 text-sm leading-6 text-[#0C1B33]/75">
            The scopes below are drafts recorded September 24, 2026. No corridor polygon
            is approved and no current street-level results are available here. Earlier
            Corridor Signals snapshots describe whole ZIP codes; they cannot establish
            conditions on these street segments.
          </p>
        </aside>

        <section id="priority-corridors" aria-labelledby="corridor-heading" className="scroll-mt-24">
          <h2 id="corridor-heading" className="font-editorial text-3xl">Eight priority corridors</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#0C1B33]/70">
            Open a corridor to review the boundary decision. Endpoint names are preserved
            from the request; direction labels and frontage still need confirmation.
          </p>
          <div className="mt-6 divide-y divide-[#0C1B33]/10 border border-[#0C1B33]/10 bg-white">
            {CORRIDOR_RESEARCH_SCOPES.map((corridor) => (
              <details key={corridor.id} id={corridor.id} className="group scroll-mt-24 px-5 py-5 sm:px-6">
                <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2563EB]">
                  <span className="ml-2 font-semibold">{corridor.name}</span>
                  <span className="mt-1 block pl-6 text-sm leading-6 text-[#0C1B33]/70">{corridor.extent}</span>
                </summary>
                <div className="ml-6 mt-4 border-t border-[#0C1B33]/10 pt-4 text-sm leading-6">
                  <p className="font-medium text-[#2563EB]">Draft scope · Polygon not approved</p>
                  <p className="mt-2"><strong>Boundary to confirm:</strong> {corridor.boundaryQuestion}</p>
                  <p className="mt-2 text-[#0C1B33]/70">Current corridor findings: not yet measured.</p>
                </div>
              </details>
            ))}
          </div>
          <p className="mt-4 text-sm leading-6 text-[#0C1B33]/70">
            Proposed counting rule: include agreed commercial frontage on both sides, decide
            mixed-use and side-street parcels, and count each business once in the combined
            total even when individual corridors overlap.
          </p>
        </section>

        <section id="proposed-measures" aria-labelledby="measures-heading" className="scroll-mt-24">
          <h2 id="measures-heading" className="font-editorial text-3xl">A practical starting scorecard</h2>
          <p className="mt-3 text-sm leading-6 text-[#0C1B33]/70">
            These six measures are proposed for discussion. Corridor conditions and outcomes
            for assisted businesses answer different questions; neither establishes causal impact.
          </p>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2">
            {CORRIDOR_RESEARCH_MEASURES.map((measure, index) => (
              <li key={measure.name} className="border border-[#0C1B33]/10 bg-white p-6">
                <p className="text-xs font-medium text-[#2563EB]">Measure {index + 1}</p>
                <h3 className="mt-2 font-semibold">{measure.name}</h3>
                <p className="mt-3 text-sm leading-6 text-[#0C1B33]/70">{measure.evidence}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="next-heading" className="border-t border-[#0C1B33]/10 pt-8">
          <h2 id="next-heading" className="font-editorial text-3xl">From scope to a repeatable brief</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#0C1B33]/75">
            <li>Approve a mapped boundary and the definition of each measure.</li>
            <li>Capture dated public records and reconcile them with verified local records.</li>
            <li>Review findings, missing information, and sources together before sharing.</li>
          </ol>
          <p className="mt-4 text-sm leading-6 text-[#0C1B33]/70">
            Automated corridor calculations and Google Docs/Sheets generation are planned future
            work. This preview does not generate a measured report or schedule a refresh.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-[#2563EB]">
            <Link href="/map" className="underline underline-offset-4">Explore the incentive map</Link>
            <Link href="/permit-activity" className="underline underline-offset-4">Explore neighborhood permit activity</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
