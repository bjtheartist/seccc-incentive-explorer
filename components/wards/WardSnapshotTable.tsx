"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import {
  EMPTY_WARD_FILTERS,
  WARD_FILTER_PRESETS,
  WARD_METRICS,
  WARD_TIERS,
  filterWards,
  needIndex,
  rankWards,
  type WardFilters,
  type WardRankKey,
  type WardRanking,
  type WardSnapshotFile,
  type WardTier,
  type WardTierFilter,
} from "@/lib/ward-snapshot";

type SortKey = "ward" | WardRankKey;

// One sequential scale: darker = higher value. Deliberately not red/green,
// because "high" is good on some measures and bad on others.
const TIER_STYLE: Record<WardTier, string> = {
  "Very High": "bg-[#0C1B33] text-white",
  High: "bg-[#2563EB] text-white",
  Moderate: "bg-[#2563EB]/15 text-[#0C1B33]",
  Low: "bg-[#0C1B33]/[0.06] text-[#0C1B33]/70",
  "Very Low": "bg-transparent text-[#0C1B33]/55 ring-1 ring-inset ring-[#0C1B33]/15",
};

const RANK_KEYS: { key: WardRankKey; label: string }[] = [
  { key: "needIndex", label: "Need index" },
  ...WARD_METRICS.map((m) => ({ key: m.key, label: m.label })),
];

const TIER_FILTER_OPTIONS: { value: WardTierFilter; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "top", label: "High or Very High" },
  { value: "bottom", label: "Low or Very Low" },
  ...WARD_TIERS.map((t) => ({ value: t, label: `${t} only` })),
];

const labelClass = "font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/55";
const controlClass =
  "h-9 w-full border border-[#0C1B33]/15 bg-white px-2 text-sm text-[#0C1B33] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/40";

function TierCell({ ranking, value }: { ranking: WardRanking | undefined; value: string | null }) {
  if (value == null || !ranking) return <span className="text-[#0C1B33]/40">No data</span>;
  return (
    <div className="flex flex-col gap-1 items-start">
      <span className={`px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${TIER_STYLE[ranking.tier]}`}>
        {ranking.tier}
      </span>
      <span className="text-[12px] text-[#0C1B33]/60 tabular-nums whitespace-nowrap">
        {value}
        <span className="text-[#0C1B33]/35"> · #{ranking.rank} of {ranking.of}</span>
      </span>
    </div>
  );
}

export default function WardSnapshotTable({ snapshot }: { snapshot: WardSnapshotFile }) {
  const [sortKey, setSortKey] = useState<SortKey>("ward");
  const [descending, setDescending] = useState(false);
  const [filters, setFilters] = useState<WardFilters>(EMPTY_WARD_FILTERS);
  const [presetId, setPresetId] = useState<string | null>(null);

  const rankings = useMemo(
    () =>
      ({
        needIndex: needIndex(snapshot.wards),
        ...Object.fromEntries(WARD_METRICS.map((m) => [m.key, rankWards(snapshot.wards, m.key)])),
      }) as Record<WardRankKey, Map<number, WardRanking & { score?: number }>>,
    [snapshot.wards],
  );

  const rows = useMemo(() => {
    const visible = filterWards(snapshot.wards, rankings, filters);
    // Rank order is ascending rank number = highest value first, so
    // "descending" (highest first) sorts by rank ascending.
    const rankOf = (ward: number) => (sortKey === "ward" ? ward : rankings[sortKey].get(ward)?.rank ?? Infinity);
    const sorted = [...visible].sort((a, b) => rankOf(a.ward) - rankOf(b.ward) || a.ward - b.ward);
    const highestFirst = sortKey === "ward" ? !descending : descending;
    return highestFirst ? sorted : sorted.reverse();
  }, [snapshot.wards, rankings, filters, sortKey, descending]);

  const setSort = (key: SortKey, desc = key !== "ward") => {
    setSortKey(key);
    setDescending(desc);
  };
  const onHeaderSort = (key: SortKey) => (key === sortKey ? setDescending((d) => !d) : setSort(key));

  const setTier = (key: WardRankKey, value: WardTierFilter) => {
    setPresetId(null);
    setFilters((f) => ({ ...f, tiers: { ...f.tiers, [key]: value } }));
  };
  const applyPreset = (id: string | null) => {
    const preset = WARD_FILTER_PRESETS.find((p) => p.id === id);
    setPresetId(preset ? preset.id : null);
    setFilters(preset ? { ...preset.filters, query: filters.query } : { ...EMPTY_WARD_FILTERS, query: filters.query });
    if (preset) setSort("needIndex", preset.id === "high-need");
  };
  const reset = () => {
    setPresetId(null);
    setFilters(EMPTY_WARD_FILTERS);
    setSort("ward", false);
  };
  const isFiltered =
    filters.query.trim() !== "" || Object.values(filters.tiers).some((v) => v && v !== "any") || sortKey !== "ward";

  const sortIcon = (key: SortKey) =>
    sortKey !== key ? null : descending ? (
      <ArrowDown className="w-3 h-3" aria-hidden />
    ) : (
      <ArrowUp className="w-3 h-3" aria-hidden />
    );
  const ariaSort = (key: SortKey) => (sortKey === key ? (descending ? "descending" : "ascending") : "none");
  const rankLabel = sortKey === "ward" ? null : RANK_KEYS.find((r) => r.key === sortKey)?.label;

  const headerButton = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => onHeaderSort(key)}
      className={`inline-flex items-center gap-1 ${labelClass} hover:text-[#0C1B33]`}
    >
      {label} {sortIcon(key)}
    </button>
  );

  return (
    <div>
      <div className="border border-[#0C1B33]/10 bg-white p-4 mb-4 space-y-4" role="search" aria-label="Filter and rank wards">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${labelClass} mr-1`}>View</span>
          {[{ id: null, label: "All wards", description: "Every ward" }, ...WARD_FILTER_PRESETS].map((p) => {
            const active = presetId === p.id && (p.id !== null || !isFiltered);
            return (
              <button
                key={p.id ?? "all"}
                type="button"
                title={p.description}
                aria-pressed={active}
                onClick={() => (p.id === null ? reset() : applyPreset(p.id))}
                className={`h-8 px-3 text-xs border transition-colors ${
                  active
                    ? "bg-[#0C1B33] text-white border-[#0C1B33]"
                    : "bg-white text-[#0C1B33]/70 border-[#0C1B33]/15 hover:border-[#0C1B33]/40"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.4fr_1fr]">
          <label className="block">
            <span className={labelClass}>Search</span>
            <span className="relative mt-1 block">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0C1B33]/35" aria-hidden />
              <input
                type="search"
                value={filters.query}
                onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                placeholder="Ward number or neighborhood"
                className={`${controlClass} pl-8`}
              />
            </span>
          </label>
          <label className="block">
            <span className={labelClass}>Rank by</span>
            <select
              value={sortKey}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className={`${controlClass} mt-1`}
            >
              <option value="ward">Ward number</option>
              {RANK_KEYS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Order</span>
            <select
              value={descending ? "desc" : "asc"}
              onChange={(e) => setDescending(e.target.value === "desc")}
              className={`${controlClass} mt-1`}
              disabled={sortKey === "ward"}
            >
              <option value="desc">Highest first</option>
              <option value="asc">Lowest first</option>
            </select>
          </label>
        </div>

        <fieldset>
          <legend className={labelClass}>Filter by tier</legend>
          <div className="mt-1 grid gap-3 grid-cols-2 lg:grid-cols-5">
            {RANK_KEYS.map((r) => (
              <label key={r.key} className="block">
                <span className="text-xs text-[#0C1B33]/60">{r.label}</span>
                <select
                  value={filters.tiers[r.key] ?? "any"}
                  onChange={(e) => setTier(r.key, e.target.value as WardTierFilter)}
                  className={`${controlClass} mt-1`}
                >
                  {TIER_FILTER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center justify-between gap-3 border-t border-[#0C1B33]/[0.06] pt-3">
          <p className="text-sm text-[#0C1B33]/65" aria-live="polite">
            Showing <span className="font-medium text-[#0C1B33]">{rows.length}</span> of {snapshot.wards.length} wards
            {rankLabel && <>, ranked by {rankLabel.toLowerCase()}</>}
          </p>
          {isFiltered && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:underline underline-offset-2"
            >
              <X className="w-3 h-3" aria-hidden /> Reset
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto border border-[#0C1B33]/10 bg-white">
        <table className="w-full min-w-[920px] text-sm">
          <caption className="sr-only">
            Ward Snapshot: measures for each of Chicago&apos;s 50 wards, ranked against the other wards
          </caption>
          <thead>
            <tr className="border-b border-[#0C1B33]/10 bg-[#FAF9F6] text-left align-bottom">
              <th scope="col" aria-sort={ariaSort("ward")} className="px-3 py-3 w-[72px]">
                {headerButton("ward", "Ward")}
              </th>
              <th scope="col" className={`px-3 py-3 ${labelClass}`}>
                Neighborhood / Area
              </th>
              <th scope="col" aria-sort={ariaSort("needIndex")} className="px-3 py-3">
                {headerButton("needIndex", "Need index")}
                <div className="mt-1 text-[11px] font-normal normal-case tracking-normal text-[#0C1B33]/45">
                  Vacancy, tax base, youth poverty
                </div>
              </th>
              {WARD_METRICS.map((m) => (
                <th key={m.key} scope="col" aria-sort={ariaSort(m.key)} className="px-3 py-3">
                  {headerButton(m.key, m.label)}
                  <div className="mt-1 text-[11px] font-normal normal-case tracking-normal text-[#0C1B33]/45">
                    {m.unitLabel(snapshot)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3 + WARD_METRICS.length} className="px-3 py-10 text-center text-[#0C1B33]/55">
                  No wards match these filters.{" "}
                  <button type="button" onClick={reset} className="text-[#2563EB] underline underline-offset-2">
                    Reset
                  </button>
                </td>
              </tr>
            )}
            {rows.map((w) => {
              const need = rankings.needIndex.get(w.ward);
              return (
                <tr key={w.ward} className="border-b border-[#0C1B33]/[0.06] last:border-0">
                  <th scope="row" className="px-3 py-2.5 font-mono-bureau text-[#0C1B33] font-medium">
                    {w.ward}
                  </th>
                  <td className="px-3 py-2.5 text-[#0C1B33]/75">{w.areas.join(", ") || "—"}</td>
                  <td className="px-3 py-2.5">
                    <TierCell ranking={need} value={need?.score != null ? need.score.toFixed(2) : null} />
                  </td>
                  {WARD_METRICS.map((m) => {
                    const value = w.values[m.key];
                    return (
                      <td key={m.key} className="px-3 py-2.5">
                        <TierCell ranking={rankings[m.key].get(w.ward)} value={value == null ? null : m.format(value)} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
