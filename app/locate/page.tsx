"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft, MapPin, CheckCircle2, ArrowRight } from "lucide-react";
import { INDUSTRIES, type Industry } from "@/lib/industries-data";
import { PROGRAMS } from "@/lib/survey-engine";
import { ZONE_LABELS, ZONE_COLORS } from "@/lib/constants";
import type { Program } from "@/lib/types";

// Zoning compatibility: which Chicago zoning classes work for each sector
const ZONING_FIT: Record<string, { best: string[]; also: string[]; avoid: string[] }> = {
  ev: { best: ["M1", "M2", "PMD"], also: ["C3", "DX"], avoid: ["RS", "RT"] },
  semiconductor: { best: ["M1", "M2", "PMD"], also: ["C3"], avoid: ["RS", "RT", "RM"] },
  dataCenter: { best: ["M1", "M2", "PMD", "C3"], also: ["DX"], avoid: ["RS", "RT"] },
  manufacturing: { best: ["M1", "M2", "PMD"], also: ["C3"], avoid: ["RS", "RT", "RM", "B"] },
  retail: { best: ["B1", "B2", "B3", "C1", "C2"], also: ["DX", "DC"], avoid: ["M2", "RS"] },
  professional: { best: ["B1", "B2", "C1", "C2"], also: ["DX", "DC", "DS"], avoid: ["M2", "RS"] },
  construction: { best: ["M1", "C3"], also: ["B3", "M2"], avoid: ["RS", "RT", "RM"] },
  healthcare: { best: ["B1", "B2", "C1", "C2"], also: ["B3", "DX"], avoid: ["M2", "PMD"] },
  tech: { best: ["B1", "B2", "C1", "C2"], also: ["DX", "DC"], avoid: ["M2"] },
  nonprofit: { best: ["B1", "B2", "C1", "C2"], also: ["DX", "RM"], avoid: ["M2", "PMD"] },
  realEstate: { best: ["B3", "C1", "C2", "DX"], also: ["RM", "RT"], avoid: ["PMD"] },
  food: { best: ["M1", "C3", "B3"], also: ["C1", "C2"], avoid: ["RS", "RT"] },
  logistics: { best: ["M1", "M2", "C3"], also: ["PMD"], avoid: ["RS", "RT", "RM", "B1"] },
  arts: { best: ["B1", "B2", "C1", "C2"], also: ["DX", "M1"], avoid: ["RS"] },
  hairBeauty: { best: ["B1", "B2", "B3", "C1"], also: ["C2", "DX"], avoid: ["M1", "M2", "RS"] },
  clothing: { best: ["B1", "B2", "B3", "C1"], also: ["C2", "DX", "DC"], avoid: ["M1", "M2", "RS"] },
  autoServices: { best: ["C2", "C3", "M1"], also: ["B3"], avoid: ["RS", "RT", "RM", "B1"] },
  childcare: { best: ["B1", "B2", "C1"], also: ["RM", "RT", "DX"], avoid: ["M1", "M2", "PMD"] },
  fitness: { best: ["B1", "B2", "B3", "C1"], also: ["C2", "DX"], avoid: ["M2", "RS"] },
  homeServices: { best: ["B1", "B2", "C1"], also: ["C2", "M1"], avoid: ["RS"] },
  petServices: { best: ["B1", "B2", "B3", "C1"], also: ["C2"], avoid: ["RS", "RT"] },
};

// Area recommendations within SSA #50
const AREA_ZONES: { name: string; desc: string; zonings: string[]; incentives: string[] }[] = [
  {
    name: "Stony Island Ave Corridor",
    desc: "High-traffic commercial corridor with strong TIF and SSA coverage. Ideal for retail, restaurants, and service businesses.",
    zonings: ["B1", "B2", "B3", "C1"],
    incentives: ["tif", "ssa", "federalOZ"],
  },
  {
    name: "83rd St Commercial District",
    desc: "Core commercial strip with SBIF project history. Great for storefront businesses, salons, and professional offices.",
    zonings: ["B1", "B2", "C1"],
    incentives: ["tif", "ssa", "enterprise"],
  },
  {
    name: "South Chicago Industrial Corridor",
    desc: "Manufacturing and industrial zone along the Calumet River. Best for production, logistics, and large-footprint operations.",
    zonings: ["M1", "M2", "PMD"],
    incentives: ["enterprise", "edge", "tif", "highUnemployment"],
  },
  {
    name: "Commercial Ave Strip",
    desc: "Mixed commercial zone with Enterprise Zone and high foot traffic. Good for service businesses and small retail.",
    zonings: ["B1", "B2", "C1", "C2"],
    incentives: ["enterprise", "ssa", "tif"],
  },
  {
    name: "Opportunity Zone Census Tracts",
    desc: "Federal and Illinois Opportunity Zone overlap areas. Best for investors, developers, and capital-intensive projects.",
    zonings: ["B3", "C1", "C2", "M1"],
    incentives: ["federalOZ", "tif", "stateIncentiveZones"],
  },
];

function getSectorAreas(industry: Industry) {
  const fit = ZONING_FIT[industry.id] || ZONING_FIT.retail;
  const bestZonings = new Set([...fit.best, ...fit.also]);

  return AREA_ZONES
    .map((area) => {
      const zoningMatch = area.zonings.filter((z) => bestZonings.has(z)).length;
      const incentiveMatch = area.incentives.filter((z) => industry.topPrograms.includes(z)).length;
      const score = zoningMatch * 2 + incentiveMatch;
      return { ...area, score, zoningMatch, incentiveMatch };
    })
    .sort((a, b) => b.score - a.score);
}

export default function LocatePage() {
  const [selected, setSelected] = useState<Industry | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);

  useEffect(() => {
    fetch("/data/programs.json")
      .then((r) => r.json())
      .then(setPrograms);
  }, []);

  const programMap = new Map(programs.map((p) => [p.zoneKey || p.id, p]));
  const fit = selected ? (ZONING_FIT[selected.id] || ZONING_FIT.retail) : null;
  const areas = selected ? getSectorAreas(selected) : [];

  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      {/* Hero */}
      <section className="bg-[#0C1B33] text-white py-16 px-6">
        <div className="container mx-auto max-w-5xl">
          <div className="flex items-center gap-4 mb-8">
            <Link
              href="/"
              className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-white/40 hover:text-white transition-colors flex items-center gap-2"
            >
              <ArrowLeft className="w-3 h-3" /> Home
            </Link>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="w-8 h-0.5 bg-[#2563EB]" />
              <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
                Location Finder
              </span>
            </div>
            <h1 className="font-editorial text-4xl md:text-5xl lg:text-6xl font-normal leading-[0.95] mb-6">
              Find the Best
              <br />
              <span className="text-white/40">Location for</span>
              <br />
              Your Business
            </h1>
            <p className="text-white/50 text-base max-w-xl leading-relaxed">
              Select your business sector and we&rsquo;ll show you the best areas
              in Southeast Chicago based on city zoning ordinances and available incentive programs.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Sector Selection Grid */}
      <section className="py-16 px-6">
        <div className="container mx-auto max-w-5xl">
          <div className="flex items-center gap-4 mb-8">
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/30">
              01
            </span>
            <div className="w-8 h-0.5 bg-[#2563EB]" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/50">
              Select Your Sector
            </span>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {INDUSTRIES.map((industry, i) => (
              <motion.button
                key={industry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.03 }}
                onClick={() => setSelected(industry)}
                className={`group block bg-white border rounded-xl p-5 text-left transition-all ${
                  selected?.id === industry.id
                    ? "border-[#2563EB] shadow-md shadow-blue-500/10 ring-1 ring-[#2563EB]/20"
                    : "border-[#0C1B33]/8 hover:shadow-md hover:border-[#2563EB]/20"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl leading-none">{industry.icon}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className={`text-sm font-medium transition-colors ${
                      selected?.id === industry.id ? "text-[#2563EB]" : "text-[#0C1B33] group-hover:text-[#2563EB]"
                    }`}>
                      {industry.name}
                    </h3>
                    <p className="text-[11px] text-[#0C1B33]/40 mt-1 leading-relaxed line-clamp-2">
                      {industry.description}
                    </p>
                    <div className="flex items-center gap-2 mt-3">
                      <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#2563EB]/60">
                        {industry.topPrograms.length} programs
                      </span>
                    </div>
                  </div>
                  {selected?.id === industry.id && (
                    <CheckCircle2 className="w-5 h-5 text-[#2563EB] shrink-0" />
                  )}
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      </section>

      {/* Results */}
      {selected && fit && (
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {/* Zoning Compatibility */}
          <section className="py-16 px-6 bg-[#EFF3FB]">
            <div className="container mx-auto max-w-5xl">
              <div className="flex items-center gap-4 mb-8">
                <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/30">
                  02
                </span>
                <div className="w-8 h-0.5 bg-[#2563EB]" />
                <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/50">
                  Zoning Compatibility
                </span>
              </div>

              <h2 className="font-editorial text-2xl md:text-3xl text-[#0C1B33] mb-2">
                City Zoning for{" "}
                <span className="text-[#0C1B33]/40">{selected.name}</span>
              </h2>
              <p className="text-sm text-[#0C1B33]/50 mb-8 max-w-xl">
                Chicago zoning ordinances determine what types of businesses can operate at each location.
                Here&rsquo;s how different zoning classifications match your sector.
              </p>

              <div className="grid md:grid-cols-3 gap-4">
                {/* Best Fit */}
                <div className="bg-white border border-green-200 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-green-600">
                      Best Fit
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {fit.best.map((z) => (
                      <span
                        key={z}
                        className="px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg font-mono-bureau text-sm text-green-700"
                      >
                        {z}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-[#0C1B33]/40 mt-3 leading-relaxed">
                    These zoning classifications are the most compatible with {selected.name.toLowerCase()} operations.
                  </p>
                </div>

                {/* Also Works */}
                <div className="bg-white border border-amber-200 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-amber-600">
                      May Work
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {fit.also.map((z) => (
                      <span
                        key={z}
                        className="px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg font-mono-bureau text-sm text-amber-700"
                      >
                        {z}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-[#0C1B33]/40 mt-3 leading-relaxed">
                    These may work depending on specific use and special use permits.
                  </p>
                </div>

                {/* Avoid */}
                <div className="bg-white border border-red-200 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-red-600">
                      Not Compatible
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {fit.avoid.map((z) => (
                      <span
                        key={z}
                        className="px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg font-mono-bureau text-sm text-red-700"
                      >
                        {z}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-[#0C1B33]/40 mt-3 leading-relaxed">
                    These zoning classifications typically don&rsquo;t permit {selected.name.toLowerCase()} uses.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Recommended Areas */}
          <section className="py-16 px-6 bg-white">
            <div className="container mx-auto max-w-5xl">
              <div className="flex items-center gap-4 mb-8">
                <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/30">
                  03
                </span>
                <div className="w-8 h-0.5 bg-[#2563EB]" />
                <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/50">
                  Recommended Areas
                </span>
              </div>

              <h2 className="font-editorial text-2xl md:text-3xl text-[#0C1B33] mb-2">
                Best Areas for{" "}
                <span className="text-[#0C1B33]/40">{selected.name}</span>
              </h2>
              <p className="text-sm text-[#0C1B33]/50 mb-8 max-w-xl">
                Areas ranked by zoning compatibility and incentive program overlap.
              </p>

              <div className="space-y-4">
                {areas.map((area, i) => (
                  <motion.div
                    key={area.name}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.1 }}
                    className={`border rounded-xl p-6 transition-all ${
                      i === 0
                        ? "border-[#2563EB]/30 bg-[#EFF3FB]/50 shadow-sm"
                        : "border-[#0C1B33]/8 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono-bureau text-sm font-bold ${
                          i === 0
                            ? "bg-[#2563EB] text-white"
                            : "bg-[#0C1B33]/5 text-[#0C1B33]/40"
                        }`}>
                          {i + 1}
                        </div>
                        <div>
                          <h3 className="text-base font-medium text-[#0C1B33]">{area.name}</h3>
                          {i === 0 && (
                            <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#2563EB]">
                              Best Match
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-[#0C1B33]/30" />
                        <span className="font-mono-bureau text-[9px] text-[#0C1B33]/30">
                          SSA #50
                        </span>
                      </div>
                    </div>

                    <p className="text-sm text-[#0C1B33]/50 mb-4 leading-relaxed">
                      {area.desc}
                    </p>

                    <div className="flex flex-wrap gap-4">
                      {/* Zoning tags */}
                      <div>
                        <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-1.5">
                          Zoning
                        </span>
                        <div className="flex gap-1.5">
                          {area.zonings.map((z) => {
                            const bestSet = new Set(fit.best);
                            const isBest = bestSet.has(z);
                            return (
                              <span
                                key={z}
                                className={`px-2 py-1 rounded font-mono-bureau text-[10px] ${
                                  isBest
                                    ? "bg-green-50 text-green-700 border border-green-200"
                                    : "bg-[#0C1B33]/5 text-[#0C1B33]/40"
                                }`}
                              >
                                {z}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {/* Incentive tags */}
                      <div>
                        <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-1.5">
                          Incentives Available
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {area.incentives.map((z) => {
                            const isRelevant = selected.topPrograms.includes(z);
                            const color = ZONE_COLORS[z] || "#6b7280";
                            return (
                              <span
                                key={z}
                                className="px-2 py-1 rounded font-mono-bureau text-[10px] border"
                                style={isRelevant ? {
                                  backgroundColor: `${color}10`,
                                  color: color,
                                  borderColor: `${color}30`,
                                } : {
                                  backgroundColor: "transparent",
                                  color: "#0C1B3340",
                                  borderColor: "#0C1B3310",
                                }}
                              >
                                {ZONE_LABELS[z] || z}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>

          {/* Programs for this sector */}
          <section className="py-16 px-6 bg-[#FAF9F6]">
            <div className="container mx-auto max-w-5xl">
              <div className="flex items-center gap-4 mb-8">
                <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/30">
                  04
                </span>
                <div className="w-8 h-0.5 bg-[#2563EB]" />
                <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/50">
                  Available Programs
                </span>
              </div>

              <h2 className="font-editorial text-2xl md:text-3xl text-[#0C1B33] mb-8">
                Programs for{" "}
                <span className="text-[#0C1B33]/40">{selected.name}</span>
              </h2>

              <div className="grid sm:grid-cols-2 gap-4">
                {selected.topPrograms.map((pid) => {
                  const prog = programMap.get(pid);
                  const surveyProg = PROGRAMS[pid];
                  if (!prog && !surveyProg) return null;
                  const name = prog?.name || surveyProg?.name || pid;
                  const summary = prog?.summary || "";
                  const color = ZONE_COLORS[pid] || "#2563EB";

                  return (
                    <div
                      key={pid}
                      className="bg-white border border-[#0C1B33]/8 rounded-xl p-5 hover:shadow-md transition-shadow"
                      style={{ borderLeftWidth: 3, borderLeftColor: color }}
                    >
                      <h3 className="text-sm font-medium text-[#0C1B33] mb-1">{name}</h3>
                      <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/30">
                        {prog?.level || ""}
                      </span>
                      {summary && (
                        <p className="text-[11px] text-[#0C1B33]/40 mt-2 leading-relaxed line-clamp-3">
                          {summary}
                        </p>
                      )}
                      {prog?.benefits && prog.benefits.length > 0 && (
                        <div className="mt-3 space-y-1">
                          {prog.benefits.slice(0, 2).map((b, j) => (
                            <div key={j} className="flex gap-1.5 text-[11px] text-green-600">
                              <span className="shrink-0">+</span>
                              <span className="line-clamp-1">{b}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="py-16 px-6 bg-[#0C1B33] text-white">
            <div className="container mx-auto max-w-3xl text-center">
              <h2 className="font-editorial text-2xl md:text-3xl mb-4">
                Ready to Review Vacant Properties?
              </h2>
              <p className="text-white/50 text-sm mb-8 max-w-md mx-auto">
                Use the vacancy report to pull neighborhood-level vacant property records,
                incentive context, and a spreadsheet you can review or export.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  href="/report?wv=2&rt=df&source=locate"
                  className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-[#2563EB] hover:bg-[#1d4ed8] text-white rounded-full font-mono-bureau text-[11px] tracking-[0.15em] uppercase transition-all hover:shadow-lg hover:shadow-blue-500/25"
                >
                  Run Vacancy Report
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/report?source=locate"
                  className="inline-flex items-center justify-center gap-3 px-8 py-4 border border-white/15 hover:border-white/30 text-white/55 hover:text-white rounded-full font-mono-bureau text-[11px] tracking-[0.15em] uppercase transition-all"
                >
                  Check an Address
                </Link>
              </div>
            </div>
          </section>
        </motion.div>
      )}
    </div>
  );
}
