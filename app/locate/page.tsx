"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ListOrdered,
  MapPinned,
  RotateCcw,
  Ruler,
} from "lucide-react";
import { SITE_COMMUNITY_AREAS } from "@/lib/site-community-areas";
import { PILOT_ZIPS } from "@/lib/pilot-zips";
import {
  SITE_AMENITY_OPTIONS,
  SITE_BUILDING_TYPE_OPTIONS,
  SITE_MEASUREMENT_BASIS_OPTIONS,
  SITE_CONTEXT_OPTIONS,
  SITE_LOCATION_PRIORITY_OPTIONS,
  SITE_PROJECT_USE_OPTIONS,
  SITE_PROPERTY_TYPE_OPTIONS,
  SITE_TRANSPORTATION_DISTANCE_OPTIONS,
  SITE_TRANSPORTATION_OPTIONS,
  buildShortlistHref,
  buildSiteMatchmakerHref,
  buildVacancyHandoffHref,
  createEmptySiteMatchCriteria,
  decodeSiteMatchCriteria,
  isSiteMatchCriteriaReady,
  normalizeSiteMatchCriteria,
  summarizeSiteMatchCriteria,
  siteMatchCriteriaVersionSupported,
  type SiteAmenityNeed,
  type SiteContextPreference,
  type SiteLocationPriority,
  type SiteMatchCriteria,
  type SiteMatchOption,
  type SiteProjectUse,
  type SitePropertyType,
  type SiteTransportationDistance,
  type SiteTransportationNeed,
} from "@/lib/site-matchmaker";

function SectionHeading({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <div className="mb-5 flex items-start gap-4">
      <span className="mt-1 font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#2563EB]">
        {number}
      </span>
      <div>
        <h2 className="text-[17px] font-semibold text-[#0C1B33]">{title}</h2>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/55">{detail}</p>
      </div>
    </div>
  );
}

function RadioOptions<T extends string>({
  name,
  options,
  value,
  onChange,
  columns = "two",
}: {
  name: string;
  options: readonly SiteMatchOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  columns?: "two" | "three";
}) {
  return (
    <div className={`grid gap-2 ${columns === "three" ? "md:grid-cols-3" : "sm:grid-cols-2"}`}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <label
            key={option.value}
            className={`cursor-pointer border p-4 transition-colors ${
              selected
                ? "border-[#2563EB] bg-[#EFF3FB]"
                : "border-[#0C1B33]/12 bg-white hover:border-[#2563EB]/40"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span className="flex min-h-[54px] items-start justify-between gap-3">
              <span>
                <span className="block text-[13px] font-semibold leading-snug text-[#0C1B33]">
                  {option.label}
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-[#0C1B33]/50">
                  {option.description}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border ${
                  selected ? "border-[#2563EB] bg-[#2563EB] text-white" : "border-[#0C1B33]/25"
                }`}
              >
                {selected ? <Check size={12} strokeWidth={3} /> : null}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function CheckboxOptions<T extends string>({
  options,
  values,
  onToggle,
}: {
  options: readonly SiteMatchOption<T>[];
  values: readonly T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {options.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-start gap-3 border-b border-[#0C1B33]/8 py-3"
        >
          <input
            type="checkbox"
            checked={values.includes(option.value)}
            onChange={() => onToggle(option.value)}
            className="mt-0.5 h-4 w-4 flex-none accent-[#2563EB]"
          />
          <span>
            <span className="block text-[12px] font-semibold text-[#0C1B33]">{option.label}</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-[#0C1B33]/50">
              {option.description}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/10 py-3 last:border-b-0">
      <div className="font-mono-bureau text-[9px] uppercase tracking-[0.13em] text-white/40">
        {label}
      </div>
      <div className="mt-1 text-[12px] leading-relaxed text-white/85">{value}</div>
    </div>
  );
}

function numericInput(value: string): number | null {
  if (value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(2_000_000, Math.round(parsed));
}

function SiteMatchmakerPage() {
  const searchParams = useSearchParams();
  const [criteria, setCriteria] = useState<SiteMatchCriteria>(() => {
    const decoded = decodeSiteMatchCriteria(new URLSearchParams(searchParams.toString()));
    return Array.from(searchParams.keys()).some((key) => key.startsWith("sm_")) ? decoded : { ...decoded, evidenceVersion: "2", includeConversions: false, measurementBasis: null };
  });
  const [copied, setCopied] = useState(false);
  const [invalidCriteria, setInvalidCriteria] = useState(() => !siteMatchCriteriaVersionSupported(new URLSearchParams(searchParams.toString())));

  useEffect(() => {
    if (!invalidCriteria) window.history.replaceState(null, "", buildSiteMatchmakerHref(criteria));
  }, [criteria, invalidCriteria]);

  const summary = useMemo(() => summarizeSiteMatchCriteria(criteria), [criteria]);
  const handoffHref = useMemo(() => buildVacancyHandoffHref(criteria), [criteria]);
  const shortlistHref = useMemo(() => buildShortlistHref(criteria), [criteria]);
  const ready = !invalidCriteria && isSiteMatchCriteriaReady(criteria);
  const requestedAreaLabel = criteria.evidenceVersion === "2"
    ? SITE_MEASUREMENT_BASIS_OPTIONS.find((option) => option.value === criteria.measurementBasis)?.label ?? "area (choose a measurement basis)"
    : criteria.propertyType === "vacant-land"
      ? "lot area"
      : criteria.propertyType === "existing-building"
        ? "reported available interior space"
        : "lot area or reported available interior space";

  function setField<K extends keyof SiteMatchCriteria>(key: K, value: SiteMatchCriteria[K]) {
    setCopied(false);
    setCriteria((current) => ({ ...current, [key]: value }));
  }

  function toggleTransportation(value: SiteTransportationNeed) {
    setCopied(false);
    setCriteria((current) => ({
      ...current,
      transportation: current.transportation.includes(value)
        ? current.transportation.filter((item) => item !== value)
        : [...current.transportation, value],
    }));
  }

  function toggleAmenity(value: SiteAmenityNeed) {
    setCopied(false);
    setCriteria((current) => ({
      ...current,
      amenities: current.amenities.includes(value)
        ? current.amenities.filter((item) => item !== value)
        : [...current.amenities, value],
    }));
  }

  function normalizeFootprint() {
    setCopied(false);
    setCriteria((current) => normalizeSiteMatchCriteria(current));
  }

  function resetCriteria() {
    setCopied(false);
    setInvalidCriteria(false);
    setCriteria({ ...createEmptySiteMatchCriteria(), evidenceVersion: "2", includeConversions: false, measurementBasis: null });
  }

  async function copyBriefLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#FAF9F6] text-[#0C1B33]">
      <header className="border-b border-white/10 bg-[#0C1B33] px-4 py-8 text-white sm:px-8">
        <div className="mx-auto max-w-6xl">
          <Link
            href="/map"
            className="inline-flex items-center gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-white/45 transition-colors hover:text-white"
          >
            <ArrowLeft size={13} aria-hidden="true" />
            Incentive map
          </Link>
          <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
            <div>
              <span className="font-mono-bureau text-[10px] uppercase tracking-[0.22em] text-[#79A3FF]">
                Site Matchmaker
              </span>
              <h1 className="mt-3 font-editorial text-[42px] leading-[0.96] sm:text-[56px]">
                Describe the site your project needs
              </h1>
            </div>
            <p className="max-w-md text-[13px] leading-relaxed text-white/55">
              Build a criteria brief and carry it into Chicago&apos;s tracked vacant-property
              inventory. Public records are starting points, not availability listings.
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 bg-white">
          <section className="border border-[#0C1B33]/10 p-5 sm:p-7">
            <SectionHeading
              number="01"
              title="Project and property"
              detail="Name the use you are planning and the kind of property record you want to review."
            />
            {invalidCriteria && <p role="alert" className="mb-4 border p-3 text-sm">This link contains unsupported criteria. Reset the brief before searching; no requirement has been silently discarded.</p>}
            <fieldset>
              <legend className="mb-3 font-mono-bureau text-[10px] uppercase tracking-[0.13em] text-[#0C1B33]/55">
                What type of project are you bringing? *
              </legend>
              <RadioOptions<SiteProjectUse>
                name="project-use"
                options={SITE_PROJECT_USE_OPTIONS}
                value={criteria.projectUse}
                onChange={(value) => setField("projectUse", value)}
              />
            </fieldset>

            <div className="mt-4">
              <label
                className={`flex items-start gap-3 border p-4 transition-colors ${
                  criteria.projectUse
                    ? "cursor-pointer border-[#0C1B33]/12 bg-white hover:border-[#2563EB]/40"
                    : "cursor-not-allowed border-[#0C1B33]/8 bg-[#FAF9F6] opacity-60"
                }`}
              >
                <input
                  type="checkbox"
                  checked={criteria.zoningAlignment === "aligned-only"}
                  disabled={!criteria.projectUse}
                  onChange={() =>
                    setField(
                      "zoningAlignment",
                      criteria.zoningAlignment === "aligned-only" ? null : "aligned-only",
                    )
                  }
                  className="mt-0.5 h-4 w-4 flex-none accent-[#2563EB]"
                />
                <span>
                  <span className="block text-[12px] font-semibold text-[#0C1B33]">
                    Broadly aligned district families
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-[#0C1B33]/50">
                    Filters by broad district family, not the building’s recorded use or legal permission.
                    In the refined search, PD/PMD and unresolved districts go to separate verification.
                    {!criteria.projectUse && " Select a project use above to enable this filter."}
                  </span>
                </span>
              </label>
            </div>

            <fieldset className="mt-8">
              <legend className="mb-3 font-mono-bureau text-[10px] uppercase tracking-[0.13em] text-[#0C1B33]/55">
                What kind of property should be included? *
              </legend>
              <RadioOptions<SitePropertyType>
                name="property-type"
                options={SITE_PROPERTY_TYPE_OPTIONS}
                value={criteria.propertyType}
                onChange={(value) => setField("propertyType", value)}
                columns="three"
              />
            </fieldset>
            {criteria.evidenceVersion !== "2" ? (
              <div className="mt-5 border p-4 text-sm">
                <p>This saved brief uses a broad building search. Select explicit recorded building types and measurements to refine it.</p>
                <button type="button" className="mt-3 underline" onClick={() => setCriteria((current) => ({ ...current, evidenceVersion: "2", buildingTypes: undefined, measurementBasis: null, includeConversions: false }))}>Refine building and measurement criteria</button>
              </div>
            ) : criteria.propertyType !== "vacant-land" && (
              <fieldset className="mt-6">
                <legend className="font-semibold">Recorded existing building types *</legend>
                <p className="my-2 text-sm">Filter by recorded use, separately from your proposed activity. County records may lag current conditions.</p>
                <label className="mr-4 inline-flex gap-2 p-2"><input type="checkbox" checked={criteria.buildingTypes?.length === 0} onChange={(event) => setField("buildingTypes", event.target.checked ? [] : undefined)} />Any recorded type</label>
                {SITE_BUILDING_TYPE_OPTIONS.map((option) => (
                  <label key={option.value} className="mr-4 inline-flex gap-2 p-2"><input type="checkbox" checked={criteria.buildingTypes?.includes(option.value) ?? false} onChange={() => setField("buildingTypes", criteria.buildingTypes?.includes(option.value) ? (criteria.buildingTypes.length === 1 ? undefined : criteria.buildingTypes.filter((type) => type !== option.value)) : [...(criteria.buildingTypes ?? []), option.value])} />{option.label}</label>
                ))}
                <label className="mt-3 flex gap-2"><input type="checkbox" checked={criteria.includeConversions ?? false} onChange={(event) => setField("includeConversions", event.target.checked)} />Include different recorded types in a separate conversion-review group</label>
                <p className="mt-2 text-xs">Conversion feasibility is not evaluated. Unknown or conflicting evidence appears separately for verification.</p>
              </fieldset>
            )}
          </section>

          <section className="border-x border-b border-[#0C1B33]/10 p-5 sm:p-7">
            <SectionHeading
              number="02"
              title="Area and required space"
              detail={`Choose a published vacancy area and the ${requestedAreaLabel} the project requires.`}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="font-mono-bureau text-[10px] uppercase tracking-[0.13em] text-[#0C1B33]/55">
                  Vacancy area *
                </span>
                <select
                  value={criteria.zip ?? ""}
                  onChange={(event) => setField("zip", event.target.value || null)}
                  className="mt-2 h-11 w-full border border-[#0C1B33]/16 bg-white px-3 text-[13px] text-[#0C1B33] outline-none focus:border-[#2563EB]"
                >
                  <option value="">Select an area</option>
                  {PILOT_ZIPS.map((entry) => (
                    <option key={entry.zip} value={entry.zip}>
                      ZIP {entry.zip} (includes {entry.primaryNeighborhood})
                    </option>
                  ))}
                </select>
              </label>

              {criteria.evidenceVersion === "2" && (
                <label className="block sm:col-span-2">
                  <span className="text-sm font-semibold">Official community area within the selected ZIP</span>
                  <select className="mt-2 block w-full border bg-white p-3" value={criteria.communityArea ?? ""} onChange={(event) => setField("communityArea", event.target.value || null)}>
                    <option value="">Entire ZIP</option>
                    {SITE_COMMUNITY_AREAS.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <span className="mt-2 block text-xs">Uses the saved map point inside the official boundary. Boundary or missing-location cases need verification. This does not search portions outside the selected ZIP.</span>
                </label>
              )}
              {criteria.evidenceVersion === "2" && (
                <label className="block sm:col-span-2">
                  <span className="text-sm font-semibold">Measurement basis for size filters</span>
                  <select className="mt-2 block w-full border bg-white p-3" value={criteria.measurementBasis ?? ""} onChange={(event) => setField("measurementBasis", SITE_MEASUREMENT_BASIS_OPTIONS.find((option) => option.value === event.target.value)?.value ?? null)}>
                    <option value="">Choose a measurement basis</option>
                    {SITE_MEASUREMENT_BASIS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <span className="mt-2 block text-xs">Assessor building area, lot area, ground coverage and available interior space are different facts. Missing measurements go to verification.</span>
                </label>
              )}
              <label className="block">
                <span className="flex items-center gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.13em] text-[#0C1B33]/55">
                  <Ruler size={13} aria-hidden="true" /> Minimum {requestedAreaLabel}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={100}
                  max={2_000_000}
                  step={100}
                  value={criteria.minSquareFeet ?? ""}
                  onChange={(event) => setField("minSquareFeet", numericInput(event.target.value))}
                  onBlur={normalizeFootprint}
                  placeholder="No minimum"
                  className="mt-2 h-11 w-full border border-[#0C1B33]/16 bg-white px-3 text-[13px] text-[#0C1B33] outline-none placeholder:text-[#0C1B33]/30 focus:border-[#2563EB]"
                />
              </label>

              <label className="block">
                <span className="flex items-center gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.13em] text-[#0C1B33]/55">
                  <Ruler size={13} aria-hidden="true" /> Maximum {requestedAreaLabel}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={100}
                  max={2_000_000}
                  step={100}
                  value={criteria.maxSquareFeet ?? ""}
                  onChange={(event) => setField("maxSquareFeet", numericInput(event.target.value))}
                  onBlur={normalizeFootprint}
                  placeholder="No maximum"
                  className="mt-2 h-11 w-full border border-[#0C1B33]/16 bg-white px-3 text-[13px] text-[#0C1B33] outline-none placeholder:text-[#0C1B33]/30 focus:border-[#2563EB]"
                />
              </label>
            </div>
          </section>

          <section className="border-x border-b border-[#0C1B33]/10 p-5 sm:p-7">
            <SectionHeading
              number="03"
              title="Density and district context"
              detail="Describe the surrounding development pattern you want to examine. This is a preference, not a zoning determination."
            />
            <RadioOptions<SiteContextPreference>
              name="site-context"
              options={SITE_CONTEXT_OPTIONS}
              value={criteria.context}
              onChange={(value) => setField("context", value)}
            />
          </section>

          <section className="border-x border-b border-[#0C1B33]/10 p-5 sm:p-7">
            <SectionHeading
              number="04"
              title="Transportation needs"
              detail="CTA rail and Metra can filter and rank by straight-line station distance. Bus, expressway, freight rail and bike selections are review preferences; they do not filter results."
            />
            <CheckboxOptions<SiteTransportationNeed>
              options={SITE_TRANSPORTATION_OPTIONS}
              values={criteria.transportation}
              onToggle={toggleTransportation}
            />
            <fieldset className="mt-8">
              <legend className="mb-3 font-mono-bureau text-[10px] uppercase tracking-[0.13em] text-[#0C1B33]/55">
                How close should the selected transportation be?
              </legend>
              <RadioOptions<SiteTransportationDistance>
                name="transportation-distance"
                options={SITE_TRANSPORTATION_DISTANCE_OPTIONS}
                value={criteria.transportationDistance}
                onChange={(value) => setField("transportationDistance", value)}
              />
            </fieldset>
          </section>

          <section className="border-x border-b border-[#0C1B33]/10 p-5 sm:p-7">
            <SectionHeading
              number="05"
              title="Walkability and pedestrian activity"
              detail="Review preferences only: these selections do not filter or rank records. Available context is shown separately; no foot-traffic measurement is inferred."
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="font-mono-bureau text-[10px] uppercase tracking-[0.13em] text-[#0C1B33]/55">
                  Walkability
                </span>
                <select
                  value={criteria.walkability ?? ""}
                  onChange={(event) =>
                    setField(
                      "walkability",
                      (event.target.value as SiteLocationPriority) || null,
                    )
                  }
                  className="mt-2 h-11 w-full border border-[#0C1B33]/16 bg-white px-3 text-[13px] text-[#0C1B33] outline-none focus:border-[#2563EB]"
                >
                  <option value="">Select importance</option>
                  {SITE_LOCATION_PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="mt-2 block text-[11px] leading-relaxed text-[#0C1B33]/50">
                  The EPA walkability index can be reviewed for each location; it is not a site-match score.
                </span>
              </label>

              <label className="block">
                <span className="font-mono-bureau text-[10px] uppercase tracking-[0.13em] text-[#0C1B33]/55">
                  Pedestrian activity / foot traffic
                </span>
                <select
                  value={criteria.pedestrianActivity ?? ""}
                  onChange={(event) =>
                    setField(
                      "pedestrianActivity",
                      (event.target.value as SiteLocationPriority) || null,
                    )
                  }
                  className="mt-2 h-11 w-full border border-[#0C1B33]/16 bg-white px-3 text-[13px] text-[#0C1B33] outline-none focus:border-[#2563EB]"
                >
                  <option value="">Select importance</option>
                  {SITE_LOCATION_PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="mt-2 block text-[11px] leading-relaxed text-[#0C1B33]/50">
                  This flags a need for direct or partner-supplied evidence; nearby amenities are not treated as foot-traffic counts.
                </span>
              </label>
            </div>
          </section>

          <section className="border-x border-b border-[#0C1B33]/10 p-5 sm:p-7">
            <SectionHeading
              number="06"
              title="Nearby amenities"
              detail="Review preferences only: these selections do not filter or rank records. Proximity and operating status still require verification."
            />
            <CheckboxOptions<SiteAmenityNeed>
              options={SITE_AMENITY_OPTIONS}
              values={criteria.amenities}
              onToggle={toggleAmenity}
            />
          </section>
        </div>

        <aside className="bg-[#0C1B33] p-5 text-white lg:sticky lg:top-24">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <span className="font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#79A3FF]">
                Criteria handoff
              </span>
              <h2 className="mt-2 font-editorial text-[26px] leading-tight">Site brief</h2>
            </div>
            <button
              type="button"
              onClick={resetCriteria}
              className="flex h-8 w-8 items-center justify-center border border-white/15 text-white/55 transition-colors hover:border-white/35 hover:text-white"
              aria-label="Reset site criteria"
              title="Reset site criteria"
            >
              <RotateCcw size={14} aria-hidden="true" />
            </button>
          </div>

          <div className="py-1">
            <SummaryRow label="Area" value={summary.location} />
            <SummaryRow label="Project use" value={summary.projectUse} />
            <SummaryRow label="Property" value={summary.propertyType} />
            <SummaryRow label="Required size" value={summary.footprint} />
            <SummaryRow label="Context" value={summary.context} />
            <SummaryRow label="Transportation" value={summary.transportation} />
            <SummaryRow label="Transport distance" value={summary.transportationDistance} />
            <SummaryRow label="Zoning alignment" value={summary.zoningAlignment} />
            <SummaryRow label="Walkability" value={summary.walkability} />
            <SummaryRow label="Pedestrian activity" value={summary.pedestrianActivity} />
            <SummaryRow label="Nearby amenities" value={summary.amenities} />
          </div>

          <div className="mt-4 border-t border-white/10 pt-5">
            {ready && shortlistHref ? (
              <>
                <Link
                  href={shortlistHref}
                  className="flex min-h-12 w-full items-center justify-between gap-3 bg-[#2563EB] px-4 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
                >
                  <span className="flex items-center gap-2">
                    <ListOrdered size={17} aria-hidden="true" />
                    Generate a ranked shortlist
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
                {handoffHref && (
                  <Link
                    href={handoffHref}
                    className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 border border-white/15 px-4 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.11em] text-white/60 transition-colors hover:border-white/35 hover:text-white"
                  >
                    <MapPinned size={14} aria-hidden="true" />
                    {criteria.evidenceVersion === "2" ? "View filtered shortlist map" : "Browse the full map instead"}
                  </Link>
                )}
              </>
            ) : (
              <div className="border border-white/15 px-4 py-3 text-[11px] leading-relaxed text-white/50">
                Select an area, project use, and property type to generate a ranked shortlist.
              </div>
            )}

            <button
              type="button"
              onClick={copyBriefLink}
              className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 border border-white/15 px-4 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.11em] text-white/60 transition-colors hover:border-white/35 hover:text-white"
            >
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {copied ? "Link copied" : "Copy criteria link"}
            </button>

            <p className="mt-4 text-[10px] leading-relaxed text-white/38">
              The next screen shows tracked public-record leads. Lot area, assessor building area,
              City ground coverage, and verified available space remain separate facts.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

export default function LocatePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAF9F6]" />}>
      <SiteMatchmakerPage />
    </Suspense>
  );
}
