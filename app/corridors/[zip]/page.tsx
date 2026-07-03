import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import {
  getCorridorCitywideMetric,
  getCorridorCitywideZips,
} from "@/lib/corridor-citywide";
import { corridorConcentrationBand } from "@/lib/report-engine";
import {
  Eyebrow,
  CorridorPreviewBanner,
  DataRow,
  DataPendingRow,
  ContextNotProofFootnote,
  usdShort,
} from "@/components/corridors/CorridorSignalsUI";

/**
 * Static params sourced from the loader — if the citywide export hasn't
 * landed yet (background job still running), this returns [] and the route
 * simply has no pre-rendered pages until the file exists at the next build.
 */
export function generateStaticParams(): { zip: string }[] {
  return getCorridorCitywideZips().map((zip) => ({ zip }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zip: string }>;
}): Promise<Metadata> {
  const { zip } = await params;
  return {
    title: `Corridor Signals — ZIP ${zip} (Preview) | Chicago Incentive Explorer`,
    description: `Experimental corridor-metrics preview for ZIP ${zip} — vacancy, license activity, ownership, and permit signals. Not part of the standard report.`,
    robots: { index: false, follow: false },
  };
}

export default async function CorridorSignalsPage({
  params,
}: {
  params: Promise<{ zip: string }>;
}) {
  const { zip } = await params;
  const metric = getCorridorCitywideMetric(zip);
  if (!metric) notFound();

  const cd = metric.details ?? null;
  const windowMonths = cd?.windowMonths ?? 24;

  // Rule 6: ownership rows render ONLY when the underlying source actually
  // loaded parcels for this ZIP. Absence must never silently read as "0%".
  const concentrationLoaded = (cd?.ownershipConcentration?.totalParcels ?? 0) > 0;
  const originLoaded = (cd?.ownershipOrigin?.totalParcels ?? 0) > 0;

  const openings = cd?.turnover?.openings;
  const closures = cd?.turnover?.closures;
  const net = cd?.turnover?.net;

  const permitCount = cd?.permits?.permitCount ?? metric.permitCount ?? null;
  const demolitionCount = cd?.permits?.demolitionCount ?? null;
  const reportedCost = usdShort(cd?.permits?.totalReportedCost);

  return (
    <main className="bg-warm min-h-screen">
      <section className="bg-warm bureau-grid">
        <div className="max-w-4xl mx-auto px-6 pt-10 pb-12 md:pt-14">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-[12px] text-[#0C1B33]/50 mb-8 font-mono-bureau"
          >
            <Link href="/corridors" className="hover:text-[#2563EB] transition-colors">
              Corridor Signals
            </Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-[#0C1B33]/80">ZIP {zip}</span>
          </nav>

          <Eyebrow>Corridor Signals</Eyebrow>
          <div className="accent-bar mt-3 mb-5" />
          <h1 className="font-editorial text-3xl md:text-5xl text-[#0C1B33] leading-tight">
            ZIP {zip} Corridor Signals (Preview)
          </h1>
          <p className="text-[#0C1B33]/70 text-base md:text-lg mt-5 max-w-2xl leading-relaxed">
            Public-record signals for ZIP {zip}, trailing {windowMonths}{" "}
            months where noted.
          </p>

          <div className="mt-8 max-w-2xl">
            <CorridorPreviewBanner />
          </div>
        </div>
      </section>

      <section className="bg-warm">
        <div className="max-w-4xl mx-auto px-6 pb-16">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Vacancy — rule 2 */}
            {metric.vacancyRate != null ? (
              <DataRow
                label="Properties flagged vacant"
                value={`${Math.round(metric.vacancyRate * 100)}% of property records`}
                detail="Share of property records in this ZIP with a public vacancy indicator."
              />
            ) : (
              <DataPendingRow label="Properties flagged vacant" />
            )}

            {/* License activity — rule 3: openings/closures always separate */}
            {openings != null && closures != null ? (
              <DataRow
                label="Business license activity"
                value={`${openings.toLocaleString()} opened / ${closures.toLocaleString()} closed in the last ${windowMonths} months`}
                detail={`Business licenses recorded as opened or closed in this ZIP, shown separately so the direction is visible.${
                  net != null ? ` Net change: ${net >= 0 ? "+" : ""}${net.toLocaleString()}.` : ""
                }`}
              />
            ) : (
              <DataPendingRow label="Business license activity" />
            )}

            {/* Ownership concentration — rule 4 & 6: band only, never raw HHI */}
            {concentrationLoaded && metric.ownershipHHI != null ? (
              <DataRow
                label="Ownership concentration"
                value={corridorConcentrationBand(metric.ownershipHHI)}
                detail="How spread out private property ownership appears in available assessor records; higher concentration means fewer owners hold a larger share."
              />
            ) : (
              <DataPendingRow label="Ownership concentration" />
            )}

            {/* Local ownership — rule 5 & 6 */}
            {originLoaded && metric.localOwnershipShare != null ? (
              <DataRow
                label="Illinois owner mailing addresses"
                value={`${Math.round(metric.localOwnershipShare * 100)}% of private-owner records`}
                detail="Share of private-owner property records with an Illinois owner mailing address; this does not measure residency or community commitment."
              />
            ) : (
              <DataPendingRow label="Illinois owner mailing addresses" />
            )}

            {/* Permits — rule 7 */}
            {permitCount != null ? (
              <DataRow
                label="Permit activity"
                value={
                  reportedCost
                    ? `${permitCount.toLocaleString()} permits, ${reportedCost} reported cost`
                    : `${permitCount.toLocaleString()} permits`
                }
                detail={`${
                  demolitionCount != null
                    ? `Includes ${demolitionCount.toLocaleString()} demolitions. `
                    : ""
                }Reported cost is self-reported on permit applications and should be treated as directional, not final investment value.`}
              />
            ) : (
              <DataPendingRow label="Permit activity" />
            )}
          </div>

          {/* Rule 8: "How to read this" footnote */}
          <div className="mt-8">
            <ContextNotProofFootnote />
          </div>
        </div>
      </section>
    </main>
  );
}
