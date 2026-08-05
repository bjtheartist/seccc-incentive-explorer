"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { clerkRecordsUrl, cookViewerUrl } from "@/lib/cook-viewer";
import {
  OWNER_SECTOR_COLORS,
  OWNER_SECTOR_LABELS,
  OWNER_SECTOR_ORDER,
  type OwnerSector,
} from "@/lib/owner-sector";
import {
  OWNER_STRUCTURE_COLORS,
  OWNER_STRUCTURE_LABELS,
  OWNER_STRUCTURE_ORDER,
  type OwnerStructure,
} from "@/lib/owner-taxonomy";
import {
  CANDIDATE_DISTRESS_LABELS,
  CANDIDATE_DISTRESS_VALUES,
  EPA_WALKABILITY_CATEGORIES,
  EPA_WALKABILITY_CATEGORY_LABELS,
  FOOTPRINT_PUBLICATION_LABELS,
  SITE_MATCHMAKER_PROPERTY_TYPE_LABELS,
  SITE_MATCHMAKER_SOURCE_LABELS,
  SITE_MATCHMAKER_SOURCES,
  ZONING_NOT_MAPPED,
  ZONING_NOT_PUBLISHED,
  candidateAddressLabel,
  candidateDistressStatuses,
  candidateFlagLabels,
  candidateFootprintLabel,
  candidateIncentiveGeographyLabel,
  candidatePinLabel,
  candidateRowsToCsv,
  candidateZoningFilterLabel,
  candidateZoningFilterValue,
  candidateZoningLabel,
  epaWalkabilityCategory,
  filterAndSortCandidateRows,
  joinCandidateContext,
  normalizeSiteMatchmakerCandidates,
  parseSiteMatchmakerContextPayload,
  type CandidateDistressStatus,
  type CandidateSort,
  type EpaWalkabilityCategory,
  type FootprintPublication,
  type ParsedSiteMatchmakerContext,
  type SiteMatchmakerCandidateFilters,
  type SiteMatchmakerCandidateRow,
  type SiteMatchmakerSource,
} from "@/lib/site-matchmaker-results";
// Type-only: lib/vacancy-index includes a node:fs-backed loader at runtime.
import type {
  VacancyLandPoint,
  VacancyPropertyType,
  VacancySitePoint,
} from "@/lib/vacancy-index";

const PAGE_SIZE = 100;

interface SiteMatchmakerResultsTableProps {
  sitePoints: VacancySitePoint[];
  landPoints?: VacancyLandPoint[] | null;
  zip: string;
  neighborhood: string;
}

interface FilterOption {
  value: string;
  label: string;
  count: number;
}

type ContextLoadState =
  | { status: "loading" }
  | {
      status: "available";
      generatedAt: string;
      sourceNotes: string[];
      contextByKey: ParsedSiteMatchmakerContext["contextByKey"];
    }
  | { status: "unavailable" };

function numericFilter(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMiles(value: number): string {
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`;
}

function formatSnapshotDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function contextPlaceholder(
  status: ContextLoadState["status"],
  hasContext: boolean,
): string | null {
  if (status === "loading") return "Loading context...";
  if (status === "unavailable") return "Context unavailable";
  return hasContext ? null : "Not mapped for this location";
}

export function SiteMatchmakerContextNotice({
  status,
  matchedCount = 0,
  totalCount = 0,
}: {
  status: ContextLoadState["status"];
  matchedCount?: number;
  totalCount?: number;
}) {
  if (status === "loading") {
    return <p>Loading Census, EPA, and proximity context...</p>;
  }
  if (status === "unavailable") {
    return (
      <p>
        Location context is temporarily unavailable. Candidate records and non-context filters still
        work.
      </p>
    );
  }
  return (
    <p>
      Context matched for {matchedCount.toLocaleString("en-US")} of {totalCount.toLocaleString("en-US")} candidate records.
    </p>
  );
}

function selectedSet<T extends string>(value: T | ""): ReadonlySet<T> {
  return value === "" ? new Set<T>() : new Set<T>([value]);
}

function countRows<T extends string>(
  rows: readonly SiteMatchmakerCandidateRow[],
  valueForRow: (row: SiteMatchmakerCandidateRow) => T,
): Map<T, number> {
  const counts = new Map<T, number>();
  for (const row of rows) {
    const value = valueForRow(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function SelectFilter({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly FilterOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/50">
        {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-0 border border-[#0C1B33]/15 bg-white px-2.5 py-2 text-[12px] text-[#0C1B33] outline-none focus:border-[#2563EB] disabled:cursor-not-allowed disabled:bg-[#F7F8FA]"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} ({option.count.toLocaleString("en-US")})
          </option>
        ))}
      </select>
    </label>
  );
}

function NumericFilter({
  label,
  value,
  placeholder,
  suffix,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  suffix: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/50">
        {label}
      </span>
      <span className="flex min-w-0 border border-[#0C1B33]/15 bg-white focus-within:border-[#2563EB]">
        <input
          type="number"
          min="0"
          step="0.1"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-[12px] text-[#0C1B33] outline-none placeholder:text-[#0C1B33]/30 disabled:cursor-not-allowed disabled:bg-[#F7F8FA]"
        />
        <span className="flex flex-shrink-0 items-center border-l border-[#0C1B33]/10 px-2 font-mono-bureau text-[8px] uppercase text-[#0C1B33]/42">
          {suffix}
        </span>
      </span>
    </label>
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: CandidateSort["direction"] }) {
  if (!active) return <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5" />;
  return direction === "asc" ? (
    <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
  ) : (
    <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
  );
}

function SourceBadge({ source }: { source: SiteMatchmakerSource }) {
  return (
    <span className="inline-flex border border-[#0C1B33]/15 bg-[#F7F8FA] px-1.5 py-0.5 font-mono-bureau text-[9px] uppercase tracking-[0.05em] text-[#0C1B33]/65">
      {SITE_MATCHMAKER_SOURCE_LABELS[source]}
    </span>
  );
}

function OwnershipValue({ row }: { row: SiteMatchmakerCandidateRow }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[#0C1B33]/75">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: OWNER_SECTOR_COLORS[row.ownerSector] }}
      />
      {OWNER_SECTOR_LABELS[row.ownerSector]}
    </span>
  );
}

function OwnerTypeValue({ row }: { row: SiteMatchmakerCandidateRow }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[#0C1B33]/75">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: OWNER_STRUCTURE_COLORS[row.ownerStructure] }}
      />
      {OWNER_STRUCTURE_LABELS[row.ownerStructure]}
    </span>
  );
}

function FlagValues({ row }: { row: SiteMatchmakerCandidateRow }) {
  const statuses = candidateDistressStatuses(row);
  return (
    <div className="flex flex-wrap gap-1">
      {statuses.includes("tax_sale") && (
        <span className="bg-[#DC2626] px-1.5 py-0.5 font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.05em] text-white">
          Tax sale {row.saleYear}
        </span>
      )}
      {statuses.includes("violation") && (
        <span className="border border-[#DC2626] px-1.5 py-0.5 font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.05em] text-[#DC2626]">
          Violation
        </span>
      )}
      {statuses.includes("none") && (
        <span className="font-mono-bureau text-[10px] text-[#0C1B33]/40">No mapped flags</span>
      )}
      {row.violation === null && (
        <span className="block w-full text-[10px] leading-snug text-[#0C1B33]/45">
          Building violations: Not mapped in this source
        </span>
      )}
    </div>
  );
}

function PopulationDensityValue({
  row,
  status,
}: {
  row: SiteMatchmakerCandidateRow;
  status: ContextLoadState["status"];
}) {
  const placeholder = contextPlaceholder(status, row.context !== null);
  if (placeholder) return <span className="text-[10px] text-[#0C1B33]/42">{placeholder}</span>;
  const density = row.context!.populationDensityPerSqMi;
  const population = row.context!.population;
  return (
    <div>
      <p className="whitespace-nowrap text-[11px] font-medium text-[#0C1B33]">
        {density === null ? "Not published" : `${formatNumber(density)} people/sq mi`}
      </p>
      <p className="mt-0.5 text-[10px] text-[#0C1B33]/48">
        Tract population {population === null ? "not published" : formatNumber(population)}
      </p>
    </div>
  );
}

function WalkabilityValue({
  row,
  status,
}: {
  row: SiteMatchmakerCandidateRow;
  status: ContextLoadState["status"];
}) {
  const index = row.context?.walkabilityIndex ?? null;
  const placeholder = contextPlaceholder(
    status,
    index !== null,
  );
  if (placeholder) return <span className="text-[10px] text-[#0C1B33]/42">{placeholder}</span>;
  return (
    <div>
      <p className="whitespace-nowrap text-[11px] font-medium text-[#0C1B33]">
        {index!.toLocaleString("en-US", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })} / 20
      </p>
      <p className="mt-0.5 text-[10px] text-[#0C1B33]/48">EPA National Walkability Index</p>
    </div>
  );
}

function ExpresswayValue({
  row,
  status,
}: {
  row: SiteMatchmakerCandidateRow;
  status: ContextLoadState["status"];
}) {
  const expresswayName = row.context?.nearestExpresswayName ?? null;
  const expresswayMiles = row.context?.nearestExpresswayMiles ?? null;
  const placeholder = contextPlaceholder(
    status,
    expresswayName !== null && expresswayMiles !== null,
  );
  if (placeholder) return <span className="text-[10px] text-[#0C1B33]/42">{placeholder}</span>;
  return (
    <div>
      <p className="text-[11px] font-medium text-[#0C1B33]">
        {expresswayName}
      </p>
      <p className="mt-0.5 whitespace-nowrap text-[10px] text-[#0C1B33]/48">
        {formatMiles(expresswayMiles!)} straight-line
      </p>
    </div>
  );
}

function AirportValue({
  row,
  status,
}: {
  row: SiteMatchmakerCandidateRow;
  status: ContextLoadState["status"];
}) {
  const placeholder = contextPlaceholder(status, row.context !== null);
  if (placeholder) return <span className="text-[10px] text-[#0C1B33]/42">{placeholder}</span>;
  return (
    <div className="space-y-0.5 text-[10px] text-[#0C1B33]/65">
      <p className="whitespace-nowrap"><span className="font-medium text-[#0C1B33]">Midway</span> {formatMiles(row.context!.midwayMiles)}</p>
      <p className="whitespace-nowrap"><span className="font-medium text-[#0C1B33]">O&apos;Hare</span> {formatMiles(row.context!.ohareMiles)}</p>
      <p className="text-[9px] text-[#0C1B33]/42">Straight-line</p>
    </div>
  );
}

function VerificationLinks({ row }: { row: SiteMatchmakerCandidateRow }) {
  const parcelUrl = cookViewerUrl(row.pin);
  const recordsUrl = clerkRecordsUrl(row.pin);
  if (parcelUrl === null || recordsUrl === null) {
    return <span className="text-[11px] text-[#0C1B33]/45">Needs verification</span>;
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono-bureau text-[9px] uppercase tracking-[0.05em]">
      <a
        href={parcelUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[#2563EB] hover:underline"
      >
        Parcel record
        <ExternalLink aria-hidden="true" className="h-3 w-3" />
      </a>
      <a
        href={recordsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[#2563EB] hover:underline"
      >
        Recorded documents
        <ExternalLink aria-hidden="true" className="h-3 w-3" />
      </a>
    </div>
  );
}

export default function SiteMatchmakerResultsTable({
  sitePoints,
  landPoints = null,
  zip,
  neighborhood,
}: SiteMatchmakerResultsTableProps) {
  const baseRows = useMemo(
    () => normalizeSiteMatchmakerCandidates(sitePoints, landPoints),
    [sitePoints, landPoints],
  );
  const [contextLoad, setContextLoad] = useState<ContextLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch(`/data/site-matchmaker-context/${encodeURIComponent(zip)}.json`, {
      cache: "force-cache",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Context request failed (${response.status})`);
        const payload: unknown = await response.json();
        const parsed = parseSiteMatchmakerContextPayload(payload, zip);
        if (parsed === null) throw new Error("Context snapshot did not match the expected schema");
        if (!cancelled) {
          setContextLoad({
            status: "available",
            generatedAt: parsed.generatedAt,
            sourceNotes: parsed.sourceNotes,
            contextByKey: parsed.contextByKey,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setContextLoad({ status: "unavailable" });
      });

    return () => {
      cancelled = true;
    };
  }, [zip]);

  const rows = useMemo(
    () =>
      contextLoad.status === "available"
        ? joinCandidateContext(baseRows, contextLoad.contextByKey)
        : baseRows,
    [baseRows, contextLoad],
  );

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SiteMatchmakerSource | "">("");
  const [propertyTypeFilter, setPropertyTypeFilter] = useState<VacancyPropertyType | "">("");
  const [footprintFilter, setFootprintFilter] = useState<FootprintPublication | "">("");
  const [ownerSectorFilter, setOwnerSectorFilter] = useState<OwnerSector | "">("");
  const [ownerStructureFilter, setOwnerStructureFilter] = useState<OwnerStructure | "">("");
  const [zoningFilter, setZoningFilter] = useState("");
  const [distressFilter, setDistressFilter] = useState<CandidateDistressStatus | "">("");
  const [minimumDensityFilter, setMinimumDensityFilter] = useState("");
  const [walkabilityFilter, setWalkabilityFilter] = useState<EpaWalkabilityCategory | "">("");
  const [maximumExpresswayFilter, setMaximumExpresswayFilter] = useState("");
  const [maximumAirportFilter, setMaximumAirportFilter] = useState("");
  const [sort, setSort] = useState<CandidateSort>({ key: "address", direction: "asc" });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filters = useMemo<SiteMatchmakerCandidateFilters>(
    () => ({
      search,
      sources: selectedSet(sourceFilter),
      propertyTypes: selectedSet(propertyTypeFilter),
      footprintPublication: selectedSet(footprintFilter),
      ownerSectors: selectedSet(ownerSectorFilter),
      ownerStructures: selectedSet(ownerStructureFilter),
      zoning: selectedSet(zoningFilter),
      distress: selectedSet(distressFilter),
      minimumPopulationDensity: numericFilter(minimumDensityFilter),
      walkabilityCategories: selectedSet(walkabilityFilter),
      maximumExpresswayMiles: numericFilter(maximumExpresswayFilter),
      maximumNearestAirportMiles: numericFilter(maximumAirportFilter),
    }),
    [
      distressFilter,
      footprintFilter,
      ownerSectorFilter,
      ownerStructureFilter,
      propertyTypeFilter,
      search,
      sourceFilter,
      zoningFilter,
      minimumDensityFilter,
      walkabilityFilter,
      maximumExpresswayFilter,
      maximumAirportFilter,
    ],
  );

  const filteredRows = useMemo(
    () => filterAndSortCandidateRows(rows, filters, sort),
    [filters, rows, sort],
  );

  const visibleRows = filteredRows.slice(0, visibleCount);
  const shownCount = visibleRows.length;

  const sourceCounts = useMemo(() => countRows(rows, (row) => row.source), [rows]);
  const propertyTypeCounts = useMemo(() => countRows(rows, (row) => row.propertyType), [rows]);
  const footprintCounts = useMemo(
    () => countRows(rows, (row) => (row.squareFeet === null ? "not_published" : "published")),
    [rows],
  );
  const ownerSectorCounts = useMemo(() => countRows(rows, (row) => row.ownerSector), [rows]);
  const ownerStructureCounts = useMemo(
    () => countRows(rows, (row) => row.ownerStructure),
    [rows],
  );
  const zoningCounts = useMemo(() => countRows(rows, candidateZoningFilterValue), [rows]);
  const distressCounts = useMemo(() => {
    const counts = new Map<CandidateDistressStatus, number>();
    for (const row of rows) {
      for (const status of candidateDistressStatuses(row)) {
        counts.set(status, (counts.get(status) ?? 0) + 1);
      }
    }
    return counts;
  }, [rows]);
  const walkabilityCounts = useMemo(() => {
    const counts = new Map<EpaWalkabilityCategory, number>();
    for (const row of rows) {
      const category = epaWalkabilityCategory(row.context?.walkabilityIndex);
      if (category !== null) counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return counts;
  }, [rows]);
  const contextMatchedCount = useMemo(
    () => rows.reduce((count, row) => count + (row.context === null ? 0 : 1), 0),
    [rows],
  );

  const zoningOptions = useMemo(() => {
    const codes = [...zoningCounts.keys()]
      .filter((value) => value !== ZONING_NOT_PUBLISHED && value !== ZONING_NOT_MAPPED)
      .sort((a, b) => candidateZoningFilterLabel(a).localeCompare(candidateZoningFilterLabel(b)));
    for (const status of [ZONING_NOT_PUBLISHED, ZONING_NOT_MAPPED]) {
      if (zoningCounts.has(status)) codes.push(status);
    }
    return codes.map((value) => ({
      value,
      label: candidateZoningFilterLabel(value),
      count: zoningCounts.get(value) ?? 0,
    }));
  }, [zoningCounts]);

  const anyFilterActive =
    search.trim().length > 0 ||
    sourceFilter !== "" ||
    propertyTypeFilter !== "" ||
    footprintFilter !== "" ||
    ownerSectorFilter !== "" ||
    ownerStructureFilter !== "" ||
    zoningFilter !== "" ||
    distressFilter !== "" ||
    minimumDensityFilter !== "" ||
    walkabilityFilter !== "" ||
    maximumExpresswayFilter !== "" ||
    maximumAirportFilter !== "";
  const contextFiltersDisabled = contextLoad.status !== "available";

  function resetFilters() {
    setSearch("");
    setSourceFilter("");
    setPropertyTypeFilter("");
    setFootprintFilter("");
    setOwnerSectorFilter("");
    setOwnerStructureFilter("");
    setZoningFilter("");
    setDistressFilter("");
    setMinimumDensityFilter("");
    setWalkabilityFilter("");
    setMaximumExpresswayFilter("");
    setMaximumAirportFilter("");
    setVisibleCount(PAGE_SIZE);
  }

  function toggleSort(key: CandidateSort["key"]) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
    setVisibleCount(PAGE_SIZE);
  }

  function resetPagination() {
    setVisibleCount(PAGE_SIZE);
  }

  function downloadCsv() {
    const csv = candidateRowsToCsv(
      filteredRows,
      contextLoad.status === "available" ? "available" : contextLoad.status,
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `site-matchmaker-${zip}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      aria-labelledby="site-matchmaker-results-heading"
      data-testid="site-matchmaker-results-table"
      className="min-w-0 max-w-full"
    >
      <div className="border-y border-[#0C1B33]/12 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#2563EB]">
              Site Matchmaker candidates
            </p>
            <h2
              id="site-matchmaker-results-heading"
              className="mt-1 text-[20px] font-semibold text-[#0C1B33]"
            >
              {neighborhood} property comparison
            </h2>
            <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-[#0C1B33]/60">
              Public records for comparison, not a statement that a property is available or
              suitable. Verify current status, ownership, and site conditions before acting.
            </p>
          </div>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={contextLoad.status === "loading"}
            className="inline-flex flex-shrink-0 items-center gap-2 border border-[#0C1B33] bg-[#0C1B33] px-3 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-white hover:bg-[#2563EB] disabled:cursor-wait disabled:opacity-50"
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            {contextLoad.status === "loading"
              ? "Preparing CSV"
              : `Download CSV (${filteredRows.length.toLocaleString("en-US")})`}
          </button>
        </div>

        <div className="mt-5 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="min-w-0 sm:col-span-2">
            <span className="mb-1 block font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/50">
              Address or PIN
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetPagination();
              }}
              placeholder="Search address or parcel PIN"
              className="w-full min-w-0 border border-[#0C1B33]/15 bg-white px-3 py-2 text-[12px] text-[#0C1B33] outline-none placeholder:text-[#0C1B33]/35 focus:border-[#2563EB]"
            />
          </label>
          <SelectFilter
            label="Source view"
            value={sourceFilter}
            onChange={(value) => {
              setSourceFilter(value as SiteMatchmakerSource | "");
              resetPagination();
            }}
            options={SITE_MATCHMAKER_SOURCES.filter((value) => sourceCounts.has(value)).map(
              (value) => ({
                value,
                label: SITE_MATCHMAKER_SOURCE_LABELS[value],
                count: sourceCounts.get(value) ?? 0,
              }),
            )}
          />
          <SelectFilter
            label="Property type"
            value={propertyTypeFilter}
            onChange={(value) => {
              setPropertyTypeFilter(value as VacancyPropertyType | "");
              resetPagination();
            }}
            options={(Object.keys(SITE_MATCHMAKER_PROPERTY_TYPE_LABELS) as VacancyPropertyType[])
              .filter((value) => propertyTypeCounts.has(value))
              .map((value) => ({
                value,
                label: SITE_MATCHMAKER_PROPERTY_TYPE_LABELS[value],
                count: propertyTypeCounts.get(value) ?? 0,
              }))}
          />
          <SelectFilter
            label="Footprint record"
            value={footprintFilter}
            onChange={(value) => {
              setFootprintFilter(value as FootprintPublication | "");
              resetPagination();
            }}
            options={(["published", "not_published"] as FootprintPublication[])
              .filter((value) => footprintCounts.has(value))
              .map((value) => ({
                value,
                label: FOOTPRINT_PUBLICATION_LABELS[value],
                count: footprintCounts.get(value) ?? 0,
              }))}
          />
          <SelectFilter
            label="Owner classification"
            value={ownerSectorFilter}
            onChange={(value) => {
              setOwnerSectorFilter(value as OwnerSector | "");
              resetPagination();
            }}
            options={OWNER_SECTOR_ORDER.filter((value) => ownerSectorCounts.has(value)).map(
              (value) => ({
                value,
                label: OWNER_SECTOR_LABELS[value],
                count: ownerSectorCounts.get(value) ?? 0,
              }),
            )}
          />
          <SelectFilter
            label="Owner type"
            value={ownerStructureFilter}
            onChange={(value) => {
              setOwnerStructureFilter(value as OwnerStructure | "");
              resetPagination();
            }}
            options={OWNER_STRUCTURE_ORDER.filter((value) => ownerStructureCounts.has(value)).map(
              (value) => ({
                value,
                label: OWNER_STRUCTURE_LABELS[value],
                count: ownerStructureCounts.get(value) ?? 0,
              }),
            )}
          />
          <SelectFilter
            label="Zoning"
            value={zoningFilter}
            onChange={(value) => {
              setZoningFilter(value);
              resetPagination();
            }}
            options={zoningOptions}
          />
          <SelectFilter
            label="Distress status"
            value={distressFilter}
            onChange={(value) => {
              setDistressFilter(value as CandidateDistressStatus | "");
              resetPagination();
            }}
            options={CANDIDATE_DISTRESS_VALUES.filter((value) => distressCounts.has(value)).map(
              (value) => ({
                value,
                label: CANDIDATE_DISTRESS_LABELS[value],
                count: distressCounts.get(value) ?? 0,
              }),
            )}
          />
          <NumericFilter
            label="Minimum population density"
            value={minimumDensityFilter}
            placeholder="5,000"
            suffix="people/sq mi"
            disabled={contextFiltersDisabled}
            onChange={(value) => {
              setMinimumDensityFilter(value);
              resetPagination();
            }}
          />
          <SelectFilter
            label="EPA walkability category"
            value={walkabilityFilter}
            disabled={contextFiltersDisabled}
            onChange={(value) => {
              setWalkabilityFilter(value as EpaWalkabilityCategory | "");
              resetPagination();
            }}
            options={EPA_WALKABILITY_CATEGORIES.map((value) => ({
              value,
              label: EPA_WALKABILITY_CATEGORY_LABELS[value],
              count: walkabilityCounts.get(value) ?? 0,
            }))}
          />
          <NumericFilter
            label="Maximum expressway distance"
            value={maximumExpresswayFilter}
            placeholder="2.0"
            suffix="miles"
            disabled={contextFiltersDisabled}
            onChange={(value) => {
              setMaximumExpresswayFilter(value);
              resetPagination();
            }}
          />
          <NumericFilter
            label="Maximum distance to nearest airport"
            value={maximumAirportFilter}
            placeholder="10.0"
            suffix="miles"
            disabled={contextFiltersDisabled}
            onChange={(value) => {
              setMaximumAirportFilter(value);
              resetPagination();
            }}
          />
        </div>

        <div
          id="site-matchmaker-context-status"
          aria-live="polite"
          className={`mt-3 border-l-2 px-3 py-2 text-[11px] leading-relaxed ${
            contextLoad.status === "unavailable"
              ? "border-[#DC2626]/55 bg-[#DC2626]/5 text-[#0C1B33]/68"
              : "border-[#2563EB]/55 bg-[#2563EB]/5 text-[#0C1B33]/62"
          }`}
        >
          <SiteMatchmakerContextNotice
            status={contextLoad.status}
            matchedCount={contextMatchedCount}
            totalCount={rows.length}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#0C1B33]/8 pt-3">
          <p aria-live="polite" className="text-[12px] text-[#0C1B33]/65">
            <span className="font-semibold text-[#0C1B33]">
              {filteredRows.length.toLocaleString("en-US")}
            </span>{" "}
            of {rows.length.toLocaleString("en-US")} candidate records
          </p>
          <button
            type="button"
            onClick={resetFilters}
            disabled={!anyFilterActive}
            className="inline-flex items-center gap-1.5 border border-[#0C1B33]/20 bg-white px-3 py-1.5 font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/65 hover:border-[#DC2626]/45 hover:text-[#DC2626] disabled:cursor-not-allowed disabled:opacity-35"
          >
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
            Reset filters
          </button>
        </div>
      </div>

      <div className="mt-4 hidden max-w-full overflow-x-auto border border-[#0C1B33]/10 bg-white sm:block">
        <table className="w-full min-w-[1980px] border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-[#0C1B33]/10 font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/48">
              <th className="w-10 px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Source view</th>
              <th className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleSort("address")}
                  aria-label={`Sort address ${sort.key === "address" && sort.direction === "asc" ? "descending" : "ascending"}`}
                  className="inline-flex items-center gap-1 font-mono-bureau text-[9px] uppercase tracking-[0.08em] hover:text-[#2563EB]"
                >
                  Address
                  <SortIcon active={sort.key === "address"} direction={sort.direction} />
                </button>
              </th>
              <th className="px-3 py-2.5">Property type</th>
              <th className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleSort("footprint")}
                  aria-label={`Sort published footprint ${sort.key === "footprint" && sort.direction === "asc" ? "descending" : "ascending"}`}
                  className="inline-flex items-center gap-1 font-mono-bureau text-[9px] uppercase tracking-[0.08em] hover:text-[#2563EB]"
                >
                  Footprint
                  <SortIcon active={sort.key === "footprint"} direction={sort.direction} />
                </button>
              </th>
              <th className="px-3 py-2.5">Owner classification</th>
              <th className="px-3 py-2.5">Owner type</th>
              <th className="px-3 py-2.5">Zoning</th>
              <th className="px-3 py-2.5">Incentive geographies</th>
              <th className="px-3 py-2.5">Source-backed flags</th>
              <th className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleSort("population_density")}
                  aria-label={`Sort population density ${sort.key === "population_density" && sort.direction === "asc" ? "descending" : "ascending"}`}
                  className="inline-flex items-center gap-1 font-mono-bureau text-[9px] uppercase tracking-[0.08em] hover:text-[#2563EB]"
                >
                  Population density
                  <SortIcon active={sort.key === "population_density"} direction={sort.direction} />
                </button>
              </th>
              <th className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleSort("walkability")}
                  aria-label={`Sort EPA Walkability Index ${sort.key === "walkability" && sort.direction === "asc" ? "descending" : "ascending"}`}
                  className="inline-flex items-center gap-1 font-mono-bureau text-[9px] uppercase tracking-[0.08em] hover:text-[#2563EB]"
                >
                  EPA Walkability Index
                  <SortIcon active={sort.key === "walkability"} direction={sort.direction} />
                </button>
              </th>
              <th className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleSort("expressway_distance")}
                  aria-label={`Sort expressway distance ${sort.key === "expressway_distance" && sort.direction === "asc" ? "descending" : "ascending"}`}
                  className="inline-flex items-center gap-1 font-mono-bureau text-[9px] uppercase tracking-[0.08em] hover:text-[#2563EB]"
                >
                  Nearest expressway
                  <SortIcon active={sort.key === "expressway_distance"} direction={sort.direction} />
                </button>
              </th>
              <th className="px-3 py-2.5">
                <span className="block">Airport proximity</span>
                <span className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("midway_distance")}
                    aria-label={`Sort Midway distance ${sort.key === "midway_distance" && sort.direction === "asc" ? "descending" : "ascending"}`}
                    className="inline-flex items-center gap-0.5 font-mono-bureau text-[8px] uppercase hover:text-[#2563EB]"
                  >
                    Midway
                    <SortIcon active={sort.key === "midway_distance"} direction={sort.direction} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSort("ohare_distance")}
                    aria-label={`Sort O'Hare distance ${sort.key === "ohare_distance" && sort.direction === "asc" ? "descending" : "ascending"}`}
                    className="inline-flex items-center gap-0.5 font-mono-bureau text-[8px] uppercase hover:text-[#2563EB]"
                  >
                    O&apos;Hare
                    <SortIcon active={sort.key === "ohare_distance"} direction={sort.direction} />
                  </button>
                </span>
              </th>
              <th className="px-3 py-2.5">Verify</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={15} className="px-4 py-10 text-center text-[13px] text-[#0C1B33]/45">
                  No candidate records match the current filters.
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => (
                <tr key={row.id} className="border-b border-[#0C1B33]/6 align-top">
                  <td className="px-3 py-2.5 font-mono-bureau text-[10px] text-[#0C1B33]/38">
                    {(index + 1).toLocaleString("en-US")}
                  </td>
                  <td className="px-3 py-2.5">
                    <SourceBadge source={row.source} />
                  </td>
                  <td className="max-w-[230px] px-3 py-2.5">
                    <p className="text-[12px] font-medium text-[#0C1B33]">
                      {candidateAddressLabel(row)}
                    </p>
                    <p className="mt-0.5 font-mono-bureau text-[9px] text-[#0C1B33]/45">
                      PIN {candidatePinLabel(row)}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-[#0C1B33]/70">
                    {SITE_MATCHMAKER_PROPERTY_TYPE_LABELS[row.propertyType]}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono-bureau text-[10px] text-[#0C1B33]/70">
                    {candidateFootprintLabel(row)}
                  </td>
                  <td className="px-3 py-2.5">
                    <OwnershipValue row={row} />
                  </td>
                  <td className="px-3 py-2.5">
                    <OwnerTypeValue row={row} />
                  </td>
                  <td className="max-w-[150px] px-3 py-2.5 text-[11px] text-[#0C1B33]/65">
                    {candidateZoningLabel(row)}
                  </td>
                  <td className="max-w-[150px] px-3 py-2.5 text-[11px] text-[#0C1B33]/65">
                    {candidateIncentiveGeographyLabel(row)}
                  </td>
                  <td className="max-w-[210px] px-3 py-2.5">
                    <FlagValues row={row} />
                  </td>
                  <td className="max-w-[190px] px-3 py-2.5">
                    <PopulationDensityValue row={row} status={contextLoad.status} />
                  </td>
                  <td className="max-w-[175px] px-3 py-2.5">
                    <WalkabilityValue row={row} status={contextLoad.status} />
                  </td>
                  <td className="max-w-[190px] px-3 py-2.5">
                    <ExpresswayValue row={row} status={contextLoad.status} />
                  </td>
                  <td className="max-w-[170px] px-3 py-2.5">
                    <AirportValue row={row} status={contextLoad.status} />
                  </td>
                  <td className="max-w-[190px] px-3 py-2.5">
                    <VerificationLinks row={row} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid min-w-0 gap-2 sm:hidden">
        {visibleRows.length === 0 ? (
          <div className="border border-[#0C1B33]/10 bg-white px-4 py-8 text-center text-[13px] text-[#0C1B33]/45">
            No candidate records match the current filters.
          </div>
        ) : (
          visibleRows.map((row) => (
            <article key={row.id} className="min-w-0 border border-[#0C1B33]/12 bg-white p-3.5">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <SourceBadge source={row.source} />
                  <h3 className="mt-2 break-words text-[14px] font-semibold text-[#0C1B33]">
                    {candidateAddressLabel(row)}
                  </h3>
                  <p className="mt-0.5 break-all font-mono-bureau text-[9px] text-[#0C1B33]/45">
                    PIN {candidatePinLabel(row)}
                  </p>
                </div>
                <span className="flex-shrink-0 font-mono-bureau text-[9px] uppercase tracking-[0.05em] text-[#0C1B33]/50">
                  {SITE_MATCHMAKER_PROPERTY_TYPE_LABELS[row.propertyType]}
                </span>
              </div>

              <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 border-y border-[#0C1B33]/8 py-3">
                <div className="min-w-0">
                  <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/42">
                    Footprint
                  </dt>
                  <dd className="mt-0.5 break-words text-[11px] text-[#0C1B33]/72">
                    {candidateFootprintLabel(row)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/42">
                    Zoning
                  </dt>
                  <dd className="mt-0.5 break-words text-[11px] text-[#0C1B33]/72">
                    {candidateZoningLabel(row)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/42">
                    Owner classification
                  </dt>
                  <dd className="mt-0.5">
                    <OwnershipValue row={row} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/42">
                    Owner type
                  </dt>
                  <dd className="mt-0.5">
                    <OwnerTypeValue row={row} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/42">
                    Incentive geographies
                  </dt>
                  <dd className="mt-0.5 break-words text-[11px] text-[#0C1B33]/72">
                    {candidateIncentiveGeographyLabel(row)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/42">
                    Flags
                  </dt>
                  <dd className="mt-0.5 text-[11px] text-[#0C1B33]/72">
                    {candidateFlagLabels(row).join("; ")}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/42">
                    Population density
                  </dt>
                  <dd className="mt-0.5">
                    <PopulationDensityValue row={row} status={contextLoad.status} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/42">
                    EPA Walkability Index
                  </dt>
                  <dd className="mt-0.5">
                    <WalkabilityValue row={row} status={contextLoad.status} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/42">
                    Nearest expressway
                  </dt>
                  <dd className="mt-0.5">
                    <ExpresswayValue row={row} status={contextLoad.status} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/42">
                    Airport proximity
                  </dt>
                  <dd className="mt-0.5">
                    <AirportValue row={row} status={contextLoad.status} />
                  </dd>
                </div>
              </dl>
              <div className="mt-3">
                <VerificationLinks row={row} />
              </div>
            </article>
          ))
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
          Showing {shownCount.toLocaleString("en-US")} of {filteredRows.length.toLocaleString("en-US")} filtered records
        </p>
        {shownCount < filteredRows.length && (
          <button
            type="button"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            className="border border-[#2563EB] bg-white px-4 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#2563EB] hover:bg-[#2563EB] hover:text-white"
          >
            Load 100 more
          </button>
        )}
      </div>

      <div className="mt-5 border-t border-[#0C1B33]/10 pt-4 text-[10px] leading-relaxed text-[#0C1B33]/50">
        <p>
          Population and density are Census tract context. Walkability is the EPA National
          Walkability Index on its published 1-20 scale. Expressway and airport distances are
          straight-line proximity signals, not routed travel times. These fields describe place
          context only.
        </p>
        {contextLoad.status === "available" ? (
          <p className="mt-1.5 font-mono-bureau text-[8px] uppercase tracking-[0.06em]">
            Context snapshot {formatSnapshotDate(contextLoad.generatedAt)}
            {contextLoad.sourceNotes.length > 0
              ? ` · Sources: ${contextLoad.sourceNotes.join(" · ")}`
              : ""}
          </p>
        ) : null}
      </div>
    </section>
  );
}
