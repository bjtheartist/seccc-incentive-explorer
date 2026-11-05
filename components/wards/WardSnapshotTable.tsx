"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  WARD_METRICS,
  rankWards,
  type WardMetricKey,
  type WardSnapshotFile,
  type WardTier,
} from "@/lib/ward-snapshot";

type SortKey = "ward" | WardMetricKey;

// One sequential scale: darker = higher value. Deliberately not red/green,
// because "high" is good on some measures and bad on others.
const TIER_STYLE: Record<WardTier, string> = {
  "Very High": "bg-[#0C1B33] text-white",
  High: "bg-[#2563EB] text-white",
  Moderate: "bg-[#2563EB]/15 text-[#0C1B33]",
  Low: "bg-[#0C1B33]/[0.06] text-[#0C1B33]/70",
  "Very Low": "bg-transparent text-[#0C1B33]/55 ring-1 ring-inset ring-[#0C1B33]/15",
};

export default function WardSnapshotTable({ snapshot }: { snapshot: WardSnapshotFile }) {
  const [sortKey, setSortKey] = useState<SortKey>("ward");
  const [descending, setDescending] = useState(false);

  const rankings = useMemo(
    () => Object.fromEntries(WARD_METRICS.map((m) => [m.key, rankWards(snapshot.wards, m.key)])) as Record<
      WardMetricKey,
      ReturnType<typeof rankWards>
    >,
    [snapshot.wards],
  );

  const rows = useMemo(() => {
    const sorted = [...snapshot.wards].sort((a, b) => {
      if (sortKey === "ward") return a.ward - b.ward;
      const av = a.values[sortKey] ?? -Infinity;
      const bv = b.values[sortKey] ?? -Infinity;
      return av - bv;
    });
    return descending ? sorted.reverse() : sorted;
  }, [snapshot.wards, sortKey, descending]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) setDescending((d) => !d);
    else {
      setSortKey(key);
      setDescending(key !== "ward");
    }
  };

  const sortIcon = (key: SortKey) =>
    sortKey !== key ? null : descending ? (
      <ArrowDown className="w-3 h-3" aria-hidden />
    ) : (
      <ArrowUp className="w-3 h-3" aria-hidden />
    );

  const ariaSort = (key: SortKey) =>
    sortKey === key ? (descending ? "descending" : "ascending") : "none";

  return (
    <div className="overflow-x-auto border border-[#0C1B33]/10 bg-white">
      <table className="w-full min-w-[760px] text-sm">
        <caption className="sr-only">
          Ward Snapshot: four measures for each of Chicago&apos;s 50 wards, ranked against the other wards
        </caption>
        <thead>
          <tr className="border-b border-[#0C1B33]/10 bg-[#FAF9F6] text-left align-bottom">
            <th scope="col" aria-sort={ariaSort("ward")} className="px-3 py-3 w-[72px]">
              <button
                type="button"
                onClick={() => onSort("ward")}
                className="inline-flex items-center gap-1 font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/60 hover:text-[#0C1B33]"
              >
                Ward {sortIcon("ward")}
              </button>
            </th>
            <th scope="col" className="px-3 py-3 font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/60">
              Neighborhood / Area
            </th>
            {WARD_METRICS.map((m) => (
              <th key={m.key} scope="col" aria-sort={ariaSort(m.key)} className="px-3 py-3">
                <button
                  type="button"
                  onClick={() => onSort(m.key)}
                  className="inline-flex items-center gap-1 font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/60 hover:text-[#0C1B33]"
                >
                  {m.label} {sortIcon(m.key)}
                </button>
                <div className="mt-1 text-[11px] font-normal normal-case tracking-normal text-[#0C1B33]/45">
                  {m.unitLabel(snapshot)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.ward} className="border-b border-[#0C1B33]/[0.06] last:border-0">
              <th scope="row" className="px-3 py-2.5 font-mono-bureau text-[#0C1B33] font-medium">
                {w.ward}
              </th>
              <td className="px-3 py-2.5 text-[#0C1B33]/75">{w.areas.join(", ") || "—"}</td>
              {WARD_METRICS.map((m) => {
                const value = w.values[m.key];
                const ranking = rankings[m.key].get(w.ward);
                return (
                  <td key={m.key} className="px-3 py-2.5">
                    {value == null || !ranking ? (
                      <span className="text-[#0C1B33]/40">No data</span>
                    ) : (
                      <div className="flex flex-col gap-1 items-start">
                        <span className={`px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${TIER_STYLE[ranking.tier]}`}>
                          {ranking.tier}
                        </span>
                        <span className="text-[12px] text-[#0C1B33]/60 tabular-nums whitespace-nowrap">
                          {m.format(value)}
                          <span className="text-[#0C1B33]/35"> · #{ranking.rank} of {ranking.of}</span>
                        </span>
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
