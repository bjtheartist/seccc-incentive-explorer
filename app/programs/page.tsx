"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ExternalLink,
  FileText,
  Phone,
  ChevronDown,
  ChevronUp,
  X,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Printer,
} from "lucide-react";
import Link from "next/link";
import type { Program, ProgramLevel } from "@/lib/types";
import { ZONE_COLORS, LEVEL_COLORS } from "@/lib/constants";
import { INDUSTRIES, getIndustryById } from "@/lib/industries-data";
import LevelBadge from "@/components/LevelBadge";

const LEVELS = ["All", "Federal", "State", "County", "City", "Utility"] as const;

interface LinkHealthEntry {
  programId: string;
  url: string;
  language: string;
  status: "ok" | "broken";
  checkedAt: string;
}

interface LinkHealthFile {
  checkedAt: string;
  portals: LinkHealthEntry[];
}

export default function ProgramsPage() {
  return (
    <Suspense>
      <ProgramsContent />
    </Suspense>
  );
}

function ProgramsContent() {
  const searchParams = useSearchParams();
  const industryParam = searchParams.get("industry");

  const [programs, setPrograms] = useState<Program[]>([]);
  const [filter, setFilter] = useState<string>("All");
  const [industryFilter, setIndustryFilter] = useState<string>(
    industryParam || ""
  );
  const [linkHealth, setLinkHealth] = useState<Map<string, "ok" | "broken">>(
    new Map(),
  );

  useEffect(() => {
    fetch("/data/programs.json")
      .then((r) => r.json())
      .then(setPrograms);
  }, []);

  useEffect(() => {
    fetch("/data/link-health.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LinkHealthFile | null) => {
        if (!d) return;
        const m = new Map<string, "ok" | "broken">();
        for (const p of d.portals) m.set(`${p.programId}:${p.url}`, p.status);
        setLinkHealth(m);
      })
      .catch(() => {});
  }, []);

  const selectedIndustry = industryFilter
    ? getIndustryById(industryFilter)
    : null;

  const filtered = programs.filter((p) => {
    const matchesLevel = filter === "All" || p.level === filter;
    const matchesIndustry =
      !selectedIndustry || selectedIndustry.topPrograms.includes(p.id);
    return matchesLevel && matchesIndustry;
  });

  return (
    <div className="min-h-screen">
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
              : `Multiple programs available to Chicago businesses across federal, state, county, and city levels.`}
          </p>
        </div>
      </div>

      <div className="container mx-auto max-w-4xl px-6 py-10 bg-[#FAF9F6]">
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
              neighborhood boundaries. Being <em>inside</em> a zone is the
              first eligibility gate — it determines which programs you can
              access. A single address can fall within multiple overlapping
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
        <CheatSheetSection programs={programs} />

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

        {/* Level Filter Tabs */}
        <div className="flex gap-0 border border-[#0C1B33]/10 mb-8 overflow-x-auto">
          {LEVELS.map((level) => {
            const count =
              level === "All"
                ? programs.length
                : programs.filter((p) => p.level === level).length;
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
            <ProgramCard key={program.id} program={program} linkHealth={linkHealth} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProgramCard({
  program,
  linkHealth,
}: {
  program: Program;
  linkHealth: Map<string, "ok" | "broken">;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = ZONE_COLORS[program.zoneKey] || "#6b7280";

  // Find the first Submittable portal whose link-health check passed.
  const submittablePortal = (program.applicationPortals || []).find(
    (p) =>
      p.type === "submittable" &&
      linkHealth.get(`${program.id}:${p.url}`) !== "broken",
  );
  const otherLangPortals = (program.applicationPortals || []).filter(
    (p) =>
      p.type === "submittable" &&
      p !== submittablePortal &&
      linkHealth.get(`${program.id}:${p.url}`) !== "broken",
  );

  return (
    <div
      className="bg-white rounded-xl shadow-sm hover:shadow-md transition-all overflow-hidden"
    >
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
            {program.status === "verify" && (
              <span
                title="Status pending verification — see notes."
                className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase px-2 py-1 rounded-full text-amber-700 bg-amber-100 inline-flex items-center gap-1"
              >
                <AlertTriangle className="w-3 h-3" /> Verify
              </span>
            )}
            {program.status === "sunset" && (
              <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase px-2 py-1 rounded-full text-red-700 bg-red-100">
                Sunset
              </span>
            )}
            {program.status === "pending" && (
              <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase px-2 py-1 rounded-full text-slate-600 bg-slate-100">
                Watch
              </span>
            )}
          </div>
          <p className="text-sm text-[#0C1B33]/50 leading-relaxed">{program.summary}</p>
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
          {/* Status banners — sunset / suspension / OZ 2.0 / boundary disclaimer */}
          {program.sunsetWarning && (
            <div className="border border-red-200 bg-red-50 rounded-lg p-3 flex gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-[12px] text-red-800 leading-relaxed">
                <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase mr-2">Heads up</span>
                {program.sunsetWarning}
              </p>
            </div>
          )}
          {program.suspensionNote && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 flex gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-800 leading-relaxed">
                <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase mr-2">Paused</span>
                {program.suspensionNote}
              </p>
            </div>
          )}
          {program.oz2Note && (
            <div className="border border-purple-200 bg-purple-50 rounded-lg p-3 flex gap-2.5">
              <AlertTriangle className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <p className="text-[12px] text-purple-900 leading-relaxed">
                <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase mr-2">OZ 2.0 watch</span>
                {program.oz2Note}
              </p>
            </div>
          )}
          {program.boundaryDisclaimer && (
            <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 flex gap-2.5">
              <AlertTriangle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <p className="text-[12px] text-slate-700 leading-relaxed">
                <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase mr-2">Boundary note</span>
                {program.boundaryDisclaimer}
              </p>
            </div>
          )}
          {program.expirationNote && (
            <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 flex gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <p className="text-[12px] text-slate-700 leading-relaxed">
                <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase mr-2">Timeline</span>
                {program.expirationNote}
              </p>
            </div>
          )}

          {/* Who Qualifies */}
          <div className="bg-[#EFF3FB] rounded-lg p-4">
            <h3 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#2563EB]/60 mb-2">
              Who Qualifies
            </h3>
            <p className="text-sm text-[#0C1B33]/60">{program.whoQualifies}</p>
          </div>

          {/* Benefits */}
          <div>
            <h3 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/35 mb-3">
              Benefits
            </h3>
            <ul className="text-sm space-y-2">
              {program.benefits.map((b, i) => (
                <li key={i} className="flex gap-2.5 text-[#0C1B33]/60">
                  <span className="w-5 h-5 rounded-full bg-[#16a34a]/10 text-[#16a34a] flex items-center justify-center text-xs shrink-0">+</span>
                  {b}
                </li>
              ))}
            </ul>
          </div>

          {/* How to Apply */}
          <div>
            <h3 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/35 mb-3">
              How to Apply
            </h3>
            <ol className="text-sm space-y-2 text-[#0C1B33]/60">
              {program.howToApply.map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-[#2563EB]/10 text-[#2563EB] flex items-center justify-center text-[10px] font-medium shrink-0">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {/* Required Documents */}
          <div>
            <h3 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/35 mb-3 flex items-center gap-1.5">
              <FileText className="w-3 h-3" />
              Required Documents
            </h3>
            <ul className="text-sm space-y-2 text-[#0C1B33]/60">
              {program.requiredDocs.map((doc, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="w-5 h-5 rounded border border-[#0C1B33]/15 shrink-0" />
                  {doc}
                </li>
              ))}
            </ul>
          </div>

          {/* Verification / next-step links — discovery, not compliance */}
          {program.verificationSteps && program.verificationSteps.length > 0 && (
            <div className="border border-[#0C1B33]/10 bg-[#FAF9F6] rounded-lg p-4">
              <h3 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/55 mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3" />
                Official next steps
              </h3>
              <p className="text-[11px] text-[#0C1B33]/55 mb-3 leading-relaxed">
                Some incentives require certification, pre-approval, or reporting through the administering agency. Verify current requirements with the official source before applying, purchasing materials, or beginning work.
              </p>
              <ul className="space-y-2">
                {program.verificationSteps.map((step, i) => (
                  <li key={i} className="text-[12px]">
                    <a
                      href={step.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#2563EB] hover:underline inline-flex items-center gap-1"
                    >
                      {step.label} <ExternalLink className="w-3 h-3" />
                    </a>
                    <span className="text-[#0C1B33]/45"> — {step.agency}</span>
                    {step.note && (
                      <p className="text-[11px] text-[#0C1B33]/50 mt-0.5">{step.note}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Contact + Apply / Official Source */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#0C1B33]/5 text-sm">
            <div className="flex flex-col gap-1">
              <span className="text-[#0C1B33]/35 flex items-center gap-1.5 font-mono-bureau text-[10px]">
                <Phone className="w-3 h-3" />
                {program.contact}
              </span>
              {program.lastVerifiedAt && (
                <span className="text-[#0C1B33]/30 font-mono-bureau text-[9px] tracking-[0.1em] uppercase">
                  Last verified {program.lastVerifiedAt}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {submittablePortal && (
                <a
                  href={submittablePortal.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white bg-[#16a34a] hover:bg-[#15803d] inline-flex items-center gap-1.5 font-mono-bureau text-[10px] tracking-[0.1em] uppercase px-4 py-2 rounded-full transition-colors"
                >
                  Apply via Submittable <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {otherLangPortals.map((p) => (
                <a
                  key={p.url}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#16a34a] border border-[#16a34a]/40 hover:bg-[#16a34a]/5 inline-flex items-center gap-1.5 font-mono-bureau text-[10px] tracking-[0.1em] uppercase px-3 py-2 rounded-full transition-colors"
                >
                  {p.language === "es" ? "Aplicar en español" : p.label}
                  <ExternalLink className="w-3 h-3" />
                </a>
              ))}
              <a
                href={program.sourceUrl || program.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#2563EB] border border-[#2563EB]/30 hover:bg-[#2563EB]/5 inline-flex items-center gap-1.5 font-mono-bureau text-[10px] tracking-[0.1em] uppercase px-4 py-2 rounded-full transition-colors"
              >
                Official Source <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ── Cheat-Sheet (printable at-a-glance matrix) ───────────────── */

const CHEAT_LEVELS: ProgramLevel[] = ["Federal", "State", "County", "City", "Utility"];

/** All programs at a given gov level, sorted with 'active' first then by recency. */
function programsByLevel(all: Program[], level: ProgramLevel): Program[] {
  return all
    .filter((p) => p.level === level)
    .sort((a, b) => {
      // Active first, then by last verified desc, then by name for stability
      const aActive = (a.status ?? "active") === "active" ? 0 : 1;
      const bActive = (b.status ?? "active") === "active" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const aDate = a.lastVerifiedAt ?? "";
      const bDate = b.lastVerifiedAt ?? "";
      const dateCmp = bDate.localeCompare(aDate);
      if (dateCmp !== 0) return dateCmp;
      return a.name.localeCompare(b.name);
    });
}

function CheatSheetSection({ programs }: { programs: Program[] }) {
  if (programs.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section
      id="cheat-sheet"
      className="cheat-sheet mb-10 border border-[#0C1B33]/15 bg-white rounded-xl overflow-hidden print:border-0 print:rounded-none print:shadow-none"
    >
      {/* Header strip */}
      <div className="px-6 py-4 border-b border-[#0C1B33]/10 flex items-center justify-between gap-4 bg-[#FAF9F6] print:bg-white">
        <div>
          <div className="font-mono-bureau text-[9px] tracking-[0.3em] uppercase text-[#2563EB]/60 mb-1">
            Cheat Sheet
          </div>
          <h2 className="font-editorial text-xl text-[#0C1B33]">
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
          className="print:hidden shrink-0 inline-flex items-center gap-1.5 bg-[#0C1B33] hover:bg-[#1c2c4a] text-white font-mono-bureau text-[10px] tracking-[0.2em] uppercase px-4 py-2.5 rounded-full transition-colors"
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
          Geographic designations (TIF, OZ, Enterprise Zone, etc.). The eligibility gate — a single address can sit in multiple overlapping zones.
        </div>
        <div>
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#059669]/70 mr-1.5">
            Programs
          </span>
          The actual benefits (grants, tax credits, financing) administered by an agency. Apply once your address sits inside the right zone.
        </div>
      </div>

      {/* 5-column matrix */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-0 border-b border-[#0C1B33]/10 print:grid-cols-5">
        {CHEAT_LEVELS.map((level, colIdx) => {
          const programsAtLevel = programsByLevel(programs, level);
          const totalAtLevel = programsAtLevel.length;
          const color = LEVEL_COLORS[level];
          return (
            <div
              key={level}
              className={`px-4 py-4 ${colIdx > 0 ? "lg:border-l border-[#0C1B33]/8 print:border-l" : ""}`}
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
                {programsAtLevel.map((p) => (
                  <li key={p.id} className="text-[11px]">
                    <div className="text-[#0C1B33] font-medium leading-snug mb-0.5">
                      {p.name}
                    </div>
                    {p.benefitRange && (
                      <div className="text-[#0C1B33]/55 text-[10.5px] leading-snug mb-0.5">
                        {p.benefitRange}
                      </div>
                    )}
                    {p.fastestConfirmingStep && (
                      <div className="text-[#0C1B33]/40 text-[10px] italic leading-snug">
                        → {p.fastestConfirmingStep}
                      </div>
                    )}
                  </li>
                ))}
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
            This is a discovery tool — not legal, tax, or eligibility advice. Confirm current requirements with the administering agency before applying, certifying, or relying on any program listed here.
          </span>
        </div>
        <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30">
          chicagoincentiveexplorer.com
        </span>
      </div>
    </section>
  );
}
