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
} from "lucide-react";
import type { Program } from "@/lib/types";
import { ZONE_COLORS } from "@/lib/constants";
import { INDUSTRIES, getIndustryById } from "@/lib/industries-data";

const LEVELS = ["All", "Federal", "State", "County", "City"] as const;

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

  useEffect(() => {
    fetch("/data/programs.json")
      .then((r) => r.json())
      .then(setPrograms);
  }, []);

  // Sync URL param on mount
  useEffect(() => {
    if (industryParam) setIndustryFilter(industryParam);
  }, [industryParam]);

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
              : `${programs.length} programs available to Chicago businesses across federal, state, county, and city levels.`}
          </p>
        </div>
      </div>

      <div className="container mx-auto max-w-4xl px-6 py-10 bg-[#FAF9F6]">
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
            <ProgramCard key={program.id} program={program} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProgramCard({ program }: { program: Program }) {
  const [expanded, setExpanded] = useState(false);
  const color = ZONE_COLORS[program.zoneKey] || "#6b7280";

  const levelColors: Record<string, string> = {
    Federal: "#2563eb",
    State: "#7c3aed",
    County: "#d97706",
    City: "#16a34a",
  };
  const levelColor = levelColors[program.level] || "#6b7280";

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
            <span
              className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase px-2.5 py-1 rounded-full"
              style={{ color: levelColor, backgroundColor: `${levelColor}12` }}
            >
              {program.level}
            </span>
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

          {/* Contact & Link */}
          <div className="flex items-center justify-between pt-4 border-t border-[#0C1B33]/5 text-sm">
            <span className="text-[#0C1B33]/35 flex items-center gap-1.5 font-mono-bureau text-[10px]">
              <Phone className="w-3 h-3" />
              {program.contact}
            </span>
            <a
              href={program.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white bg-[#2563EB] hover:bg-[#1d4ed8] inline-flex items-center gap-1.5 font-mono-bureau text-[10px] tracking-[0.1em] uppercase px-4 py-2 rounded-full transition-colors"
            >
              Official Website <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
