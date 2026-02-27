"use client";

import { useState, useEffect } from "react";
import { MapPin, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { ZONE_KEYS, ZONE_LABELS, ZONE_COLORS } from "@/lib/constants";
import { runConfidenceEngine, computeTopActions, computeStackingNarrative } from "@/lib/confidence-engine";
import type { StackingNarrative } from "@/lib/confidence-engine";
import { TopActionsStrip } from "./TopActionsStrip";
import { ProgramResultCard } from "./ProgramResultCard";
import type { Program, SurveyAnswers, ProgramCheckResult, TopAction, CityZoning, CensusData } from "@/lib/types";
import { censusNarrative } from "@/lib/census-narrative";

interface CheckResultsProps {
  address: string;
  lat: number;
  lon: number;
  survey?: SurveyAnswers;
}

interface ZoneCheckResult {
  key: string;
  name: string;
}

const LOADING_STEPS = [
  "Checking incentive zones...",
  "Loading program data...",
  "Analyzing eligibility...",
  "Preparing results...",
];

export function CheckResults({ address, lat, lon, survey }: CheckResultsProps) {
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);
  const [zones, setZones] = useState<Record<string, boolean>>({});
  const [zoneNames, setZoneNames] = useState<Record<string, string>>({});
  const [zoneCount, setZoneCount] = useState(0);
  const [programs, setPrograms] = useState<ProgramCheckResult[]>([]);
  const [topActions, setTopActions] = useState<TopAction[]>([]);
  const [cityZoning, setCityZoning] = useState<CityZoning | undefined>();
  const [census, setCensus] = useState<CensusData | undefined>();
  const [copied, setCopied] = useState(false);
  const [showNotApplicable, setShowNotApplicable] = useState(false);
  const [stackingNarrative, setStackingNarrative] = useState<StackingNarrative | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stepInterval = setInterval(() => {
      setLoadingStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1));
    }, 800);

    async function fetchResults() {
      try {
        // Fetch zone check, programs, census, and zoning in parallel
        const [zoneRes, programsRes, censusRes, zoningRes] = await Promise.all([
          fetch(`/api/zones/check?lat=${lat}&lon=${lon}`).then((r) =>
            r.ok ? r.json() : []
          ),
          fetch("/api/programs")
            .then((r) => (r.ok ? r.json() : Promise.reject()))
            .catch(() => fetch("/data/programs.json").then((r) => r.json())),
          fetch(`/api/census?lat=${lat}&lon=${lon}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch(`/api/zoning?lat=${lat}&lon=${lon}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ]);

        if (cancelled) return;

        // Build zone maps
        const zoneMap: Record<string, boolean> = {};
        const nameMap: Record<string, string> = {};
        for (const key of ZONE_KEYS) {
          zoneMap[key] = false;
        }
        let count = 0;
        for (const r of zoneRes as ZoneCheckResult[]) {
          zoneMap[r.key] = true;
          if (r.name) nameMap[r.key] = r.name;
          count++;
        }

        // Run confidence engine
        const allPrograms: Program[] = programsRes;
        const results = runConfidenceEngine(allPrograms, zoneMap, nameMap, survey);
        const actions = computeTopActions(results);

        // Compute stacking narrative
        const narrative = computeStackingNarrative(zoneMap, nameMap);

        setZones(zoneMap);
        setZoneNames(nameMap);
        setZoneCount(count);
        setPrograms(results);
        setTopActions(actions);
        setStackingNarrative(narrative);
        if (censusRes) setCensus(censusRes);
        if (zoningRes?.zoneClass) setCityZoning(zoningRes);
      } catch (err) {
        console.error("CheckResults fetch error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchResults();
    return () => {
      cancelled = true;
      clearInterval(stepInterval);
    };
  }, [lat, lon, survey]);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="w-full max-w-2xl mx-auto py-16 text-center">
        <div className="inline-flex flex-col items-center gap-4">
          {/* Skeleton cards */}
          <div className="w-full max-w-md space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 bg-[#0C1B33]/3 rounded-lg animate-pulse"
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </div>
          <p className="font-mono-bureau text-[11px] tracking-wide text-[#0C1B33]/40 mt-4">
            {LOADING_STEPS[loadingStep]}
          </p>
        </div>
      </div>
    );
  }

  const applicablePrograms = programs.filter(
    (p) => p.confidence !== "not_applicable"
  );
  const notApplicablePrograms = programs.filter(
    (p) => p.confidence === "not_applicable"
  );

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Address header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-4 h-4 text-[#2563EB] shrink-0" />
            <h2 className="text-lg font-semibold text-[#0C1B33]/90 truncate">
              {address}
            </h2>
          </div>
          <p className="text-[11px] font-mono-bureau tracking-wide text-[#0C1B33]/40">
            {zoneCount} of {ZONE_KEYS.length} incentive zones
            {cityZoning && ` · ${cityZoning.zoneClass} zoning`}
          </p>
        </div>
        <button
          onClick={handleCopyUrl}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono-bureau tracking-[0.1em] uppercase text-[#0C1B33]/40 border border-[#0C1B33]/10 rounded-lg hover:border-[#2563EB]/30 hover:text-[#2563EB] transition-all shrink-0"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              Share
            </>
          )}
        </button>
      </div>

      {/* Zone pills */}
      {zoneCount > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-6">
          {ZONE_KEYS.filter((k) => zones[k]).map((key) => (
            <span
              key={key}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono-bureau tracking-[0.05em] border rounded-full"
              style={{
                borderColor: `${ZONE_COLORS[key]}40`,
                color: ZONE_COLORS[key],
                backgroundColor: `${ZONE_COLORS[key]}08`,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: ZONE_COLORS[key] }}
              />
              {ZONE_LABELS[key]}
            </span>
          ))}
        </div>
      )}

      {/* Zone Power Score */}
      {stackingNarrative && zoneCount > 0 && (
        <div className="mb-6 p-4 bg-gradient-to-br from-[#2563EB]/[0.04] to-[#7C3AED]/[0.03] border border-[#2563EB]/10 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-[#2563EB]/10 rounded-full flex items-center justify-center">
              <span className="font-editorial text-[16px] text-[#2563EB] font-bold">{zoneCount}</span>
            </div>
            <div>
              <span className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#2563EB]/70 block">
                Zone Power Score
              </span>
              <span className="font-mono-bureau text-[9px] tracking-[0.1em] text-[#0C1B33]/30">
                {stackingNarrative.percentileLabel} of Chicago locations
              </span>
            </div>
          </div>
          <p className="text-[12px] text-[#0C1B33]/55 leading-relaxed mb-3">
            {stackingNarrative.narrative}
          </p>

          {/* Zone combination cards */}
          {stackingNarrative.combinations.length > 0 && (
            <div className="space-y-2">
              {stackingNarrative.combinations.slice(0, 3).map((combo, i) => (
                <div key={i} className="bg-white border border-[#0C1B33]/6 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span className="font-mono-bureau text-[9px] tracking-[0.1em] uppercase text-emerald-600">
                      {combo.zones.join(" + ")}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#0C1B33]/50 leading-relaxed">
                    {combo.benefit}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top Actions */}
      <TopActionsStrip actions={topActions} hasSurvey={!!survey} />

      {/* Program Results */}
      <div className="mb-4">
        <h3 className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/40 mb-3">
          Programs ({applicablePrograms.length} applicable)
        </h3>
      </div>

      <div className="space-y-3">
        {applicablePrograms.map((result, i) => (
          <ProgramResultCard
            key={result.programId}
            result={result}
            defaultExpanded={i < 3}
          />
        ))}
      </div>

      {/* Not Applicable (collapsed section) */}
      {notApplicablePrograms.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowNotApplicable(!showNotApplicable)}
            className="flex items-center gap-2 text-[10px] font-mono-bureau tracking-[0.2em] uppercase text-[#0C1B33]/30 hover:text-[#0C1B33]/50 transition-colors"
          >
            {showNotApplicable ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
            {notApplicablePrograms.length} not applicable at this location
          </button>

          {showNotApplicable && (
            <div className="mt-3 space-y-2">
              {notApplicablePrograms.map((result) => (
                <ProgramResultCard key={result.programId} result={result} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Neighborhood Intelligence */}
      {census && (() => {
        const narrative = censusNarrative(census);

        return (
          <div className="mt-8 space-y-4">
            <h4 className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/30">
              Neighborhood Intelligence
            </h4>

            {/* Why This Location Qualifies */}
            <div className="p-4 bg-gradient-to-br from-[#2563EB]/[0.03] to-[#7C3AED]/[0.02] border border-[#2563EB]/10 rounded-lg">
              <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#2563EB]/60 block mb-2">
                Why This Location Qualifies
              </span>
              <p className="text-[12px] text-[#0C1B33]/60 leading-relaxed">
                {narrative.qualificationNarrative}
              </p>
              {narrative.unlockedPrograms.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {narrative.unlockedPrograms.map((prog) => (
                    <span key={prog} className="inline-flex items-center px-2 py-0.5 text-[9px] font-mono-bureau tracking-[0.05em] bg-emerald-50 border border-emerald-200/50 text-emerald-700 rounded-sm">
                      {prog}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Interpreted Census Stats */}
            <div className="grid gap-3 sm:grid-cols-2">
              {narrative.incomeNarrative && (
                <div className="p-4 bg-[#0C1B33]/[0.02] border border-[#0C1B33]/5 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/30">
                      Median Income
                    </span>
                    {narrative.incomePercentOfMetro != null && (
                      <span className={`font-mono-bureau text-[9px] tracking-[0.1em] px-1.5 py-0.5 rounded-sm ${
                        narrative.isLikelyQCT
                          ? "bg-emerald-50 text-emerald-600 border border-emerald-200/50"
                          : narrative.isLMI
                            ? "bg-amber-50 text-amber-600 border border-amber-200/50"
                            : "bg-[#0C1B33]/5 text-[#0C1B33]/40"
                      }`}>
                        {narrative.incomePercentOfMetro}% of metro
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[#0C1B33]/55 leading-relaxed">
                    {narrative.incomeNarrative}
                  </p>
                </div>
              )}

              {narrative.homeValueNarrative && (
                <div className="p-4 bg-[#0C1B33]/[0.02] border border-[#0C1B33]/5 rounded-lg">
                  <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/30 block mb-2">
                    Property Values
                  </span>
                  <p className="text-[12px] text-[#0C1B33]/55 leading-relaxed">
                    {narrative.homeValueNarrative}
                  </p>
                </div>
              )}

              {narrative.populationNarrative && (
                <div className="p-4 bg-[#0C1B33]/[0.02] border border-[#0C1B33]/5 rounded-lg">
                  <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/30 block mb-2">
                    Population
                  </span>
                  <p className="text-[12px] text-[#0C1B33]/55 leading-relaxed">
                    {narrative.populationNarrative}
                  </p>
                </div>
              )}

              {census.tractId && (
                <div className="p-4 bg-[#0C1B33]/[0.02] border border-[#0C1B33]/5 rounded-lg">
                  <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/30 block mb-2">
                    Census Tract
                  </span>
                  <p className="text-sm font-medium text-[#0C1B33]/70 font-mono-bureau">
                    {census.tractId}
                  </p>
                  <p className="text-[11px] text-[#0C1B33]/35 mt-1">
                    American Community Survey (ACS 5-Year Estimates)
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
