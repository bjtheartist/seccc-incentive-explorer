"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Building2,
  ExternalLink,
  List,
  Map as MapIcon,
  MapPinned,
  Search,
  X,
} from "lucide-react";
import { OWNER_TYPE_COLORS } from "@/lib/owner-classify";
import { cookViewerUrl, clerkRecordsUrl } from "@/lib/cook-viewer";
import type { VacancyCaseRecord } from "@/lib/vacancy-cases";
import { PUBLIC_OWNER_TYPE_LABELS } from "@/lib/vacancy-public-labels";
import { siteReportHref } from "@/lib/vacancy-site-zones";
import {
  filterVacancyWorkspaceRecords,
  serializeWorkspaceBounds,
  VACANCY_WORKSPACE_URL_EVENT,
  type VacancyWorkspaceBounds,
  type VacancyWorkspaceUniverse,
  type VacancyWorkspaceView,
} from "@/lib/vacancy-workspace";
import CaseWorkspaceMapIsland from "./CaseWorkspaceMapIsland";
import { PermitEvidencePanel } from "./PermitEvidencePanel";

const PAGE_SIZE = 80;

interface CaseWorkspaceProps {
  zip: string;
  neighborhood: string;
  records: readonly VacancyCaseRecord[];
  boundary: { rings: [number, number][][]; bbox: VacancyWorkspaceBounds } | null;
  centroid: { lat: number; lon: number } | null;
  initialView: VacancyWorkspaceView;
  initialUniverse: VacancyWorkspaceUniverse;
  initialQuery: string;
  initialBounds: VacancyWorkspaceBounds | null;
}

function recordKind(record: VacancyCaseRecord): string {
  return record.universe === "land" ? "Land parcel" : "Reported building";
}

function recordEvidence(record: VacancyCaseRecord): string {
  const facts: string[] = [];
  if (record.saleYear != null) facts.push(`Tax-sale signal ${record.saleYear}`);
  if (record.violation) facts.push("Vacant-building violation");
  if (record.squareFeet != null) facts.push(`${record.squareFeet.toLocaleString("en-US")} sq ft`);
  return facts.join(" · ") || "No additional distress field on this record";
}

function ExternalAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] hover:underline"
    >
      {children}
      <ExternalLink aria-hidden="true" size={12} />
    </a>
  );
}

function SelectedRecord({ record }: { record: VacancyCaseRecord }) {
  const cookViewer = cookViewerUrl(record.pin);
  const clerk = clerkRecordsUrl(record.pin);
  const report =
    Number.isFinite(record.lat) && Number.isFinite(record.lon)
      ? siteReportHref(record.lat as number, record.lon as number, record.address)
      : null;

  return (
    <div className="border border-[#0C1B33]/12 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.13em] text-[#2563EB]">
            Selected public record
          </span>
          <h3 className="mt-2 break-words font-editorial text-[25px] leading-tight text-[#0C1B33]">
            {record.address}
          </h3>
          <p className="mt-1 text-[11px] text-[#0C1B33]/50">
            {recordKind(record)}{record.pin ? ` · PIN ${record.pin}` : " · No PIN on record"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {report ? <ExternalAction href={report}>Run site incentive report</ExternalAction> : null}
          {cookViewer ? <ExternalAction href={cookViewer}>Parcel record</ExternalAction> : null}
          {clerk ? <ExternalAction href={clerk}>Deed history</ExternalAction> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-px border border-[#0C1B33]/10 bg-[#0C1B33]/10 sm:grid-cols-3">
        <div className="bg-[#FAF9F6] p-3">
          <div className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
            Owner type
          </div>
          <div className="mt-1 flex items-center gap-2 text-[12px] font-medium text-[#0C1B33]/75">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: OWNER_TYPE_COLORS[record.ownerType] }}
            />
            {PUBLIC_OWNER_TYPE_LABELS[record.ownerType]}
          </div>
        </div>
        <div className="bg-[#FAF9F6] p-3 sm:col-span-2">
          <div className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
            Record evidence
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[#0C1B33]/70">
            {recordEvidence(record)}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <PermitEvidencePanel pin={record.pin} />
      </div>
    </div>
  );
}

export default function CaseWorkspace({
  zip,
  neighborhood,
  records,
  boundary,
  centroid,
  initialView,
  initialUniverse,
  initialQuery,
  initialBounds,
}: CaseWorkspaceProps) {
  const [view, setView] = useState(initialView);
  const [universe, setUniverse] = useState(initialUniverse);
  const [query, setQuery] = useState(initialQuery);
  const [bounds, setBounds] = useState<VacancyWorkspaceBounds | null>(initialBounds);
  const [candidateBounds, setCandidateBounds] = useState<VacancyWorkspaceBounds | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const detailRef = useRef<HTMLDivElement | null>(null);

  const updateUrl = useCallback((updates: Record<string, string | null>) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(updates)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new Event(VACANCY_WORKSPACE_URL_EVENT));
  }, []);

  const filtered = useMemo(
    () => filterVacancyWorkspaceRecords(records, { query, universe, bounds }),
    [bounds, query, records, universe],
  );
  const selected = selectedId ? filtered.find((record) => record.id === selectedId) ?? null : null;
  const mappedCount = filtered.filter(
    (record) => Number.isFinite(record.lat) && Number.isFinite(record.lon),
  ).length;
  const landCount = filtered.filter((record) => record.universe === "land").length;
  const buildingCount = filtered.length - landCount;

  function changeView(next: VacancyWorkspaceView) {
    setView(next);
    updateUrl({ view: next });
  }

  function changeUniverse(next: VacancyWorkspaceUniverse) {
    setUniverse(next);
    setVisibleCount(PAGE_SIZE);
    setSelectedId(null);
    updateUrl({ universe: next === "all" ? null : next });
  }

  function changeQuery(next: string) {
    setQuery(next);
    setVisibleCount(PAGE_SIZE);
    setSelectedId(null);
    updateUrl({ q: next.trim() || null });
  }

  function commitMapArea() {
    if (!candidateBounds) return;
    setBounds(candidateBounds);
    setCandidateBounds(null);
    setVisibleCount(PAGE_SIZE);
    setSelectedId(null);
    updateUrl({ bounds: serializeWorkspaceBounds(candidateBounds) });
  }

  function clearMapArea() {
    setBounds(null);
    setCandidateBounds(null);
    setVisibleCount(PAGE_SIZE);
    setSelectedId(null);
    updateUrl({ bounds: null });
  }

  function selectRecord(id: string) {
    setCandidateBounds(null);
    setSelectedId(id);
  }

  const activeFilters = [
    query.trim() ? `address contains “${query.trim()}”` : null,
    universe === "land" ? "land only" : universe === "building_report" ? "building reports only" : null,
    bounds ? "searched map area" : null,
  ].filter(Boolean);

  return (
    <section aria-labelledby="case-workspace-title" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#2563EB]">
            Synchronized workspace
          </span>
          <h2 id="case-workspace-title" className="mt-2 font-editorial text-[28px] leading-tight">
            Review the active case
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/50">
            One filtered public-record set across list and map, with map-area changes applied only
            on confirmation.
          </p>
        </div>
        <div className="inline-flex border border-[#0C1B33]/15 bg-white p-0.5 lg:hidden" aria-label="Workspace view">
          {(["list", "map"] as const).map((option) => {
            const Icon = option === "list" ? List : MapIcon;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => changeView(option)}
                className={`inline-flex h-9 items-center gap-1.5 px-3 text-[11px] font-medium capitalize ${
                  view === option ? "bg-[#0C1B33] text-white" : "text-[#0C1B33]/55"
                }`}
              >
                <Icon aria-hidden="true" size={14} />
                {option}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 border border-[#0C1B33]/10 bg-white p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <label className="relative block min-w-0 flex-1 xl:max-w-md">
            <span className="sr-only">Search address or PIN</span>
            <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0C1B33]/35" size={15} />
            <input
              type="search"
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              placeholder="Search address or PIN"
              className="h-10 w-full border border-[#0C1B33]/15 bg-[#FAF9F6] pl-9 pr-3 text-[12px] text-[#0C1B33] outline-none placeholder:text-[#0C1B33]/35 focus:border-[#2563EB]"
            />
          </label>
          <div className="inline-flex w-full border border-[#0C1B33]/15 p-0.5 sm:w-auto" aria-label="Property record type">
            {([
              ["all", "All"],
              ["land", "Land"],
              ["building_report", "Building reports"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={universe === value}
                onClick={() => changeUniverse(value)}
                className={`min-h-9 flex-1 px-3 text-[10px] font-medium sm:flex-none ${
                  universe === value ? "bg-[#0C1B33] text-white" : "text-[#0C1B33]/55 hover:text-[#0C1B33]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#0C1B33]/8 pt-3">
          <p className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
            {filtered.length.toLocaleString("en-US")} records · {mappedCount.toLocaleString("en-US")} mapped · {landCount.toLocaleString("en-US")} land · {buildingCount.toLocaleString("en-US")} building
          </p>
          {bounds ? (
            <button
              type="button"
              onClick={clearMapArea}
              className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[#A45B00] hover:underline"
            >
              <X aria-hidden="true" size={13} />
              Clear searched map area
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid min-h-[560px] border border-[#0C1B33]/10 bg-white lg:h-[680px] lg:grid-cols-[minmax(330px,0.82fr)_minmax(0,1.35fr)]">
        <div className={`${view === "list" ? "block" : "hidden"} min-h-0 border-[#0C1B33]/10 lg:block lg:border-r`}>
          <div className="flex items-center justify-between border-b border-[#0C1B33]/10 px-4 py-3">
            <span className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/50">
              Matching public records
            </span>
            <span className="text-[10px] text-[#0C1B33]/40">{neighborhood} · {zip}</span>
          </div>
          <div className="max-h-[620px] overflow-y-auto lg:h-[633px] lg:max-h-none">
            {filtered.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-[13px] font-medium text-[#0C1B33]">No records match the current filters.</p>
                <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/45">
                  {activeFilters.length > 0 ? `Applied: ${activeFilters.join(", ")}.` : "No public records are available for this case."}
                </p>
                {bounds ? (
                  <button type="button" onClick={clearMapArea} className="mt-4 text-[11px] font-medium text-[#2563EB] hover:underline">
                    Clear searched map area
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <ul className="divide-y divide-[#0C1B33]/8">
                  {filtered.slice(0, visibleCount).map((record) => {
                    const selectedRow = record.id === selectedId;
                    return (
                      <li key={record.id}>
                        <button
                          type="button"
                          aria-pressed={selectedRow}
                          onClick={() => selectRecord(record.id)}
                          className={`w-full px-4 py-3.5 text-left transition-colors ${
                            selectedRow ? "bg-[#EAF1FF]" : "hover:bg-[#FAF9F6]"
                          }`}
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0">
                              <span className="block break-words text-[12px] font-semibold leading-snug text-[#0C1B33]">
                                {record.address}
                              </span>
                              <span className="mt-1 block font-mono-bureau text-[9px] uppercase tracking-[0.07em] text-[#0C1B33]/45">
                                {recordKind(record)}{record.pin ? ` · ${record.pin}` : ""}
                              </span>
                            </span>
                            <span
                              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: OWNER_TYPE_COLORS[record.ownerType] }}
                              title={PUBLIC_OWNER_TYPE_LABELS[record.ownerType]}
                            />
                          </span>
                          <span className="mt-2 block text-[10px] leading-snug text-[#0C1B33]/45">
                            {recordEvidence(record)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {visibleCount < filtered.length ? (
                  <div className="border-t border-[#0C1B33]/10 p-3 text-center">
                    <button
                      type="button"
                      onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                      className="text-[11px] font-medium text-[#2563EB] hover:underline"
                    >
                      Show {Math.min(PAGE_SIZE, filtered.length - visibleCount).toLocaleString("en-US")} more
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className={`${view === "map" ? "block" : "hidden"} relative min-h-[560px] lg:block lg:min-h-0`}>
          <CaseWorkspaceMapIsland
            zip={zip}
            records={filtered}
            selectedId={selectedId}
            boundary={boundary}
            centroid={centroid}
            committedBounds={bounds}
            onSelect={selectRecord}
            onCandidateBounds={setCandidateBounds}
          />
          {candidateBounds ? (
            <button
              type="button"
              onClick={commitMapArea}
              className="absolute left-1/2 top-3 z-10 inline-flex -translate-x-1/2 items-center gap-2 border border-[#0C1B33] bg-white px-3 py-2 text-[11px] font-semibold text-[#0C1B33] shadow-sm hover:bg-[#FAF9F6]"
            >
              <MapPinned aria-hidden="true" size={14} />
              Search this area
            </button>
          ) : null}
          <div className="pointer-events-none absolute bottom-7 left-3 z-10 flex items-center gap-3 border border-[#0C1B33]/10 bg-white/95 px-2.5 py-1.5 font-mono-bureau text-[9px] uppercase tracking-[0.07em] text-[#0C1B33]/55">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#0C1B33]" /> Land</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#8A8A8A]" /> Building report</span>
          </div>
          {selected ? (
            <button
              type="button"
              onClick={() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="absolute bottom-7 right-3 z-10 max-w-[min(300px,calc(100%-24px))] border border-[#0C1B33]/15 bg-white px-3 py-2 text-left shadow-sm"
            >
              <span className="block truncate text-[11px] font-semibold text-[#0C1B33]">{selected.address}</span>
              <span className="mt-0.5 block text-[9px] uppercase tracking-[0.08em] text-[#2563EB]">Review record details ↓</span>
            </button>
          ) : null}
        </div>
      </div>

      {selected ? (
        <div ref={detailRef} className="mt-3 scroll-mt-4">
          <SelectedRecord record={selected} />
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 border border-dashed border-[#0C1B33]/15 px-4 py-3 text-[11px] text-[#0C1B33]/45">
          <Building2 aria-hidden="true" size={14} />
          Select a list row or map point to review parcel links and matched permit evidence.
        </div>
      )}
    </section>
  );
}
