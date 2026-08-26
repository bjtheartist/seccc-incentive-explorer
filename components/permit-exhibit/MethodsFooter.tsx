import { formatPermitAreaDate } from "@/lib/permit-area";
import {
  PERMIT_EXHIBIT_LIMITS,
  PERMIT_EXHIBIT_SOURCE_LABEL,
  PERMIT_EXHIBIT_SOURCE_URL,
  permitExhibitVintageSentence,
} from "@/lib/permit-exhibit-copy";
import type { PermitExhibitCoverage, PermitExhibitMeta } from "@/lib/permit-exhibit-types";

function queryParamsLine(meta: PermitExhibitMeta): string {
  const entries = Object.entries(meta.queryParams).map(([key, value]) => `${key}=${value}`);
  return entries.join(" · ");
}

/**
 * S4 — methods & limits footer. Non-suppressible: this section always
 * renders (never behind a details/summary toggle), carrying the exact
 * claim-surface copy from lib/permit-exhibit-copy.ts, the match-method +
 * unlocated coverage arithmetic, the reproducible exhibit ID, and its
 * vintage semantics.
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

      <dl className="mt-4 grid gap-x-6 gap-y-2 border border-[#0C1B33]/10 bg-white p-4 text-[12px] sm:grid-cols-2">
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/45">Snapshot date</dt>
          <dd className="text-[#0C1B33]/75">{formatPermitAreaDate(meta.snapshotDate)}</dd>
        </div>
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/45">Source dataset</dt>
          <dd>
            <a href={PERMIT_EXHIBIT_SOURCE_URL} target="_blank" rel="noreferrer" className="text-[#2563EB] hover:underline">
              {PERMIT_EXHIBIT_SOURCE_LABEL}
            </a>
          </dd>
        </div>
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/45">Dataset last updated</dt>
          <dd className="text-[#0C1B33]/75">{formatPermitAreaDate(meta.datasetLastUpdate)}</dd>
        </div>
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/45">Query parameters</dt>
          <dd className="font-mono-bureau text-[11px] text-[#0C1B33]/65" data-testid="query-params-line">
            {queryParamsLine(meta)}
          </dd>
        </div>
      </dl>

      <div className="mt-4 border border-[#0C1B33]/10 bg-white p-4">
        <p className="font-mono-bureau text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0C1B33]/60">
          Match-method breakdown
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="match-method-breakdown">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/45">Pin/parcel</dt>
            <dd className="tabular-nums text-[15px] font-medium text-[#0C1B33]">
              {coverage.matchMethodCounts.pinParcel.toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/45">Address exact</dt>
            <dd className="tabular-nums text-[15px] font-medium text-[#0C1B33]">
              {coverage.matchMethodCounts.addressExact.toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/45">Proximity</dt>
            <dd className="tabular-nums text-[15px] font-medium text-[#0C1B33]">
              {coverage.matchMethodCounts.proximity.toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.06em] text-[#A45B00]">Unlocated</dt>
            <dd className="tabular-nums text-[15px] font-medium text-[#A45B00]" data-testid="unlocated-count">
              {coverage.unlocatedCount.toLocaleString("en-US")}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/55">
          {coverage.geolocatedRows.toLocaleString("en-US")} of {coverage.totalSourceRowsInRadius.toLocaleString("en-US")}{" "}
          source records in this radius have a usable map location; {coverage.unlocatedCount.toLocaleString("en-US")}{" "}
          could not be geolocated and are excluded from every map, count, and table above. An unlocated
          record is not evidence the work did not happen — only that this tool cannot place it.
        </p>
      </div>

      <ol className="mt-4 space-y-2 border border-[#0C1B33]/10 bg-[#0C1B33]/[0.02] p-4 text-[12px] leading-relaxed text-[#0C1B33]/70">
        {PERMIT_EXHIBIT_LIMITS.map((limit, index) => (
          <li key={index} className="flex gap-3">
            <span className="font-mono-bureau text-[11px] font-semibold text-[#2563EB]">{index + 1}</span>
            <span>{limit}</span>
          </li>
        ))}
      </ol>

      <p className="mt-4 font-mono-bureau text-[10px] uppercase leading-relaxed tracking-[0.06em] text-[#0C1B33]/45">
        {permitExhibitVintageSentence(meta.exhibitId)}
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/45">
        Every permit number above links to its City record where the dataset provides one.
      </p>
    </footer>
  );
}
