import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { getCorridorCitywideZips, loadCorridorCitywideData } from "@/lib/corridor-citywide";
import { Eyebrow, CorridorPreviewBanner } from "@/components/corridors/CorridorSignalsUI";

// Unlisted preview route: no sitemap entry, no nav link, noindex/nofollow.
export const metadata: Metadata = {
  title: "Corridor Signals (Preview) | Chicago Incentive Explorer",
  description:
    "Experimental citywide corridor-metrics dataset by ZIP — preview only, not part of the standard report.",
  robots: { index: false, follow: false },
};

export default function CorridorsIndexPage() {
  const data = loadCorridorCitywideData();
  const zips = getCorridorCitywideZips();

  return (
    <main className="bg-warm min-h-screen">
      <section className="bg-warm bureau-grid">
        <div className="max-w-4xl mx-auto px-6 pt-10 pb-12 md:pt-14">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-[12px] text-[#0C1B33]/50 mb-8 font-mono-bureau"
          >
            <span className="text-[#0C1B33]/50">Home</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-[#0C1B33]/80">Corridor Signals</span>
          </nav>

          <Eyebrow>Corridor Signals</Eyebrow>
          <div className="accent-bar mt-3 mb-5" />
          <h1 className="font-editorial text-3xl md:text-5xl text-[#0C1B33] leading-tight">
            Corridor Signals by ZIP (Preview)
          </h1>
          <p className="text-[#0C1B33]/70 text-base md:text-lg mt-5 max-w-2xl leading-relaxed">
            A citywide index of the experimental corridor-metrics dataset —
            vacancy, license activity, ownership, and permit signals for every
            ZIP with a computed record.
          </p>

          <div className="mt-8 max-w-2xl">
            <CorridorPreviewBanner />
          </div>
        </div>
      </section>

      <section className="bg-warm">
        <div className="max-w-4xl mx-auto px-6 pb-16">
          {!data || zips.length === 0 ? (
            <p className="text-[#0C1B33]/60 text-sm rounded-xl border border-[#0C1B33]/10 bg-white px-5 py-4 max-w-2xl leading-relaxed">
              No corridor data generated yet. The citywide export
              (data/exports/corridor-metrics-citywide.json) hasn&apos;t landed
              for this environment — check back once the batch job finishes.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {zips.map((zip) => {
                const metric = data[zip];
                const cd = metric?.details ?? null;
                const vacancyPct =
                  metric?.vacancyRate != null
                    ? `${Math.round(metric.vacancyRate * 100)}% vacant`
                    : "Vacancy pending";
                const openings = cd?.turnover?.openings;
                const closures = cd?.turnover?.closures;
                const licenseSummary =
                  openings != null && closures != null
                    ? `${openings.toLocaleString()} opened / ${closures.toLocaleString()} closed`
                    : "License activity pending";
                const permitCount = metric?.permitCount;
                const permitSummary =
                  permitCount != null
                    ? `${permitCount.toLocaleString()} permits`
                    : "Permits pending";

                return (
                  <li key={zip}>
                    <Link
                      href={`/corridors/${zip}`}
                      className="block rounded-xl border border-[#0C1B33]/10 bg-white p-5 hover:border-[#2563EB]/40 transition-colors"
                    >
                      <p className="font-editorial text-xl text-[#0C1B33]">
                        ZIP {zip}
                      </p>
                      <p className="text-[13px] text-[#0C1B33]/55 mt-2 leading-relaxed">
                        {vacancyPct} · {licenseSummary} · {permitSummary}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
