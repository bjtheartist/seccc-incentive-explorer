import type { Metadata } from "next";
import WardSnapshotTable from "@/components/wards/WardSnapshotTable";
import { NEED_INDEX_METHOD, WARD_METRICS, type WardSnapshotFile } from "@/lib/ward-snapshot";
import snapshotJson from "@/public/data/ward-snapshot.json";

export const metadata: Metadata = {
  title: "Ward Snapshot",
  description:
    "Vacant lots, property tax base, youth poverty, and TIF spending for all 50 Chicago wards, ranked against each other from public data.",
};

const snapshot = snapshotJson as WardSnapshotFile;

const usdMillions = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;

export default function WardSnapshotPage() {
  const { coverage, vintages } = snapshot;
  const tifShare = coverage.tifExpenditureTotal > 0 ? coverage.tifExpenditureAllocated / coverage.tifExpenditureTotal : 0;
  const built = new Date(snapshot.generatedAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="min-h-screen">
      <div className="relative border-b border-[#0C1B33]/10 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/chicago-map-hero.png')" }}
        />
        <div className="absolute inset-0 bg-[#0C1B33]/80" />
        <div className="relative z-10 container mx-auto max-w-6xl px-6 py-16">
          <div className="flex items-center gap-4 mb-6">
            <div className="accent-bar-light" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
              Ward Snapshot
            </span>
          </div>
          <h1 className="font-editorial text-4xl md:text-5xl text-white mb-4">Chicago&apos;s 50 wards at a glance</h1>
          <p className="text-white/60 text-base max-w-2xl">
            Four public measures for every ward on the {snapshot.wardMap} ward map. Each ward is ranked against the
            other 49, and the ranking is split into five equal groups, so &ldquo;Very High&rdquo; means the top 10
            wards on that measure, not a fixed threshold.
          </p>
        </div>
      </div>

      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-10 bg-[#FAF9F6]">
        <p className="text-sm text-[#0C1B33]/55 mb-4">
          Filter and rank with the controls below, or select a column heading to sort. Darker labels mean a higher value; whether higher is better depends on the
          measure.
        </p>

        <WardSnapshotTable snapshot={snapshot} />

        <section className="mt-12 max-w-3xl" aria-labelledby="ward-method">
          <div className="flex items-center gap-4 mb-4">
            <div className="accent-bar" />
            <h2 id="ward-method" className="font-editorial text-2xl text-[#0C1B33]">
              How each measure is built
            </h2>
          </div>
          <dl className="space-y-6">
            <div>
              <dt className="text-sm font-medium text-[#0C1B33]">Need index</dt>
              <dd className="mt-1 text-sm text-[#0C1B33]/65 leading-relaxed">{NEED_INDEX_METHOD}</dd>
            </div>
            {WARD_METRICS.map((m) => (
              <div key={m.key}>
                <dt className="text-sm font-medium text-[#0C1B33]">
                  {m.label}{" "}
                  <span className="font-normal text-[#0C1B33]/50">· {m.unitLabel(snapshot)}</span>
                </dt>
                <dd className="mt-1 text-sm text-[#0C1B33]/65 leading-relaxed">
                  {m.method}{" "}
                  <a href={m.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[#2563EB] underline underline-offset-2">
                    Source: {m.source}
                  </a>
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-8 border-t border-[#0C1B33]/10 pt-6 text-sm text-[#0C1B33]/60 leading-relaxed space-y-2">
            <p>
              Ward residents come from ACS {vintages.acs} tract population, split the same way as youth poverty.
              Neighborhood names are the community areas holding most of each ward&apos;s homes.
            </p>
            <p>
              {usdMillions(coverage.tifExpenditureAllocated)} of {usdMillions(coverage.tifExpenditureTotal)} in{" "}
              {vintages.tifReportYear} TIF expenditures ({Math.round(tifShare * 100)}%) could be placed in a ward.
              {coverage.tifDistrictsUnallocated.length > 0 && (
                <>
                  {" "}
                  The rest belongs to districts with no matching parcels on the current tax roll (
                  {coverage.tifDistrictsUnallocated.join("; ")}), usually because the district is new or has closed.
                </>
              )}
              {coverage.tifTransitExcluded > 0 && (
                <>
                  {" "}
                  Not counted: {usdMillions(coverage.tifTransitExcluded)} in Transit TIF spending (
                  {coverage.tifTransitDistricts.join("; ")}), which pays for CTA rail construction rather than
                  neighborhood development.
                </>
              )}
            </p>
            <p>
              Built {built} from {coverage.parcels.toLocaleString("en-US")} Chicago parcels. These are public-record
              comparisons, not program eligibility determinations.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
