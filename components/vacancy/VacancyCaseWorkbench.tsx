"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  ClipboardCheck,
  Columns3,
  Copy,
  ExternalLink,
  FileSearch,
  Landmark,
  Layers3,
  ListFilter,
  MapPinned,
  Plus,
  Search,
  ShieldQuestion,
  Trash2,
  Users,
} from "lucide-react";
import { PILOT_ZIPS } from "@/lib/pilot-zips";
import {
  buildCaseSearchParams,
  type BuilderGoal,
  type BuilderUniverse,
  type PresetId,
  type VacancyCaseArea,
  type VacancyCaseRecord,
  type VacancyWorkbenchInitialState,
  type WorkbenchMode,
} from "@/lib/vacancy-case-state";

/**
 * Case Workbench — production surface at /vacancy/[zip]/cases (all nine pilot
 * ZIPs). Started life as the app/vacancy/ux-lab/ interaction prototype;
 * VacancyCaseWorkbench is now zip-generic (no hard-coded 60617 anywhere) and
 * the URL is the single source of truth for a shared case: the address bar
 * stays in sync via history.replaceState on every state change, and the Copy
 * case link button copies the same string. Data comes from
 * lib/vacancy-cases.ts's buildCaseRecords(zip) — evidence fields only, never
 * a score/tier/portfolio rank.
 */

const OWNER_LABELS: Record<VacancyCaseRecord["ownerType"], string> = {
  city_public: "City / public",
  local_private: "Local private",
  corporate_llc: "Corporate / LLC",
  out_of_state: "Out-of-state",
  unknown: "Not yet classified",
};

const OWNER_COLORS: Record<VacancyCaseRecord["ownerType"], string> = {
  city_public: "#2563EB",
  local_private: "#159947",
  corporate_llc: "#7C3AED",
  out_of_state: "#D97706",
  unknown: "#8A93A6",
};

const PRIVATE_OWNER_TYPES = new Set<VacancyCaseRecord["ownerType"]>([
  "local_private",
  "corporate_llc",
  "out_of_state",
]);

const PRESETS: Array<{
  id: PresetId;
  label: string;
  shortLabel: string;
  description: string;
  detail: string;
  color: string;
  icon: typeof Landmark;
  match: (record: VacancyCaseRecord) => boolean;
}> = [
  {
    id: "public-land",
    label: "Public-land pathway",
    shortLabel: "Public land",
    description: "Start with land that has a public disposition pathway.",
    detail: "Vacant land classified as City or public control. Verify current status before relying.",
    color: "#2563EB",
    icon: Landmark,
    match: (record) => record.universe === "land" && record.ownerType === "city_public",
  },
  {
    id: "private-outreach",
    label: "Private-owner outreach",
    shortLabel: "Owner outreach",
    description: "Build a focused list for owner verification and outreach.",
    detail: "Known private or entity taxpayer classifications in the reconciled land universe.",
    color: "#159947",
    icon: Users,
    match: (record) => record.universe === "land" && PRIVATE_OWNER_TYPES.has(record.ownerType),
  },
  {
    id: "ownership-check",
    label: "Ownership follow-up",
    shortLabel: "Verify ownership",
    description: "Find land records that still need ownership classification.",
    detail: "Land parcels whose public taxpayer record did not resolve to a public owner category.",
    color: "#7C3AED",
    icon: ShieldQuestion,
    match: (record) => record.universe === "land" && record.ownerType === "unknown",
  },
  {
    id: "building-review",
    label: "Building condition review",
    shortLabel: "Building reports",
    description: "Review reported buildings and current-condition evidence.",
    detail: "311-reported vacant-building sites. Parcel, ownership, and active status still need verification.",
    color: "#D97706",
    icon: Building2,
    match: (record) => record.universe === "building_report",
  },
  {
    id: "tax-title",
    label: "Tax and title review",
    shortLabel: "Tax / title",
    description: "Surface land with tax-sale history for records review.",
    detail: "A historical tax-sale record on file is a reason to verify current tax and title status, not a current-status claim.",
    color: "#DC2626",
    icon: FileSearch,
    match: (record) => record.universe === "land" && record.saleYear != null,
  },
];

function matchesBuilder(
  record: VacancyCaseRecord,
  goal: BuilderGoal,
  universe: BuilderUniverse,
  taxSaleOnly: boolean,
  violationsOnly: boolean,
): boolean {
  if (universe !== "all" && record.universe !== universe) return false;
  if (goal === "public" && record.ownerType !== "city_public") return false;
  if (goal === "private" && !PRIVATE_OWNER_TYPES.has(record.ownerType)) return false;
  if (goal === "verify" && record.ownerType !== "unknown") return false;
  if (goal === "conditions" && record.universe !== "building_report") return false;
  if (taxSaleOnly && record.saleYear == null) return false;
  if (violationsOnly && !record.violation) return false;
  return true;
}

function splitCounts(records: VacancyCaseRecord[]) {
  let land = 0;
  let buildings = 0;
  for (const record of records) {
    if (record.universe === "land") land += 1;
    else buildings += 1;
  }
  return { land, buildings };
}

function parcelUrl(pin: string | null): string | null {
  if (!pin) return null;
  return `https://maps.cookcountyil.gov/cookviewer/?pin14=${encodeURIComponent(pin)}`;
}

function nextAction(record: VacancyCaseRecord): string {
  if (record.universe === "building_report") {
    return record.violation
      ? "Confirm the active condition record, then identify the parcel."
      : "Confirm active status and match the report to a parcel.";
  }
  if (record.saleYear != null && record.ownerType !== "city_public") {
    return "Review current tax and title records before outreach.";
  }
  if (record.ownerType === "city_public") {
    return "Confirm the controlling agency and disposition status.";
  }
  if (record.ownerType === "unknown") {
    return "Verify the taxpayer and deed record before outreach.";
  }
  return "Verify the record holder and prepare a focused outreach note.";
}

function displayAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\b(E|W|N|S)\b/g, (direction) => direction.toUpperCase());
}

interface VacancyCaseWorkbenchProps {
  records: VacancyCaseRecord[];
  areas: VacancyCaseArea[];
  recordsAsOf: string;
  zip: string;
  neighborhood: string;
  initialState: VacancyWorkbenchInitialState;
}

export default function VacancyCaseWorkbench({
  records,
  areas,
  recordsAsOf,
  zip,
  neighborhood,
  initialState,
}: VacancyCaseWorkbenchProps) {
  const router = useRouter();
  const [mode, setMode] = useState<WorkbenchMode>(initialState.mode);
  const [activePreset, setActivePreset] = useState<PresetId>(initialState.activePreset);
  const [goal, setGoal] = useState<BuilderGoal>(initialState.goal);
  const [universe, setUniverse] = useState<BuilderUniverse>(initialState.universe);
  const [taxSaleOnly, setTaxSaleOnly] = useState(initialState.taxSaleOnly);
  const [violationsOnly, setViolationsOnly] = useState(initialState.violationsOnly);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialState.initialSelectedIds);
  const [copied, setCopied] = useState(false);

  const activePresetDefinition = PRESETS.find((preset) => preset.id === activePreset) ?? PRESETS[0];
  const presetMatches = useMemo(
    () => records.filter(activePresetDefinition.match),
    [records, activePresetDefinition],
  );
  const builderMatches = useMemo(
    () =>
      records.filter((record) =>
        matchesBuilder(record, goal, universe, taxSaleOnly, violationsOnly),
      ),
    [records, goal, universe, taxSaleOnly, violationsOnly],
  );
  const activeMatches = mode === "builder" ? builderMatches : presetMatches;
  const activeCounts = splitCounts(activeMatches);
  const selectedRecords = selectedIds
    .map((id) => records.find((record) => record.id === id))
    .filter((record): record is VacancyCaseRecord => Boolean(record));

  function toggleSelected(record: VacancyCaseRecord) {
    setSelectedIds((current) => {
      if (current.includes(record.id)) return current.filter((id) => id !== record.id);
      if (current.length >= 3) return [...current.slice(1), record.id];
      return [...current, record.id];
    });
  }

  const currentUrlState = {
    mode,
    activePreset,
    goal,
    universe,
    taxSaleOnly,
    violationsOnly,
    selectedIds,
  };

  // Keep the address bar shareable at all times, not just after pressing
  // "Copy case link" — every state change that would change the case rewrites
  // the URL via history.replaceState (no navigation, no history-stack noise).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = buildCaseSearchParams(currentUrlState).toString();
    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}`;
    window.history.replaceState(null, "", nextUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activePreset, goal, universe, taxSaleOnly, violationsOnly, selectedIds]);

  async function copyCurrentView() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.search = buildCaseSearchParams(currentUrlState).toString();
    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function switchZip(nextZip: string) {
    if (nextZip === zip) return;
    const search = buildCaseSearchParams(currentUrlState).toString();
    router.push(`/vacancy/${nextZip}/cases${search ? `?${search}` : ""}`);
  }

  return (
    <div className="py-2 sm:py-4">
      <header className="border-b border-[#0C1B33]/10 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono-bureau text-[11px] uppercase tracking-[0.08em] text-[#0C1B33]/50">
              Vacant Sites / {neighborhood}
            </p>
            <h1 className="mt-2 font-editorial text-[36px] leading-[1.05] sm:text-[44px]">
              Case Workbench
            </h1>
          </div>
          <label className="hidden min-w-[220px] items-center gap-3 border border-[#0C1B33]/15 bg-white px-3 py-2 sm:flex">
            <MapPinned aria-hidden className="h-4 w-4 text-[#2563EB]" />
            <span className="flex-1">
              <span className="block text-[10px] font-semibold text-[#0C1B33]/55">Area</span>
              <select
                aria-label="Neighborhood"
                value={zip}
                className="w-full appearance-none bg-transparent text-[13px] font-semibold text-[#0C1B33] outline-none"
                onChange={(event) => switchZip(event.target.value)}
              >
                {PILOT_ZIPS.map((entry) => (
                  <option key={entry.zip} value={entry.zip}>
                    {entry.primaryNeighborhood} · {entry.zip}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="max-w-2xl text-[14px] leading-6 text-[#0C1B33]/70">
              Start with the decision you are trying to move forward. The same case can stay
              active across property records, nearby-site groups, and partner conversations.
            </p>
            <p className="mt-1 text-[11px] text-[#0C1B33]/45">
              {recordsAsOf ? `Public records as of ${recordsAsOf}` : "Public records not yet available"}
            </p>
          </div>
          <div className="inline-flex w-full border border-[#0C1B33]/15 bg-white p-1 sm:w-auto">
            {[
              { id: "paths" as const, label: "Quick paths", icon: Layers3 },
              { id: "builder" as const, label: "Build a case", icon: ListFilter },
              { id: "compare" as const, label: "Compare", icon: Columns3 },
            ].map((item) => {
              const Icon = item.icon;
              const selected = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id)}
                  aria-pressed={selected}
                  className={`flex min-h-10 flex-1 items-center justify-center gap-2 px-3 text-[12px] font-semibold transition-colors sm:flex-none ${
                    selected ? "bg-[#0C1B33] text-white" : "text-[#0C1B33]/55 hover:bg-[#0C1B33]/5"
                  }`}
                >
                  <Icon aria-hidden className="h-4 w-4" />
                  {item.label}
                  {item.id === "compare" && selectedIds.length > 0 && (
                    <span className={`text-[10px] ${selected ? "text-white/70" : "text-[#2563EB]"}`}>
                      {selectedIds.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {records.length === 0 ? (
        <div className="mt-8 border border-dashed border-[#0C1B33]/20 bg-white px-4 py-8 text-center">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
            No tracked records yet
          </span>
          <p className="mt-2 text-[12px] text-[#0C1B33]/45">
            This neighborhood&apos;s vacancy index has not been published yet.
          </p>
        </div>
      ) : (
        <>
          {mode === "paths" && (
            <QuickPaths
              activePreset={activePreset}
              setActivePreset={setActivePreset}
              records={records}
              matches={presetMatches}
              areas={areas}
              zip={zip}
              neighborhood={neighborhood}
              selectedIds={selectedIds}
              toggleSelected={toggleSelected}
              copyCurrentView={copyCurrentView}
              copied={copied}
            />
          )}

          {mode === "builder" && (
            <CaseBuilder
              goal={goal}
              setGoal={setGoal}
              universe={universe}
              setUniverse={setUniverse}
              taxSaleOnly={taxSaleOnly}
              setTaxSaleOnly={setTaxSaleOnly}
              violationsOnly={violationsOnly}
              setViolationsOnly={setViolationsOnly}
              matches={builderMatches}
              counts={activeCounts}
              zip={zip}
              neighborhood={neighborhood}
              selectedIds={selectedIds}
              toggleSelected={toggleSelected}
              copyCurrentView={copyCurrentView}
              copied={copied}
            />
          )}

          {mode === "compare" && (
            <ComparisonView
              selected={selectedRecords}
              records={records}
              toggleSelected={toggleSelected}
              setMode={setMode}
            />
          )}
        </>
      )}
    </div>
  );
}

function QuickPaths({
  activePreset,
  setActivePreset,
  records,
  matches,
  areas,
  zip,
  neighborhood,
  selectedIds,
  toggleSelected,
  copyCurrentView,
  copied,
}: {
  activePreset: PresetId;
  setActivePreset: (id: PresetId) => void;
  records: VacancyCaseRecord[];
  matches: VacancyCaseRecord[];
  areas: VacancyCaseArea[];
  zip: string;
  neighborhood: string;
  selectedIds: string[];
  toggleSelected: (record: VacancyCaseRecord) => void;
  copyCurrentView: () => void;
  copied: boolean;
}) {
  const active = PRESETS.find((preset) => preset.id === activePreset) ?? PRESETS[0];
  const counts = splitCounts(matches);

  return (
    <section className="pt-7">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono-bureau text-[11px] uppercase tracking-[0.08em] text-[#2563EB]">
            Choose a starting point
          </p>
          <h2 className="mt-1 text-[20px] font-semibold">What kind of work are you doing?</h2>
        </div>
        <span className="hidden text-[11px] text-[#0C1B33]/45 md:block">
          One click creates a repeatable case
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {PRESETS.map((preset) => {
          const Icon = preset.icon;
          const selected = preset.id === activePreset;
          const count = records.filter(preset.match).length;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => setActivePreset(preset.id)}
              aria-pressed={selected}
              className={`min-h-[152px] border bg-white p-4 text-left transition-colors ${
                selected
                  ? "border-[#0C1B33] shadow-[inset_0_-3px_0_#0C1B33]"
                  : "border-[#0C1B33]/15 hover:border-[#0C1B33]/40"
              }`}
            >
              <span
                className="inline-flex h-9 w-9 items-center justify-center border"
                style={{ borderColor: `${preset.color}50`, color: preset.color }}
              >
                <Icon aria-hidden className="h-4 w-4" />
              </span>
              <span className="mt-4 block text-[13px] font-semibold leading-5">{preset.label}</span>
              <span className="mt-1 block text-[11px] leading-4 text-[#0C1B33]/50">
                {count.toLocaleString("en-US")} matching records
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 border border-[#0C1B33]/15 bg-white">
        <div className="grid lg:grid-cols-[1.2fr_0.8fr]">
          <div className="border-b border-[#0C1B33]/10 p-5 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5" style={{ backgroundColor: active.color }} />
                  <p className="font-mono-bureau text-[11px] uppercase tracking-[0.08em] text-[#0C1B33]/55">
                    Active case
                  </p>
                </div>
                <h3 className="mt-2 font-editorial text-[30px] leading-tight">{active.label}</h3>
                <p className="mt-2 text-[14px] leading-6 text-[#0C1B33]/70">{active.description}</p>
                <p className="mt-2 max-w-xl text-[11px] leading-5 text-[#0C1B33]/45">{active.detail}</p>
              </div>
              <button
                type="button"
                onClick={copyCurrentView}
                className="inline-flex min-h-10 items-center gap-2 border border-[#0C1B33]/15 px-3 text-[12px] font-semibold text-[#0C1B33]/70 hover:border-[#2563EB] hover:text-[#2563EB]"
              >
                {copied ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
                {copied ? "Link copied" : "Copy case link"}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-[#0C1B33]/10 bg-[#0C1B33]/5">
            <CountCell value={counts.land} label="Land parcels" />
            <CountCell value={counts.buildings} label="Building reports" />
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <GeoPreview records={matches} color={active.color} zip={zip} neighborhood={neighborhood} />
          <ResultList
            records={matches}
            selectedIds={selectedIds}
            toggleSelected={toggleSelected}
          />
        </div>
        <aside className="border-t border-[#0C1B33]/15 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono-bureau text-[11px] uppercase tracking-[0.08em] text-[#2563EB]">
                Nearby-site groups
              </p>
              <h3 className="mt-1 text-[17px] font-semibold">Opportunity areas</h3>
            </div>
            <Link
              href={`/vacancy/${zip}/areas`}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:underline"
            >
              All areas <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="mt-4 divide-y divide-[#0C1B33]/10 border-y border-[#0C1B33]/10">
            {areas.length === 0 ? (
              <p className="py-4 text-[11px] leading-4 text-[#0C1B33]/45">
                No opportunity areas surfaced yet for this neighborhood.
              </p>
            ) : (
              areas.slice(0, 4).map((area) => (
                <Link
                  key={area.id}
                  href={`/vacancy/${zip}/areas/${area.id}`}
                  className="group block py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-semibold group-hover:text-[#2563EB]">{area.name}</p>
                      <p className="mt-1 text-[11px] text-[#0C1B33]/50">
                        {area.siteCount} nearby sites
                        {area.corridor ? ` · ${area.corridor}` : ""}
                      </p>
                    </div>
                    <ArrowRight aria-hidden className="mt-0.5 h-4 w-4 text-[#0C1B33]/35 group-hover:text-[#2563EB]" />
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-[#0C1B33]/45">{area.needsChecking}</p>
                  {area.mappedCount < area.siteCount && (
                    <p className="mt-2 text-[10px] font-semibold text-[#A45B00]">
                      Detailed facts cover {area.mappedCount} of {area.siteCount} mapped members
                    </p>
                  )}
                </Link>
              ))
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function CaseBuilder({
  goal,
  setGoal,
  universe,
  setUniverse,
  taxSaleOnly,
  setTaxSaleOnly,
  violationsOnly,
  setViolationsOnly,
  matches,
  counts,
  zip,
  neighborhood,
  selectedIds,
  toggleSelected,
  copyCurrentView,
  copied,
}: {
  goal: BuilderGoal;
  setGoal: (goal: BuilderGoal) => void;
  universe: BuilderUniverse;
  setUniverse: (universe: BuilderUniverse) => void;
  taxSaleOnly: boolean;
  setTaxSaleOnly: (value: boolean) => void;
  violationsOnly: boolean;
  setViolationsOnly: (value: boolean) => void;
  matches: VacancyCaseRecord[];
  counts: { land: number; buildings: number };
  zip: string;
  neighborhood: string;
  selectedIds: string[];
  toggleSelected: (record: VacancyCaseRecord) => void;
  copyCurrentView: () => void;
  copied: boolean;
}) {
  return (
    <section className="pt-7">
      <div className="grid gap-6 lg:grid-cols-[330px_1fr]">
        <aside className="border border-[#0C1B33]/15 bg-white p-5 lg:sticky lg:top-5 lg:self-start">
          <div className="flex items-center gap-2">
            <ListFilter aria-hidden className="h-4 w-4 text-[#2563EB]" />
            <h2 className="text-[16px] font-semibold">Build the case</h2>
          </div>

          <FieldGroup label="Goal">
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "all" as const, label: "Explore" },
                { id: "public" as const, label: "Public path" },
                { id: "private" as const, label: "Outreach" },
                { id: "verify" as const, label: "Verify" },
                { id: "conditions" as const, label: "Conditions" },
              ].map((item) => (
                <ChoiceButton
                  key={item.id}
                  selected={goal === item.id}
                  label={item.label}
                  onClick={() => setGoal(item.id)}
                />
              ))}
            </div>
          </FieldGroup>

          <FieldGroup label="Record set">
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "all" as const, label: "Both" },
                { id: "land" as const, label: "Land" },
                { id: "building_report" as const, label: "Buildings" },
              ].map((item) => (
                <ChoiceButton
                  key={item.id}
                  selected={universe === item.id}
                  label={item.label}
                  onClick={() => setUniverse(item.id)}
                />
              ))}
            </div>
          </FieldGroup>

          <FieldGroup label="Evidence signals">
            <label className="flex cursor-pointer items-center justify-between gap-3 border-b border-[#0C1B33]/10 py-3 text-[12px]">
              <span>Tax-sale record on file</span>
              <input
                type="checkbox"
                checked={taxSaleOnly}
                onChange={(event) => setTaxSaleOnly(event.target.checked)}
                className="h-4 w-4 accent-[#0C1B33]"
              />
            </label>
            <label className="flex cursor-pointer items-center justify-between gap-3 py-3 text-[12px]">
              <span>Building violation record</span>
              <input
                type="checkbox"
                checked={violationsOnly}
                onChange={(event) => setViolationsOnly(event.target.checked)}
                className="h-4 w-4 accent-[#0C1B33]"
              />
            </label>
          </FieldGroup>

          <button
            type="button"
            onClick={copyCurrentView}
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 bg-[#0C1B33] px-4 text-[12px] font-semibold text-white hover:bg-[#1E3054]"
          >
            {copied ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
            {copied ? "View link copied" : "Save this view"}
          </button>
        </aside>

        <div className="min-w-0">
          <div className="border border-[#0C1B33]/15 bg-white p-5">
            <p className="font-mono-bureau text-[11px] uppercase tracking-[0.08em] text-[#2563EB]">
              Live case summary
            </p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-editorial text-[31px] leading-tight">
                  {matches.length === 0 ? "No matching records" : "A focused working set"}
                </h2>
                <p className="mt-2 max-w-xl text-[12px] leading-5 text-[#0C1B33]/50">
                  Land and reported buildings stay separate until parcel matching can support a
                  deduplicated total.
                </p>
              </div>
              <div className="flex border border-[#0C1B33]/10 bg-[#0C1B33]/5">
                <CompactCount value={counts.land} label="Land" />
                <CompactCount value={counts.buildings} label="Building reports" />
              </div>
            </div>
          </div>
          <div className="mt-4">
            <GeoPreview records={matches} color="#2563EB" zip={zip} neighborhood={neighborhood} />
          </div>
          <ResultList
            records={matches}
            selectedIds={selectedIds}
            toggleSelected={toggleSelected}
          />
        </div>
      </div>
    </section>
  );
}

function ComparisonView({
  selected,
  records,
  toggleSelected,
  setMode,
}: {
  selected: VacancyCaseRecord[];
  records: VacancyCaseRecord[];
  toggleSelected: (record: VacancyCaseRecord) => void;
  setMode: (mode: WorkbenchMode) => void;
}) {
  const suggestions = records
    .filter((record) => !selected.some((item) => item.id === record.id))
    .filter((record) => record.pin || record.violation)
    .slice(0, 6);

  return (
    <section className="pt-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono-bureau text-[11px] uppercase tracking-[0.08em] text-[#2563EB]">
            Shortlist
          </p>
          <h2 className="mt-1 text-[22px] font-semibold">Compare evidence before the handoff</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-5 text-[#0C1B33]/50">
            Keep the decision, missing evidence, and next action visible for up to three records.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMode("paths")}
          className="inline-flex min-h-10 items-center gap-2 border border-[#0C1B33]/15 bg-white px-3 text-[12px] font-semibold hover:border-[#2563EB] hover:text-[#2563EB]"
        >
          <Search aria-hidden className="h-4 w-4" />
          Find more records
        </button>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {selected.map((record) => {
          const link = parcelUrl(record.pin);
          return (
            <article key={record.id} className="border border-[#0C1B33]/15 bg-white">
              <div className="flex items-start justify-between gap-3 border-b border-[#0C1B33]/10 p-4">
                <div>
                  <p className="text-[11px] font-semibold" style={{ color: OWNER_COLORS[record.ownerType] }}>
                    {record.universe === "land" ? "Vacant land" : "Reported vacant building"}
                  </p>
                  <h3 className="mt-1 text-[16px] font-semibold leading-5">
                    {displayAddress(record.address)}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => toggleSelected(record)}
                  aria-label={`Remove ${record.address} from comparison`}
                  className="inline-flex h-10 w-10 items-center justify-center border border-[#0C1B33]/10 text-[#0C1B33]/50 hover:border-[#DC2626] hover:text-[#DC2626]"
                >
                  <Trash2 aria-hidden className="h-4 w-4" />
                </button>
              </div>
              <dl className="divide-y divide-[#0C1B33]/10">
                <EvidenceRow label="Ownership type" value={OWNER_LABELS[record.ownerType]} />
                <EvidenceRow
                  label="Tax / title signal"
                  value={record.saleYear ? `Tax-sale record on file · latest ${record.saleYear}` : "No tax-sale flag in this dataset"}
                  caution={record.saleYear != null}
                />
                <EvidenceRow
                  label="Condition signal"
                  value={record.violation ? "Building-violation record" : "No violation flag in this dataset"}
                  caution={record.violation}
                />
                <EvidenceRow
                  label="Parcel link"
                  value={record.pin ? "County parcel record available" : "PIN still needed"}
                  caution={!record.pin}
                />
              </dl>
              <div className="border-t border-[#0C1B33]/10 bg-[#0C1B33]/5 p-4">
                <p className="text-[10px] font-semibold text-[#0C1B33]/50">Suggested next action</p>
                <p className="mt-1 text-[12px] leading-5">{nextAction(record)}</p>
                {link && (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:underline"
                  >
                    Open parcel record <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </article>
          );
        })}
        {Array.from({ length: Math.max(0, 3 - selected.length) }).map((_, index) => (
          <div
            key={`empty-${index}`}
            className="flex min-h-[360px] items-center justify-center border border-dashed border-[#0C1B33]/20 bg-white p-6 text-center"
          >
            <div>
              <Plus aria-hidden className="mx-auto h-5 w-5 text-[#0C1B33]/35" />
              <p className="mt-3 text-[12px] font-semibold text-[#0C1B33]/50">
                Add a record to compare
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-7 border-t border-[#0C1B33]/15 pt-5">
        <h3 className="text-[15px] font-semibold">Suggested records</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {suggestions.map((record) => (
            <button
              key={record.id}
              type="button"
              onClick={() => toggleSelected(record)}
              className="flex items-center justify-between gap-3 border border-[#0C1B33]/10 bg-white p-3 text-left hover:border-[#2563EB]"
            >
              <span>
                <span className="block text-[12px] font-semibold">{displayAddress(record.address)}</span>
                <span className="mt-1 block text-[10px] text-[#0C1B33]/50">
                  {OWNER_LABELS[record.ownerType]} · {record.universe === "land" ? "land" : "building report"}
                </span>
              </span>
              <Plus aria-hidden className="h-4 w-4 flex-shrink-0 text-[#2563EB]" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ResultList({
  records,
  selectedIds,
  toggleSelected,
}: {
  records: VacancyCaseRecord[];
  selectedIds: string[];
  toggleSelected: (record: VacancyCaseRecord) => void;
}) {
  const shown = records.slice(0, 8);
  const universeCount = new Set(records.map((record) => record.universe)).size;
  return (
    <div className="mt-4 border border-[#0C1B33]/15 bg-white">
      <div className="flex items-center justify-between border-b border-[#0C1B33]/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck aria-hidden className="h-4 w-4 text-[#2563EB]" />
          <h3 className="text-[13px] font-semibold">Representative records</h3>
        </div>
        <p className="text-[10px] text-[#0C1B33]/45">
          {universeCount > 1
            ? `Showing ${shown.length} representative records`
            : `Showing ${shown.length} of ${records.length.toLocaleString("en-US")}`}
        </p>
      </div>
      {shown.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <Search aria-hidden className="mx-auto h-5 w-5 text-[#0C1B33]/35" />
          <p className="mt-3 text-[13px] font-semibold">No records match this case</p>
          <p className="mt-1 text-[11px] text-[#0C1B33]/45">Remove one condition and try again.</p>
        </div>
      ) : (
        <div className="divide-y divide-[#0C1B33]/10">
          {shown.map((record) => {
            const selected = selectedIds.includes(record.id);
            const link = parcelUrl(record.pin);
            return (
              <div
                key={record.id}
                className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(180px,1fr)_150px_minmax(210px,1.2fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold">{displayAddress(record.address)}</p>
                  <p className="mt-1 text-[10px] text-[#0C1B33]/50">
                    {record.universe === "land" ? "Vacant land" : "Reported vacant building"}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: OWNER_COLORS[record.ownerType] }}
                  />
                  {OWNER_LABELS[record.ownerType]}
                </div>
                <p className="text-[11px] leading-4 text-[#0C1B33]/55">{nextAction(record)}</p>
                <div className="flex items-center justify-end gap-2">
                  {link && (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open county parcel record for ${record.address}`}
                      className="inline-flex h-10 w-10 items-center justify-center border border-[#0C1B33]/10 text-[#0C1B33]/50 hover:border-[#2563EB] hover:text-[#2563EB]"
                    >
                      <ExternalLink aria-hidden className="h-4 w-4" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleSelected(record)}
                    aria-label={`${selected ? "Remove" : "Add"} ${record.address} ${selected ? "from" : "to"} comparison`}
                    className={`inline-flex h-10 w-10 items-center justify-center border ${
                      selected
                        ? "border-[#0C1B33] bg-[#0C1B33] text-white"
                        : "border-[#0C1B33]/10 text-[#0C1B33]/50 hover:border-[#2563EB] hover:text-[#2563EB]"
                    }`}
                  >
                    {selected ? <Check aria-hidden className="h-4 w-4" /> : <Plus aria-hidden className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GeoPreview({
  records,
  color,
  zip,
  neighborhood,
}: {
  records: VacancyCaseRecord[];
  color: string;
  zip: string;
  neighborhood: string;
}) {
  const points = records
    .filter(
      (record): record is VacancyCaseRecord & { lat: number; lon: number } =>
        Number.isFinite(record.lat) && Number.isFinite(record.lon),
    )
    .slice(0, 320);

  const bounds = useMemo(() => {
    if (points.length === 0) return null;
    return points.reduce(
      (acc, point) => ({
        minLat: Math.min(acc.minLat, point.lat),
        maxLat: Math.max(acc.maxLat, point.lat),
        minLon: Math.min(acc.minLon, point.lon),
        maxLon: Math.max(acc.maxLon, point.lon),
      }),
      { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity },
    );
  }, [points]);

  return (
    <div className="relative h-[230px] overflow-hidden border border-[#0C1B33]/15 bg-[#0C1B33]/5 sm:h-[285px]">
      <div className="absolute inset-0 opacity-60">
        <div className="absolute left-1/4 top-0 h-full border-l border-white" />
        <div className="absolute left-1/2 top-0 h-full border-l border-white" />
        <div className="absolute left-3/4 top-0 h-full border-l border-white" />
        <div className="absolute left-0 top-1/3 w-full border-t border-white" />
        <div className="absolute left-0 top-2/3 w-full border-t border-white" />
      </div>
      <div className="absolute left-4 top-4 z-10 border border-[#0C1B33]/15 bg-white/95 px-3 py-2">
        <p className="flex items-center gap-2 text-[11px] font-semibold">
          <MapPinned aria-hidden className="h-4 w-4 text-[#2563EB]" />
          Geographic preview
        </p>
        <p className="mt-1 text-[10px] text-[#0C1B33]/45">
          {points.length.toLocaleString("en-US")} mapped matches shown
        </p>
      </div>
      {bounds &&
        points.map((point) => {
          const lonSpan = bounds.maxLon - bounds.minLon || 1;
          const latSpan = bounds.maxLat - bounds.minLat || 1;
          const left = 7 + ((point.lon - bounds.minLon) / lonSpan) * 86;
          const top = 7 + ((bounds.maxLat - point.lat) / latSpan) * 86;
          return (
            <span
              key={point.id}
              className="absolute h-2 w-2 rounded-full border border-white/70"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                backgroundColor: color,
                opacity: 0.68,
              }}
            />
          );
        })}
      <div className="absolute bottom-4 right-4 border border-[#0C1B33]/15 bg-white/95 px-3 py-2 text-[10px] text-[#0C1B33]/50">
        {neighborhood} · ZIP {zip}
      </div>
    </div>
  );
}

function CountCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex min-h-[144px] flex-col justify-center px-5">
      <span className="font-editorial text-[34px] leading-none">{value.toLocaleString("en-US")}</span>
      <span className="mt-2 text-[10px] font-semibold text-[#0C1B33]/50">{label}</span>
    </div>
  );
}

function CompactCount({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-[100px] border-r border-[#0C1B33]/10 px-3 py-2 last:border-r-0">
      <span className="block text-[16px] font-semibold">{value.toLocaleString("en-US")}</span>
      <span className="block text-[9px] font-semibold text-[#0C1B33]/45">{label}</span>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-6 border-t border-[#0C1B33]/10 pt-4">
      <legend className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/50">
        {label}
      </legend>
      <div className="mt-3">{children}</div>
    </fieldset>
  );
}

function ChoiceButton({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`min-h-10 border px-2 text-[11px] font-semibold ${
        selected
          ? "border-[#0C1B33] bg-[#0C1B33] text-white"
          : "border-[#0C1B33]/15 bg-white text-[#0C1B33]/55 hover:border-[#0C1B33]/40"
      }`}
    >
      {label}
    </button>
  );
}

function EvidenceRow({
  label,
  value,
  caution = false,
}: {
  label: string;
  value: string;
  caution?: boolean;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 px-4 py-3">
      <dt className="text-[10px] font-semibold text-[#0C1B33]/45">{label}</dt>
      <dd className={`text-[11px] leading-4 ${caution ? "text-[#A33B2B]" : "text-[#0C1B33]/80"}`}>
        {value}
      </dd>
    </div>
  );
}
