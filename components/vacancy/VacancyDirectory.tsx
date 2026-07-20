"use client";

/**
 * VacancyDirectory — the full "SITE DIRECTORY" section of the Vacancy
 * Opportunity Index web report (app/vacancy/[zip]/page.tsx). The web report IS
 * the online index now: this lists EVERY tracked vacant property with a usable
 * address, not just the top-15 site index above it.
 *
 * Collapsed by default (a single bordered "Browse all N tracked addresses" row)
 * so the multi-hundred-row directory file only loads on demand. On expand it
 * fetches /data/vacancy-directory/{zip}.json ONCE (cached in state) and renders
 * a spreadsheet-style table with per-column multifilters (OWNER / TYPE / PRI /
 * FLAGS), an ADDRESS search, click-to-sort on ADDRESS and PRI, and simple
 * 100-row pagination. Anonymized end to end — owner TYPE only, never names.
 *
 * Filter semantics: OR within a column (any checked value matches), AND across
 * columns. An empty column selection is NO filter (all rows pass) — never
 * match-nothing. Pagination applies AFTER filtering. Mirrors the sort/filter
 * idioms in components/owner-file/OwnerClusterListClient.tsx.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OWNER_TYPE_COLORS,
  OWNER_TYPE_LABELS,
  OWNER_TYPE_ORDER,
  normalizeOwnerType,
  type OwnerType,
} from "@/lib/owner-classify";
import { trackEvent } from "@/lib/analytics-events";
// Type-only import: pulling a runtime value from lib/vacancy-index.ts would drag
// its fs-backed loader (node:fs) into this client bundle. Mirrors the
// type-only convention VacancyReportMap uses; the priority comparator is inlined
// below (it must stay identical to compareDirectoryRows in lib/vacancy-index.ts).
import type {
  VacancyDirectoryFile,
  VacancyDirectoryRow,
  VacancyPriorityTier,
  VacancyPropertyType,
} from "@/lib/vacancy-index";

const DISTRESS_RED = "#DC2626";
const PAGE_SIZE = 100;

/** Short owner-type labels for the dense directory table's OWNER column. */
const OWNER_TYPE_ABBREV: Record<OwnerType, string> = {
  corporate_llc: "LLC",
  out_of_state: "OOS",
  local_private: "LOCAL",
  city_public: "CITY",
  unknown: "UNK",
};

const PRIORITY_CHIP: Record<VacancyPriorityTier, { label: string; bg: string; fg: string }> = {
  high: { label: "HIGH", bg: "#DC2626", fg: "#FFFFFF" },
  medium: { label: "MEDIUM", bg: "#EAB308", fg: "#111111" },
  low: { label: "LOW", bg: "#D9D9D9", fg: "#4B4B4B" },
};

const PROPERTY_TYPE_ABBREV: Record<VacancyPropertyType, string> = {
  vacant_land: "LAND",
  vacant_building: "BLDG",
};

type FlagValue = "tax_sale" | "violation" | "none";
type SortKey = "priority" | "address";
type SortDir = "asc" | "desc";
type DropdownColumn = "owner" | "type" | "pri" | "flags";

const PRIORITY_TIERS: VacancyPriorityTier[] = ["high", "medium", "low"];
const PROPERTY_TYPES: VacancyPropertyType[] = ["vacant_land", "vacant_building"];
const FLAG_VALUES: FlagValue[] = ["tax_sale", "violation", "none"];

const FLAG_LABELS: Record<FlagValue, string> = {
  tax_sale: "Tax-sale exposed",
  violation: "Violation",
  none: "No flags",
};

/** Directory ordering — MUST match compareDirectoryRows in lib/vacancy-index.ts
 * (priorityScore desc, then address asc). Inlined here so this client bundle
 * never imports the fs-backed lib module. */
function comparePriority(a: VacancyDirectoryRow, b: VacancyDirectoryRow): number {
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
}

/** Two-digit tax-sale year suffix, e.g. 2015 -> "'15". */
function saleYearSuffix(year: number): string {
  return `'${String(year % 100).padStart(2, "0")}`;
}

function rowFlags(row: VacancyDirectoryRow): FlagValue[] {
  const flags: FlagValue[] = [];
  if (row.saleYear != null) flags.push("tax_sale");
  if (row.violation) flags.push("violation");
  if (flags.length === 0) flags.push("none");
  return flags;
}

interface VacancyDirectoryProps {
  zip: string;
  neighborhood: string;
  directoryCount: number;
}

export default function VacancyDirectory({ zip, neighborhood, directoryCount }: VacancyDirectoryProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<VacancyDirectoryFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const firedOpenEvent = useRef(false);

  // Column multifilter state (empty set = no filter on that column).
  const [ownerFilter, setOwnerFilter] = useState<Set<OwnerType>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<VacancyPropertyType>>(new Set());
  const [priFilter, setPriFilter] = useState<Set<VacancyPriorityTier>>(new Set());
  const [flagFilter, setFlagFilter] = useState<Set<FlagValue>>(new Set());
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [openDropdown, setOpenDropdown] = useState<DropdownColumn | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const rootRef = useRef<HTMLDivElement | null>(null);

  const fetchDirectory = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/data/vacancy-directory/${zip}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = (await res.json()) as VacancyDirectoryFile;
      setData(parsed);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [zip]);

  function handleExpand() {
    setOpen(true);
    if (!firedOpenEvent.current) {
      firedOpenEvent.current = true;
      trackEvent("vacancy_directory_opened", {
        source: "vacancy_web_report",
        metadata: { zip, total: directoryCount },
      });
    }
    if (!data && !loading) void fetchDirectory();
  }

  // Close any open column dropdown on outside click or Escape.
  useEffect(() => {
    if (openDropdown === null) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenDropdown(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenDropdown(null);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openDropdown]);

  const allRows = useMemo(() => data?.rows ?? [], [data]);

  // Live per-value counts over the full (unfiltered) dataset for the dropdowns.
  const ownerCounts = useMemo(() => {
    const counts = new Map<OwnerType, number>();
    for (const r of allRows) counts.set(r.ownerType, (counts.get(r.ownerType) ?? 0) + 1);
    return counts;
  }, [allRows]);
  const typeCounts = useMemo(() => {
    const counts = new Map<VacancyPropertyType, number>();
    for (const r of allRows) counts.set(r.propertyType, (counts.get(r.propertyType) ?? 0) + 1);
    return counts;
  }, [allRows]);
  const priCounts = useMemo(() => {
    const counts = new Map<VacancyPriorityTier, number>();
    for (const r of allRows) counts.set(r.priorityTier, (counts.get(r.priorityTier) ?? 0) + 1);
    return counts;
  }, [allRows]);
  const flagCounts = useMemo(() => {
    const counts = new Map<FlagValue, number>();
    for (const r of allRows) for (const f of rowFlags(r)) counts.set(f, (counts.get(f) ?? 0) + 1);
    return counts;
  }, [allRows]);

  // AND across columns, OR within each; empty column = pass. Search is a
  // case-insensitive substring on address.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const out = allRows.filter((r) => {
      if (ownerFilter.size > 0 && !ownerFilter.has(r.ownerType)) return false;
      if (typeFilter.size > 0 && !typeFilter.has(r.propertyType)) return false;
      if (priFilter.size > 0 && !priFilter.has(r.priorityTier)) return false;
      if (flagFilter.size > 0 && !rowFlags(r).some((f) => flagFilter.has(f))) return false;
      if (needle && !r.address.toLowerCase().includes(needle)) return false;
      return true;
    });
    // Sort a copy (never mutate the cached data.rows).
    const sorted = [...out];
    if (sortKey === "address") {
      sorted.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
      if (sortDir === "desc") sorted.reverse();
    } else {
      sorted.sort(comparePriority); // priorityScore desc, then address asc
      if (sortDir === "asc") sorted.reverse();
    }
    return sorted;
  }, [allRows, ownerFilter, typeFilter, priFilter, flagFilter, search, sortKey, sortDir]);

  // Reset pagination whenever the filtered/sorted result changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filtered]);

  const anyFilterActive =
    ownerFilter.size > 0 ||
    typeFilter.size > 0 ||
    priFilter.size > 0 ||
    flagFilter.size > 0 ||
    search.trim().length > 0;

  function clearFilters() {
    setOwnerFilter(new Set());
    setTypeFilter(new Set());
    setPriFilter(new Set());
    setFlagFilter(new Set());
    setSearch("");
  }

  function toggle<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, value: T) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Sensible defaults: priority high-first, address A–Z.
      setSortDir(key === "priority" ? "desc" : "asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  // ── Collapsed state ──
  if (!open) {
    return (
      <button
        type="button"
        onClick={handleExpand}
        className="flex w-full items-center justify-between border border-[#0C1B33]/15 bg-white px-4 py-3.5 text-left transition-colors hover:border-[#2563EB]/40"
      >
        <span className="font-mono-bureau text-[11px] uppercase tracking-[0.12em] text-[#0C1B33]/70">
          Browse all {directoryCount.toLocaleString("en-US")} tracked addresses
        </span>
        <span className="font-mono-bureau text-[12px] text-[#2563EB]">&rarr;</span>
      </button>
    );
  }

  // ── Loading / error ──
  if (loading) {
    return (
      <div className="border border-[#0C1B33]/15 bg-white px-4 py-6 text-center">
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45">
          Loading directory&hellip;
        </span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 border border-dashed border-[#DC2626]/40 bg-white px-4 py-6 text-center">
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#DC2626]">
          Could not load the directory
        </span>
        <button
          type="button"
          onClick={() => void fetchDirectory()}
          className="border border-[#0C1B33]/20 bg-white px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/70 hover:border-[#2563EB]/50"
        >
          Retry
        </button>
      </div>
    );
  }

  const shown = Math.min(visibleCount, filtered.length);
  const total = allRows.length;

  return (
    <div ref={rootRef}>
      {/* Search + clear */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search address"
          className="flex-1 min-w-[180px] border border-[#0C1B33]/15 bg-white px-3 py-2 text-[13px] text-[#0C1B33] outline-none focus:border-[#2563EB]"
        />
        {anyFilterActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="border border-[#0C1B33]/20 bg-white px-3 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/70 hover:border-[#DC2626]/50 hover:text-[#DC2626]"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-x-auto border border-[#0C1B33]/10 bg-white">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#0C1B33]/10 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
              <th className="px-3 py-2.5 w-10">#</th>
              <th className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleSort("address")}
                  className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/60 hover:text-[#2563EB]"
                >
                  Address{sortIndicator("address")}
                </button>
              </th>
              <FilterHeader
                label="Owner"
                column="owner"
                active={ownerFilter.size}
                openDropdown={openDropdown}
                setOpenDropdown={setOpenDropdown}
              >
                {OWNER_TYPE_ORDER.map((t) => (
                  <FilterCheckbox
                    key={t}
                    checked={ownerFilter.has(t)}
                    onChange={() => toggle(setOwnerFilter, t)}
                    count={ownerCounts.get(t) ?? 0}
                    dotColor={OWNER_TYPE_COLORS[t]}
                    label={OWNER_TYPE_LABELS[t]}
                  />
                ))}
              </FilterHeader>
              <FilterHeader
                label="Type"
                column="type"
                active={typeFilter.size}
                openDropdown={openDropdown}
                setOpenDropdown={setOpenDropdown}
              >
                {PROPERTY_TYPES.map((t) => (
                  <FilterCheckbox
                    key={t}
                    checked={typeFilter.has(t)}
                    onChange={() => toggle(setTypeFilter, t)}
                    count={typeCounts.get(t) ?? 0}
                    label={PROPERTY_TYPE_ABBREV[t]}
                  />
                ))}
              </FilterHeader>
              <th className="px-3 py-2.5 relative">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggleSort("priority")}
                    className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/60 hover:text-[#2563EB]"
                  >
                    Pri{sortIndicator("priority")}
                  </button>
                  <FilterFunnel
                    column="pri"
                    active={priFilter.size}
                    openDropdown={openDropdown}
                    setOpenDropdown={setOpenDropdown}
                  />
                </div>
                {openDropdown === "pri" && (
                  <FilterPanel>
                    {PRIORITY_TIERS.map((t) => (
                      <FilterCheckbox
                        key={t}
                        checked={priFilter.has(t)}
                        onChange={() => toggle(setPriFilter, t)}
                        count={priCounts.get(t) ?? 0}
                        label={PRIORITY_CHIP[t].label}
                      />
                    ))}
                  </FilterPanel>
                )}
              </th>
              <FilterHeader
                label="Flags"
                column="flags"
                active={flagFilter.size}
                openDropdown={openDropdown}
                setOpenDropdown={setOpenDropdown}
              >
                {FLAG_VALUES.map((f) => (
                  <FilterCheckbox
                    key={f}
                    checked={flagFilter.has(f)}
                    onChange={() => toggle(setFlagFilter, f)}
                    count={flagCounts.get(f) ?? 0}
                    dotColor={f === "none" ? undefined : DISTRESS_RED}
                    label={FLAG_LABELS[f]}
                  />
                ))}
              </FilterHeader>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-[13px] text-[#0C1B33]/45">
                  No addresses match the current filters.
                </td>
              </tr>
            ) : (
              filtered.slice(0, visibleCount).map((row, i) => {
                const ownerType = normalizeOwnerType(row.ownerType);
                const chip = PRIORITY_CHIP[row.priorityTier];
                return (
                  <tr key={`${row.address}-${i}`} className="border-b border-[#0C1B33]/5 align-top">
                    <td className="px-3 py-2 font-mono-bureau text-[11px] text-[#0C1B33]/40">
                      {(i + 1).toLocaleString("en-US")}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-[#0C1B33]/80">{row.address}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 font-mono-bureau text-[11px] text-[#0C1B33]/70">
                        <span
                          className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: OWNER_TYPE_COLORS[ownerType] }}
                        />
                        {OWNER_TYPE_ABBREV[ownerType]}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono-bureau text-[11px] text-[#0C1B33]/60">
                      {PROPERTY_TYPE_ABBREV[row.propertyType]}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-block px-2 py-0.5 font-mono-bureau text-[9px] font-semibold tracking-[0.08em]"
                        style={{ backgroundColor: chip.bg, color: chip.fg }}
                      >
                        {chip.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {row.saleYear != null && (
                          <span
                            className="inline-block px-1.5 py-0.5 font-mono-bureau text-[9px] font-semibold tracking-[0.06em] text-white"
                            style={{ backgroundColor: DISTRESS_RED }}
                          >
                            TAX SALE {saleYearSuffix(row.saleYear)}
                          </span>
                        )}
                        {row.violation && (
                          <span
                            className="inline-block border px-1.5 py-0.5 font-mono-bureau text-[9px] font-semibold tracking-[0.06em]"
                            style={{ borderColor: DISTRESS_RED, color: DISTRESS_RED }}
                          >
                            VIOLATION
                          </span>
                        )}
                        {row.saleYear == null && !row.violation && (
                          <span className="font-mono-bureau text-[10px] text-[#0C1B33]/25">&mdash;</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {shown < filtered.length && (
        <button
          type="button"
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          className="mt-3 w-full border border-[#0C1B33]/15 bg-white px-4 py-2.5 font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/70 hover:border-[#2563EB]/40 hover:text-[#2563EB]"
        >
          Show {Math.min(PAGE_SIZE, filtered.length - shown).toLocaleString("en-US")} more
        </button>
      )}

      <p className="mt-3 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/40">
        {shown.toLocaleString("en-US")} of {filtered.length.toLocaleString("en-US")}
        {filtered.length !== total ? ` (filtered from ${total.toLocaleString("en-US")})` : ""}
        {data.excludedNoAddressCount > 0
          ? ` · ${data.excludedNoAddressCount.toLocaleString("en-US")} records without a usable address omitted`
          : ""}
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[#0C1B33]/45">
        {neighborhood} &middot; ZIP {zip}. Records indicate; verify current ownership, eligibility,
        timing, and approval requirements with the administering organization before relying.
      </p>
    </div>
  );
}

// ── Header + dropdown primitives ─────────────────────────────────────────────

function FilterFunnel({
  column,
  active,
  openDropdown,
  setOpenDropdown,
}: {
  column: DropdownColumn;
  active: number;
  openDropdown: DropdownColumn | null;
  setOpenDropdown: (c: DropdownColumn | null) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Filter column${active > 0 ? ` (${active} active)` : ""}`}
      onClick={() => setOpenDropdown(openDropdown === column ? null : column)}
      className={`inline-flex items-center gap-0.5 border px-1 py-0.5 font-mono-bureau text-[9px] transition-colors ${
        active > 0
          ? "border-[#2563EB] bg-[#2563EB] text-white"
          : "border-[#0C1B33]/20 bg-white text-[#0C1B33]/55 hover:border-[#2563EB]/50"
      }`}
    >
      <span aria-hidden>{"▼"}</span>
      {active > 0 ? <span>{active}</span> : null}
    </button>
  );
}

function FilterPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute left-3 top-full z-20 mt-1 w-[190px] border border-[#0C1B33]/15 bg-white p-2 shadow-lg">
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function FilterHeader({
  label,
  column,
  active,
  openDropdown,
  setOpenDropdown,
  children,
}: {
  label: string;
  column: DropdownColumn;
  active: number;
  openDropdown: DropdownColumn | null;
  setOpenDropdown: (c: DropdownColumn | null) => void;
  children: React.ReactNode;
}) {
  return (
    <th className="px-3 py-2.5 relative">
      <div className="flex items-center gap-1.5">
        <span className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
          {label}
        </span>
        <FilterFunnel
          column={column}
          active={active}
          openDropdown={openDropdown}
          setOpenDropdown={setOpenDropdown}
        />
      </div>
      {openDropdown === column && <FilterPanel>{children}</FilterPanel>}
    </th>
  );
}

function FilterCheckbox({
  checked,
  onChange,
  count,
  label,
  dotColor,
}: {
  checked: boolean;
  onChange: () => void;
  count: number;
  label: string;
  dotColor?: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onChange}
        aria-pressed={checked}
        className="flex w-full items-center gap-2 px-1 py-1 text-left hover:bg-[#FAF9F6]"
      >
        <span
          className="inline-flex h-3 w-3 flex-shrink-0 items-center justify-center border text-[9px] leading-none"
          style={{
            backgroundColor: checked ? "#0C1B33" : "white",
            borderColor: checked ? "#0C1B33" : "#0C1B3340",
            color: "white",
          }}
        >
          {checked ? "✓" : ""}
        </span>
        {dotColor && (
          <span
            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: dotColor }}
          />
        )}
        <span className="flex-1 font-mono-bureau text-[10px] uppercase tracking-[0.04em] text-[#0C1B33]/75">
          {label}
        </span>
        <span className="font-mono-bureau text-[10px] text-[#0C1B33]/40">
          {count.toLocaleString("en-US")}
        </span>
      </button>
    </li>
  );
}
