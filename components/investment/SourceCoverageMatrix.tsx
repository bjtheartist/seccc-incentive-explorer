"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  COVERAGE_DIMENSION_LABELS,
  COVERAGE_STATE_LABELS,
  type CoverageDimension,
  type CoverageState,
  type SourceCoverageRow,
} from "@/lib/investment-source-coverage";
import { formatAsOf, formatCount } from "./format";

const DIMENSIONS: readonly CoverageDimension[] = [
  "capture",
  "map_detail",
  "refresh",
  "review",
] as const;

const STATE_STYLES: Record<CoverageState, string> = {
  complete_published: "border-[#138A5B]/25 bg-[#EAF7F1] text-[#0B6B45]",
  partial: "border-[#A45B00]/25 bg-[#FFF4DD] text-[#8A4B00]",
  aggregate_only: "border-[#2563EB]/25 bg-[#EAF1FF] text-[#1E56C4]",
  awaiting_publication: "border-[#596579]/20 bg-[#F0F2F5] text-[#4B5565]",
  quarantined: "border-[#B42318]/25 bg-[#FDECEA] text-[#9F2017]",
};

interface Selection {
  row: SourceCoverageRow;
  dimension: CoverageDimension;
}

export function SourceCoverageMatrix({
  rows,
  generatedAt,
}: {
  rows: SourceCoverageRow[];
  generatedAt: string;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    if (!selection) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelection(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selection]);

  if (rows.length === 0) return null;

  return (
    <>
      <div className="overflow-x-auto border border-[#0C1B33]/10 bg-white">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#0C1B33]/10 bg-[#F0F1EE]">
              <th className="w-[250px] px-4 py-3 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
                Source family
              </th>
              {DIMENSIONS.map((dimension) => (
                <th
                  key={dimension}
                  className="w-[160px] px-3 py-3 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45"
                >
                  {COVERAGE_DIMENSION_LABELS[dimension]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0C1B33]/8">
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="px-4 py-3 align-top">
                  <span className="block text-[12px] font-semibold leading-snug text-[#0C1B33]">
                    {row.name}
                  </span>
                  <span className="mt-1 block font-mono-bureau text-[9px] uppercase tracking-[0.07em] text-[#0C1B33]/40">
                    {formatCount(row.releasedRecords)} released records
                  </span>
                </th>
                {DIMENSIONS.map((dimension) => {
                  const cell = row.coverage[dimension];
                  return (
                    <td key={dimension} className="px-3 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => setSelection({ row, dimension })}
                        aria-label={`${row.name}, ${COVERAGE_DIMENSION_LABELS[dimension]}: ${COVERAGE_STATE_LABELS[cell.state]}`}
                        className={`min-h-9 w-full border px-2.5 py-2 text-left text-[10px] font-semibold leading-snug transition-opacity hover:opacity-80 ${STATE_STYLES[cell.state]}`}
                      >
                        {COVERAGE_STATE_LABELS[cell.state]}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {Object.entries(COVERAGE_STATE_LABELS).map(([state, label]) => (
          <span key={state} className="inline-flex items-center gap-1.5 text-[9px] text-[#0C1B33]/50">
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 border ${STATE_STYLES[state as CoverageState]}`}
            />
            {label}
          </span>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-[#0C1B33]/40">
        Export generated {formatAsOf(generatedAt)}. States describe the committed source snapshot;
        no completion percentage is inferred from an unpublished or moving denominator.
      </p>

      {selection ? (
        <div className="fixed inset-0 z-[80]" role="presentation">
          <button
            type="button"
            aria-label="Close coverage detail"
            onClick={() => setSelection(null)}
            className="absolute inset-0 h-full w-full bg-[#0C1B33]/35"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="coverage-drawer-title"
            className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto border-l border-[#0C1B33]/15 bg-[#FAF9F6] p-5 shadow-xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB]">
                  {COVERAGE_DIMENSION_LABELS[selection.dimension]}
                </span>
                <h3 id="coverage-drawer-title" className="mt-2 font-editorial text-[28px] leading-tight text-[#0C1B33]">
                  {selection.row.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelection(null)}
                title="Close"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-[#0C1B33]/15 bg-white text-[#0C1B33]/55 hover:text-[#0C1B33]"
              >
                <X aria-hidden="true" size={17} />
                <span className="sr-only">Close</span>
              </button>
            </div>

            <div className={`mt-6 inline-flex border px-2.5 py-1.5 text-[10px] font-semibold ${STATE_STYLES[selection.row.coverage[selection.dimension].state]}`}>
              {COVERAGE_STATE_LABELS[selection.row.coverage[selection.dimension].state]}
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-[#0C1B33]/70">
              {selection.row.coverage[selection.dimension].detail}
            </p>

            <dl className="mt-7 divide-y divide-[#0C1B33]/10 border-y border-[#0C1B33]/10">
              <div className="py-4">
                <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                  Released records
                </dt>
                <dd className="mt-1 text-[13px] font-semibold text-[#0C1B33]">
                  {formatCount(selection.row.releasedRecords)}
                </dd>
              </div>
              <div className="py-4">
                <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                  Refresh cadence
                </dt>
                <dd className="mt-1 text-[12px] leading-relaxed text-[#0C1B33]/70">
                  {selection.row.cadence}
                </dd>
              </div>
              <div className="py-4">
                <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                  Included source IDs
                </dt>
                <dd className="mt-2 flex flex-wrap gap-1.5">
                  {selection.row.sources.map((source) => (
                    <code key={source} className="border border-[#0C1B33]/10 bg-white px-2 py-1 text-[10px] text-[#0C1B33]/65">
                      {source}
                    </code>
                  ))}
                </dd>
              </div>
            </dl>

            <p className="mt-5 text-[11px] leading-relaxed text-[#0C1B33]/45">
              This diagnostic contains source-level metadata only. It does not expose held recipient
              rows, grant applicants, property owners, or any estimated incentive amount.
            </p>
          </aside>
        </div>
      ) : null}
    </>
  );
}
