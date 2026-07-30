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
 * a spreadsheet-style table with per-column multifilters (PUBLIC / PRIVATE ·
 * ENTITY · TYPE · FLAGS), an ADDRESS search, an address-order toggle,
 * and simple 100-row pagination. Below the sm breakpoint the dense table gives
 * way to stacked cards — same filtered/sorted/paginated array, just a
 * different rendering — since the table is unusable on a phone. Anonymized
 * end to end — owner CLASSIFICATION only, never names.
 *
 * The two ownership columns are the two axes, coarse first:
 *   • PUBLIC / PRIVATE — the sector reading (lib/owner-sector.ts): government /
 *     city-inventory ownership reads Public, individual / entity / trust reads
 *     Private, and a row neither axis resolved reads "Not yet classified".
 *     Never guessed, never blank.
 *   • ENTITY — the structure detail (lib/owner-taxonomy.ts): IND / ENT / TRUST /
 *     GOV / UNR, each with its taxonomy color.
 *
 * Filter semantics: OR within a column (any checked value matches), AND across
 * columns. An empty column selection is NO filter (all rows pass) — never
 * match-nothing. Pagination applies AFTER filtering. Mirrors the sort/filter
 * idioms in components/owner-file/OwnerClusterListClient.tsx. The row
 * derivations and the predicate itself live in ./vacancy-directory-filter so
 * they are unit-testable without rendering the table.
 *
 * Area handoff: when the caller (app/vacancy/[zip]/directory/page.tsx, from a
 * `?area=` query param) passes initialAreaId, the directory auto-expands and
 * pre-filters to that Opportunity Area's clusterId, with a dismissible banner.
 * clusterId only tags rows whose mapped site landed in a kept proximity
 * cluster, so the banner says plainly that unmapped rows aren't tagged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OWNER_SECTOR_ABBREV,
  OWNER_SECTOR_COLORS,
  OWNER_SECTOR_LABELS,
  OWNER_SECTOR_ORDER,
  type OwnerSector,
} from "@/lib/owner-sector";
import {
  OWNER_STRUCTURE_ABBREV,
  OWNER_STRUCTURE_COLORS,
  OWNER_STRUCTURE_LABELS,
  OWNER_STRUCTURE_ORDER,
  type OwnerStructure,
} from "@/lib/owner-taxonomy";
import { clerkRecordsUrl, cookViewerUrl } from "@/lib/cook-viewer";
import { trackEvent } from "@/lib/analytics-events";
import {
  FLAG_LABELS,
  FLAG_VALUES,
  PROPERTY_TYPES,
  PROPERTY_TYPE_ABBREV,
  PROPERTY_TYPE_LABELS,
  filterAndSortRows,
  rowEvidenceLine,
  rowFlags,
  rowSector,
  rowStructure,
  saleYearSuffix,
  type FlagValue,
  type SortDir,
} from "./vacancy-directory-filter";
// Type-only import: pulling a runtime value from lib/vacancy-index.ts would drag
// its fs-backed loader (node:fs) into this client bundle. Mirrors the
// type-only convention VacancyReportMap uses.
import type {
  VacancyDirectoryFile,
  VacancyDirectoryRow,
  VacancyPropertyType,
} from "@/lib/vacancy-index";

const DISTRESS_RED = "#DC2626";
const PAGE_SIZE = 100;

type DropdownColumn = "sector" | "structure" | "type" | "flags";

/** Strip a `?area=` query param from the URL bar without a navigation, once
 * the area filter it seeded has been cleared. Best-effort: no-ops if there's
 * no window (SSR) or no such param. */
function stripAreaParamFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("area")) return;
  url.searchParams.delete("area");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

interface VacancyDirectoryProps {
  zip: string;
  neighborhood: string;
  directoryCount: number;
  /** Opportunity-Area handoff: when set (from the directory page's `?area=`
   * query param), the directory auto-expands and pre-filters to rows whose
   * clusterId matches, with a dismissible banner. */
  initialAreaId?: number | null;
  /** The area's display name, resolved server-side via opportunityAreaById;
   * null when it doesn't resolve (the banner falls back to "area {id}"). */
  initialAreaName?: string | null;
}

export default function VacancyDirectory({
  zip,
  neighborhood,
  directoryCount,
  initialAreaId = null,
  initialAreaName = null,
}: VacancyDirectoryProps) {
  const [open, setOpen] = useState(initialAreaId != null);
  const [data, setData] = useState<VacancyDirectoryFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const firedOpenEvent = useRef(false);

  // Column multifilter state (empty set = no filter on that column).
  const [sectorFilter, setSectorFilter] = useState<Set<OwnerSector>>(new Set());
  const [structureFilter, setStructureFilter] = useState<Set<OwnerStructure>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<VacancyPropertyType>>(new Set());
  const [flagFilter, setFlagFilter] = useState<Set<FlagValue>>(new Set());
  const [search, setSearch] = useState("");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [openDropdown, setOpenDropdown] = useState<DropdownColumn | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Opportunity-Area handoff filter — seeded from the `?area=` query param,
  // clearable independently of the other column filters.
  const [areaFilterId, setAreaFilterId] = useState<number | null>(initialAreaId);

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
  }

  // Fetch on first expand, whether that's a manual click (handleExpand) or an
  // auto-expand from an area handoff (initialAreaId set at mount). Fires the
  // open-tracking event exactly once, same as the old click-handler logic.
  useEffect(() => {
    if (!open) return;
    if (!firedOpenEvent.current) {
      firedOpenEvent.current = true;
      trackEvent("vacancy_directory_opened", {
        source: "vacancy_web_report",
        metadata: { zip, total: directoryCount },
      });
    }
    if (!data && !loading && !error) void fetchDirectory();
  }, [open, data, loading, error, fetchDirectory, zip, directoryCount]);

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
  const sectorCounts = useMemo(() => {
    const counts = new Map<OwnerSector, number>();
    for (const r of allRows) {
      const s = rowSector(r);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return counts;
  }, [allRows]);
  const structureCounts = useMemo(() => {
    const counts = new Map<OwnerStructure, number>();
    for (const r of allRows) {
      const s = rowStructure(r);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return counts;
  }, [allRows]);
  const typeCounts = useMemo(() => {
    const counts = new Map<VacancyPropertyType, number>();
    for (const r of allRows) counts.set(r.propertyType, (counts.get(r.propertyType) ?? 0) + 1);
    return counts;
  }, [allRows]);
  const flagCounts = useMemo(() => {
    const counts = new Map<FlagValue, number>();
    for (const r of allRows) for (const f of rowFlags(r)) counts.set(f, (counts.get(f) ?? 0) + 1);
    return counts;
  }, [allRows]);

  // How many rows carry the handoff area's clusterId, independent of every
  // other filter — the number the banner reports.
  const areaMatchCount = useMemo(() => {
    if (areaFilterId == null) return 0;
    return allRows.filter((r) => r.clusterId === areaFilterId).length;
  }, [allRows, areaFilterId]);

  // AND across columns, OR within each; empty column = pass. Search is a
  // case-insensitive substring on address. Predicate + address sort live in
  // ./vacancy-directory-filter so the semantics are unit-tested directly.
  const filtered = useMemo(
    () =>
      filterAndSortRows(
        allRows,
        {
          areaId: areaFilterId,
          sectors: sectorFilter,
          structures: structureFilter,
          types: typeFilter,
          flags: flagFilter,
          search,
        },
        sortDir,
      ),
    [
      allRows,
      areaFilterId,
      sectorFilter,
      structureFilter,
      typeFilter,
      flagFilter,
      search,
      sortDir,
    ],
  );

  // Reset pagination whenever the filtered/sorted result changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filtered]);

  const anyFilterActive =
    sectorFilter.size > 0 ||
    structureFilter.size > 0 ||
    typeFilter.size > 0 ||
    flagFilter.size > 0 ||
    search.trim().length > 0 ||
    areaFilterId != null;

  function clearFilters() {
    setSectorFilter(new Set());
    setStructureFilter(new Set());
    setTypeFilter(new Set());
    setFlagFilter(new Set());
    setSearch("");
    setAreaFilterId(null);
    stripAreaParamFromUrl();
  }

  function clearAreaFilter() {
    setAreaFilterId(null);
    stripAreaParamFromUrl();
  }

  function toggle<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, value: T) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleAddressSort() {
    setSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
  }

  function sortIndicator() {
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
  const areaLabel = initialAreaName ?? (areaFilterId != null ? `area ${areaFilterId}` : "");

  return (
    <div ref={rootRef}>
      {/* Area handoff banner */}
      {areaFilterId != null && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border border-[#2563EB]/25 bg-[#2563EB]/5 px-4 py-3">
          <p className="text-[12px] leading-relaxed text-[#0C1B33]/70">
            Showing {areaMatchCount.toLocaleString("en-US")} tracked addresses in {areaLabel} —
            mapped members only; unmapped rows in this group are not tagged.
          </p>
          <button
            type="button"
            onClick={clearAreaFilter}
            className="flex-shrink-0 border border-[#0C1B33]/20 bg-white px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/70 hover:border-[#DC2626]/50 hover:text-[#DC2626]"
          >
            Clear area filter
          </button>
        </div>
      )}

      {/* Search + sort + clear */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search address"
          className="flex-1 min-w-[180px] border border-[#0C1B33]/15 bg-white px-3 py-2 text-[13px] text-[#0C1B33] outline-none focus:border-[#2563EB]"
        />
        <div className="flex items-center gap-1.5">
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
            Sort
          </span>
          <button
            type="button"
            onClick={toggleAddressSort}
            className="border border-[#2563EB] bg-[#2563EB] px-2 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-white"
          >
            Address{sortIndicator()}
          </button>
        </div>
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

      {/* Desktop / tablet: dense spreadsheet-style table (sm and up). */}
      <div className="hidden overflow-x-auto border border-[#0C1B33]/10 bg-white sm:block">
        <table className="w-full min-w-[1140px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#0C1B33]/10 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
              <th className="px-3 py-2.5 w-10">#</th>
              <th className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={toggleAddressSort}
                  className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/60 hover:text-[#2563EB]"
                >
                  Address{sortIndicator()}
                </button>
              </th>
              <FilterHeader
                label="Public / Private"
                column="sector"
                active={sectorFilter.size}
                openDropdown={openDropdown}
                setOpenDropdown={setOpenDropdown}
              >
                {OWNER_SECTOR_ORDER.map((s) => (
                  <FilterCheckbox
                    key={s}
                    checked={sectorFilter.has(s)}
                    onChange={() => toggle(setSectorFilter, s)}
                    count={sectorCounts.get(s) ?? 0}
                    dotColor={OWNER_SECTOR_COLORS[s]}
                    label={OWNER_SECTOR_LABELS[s]}
                  />
                ))}
              </FilterHeader>
              <FilterHeader
                label="Entity"
                column="structure"
                active={structureFilter.size}
                openDropdown={openDropdown}
                setOpenDropdown={setOpenDropdown}
              >
                {OWNER_STRUCTURE_ORDER.map((s) => (
                  <FilterCheckbox
                    key={s}
                    checked={structureFilter.has(s)}
                    onChange={() => toggle(setStructureFilter, s)}
                    count={structureCounts.get(s) ?? 0}
                    dotColor={OWNER_STRUCTURE_COLORS[s]}
                    label={OWNER_STRUCTURE_LABELS[s]}
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
              <th className="px-3 py-2.5 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                Verify
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[13px] text-[#0C1B33]/45">
                  No addresses match the current filters.
                </td>
              </tr>
            ) : (
              filtered.slice(0, visibleCount).map((row, i) => {
                const sector = rowSector(row);
                const structure = rowStructure(row);
                // Back-search links resolve only when the row carries a real PIN
                // (COLS inventory or a uniquely address-matched 311 parcel).
                const cookViewer = cookViewerUrl(row.pin);
                const clerk = clerkRecordsUrl(row.pin);
                return (
                  <tr key={`${row.address}-${i}`} className="border-b border-[#0C1B33]/5 align-top">
                    <td className="px-3 py-2 font-mono-bureau text-[11px] text-[#0C1B33]/40">
                      {(i + 1).toLocaleString("en-US")}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-[#0C1B33]/80">{row.address}</td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono-bureau text-[11px] text-[#0C1B33]/70"
                        title={`Sector: ${OWNER_SECTOR_LABELS[sector]}`}
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: OWNER_SECTOR_COLORS[sector] }}
                        />
                        {OWNER_SECTOR_ABBREV[sector]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center gap-1.5 font-mono-bureau text-[11px] text-[#0C1B33]/70"
                        title={`Entity: ${OWNER_STRUCTURE_LABELS[structure]} (taxpayer name)`}
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: OWNER_STRUCTURE_COLORS[structure] }}
                        />
                        {OWNER_STRUCTURE_ABBREV[structure]}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono-bureau text-[11px] text-[#0C1B33]/60">
                      {PROPERTY_TYPE_ABBREV[row.propertyType]}
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
                    <td className="px-3 py-2 whitespace-nowrap">
                      {cookViewer ? (
                        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.06em]">
                          <a
                            href={cookViewer}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Opens Cook County's official parcel record in a new tab."
                            className="text-[#2563EB] hover:underline"
                          >
                            CookViewer ↗
                          </a>
                          {clerk && (
                            <>
                              <span className="text-[#0C1B33]/30"> · </span>
                              <a
                                href={clerk}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Review recorded deeds, grantors, grantees, liens, releases, and other documents associated with this parcel."
                                className="text-[#2563EB] hover:underline"
                              >
                                Clerk ↗
                              </a>
                            </>
                          )}
                        </span>
                      ) : (
                        <span className="font-mono-bureau text-[10px] text-[#0C1B33]/30">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards (below sm) — same filtered/sorted/paginated
          array as the table, just a different rendering. */}
      <div className="space-y-3 sm:hidden">
        {filtered.length === 0 ? (
          <div className="border border-[#0C1B33]/10 bg-white px-4 py-8 text-center text-[13px] text-[#0C1B33]/45">
            No addresses match the current filters.
          </div>
        ) : (
          filtered
            .slice(0, visibleCount)
            .map((row, i) => <DirectoryCard key={`${row.address}-${i}`} row={row} />)
        )}
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

// ── Mobile card ──────────────────────────────────────────────────────────────

/** One tracked address, stacked-card form (below sm). Mirrors the table row's
 * fields but in a plain-language, thumb-friendly layout: address, property type
 * + the same two ownership axes the table shows (sector, then entity detail),
 * evidence line, Verify links. An unresolved row reads "Not yet classified"
 * here too — never a blank or a guess. */
function DirectoryCard({ row }: { row: VacancyDirectoryRow }) {
  const sector = rowSector(row);
  const structure = rowStructure(row);
  const cookViewer = cookViewerUrl(row.pin);
  const clerk = clerkRecordsUrl(row.pin);

  return (
    <div className="border border-[#0C1B33]/10 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] font-semibold leading-snug text-[#0C1B33]">{row.address}</p>
      </div>
      <p className="mt-1 font-mono-bureau text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/55">
        {PROPERTY_TYPE_LABELS[row.propertyType]} &middot; {OWNER_SECTOR_LABELS[sector]}
        {sector === "unclassified" ? "" : ` · ${OWNER_STRUCTURE_LABELS[structure]}`}
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-[#0C1B33]/60">{rowEvidenceLine(row)}</p>
      {(cookViewer || clerk) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {cookViewer && (
            <a
              href={cookViewer}
              target="_blank"
              rel="noopener noreferrer"
              title="Opens Cook County's official parcel record in a new tab."
              className="flex min-h-[44px] items-center border border-[#2563EB]/30 px-3 font-mono-bureau text-[11px] uppercase tracking-[0.06em] text-[#2563EB]"
            >
              CookViewer ↗
            </a>
          )}
          {clerk && (
            <a
              href={clerk}
              target="_blank"
              rel="noopener noreferrer"
              title="Review recorded deeds, grantors, grantees, liens, releases, and other documents associated with this parcel."
              className="flex min-h-[44px] items-center border border-[#2563EB]/30 px-3 font-mono-bureau text-[11px] uppercase tracking-[0.06em] text-[#2563EB]"
            >
              Clerk ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Header + dropdown primitives ─────────────────────────────────────────────

function FilterFunnel({
  label,
  column,
  active,
  openDropdown,
  setOpenDropdown,
}: {
  label: string;
  column: DropdownColumn;
  active: number;
  openDropdown: DropdownColumn | null;
  setOpenDropdown: (c: DropdownColumn | null) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Filter ${label}${active > 0 ? ` (${active} active)` : ""}`}
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
        <span className="whitespace-nowrap font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
          {label}
        </span>
        <FilterFunnel
          label={label}
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
