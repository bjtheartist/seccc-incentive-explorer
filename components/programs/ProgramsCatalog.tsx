"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X,
  AlertTriangle,
  ArrowRight,
  Printer,
  CalendarOff,
} from "lucide-react";
import Link from "next/link";
import type { PublicProgramView } from "@/lib/program-public";
import { ZONE_COLORS, LEVEL_COLORS } from "@/lib/constants";
import type { ProgramLevel } from "@/lib/types";
import { INDUSTRIES, getIndustryById } from "@/lib/industries-data";
import LevelBadge from "@/components/LevelBadge";
// review5 S1: imported from lib/program-slug.ts, NOT lib/programs-data.ts —
// that module also exports getProgramsSync(), which require()s the full
// internal catalog. This client component must never be reachable to that
// file at all, not merely avoid calling the function.
import { slugifyProgramName } from "@/lib/program-slug";
import { useLiveNow } from "@/components/programs/useLiveNow";
// review5 S1 (CRITICAL — the earlier "hard cutover" claim did not hold):
// this now imports the PUBLIC DTO envelope (public/data/programs-public.json,
// PR1's committed build artifact), never the internal catalog
// (data/programs-internal.json). Still a build-time static import, not a
// runtime fetch — the catalog must render in the initial HTML with no
// client data fetch (SEO/no-JS/no empty-flash — see
// app/programs/page.test.tsx's "without a client data fetch" test), but the
// BUNDLED CONTENT is now the sanitized DTO, not the full internal record.
// This is a real trade-off from the richer Program-shaped card this
// component rendered before: whoQualifies/benefits become
// screening.publishedCriteria/benefit.qualifier, and internal-only detail
// (requiredDocs, verificationSteps, applicationPortals, sunsetWarning,
// suspensionNote, boundaryDisclaimer, contact, howToApply) is no longer
// available at this layer — the expanded card links out to the full,
// server-rendered `/programs/[slug]` detail page for that instead, which
// already renders from data/programs-internal.json SERVER-SIDE only (see
// app/programs/[slug]/page.tsx) and never ships that data to the client
// bundle. See docs/eligibility-claims-acceptance.md's S1 resolution note.
import programsPublicData from "@/public/data/programs-public.json";

const LEVELS = ["All", "Federal", "State", "County", "City", "Utility"] as const;
const INITIAL_PROGRAMS = programsPublicData.programs as unknown as PublicProgramView[];

const OPEN_INTAKE_STATES = new Set(["open", "rolling"]);

/** DTO-only availability approximation (review5 S1): the full
 * `resolveAvailability`/`resolveConservativeProgramAvailability` machinery
 * needs raw `deadlines[]`/`expiresOn`/`status` fields that PublicProgramView
 * does not carry by design. A program whose published `nextWindow.expected`
 * date has passed is treated as no-longer-current for display purposes —
 * narrower than the full engine (it cannot detect every expiry shape the
 * internal catalog can), but sourced ENTIRELY from DTO fields, never from a
 * client-bundled internal record. */
function isPastPublishedWindow(program: PublicProgramView, now: Date): boolean {
  const expected = program.intake.nextWindow.expected;
  if (!expected) return false;
  const date = new Date(expected);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < now.getTime();
}

function programHref(program: PublicProgramView): string {
  return `/programs/${slugifyProgramName(program.name) || program.id}`;
}

function statusLabel(
  program: PublicProgramView,
): { text: string; tone: "open" | "caution"; icon: "calendar" | "alert" } {
  const status = program.intake.status;
  if (OPEN_INTAKE_STATES.has(status)) return { text: "Open", tone: "open", icon: "alert" };
  switch (status) {
    case "closed":
      return { text: "Closed", tone: "caution", icon: "calendar" };
    case "lapsed":
      return { text: "Lapsed", tone: "caution", icon: "calendar" };
    case "pending":
      return { text: "Pending", tone: "caution", icon: "alert" };
    default:
      return { text: "Status not established", tone: "caution", icon: "alert" };
  }
}

export default function ProgramsCatalog({
  initialNowIso,
}: {
  initialNowIso: string;
}) {
  return <ProgramsContent initialNowIso={initialNowIso} />;
}

function ProgramsContent({ initialNowIso }: { initialNowIso: string }) {
  const programs = INITIAL_PROGRAMS;
  const [filter, setFilter] = useState<string>("All");
  const [industryFilter, setIndustryFilter] = useState<string>("");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const now = useLiveNow(initialNowIso);
  const nowDate = useMemo(() => (now ? now : new Date(initialNowIso)), [now, initialNowIso]);

  // Availability gating: a program whose published window has passed is
  // hidden by default; still-open and closed/lapsed/pending-but-not-past-
  // window programs stay visible with a status badge (build-spec.md 2.2,
  // audit F4 — "available" means an open/rolling intake window).
  const unavailableCount = useMemo(
    () => programs.filter((p) => isPastPublishedWindow(p, nowDate)).length,
    [programs, nowDate],
  );

  const visiblePrograms = useMemo(
    () =>
      showUnavailable
        ? programs
        : programs.filter((p) => !isPastPublishedWindow(p, nowDate)),
    [programs, nowDate, showUnavailable],
  );

  const openIntakeCount = useMemo(
    () => visiblePrograms.filter((p) => OPEN_INTAKE_STATES.has(p.intake.status)).length,
    [visiblePrograms],
  );

  // review5 S1: the previous per-portal Submittable apply-button and its
  // link-health badge (fetched here from /data/link-health.json, keyed by
  // `${programId}:${applicationPortals[].url}`) are retired from this
  // card. applicationPortals is internal-only and not on PublicProgramView
  // by design, so this card can no longer render a Submittable button at
  // all. KNOWN GAP, not silently dropped: neither this card nor
  // app/programs/[slug]/page.tsx currently render a Submittable apply
  // button — verified by grep, not assumed. A user who needs the apply
  // flow still reaches it via the program's official source link
  // (program.links.url / links.sourceUrl), just not the one-click
  // Submittable shortcut. Rebuilding that flow server-side (so it can
  // safely read applicationPortals + link-health.json again) is a real,
  // scoped piece of follow-up work, deliberately left out of this pass —
  // it is not one of the S1-S10 findings this branch was asked to fix.

  const selectedIndustry = industryFilter
    ? getIndustryById(industryFilter)
    : null;

  const filtered = visiblePrograms.filter((p) => {
    const matchesLevel = filter === "All" || p.level === filter;
    const matchesIndustry =
      !selectedIndustry || selectedIndustry.topPrograms.includes(p.id);
    return matchesLevel && matchesIndustry;
  });

  return (
    <div className="min-h-screen">
      <Suspense fallback={null}>
        <IndustryQuerySync onIndustryChange={setIndustryFilter} />
      </Suspense>
      {/* Page Header — soft blue */}
      <div className="relative border-b border-[#0C1B33]/10 overflow-hidden">
        <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: "url('/chicago-map-hero.png')" }} />
        <div className="absolute inset-0 bg-[#0C1B33]/80" />
        <div className="relative z-10 container mx-auto max-w-4xl px-6 py-16">
          <div className="flex items-center gap-4 mb-6">
            <div className="accent-bar-light" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
              Directory
            </span>
          </div>
          <h1 className="font-editorial text-4xl md:text-5xl text-white mb-4">
            Incentive Programs
          </h1>
          <p className="text-white/50 text-base max-w-xl">
            {selectedIndustry
              ? `${filtered.length} programs relevant to ${selectedIndustry.name} businesses.`
              : `${visiblePrograms.length} sourced federal, state, county, and city incentive programs — ${openIntakeCount} with an intake window currently open or rolling.`}
          </p>
        </div>
      </div>

      <div className="programs-page container mx-auto max-w-4xl px-6 py-10 bg-[#FAF9F6]">
        {/* Quiz CTA — public education entry point */}
        <Link
          href="/quiz"
          className="group block mb-10 relative overflow-hidden bg-[#0C1B33] hover:bg-[#1c2c4a] transition-colors rounded-xl p-6 md:p-7"
        >
          <div className="absolute inset-0 bureau-noise opacity-20" />
          <div className="relative z-10 flex items-center gap-5">
            <div className="flex-1">
              <div className="font-mono-bureau text-[9px] tracking-[0.3em] uppercase text-white/40 mb-1.5">
                Public-education quiz
              </div>
              <h2 className="font-editorial text-xl md:text-2xl text-white mb-1">
                How well do you know Chicago incentives?
              </h2>
              <p className="text-white/55 text-sm">
                10 questions sampled from a 100-question bank. Find out if you&apos;re an Early Explorer or a Policy Wonk.
              </p>
            </div>
            <div className="shrink-0">
              <span className="inline-flex items-center gap-1.5 bg-[#2563EB] group-hover:bg-[#1d4ed8] text-white font-mono-bureau text-[10px] tracking-[0.2em] uppercase px-4 py-2.5 rounded-full transition-colors">
                Start <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        </Link>

        {/* Definitions: Incentive Zones vs Programs */}
        <div className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-[#2563EB]/15 bg-[#EFF3FB] p-5">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50 mb-2">
              Definition
            </div>
            <h3 className="text-sm font-semibold text-[#0C1B33] mb-2">Incentive Zones</h3>
            <p className="text-[12px] text-[#0C1B33]/55 leading-relaxed">
              Incentive zones are <strong>geographic designations</strong> drawn
              by federal, state, or city agencies on census tracts or
              neighborhood boundaries. A geocoded point that falls{" "}
              <em>inside</em> a zone is a location signal for the programs
              that reference that boundary — review the current program
              source for the boundary&apos;s role and any remaining
              criteria. A single address can fall within multiple overlapping
              zones (e.g., TIF + Opportunity Zone + Enterprise Zone).
            </p>
          </div>
          <div className="border border-[#059669]/15 bg-[#f0fdf4] p-5">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#059669]/50 mb-2">
              Definition
            </div>
            <h3 className="text-sm font-semibold text-[#0C1B33] mb-2">Incentive Programs</h3>
            <p className="text-[12px] text-[#0C1B33]/55 leading-relaxed">
              Programs are the <strong>actual benefits</strong> — grants, tax
              credits, financing, and technical assistance — administered by a
              government agency. Each program has its own application process,
              eligibility criteria, and deadlines. Some programs require zone
              membership; others (like Cook County programs) are available
              county-wide regardless of zone status.
            </p>
          </div>
        </div>

        {/* Cheat-Sheet: at-a-glance program matrix, designed to print/save as PDF */}
        <CheatSheetSection programs={visiblePrograms} asOf={now} />

        {/* Industry Filter */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/35">
              Filter by industry
            </span>
            {selectedIndustry && (
              <button
                onClick={() => setIndustryFilter("")}
                className="font-mono-bureau text-[9px] tracking-[0.1em] uppercase text-[#2563EB]/60 hover:text-[#2563EB] transition-colors flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {INDUSTRIES.map((ind) => (
              <button
                key={ind.id}
                onClick={() =>
                  setIndustryFilter(industryFilter === ind.id ? "" : ind.id)
                }
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono-bureau tracking-wide transition-all ${
                  industryFilter === ind.id
                    ? "bg-[#2563EB] text-white shadow-sm"
                    : "bg-white border border-[#0C1B33]/10 text-[#0C1B33]/50 hover:border-[#2563EB]/30 hover:text-[#0C1B33]/70"
                }`}
              >
                <span>{ind.icon}</span>
                {ind.name}
              </button>
            ))}
          </div>
        </div>

        {/* Availability toggle — programs past their published window are hidden by default */}
        {unavailableCount > 0 && (
          <label className="mb-4 flex items-center gap-2 cursor-pointer select-none w-fit">
            <input
              type="checkbox"
              checked={showUnavailable}
              onChange={(e) => setShowUnavailable(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#2563EB]"
            />
            <span className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/45">
              Show programs past their published window ({unavailableCount} hidden)
            </span>
          </label>
        )}

        {/* Level Filter Tabs */}
        <div className="flex gap-0 border border-[#0C1B33]/10 mb-8 overflow-x-auto">
          {LEVELS.map((level) => {
            const count =
              level === "All"
                ? visiblePrograms.length
                : visiblePrograms.filter((p) => p.level === level).length;
            return (
              <button
                key={level}
                onClick={() => setFilter(level)}
                className={`flex-1 min-w-[80px] px-4 py-3 font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-center transition-colors ${
                  filter === level
                    ? "bg-[#0C1B33] text-white"
                    : "text-[#0C1B33]/40 hover:text-[#0C1B33]/80 hover:bg-[#EFF3FB]"
                }`}
              >
                {level}
                <span className="ml-1.5 opacity-60">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Program Cards */}
        <div className="space-y-3">
          {filtered.map((program) => (
            <ProgramCard key={program.id} program={program} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProgramCard({ program }: { program: PublicProgramView }) {
  const [expanded, setExpanded] = useState(false);
  const color = ZONE_COLORS[program.zoneKey ?? ""] || "#6b7280";
  const status = statusLabel(program);
  const criteriaFrame = program.links.administeringAgency
    ? `Published criteria — confirm with ${program.links.administeringAgency}`
    : "Published criteria — confirm with the administering agency";

  return (
    <div className="bg-white rounded-xl shadow-sm hover:shadow-md transition-all overflow-hidden">
      <button
        className="w-full px-6 py-5 text-left flex items-start gap-4"
        onClick={() => setExpanded(!expanded)}
      >
        <div
          className="w-1.5 h-10 rounded-full shrink-0 mt-0.5"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-1.5">
            <h2 className="text-[#0C1B33] text-base font-medium">{program.name}</h2>
            <LevelBadge level={program.level} />
            <span
              className={`font-mono-bureau text-[9px] tracking-[0.15em] uppercase px-2 py-1 rounded-full inline-flex items-center gap-1 ${
                status.tone === "open"
                  ? "text-emerald-700 bg-emerald-100"
                  : "text-amber-700 bg-amber-100"
              }`}
            >
              {status.tone === "caution" && status.icon === "calendar" && <CalendarOff className="w-3 h-3" />}
              {status.tone === "caution" && status.icon === "alert" && <AlertTriangle className="w-3 h-3" />}
              {status.text}
            </span>
          </div>
          <p className="text-sm text-[#0C1B33]/50 leading-relaxed">{program.benefit.qualifier}</p>
        </div>
        <span className="shrink-0 mt-1 text-[#0C1B33]/25">
          {expanded ? (
            <ChevronUp className="w-5 h-5" />
          ) : (
            <ChevronDown className="w-5 h-5" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="px-6 pb-6 space-y-5 border-t border-[#0C1B33]/5 pt-5 ml-4">
          {program.benefit.summary && (
            <div>
              <h3 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/35 mb-2">
                Range on file
              </h3>
              <p className="text-sm text-[#0C1B33]/60">{program.benefit.summary}</p>
              <p className="text-[11px] text-[#0C1B33]/45 mt-1">{program.benefit.qualifier}</p>
            </div>
          )}

          {/* Published criteria (build-spec.md DTO design: never raw whoQualifies) */}
          <div className="bg-[#EFF3FB] rounded-lg p-4">
            <h3 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#2563EB]/60 mb-2">
              {criteriaFrame}
            </h3>
            {program.screening.publishedCriteria.length > 0 ? (
              <ul className="text-sm space-y-1.5">
                {program.screening.publishedCriteria.map((criterion, i) => (
                  <li key={i} className="text-[#0C1B33]/60">
                    {criterion}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[#0C1B33]/60">
                See the official source for published criteria.
              </p>
            )}
          </div>

          {/* Full detail (requirements, application steps, contacts, notices) lives
              on the server-rendered program page, which reads the internal
              catalog server-side only — never bundled here. */}
          <Link
            href={programHref(program)}
            className="inline-flex items-center gap-2 font-mono-bureau text-[11px] text-[#2563EB] uppercase tracking-[0.1em] hover:text-[#0C1B33] transition-colors"
          >
            View full program details
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>

          {program.links.url && (
            <div className="pt-2 border-t border-[#0C1B33]/5">
              <a
                href={program.links.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[#2563EB] text-sm hover:underline"
              >
                Official source <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IndustryQuerySync({
  onIndustryChange,
}: {
  onIndustryChange: (industry: string) => void;
}) {
  const searchParams = useSearchParams();
  const industry = searchParams.get("industry") || "";

  useEffect(() => {
    onIndustryChange(industry);
  }, [industry, onIndustryChange]);

  return null;
}


/* ── Cheat-Sheet (printable at-a-glance matrix) ───────────────── */

const CHEAT_LEVELS: ProgramLevel[] = ["Federal", "State", "County", "City", "Utility"];

/** All programs at a given gov level, open/rolling first then by name. */
function programsByLevel(all: PublicProgramView[], level: ProgramLevel): PublicProgramView[] {
  return all
    .filter((p) => p.level === level)
    .sort((a, b) => {
      const aOpen = OPEN_INTAKE_STATES.has(a.intake.status) ? 0 : 1;
      const bOpen = OPEN_INTAKE_STATES.has(b.intake.status) ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return a.name.localeCompare(b.name);
    });
}

function CheatSheetSection({
  programs,
  asOf,
}: {
  programs: PublicProgramView[];
  asOf: Date | null;
}) {
  // Active gov-level tab on mobile. Desktop (lg+) shows all 5 columns;
  // print mode forces all columns visible regardless of tab state.
  const [activeLevel, setActiveLevel] = useState<ProgramLevel>("City");
  if (programs.length === 0) return null;
  const today = asOf
    ? asOf.toLocaleDateString("en-CA", { timeZone: "America/Chicago" })
    : "Status check pending";

  return (
    <section
      id="cheat-sheet"
      className="cheat-sheet mb-10 border border-[#0C1B33]/15 bg-white rounded-xl overflow-hidden print:border-0 print:rounded-none print:shadow-none"
    >
      {/* Header strip */}
      <div className="px-4 md:px-6 py-4 border-b border-[#0C1B33]/10 flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4 bg-[#FAF9F6] print:bg-white">
        <div className="min-w-0">
          <div className="font-mono-bureau text-[9px] tracking-[0.3em] uppercase text-[#2563EB]/60 mb-1">
            Cheat Sheet
          </div>
          <h2 className="font-editorial text-lg md:text-xl text-[#0C1B33] leading-tight">
            Chicago Incentive Explorer · One-Page Overview
          </h2>
          <p className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/35 mt-1">
            Generated {today} · chicagoincentiveexplorer.com
          </p>
        </div>
        <button
          onClick={() => {
            document.body.classList.add("printing-cheat-sheet");
            window.print();
            // Some browsers don't fire afterprint; clean up on a short timer too.
            setTimeout(
              () => document.body.classList.remove("printing-cheat-sheet"),
              500,
            );
          }}
          className="print:hidden shrink-0 inline-flex items-center justify-center gap-1.5 bg-[#0C1B33] hover:bg-[#1c2c4a] text-white font-mono-bureau text-[10px] tracking-[0.2em] uppercase px-4 py-2.5 rounded-full transition-colors w-full md:w-auto"
        >
          <Printer className="w-3.5 h-3.5" /> Print / Save as PDF
        </button>
      </div>

      {/* Zones vs Programs reminder strip */}
      <div className="px-6 py-3 grid grid-cols-1 md:grid-cols-2 gap-3 border-b border-[#0C1B33]/10 text-[11px] text-[#0C1B33]/65 leading-relaxed">
        <div>
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#2563EB]/60 mr-1.5">
            Zones
          </span>
          Geographic designations (TIF, OZ, Enterprise Zone, etc.). A location signal for the programs that reference them — a single address can sit in multiple overlapping zones.
        </div>
        <div>
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#059669]/70 mr-1.5">
            Programs
          </span>
          The actual benefits (grants, tax credits, financing) administered by an agency. Review the current program source for the boundary&apos;s role and any remaining criteria before applying.
        </div>
      </div>

      {/* Mobile-only gov-level tab selector (hidden on desktop and in print) */}
      <div className="lg:hidden print:hidden flex gap-1 px-3 py-3 border-b border-[#0C1B33]/10 overflow-x-auto">
        {CHEAT_LEVELS.map((level) => {
          const total = programs.filter((p) => p.level === level).length;
          const color = LEVEL_COLORS[level];
          const active = activeLevel === level;
          return (
            <button
              key={level}
              onClick={() => setActiveLevel(level)}
              className="shrink-0 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-3 py-1.5 rounded-full border transition-colors inline-flex items-center gap-1.5"
              style={{
                color: active ? "#fff" : color,
                backgroundColor: active ? color : "transparent",
                borderColor: active ? color : `${color}40`,
              }}
            >
              {level}
              <span
                className="font-mono-bureau text-[9px] tracking-normal"
                style={{ opacity: 0.7 }}
              >
                {total}
              </span>
            </button>
          );
        })}
      </div>

      {/* 5-column matrix (mobile: only active tab visible; desktop + print: all) */}
      <div className="cheat-matrix grid grid-cols-1 lg:grid-cols-5 gap-0 border-b border-[#0C1B33]/10 print:grid-cols-5">
        {CHEAT_LEVELS.map((level, colIdx) => {
          const programsAtLevel = programsByLevel(programs, level);
          const totalAtLevel = programsAtLevel.length;
          const color = LEVEL_COLORS[level];
          const visible = activeLevel === level;
          return (
            <div
              key={level}
              className={`px-4 py-4 ${colIdx > 0 ? "lg:border-l border-[#0C1B33]/8 print:border-l" : ""} ${visible ? "block" : "hidden"} lg:block print:block`}
            >
              <div className="flex items-baseline justify-between mb-3 pb-2 border-b border-[#0C1B33]/8">
                <span
                  className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase font-medium"
                  style={{ color }}
                >
                  {level}
                </span>
                <span className="font-mono-bureau text-[9px] tracking-[0.1em] uppercase text-[#0C1B33]/35">
                  {totalAtLevel} total
                </span>
              </div>
              <ul className="space-y-3">
                {programsAtLevel.map((p) => {
                  const s = statusLabel(p);
                  return (
                    <li key={p.id} className="text-[11px]">
                      <div className="text-[#0C1B33] font-medium leading-snug mb-0.5">
                        {p.name}
                        {s.tone === "caution" && (
                          <span className="ml-1.5 font-mono-bureau text-[8.5px] tracking-[0.1em] uppercase text-amber-700/80">
                            · {s.text}
                          </span>
                        )}
                      </div>
                      {p.benefit.summary && (
                        <div className="text-[#0C1B33]/55 text-[10.5px] leading-snug mb-0.5">
                          {p.benefit.summary}
                        </div>
                      )}
                    </li>
                  );
                })}
                {programsAtLevel.length === 0 && (
                  <li className="text-[10px] text-[#0C1B33]/30 italic">
                    None listed yet
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Verify-first callout + footer */}
      <div className="px-6 py-3 bg-[#FAF9F6] print:bg-white flex flex-wrap items-center justify-between gap-3 text-[10.5px] text-[#0C1B33]/55">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
          <span>
            <strong className="text-[#0C1B33]/70">Verify with the official source.</strong>{" "}
            This is a discovery tool — not legal, tax, or eligibility advice.{" "}
            {
              // Locked verification copy, verbatim — lib/outreach-letter.ts's
              // VERIFICATION_DISCLAIMER re-uses this exact sentence for every
              // per-parcel program mention in the outreach letter (see
              // lib/__tests__/outreach-letter.test.ts's byte-for-byte lock),
              // so this string must never be paraphrased here independently.
              "Some incentives require certification, pre-approval, or reporting through the administering agency. Verify current requirements with the official source before applying, purchasing materials, or beginning work."
            }
          </span>
        </div>
        <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30">
          chicagoincentiveexplorer.com
        </span>
      </div>
    </section>
  );
}
