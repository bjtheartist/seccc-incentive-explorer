import { formatPermitAreaDate } from "@/lib/permit-area";
import type { PermitExhibitCoverage, PermitExhibitMeta } from "@/lib/permit-exhibit";
import { PermitExhibitTruncationNotice } from "./PermitExhibitTruncationNotice";

function queryParamsLine(meta: PermitExhibitMeta): string {
  const { pinFormatted, radiusFt, filters } = meta.queryParams;
  const filterKeys = filters.permitTypeKeys;
  const filterLine =
    filterKeys && filterKeys.length > 0 ? `permitTypeKeys=${filterKeys.join(",")}` : "filters=none";
  return `pin=${pinFormatted} · radiusFt=${radiusFt} · ${filterLine}`;
}

/**
 * S4 — methods & limits footer. Non-suppressible: this section always
 * renders (never behind a details/summary toggle), carrying the exact
 * claim-surface copy from lib/permit-exhibit.ts (the spine's own S4
 * strings — cost label, limits block, coverage note, exhibit-id footer),
 * plus the match-method + unlocated coverage arithmetic and the
 * reproducible exhibit ID.
 */
export function MethodsFooter({
  meta,
  coverage,
}: {
  meta: PermitExhibitMeta;
  coverage: PermitExhibitCoverage;
}) {
  return (
    <footer className="mt-10 border-t-2 border-[#0C1B33] pt-6" aria-labelledby="s4-methods-title">
      <p className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#2563EB]">S4 · Methods &amp; limits</p>
      <h2 id="s4-methods-title" className="mt-1 font-editorial text-[24px] leading-tight text-[#0C1B33]">
        How this exhibit was built
      </h2>

      {/* The read cap is a limit of THIS exhibit, so it belongs in the
          non-suppressible limits block — all four exhibit surfaces render
          this footer, which is what makes the disclosure unconditional. */}
      <PermitExhibitTruncationNotice truncation={meta.truncation} className="mt-4" />

      <dl className="mt-4 grid gap-x-6 gap-y-2 border border-[#0C1B33]/10 bg-white p-4 text-[12px] sm:grid-cols-2">
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/45">Snapshot date</dt>
          <dd className="text-[#0C1B33]/75">{formatPermitAreaDate(meta.snapshotDate)}</dd>
        </div>
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/45">Source dataset</dt>
          <dd>
            <a href={meta.sourceUrl} target="_blank" rel="noreferrer" className="text-[#2563EB] hover:underline">
              {meta.sourceLabel}
            </a>
          </dd>
        </div>
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/45">Dataset last updated</dt>
          <dd className="text-[#0C1B33]/75">
            {meta.datasetLastUpdate ? formatPermitAreaDate(meta.datasetLastUpdate) : "Not recorded"}
          </dd>
        </div>
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/45">Query parameters</dt>
          <dd className="font-mono-bureau text-[11px] text-[#0C1B33]/65" data-testid="query-params-line">
            {queryParamsLine(meta)}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/45">Data window</dt>
          <dd className="text-[#0C1B33]/75">
            Full ingested history (since {formatPermitAreaDate(meta.ingestFloorDate)}), not the rolling analysis
            window the neighborhood permit-activity brief uses.
          </dd>
        </div>
      </dl>

      <div className="mt-4 border border-[#0C1B33]/10 bg-white p-4">
        <p className="font-mono-bureau text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0C1B33]/60">
          Match-method breakdown (subject parcel)
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="match-method-breakdown">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/45">Pin/parcel</dt>
            <dd className="tabular-nums text-[15px] font-medium text-[#0C1B33]">
              {coverage.matchMethodBreakdown.pinParcel.toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/45">Address exact</dt>
            <dd className="tabular-nums text-[15px] font-medium text-[#0C1B33]">
              {coverage.matchMethodBreakdown.addressExact.toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/45">Proximity</dt>
            <dd className="tabular-nums text-[15px] font-medium text-[#0C1B33]">
              {coverage.matchMethodBreakdown.proximity.toLocaleString("en-US")}
            </dd>
          </div>
        </dl>

        <p className="mt-4 font-mono-bureau text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0C1B33]/60">
          Area coverage (radius)
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/45">Located by point</dt>
            <dd className="tabular-nums text-[15px] font-medium text-[#0C1B33]">
              {coverage.area.geolocatedCount.toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.06em] text-[#A45B00]">Unlocated (address-only)</dt>
            <dd className="tabular-nums text-[15px] font-medium text-[#A45B00]" data-testid="unlocated-count">
              {coverage.area.unlocatedCount.toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/45">Total area records</dt>
            <dd className="tabular-nums text-[15px] font-medium text-[#0C1B33]">
              {coverage.area.totalCount.toLocaleString("en-US")}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/55">{coverage.coverageNote}</p>
      </div>

      <ol className="mt-4 space-y-2 border border-[#0C1B33]/10 bg-[#0C1B33]/[0.02] p-4 text-[12px] leading-relaxed text-[#0C1B33]/70">
        {meta.limitsBlock.map((limit, index) => (
          <li key={index} className="flex gap-3">
            <span className="font-mono-bureau text-[11px] font-semibold text-[#2563EB]">{index + 1}</span>
            <span>{limit}</span>
          </li>
        ))}
      </ol>

      <p className="mt-4 font-mono-bureau text-[10px] uppercase leading-relaxed tracking-[0.06em] text-[#0C1B33]/45">
        {meta.exhibitIdFooter}
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/45">
        Every permit number above links to its City record where the dataset provides one.
      </p>
    </footer>
  );
}
