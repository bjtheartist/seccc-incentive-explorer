import Link from "next/link";
import type { Metadata } from "next";
import { PILOT_ZIPS } from "@/lib/pilot-zips";
import { loadVacancyIndex } from "@/lib/vacancy-index";
import { OPPORTUNITY_AREA_DISCLAIMER } from "@/lib/vacancy-public-labels";

export const metadata: Metadata = {
  title: "Chicago Vacant Sites — neighborhood overviews",
  description:
    "Explore vacant-property overviews across nine Chicago pilot neighborhoods. Early possibilities identified from public records — not availability listings.",
};

/**
 * The public Vacant Sites landing page — a neighborhood picker across the nine
 * pilot editions (GPT-5.6 IA consult "option A"). Server-rendered from the
 * committed vacancy-index; each card links to that neighborhood's Overview.
 * No gate: this section is public. Owner data never appears here (counts only).
 */
export default function VacantSitesLandingPage() {
  const data = loadVacancyIndex();

  const cards = PILOT_ZIPS.map((entry) => {
    const edition = data?.editions[entry.zip] ?? null;
    const trackedCount = edition?.headline.vacantPropertyCount ?? null;
    return { ...entry, trackedCount };
  });

  const asOf = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-10 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          Chicago Vacant Sites
        </span>
        <h1 className="mt-3 font-editorial text-[44px] leading-none sm:text-[56px]">
          Vacant-property overviews
        </h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[#0C1B33]/55">
          A neighborhood-by-neighborhood look at tracked vacant land and buildings across nine pilot
          areas — where the sites are, how they cluster into opportunity areas, and what public
          records show about each.
        </p>
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/45">
          {OPPORTUNITY_AREA_DISCLAIMER}
        </p>
        {asOf && (
          <p className="mt-2 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/35">
            Records as of {asOf}
          </p>
        )}

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((entry) => (
            <Link
              key={entry.zip}
              href={`/vacancy/${entry.zip}`}
              className="flex flex-col border border-[#0C1B33]/10 bg-white p-5 transition-colors hover:border-[#2563EB]/40 hover:bg-white"
            >
              <p className="font-editorial text-[26px] leading-tight text-[#0C1B33]">
                {entry.primaryNeighborhood}
              </p>
              <p className="mt-1 font-mono-bureau text-[11px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                ZIP {entry.zip}
              </p>
              {entry.secondaryAreas.length > 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/40">
                  Also covers {entry.secondaryAreas.join(" · ")}
                </p>
              )}
              <div className="mt-4 flex items-baseline gap-2 font-mono-bureau text-[11px] uppercase tracking-[0.1em] text-[#0C1B33]/60">
                {entry.trackedCount != null ? (
                  <>
                    <span className="font-editorial text-[22px] not-italic text-[#0C1B33]">
                      {entry.trackedCount.toLocaleString("en-US")}
                    </span>
                    <span>tracked vacant sites</span>
                  </>
                ) : (
                  <span className="text-[#0C1B33]/40">Not yet available</span>
                )}
              </div>
              <span className="mt-4 font-mono-bureau text-[11px] uppercase tracking-[0.12em] text-[#2563EB]">
                View overview →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
