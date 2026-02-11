"use client";

import { motion } from "framer-motion";
import { ArrowRight, MapPin, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { SurveyResult, ProgramMatch } from "@/lib/types";

interface SurveyResultsProps {
  results: SurveyResult;
  onRetake: () => void;
}

export function SurveyResults({ results, onRetake }: SurveyResultsProps) {
  const { matches, total, totalPrograms } = results;

  const highMatches = matches.filter((m) => m.confidence === "high");
  const mediumMatches = matches.filter((m) => m.confidence === "medium");
  const lowMatches = matches.filter((m) => m.confidence === "low");

  // Score ring
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const progress = total / totalPrograms;
  const dashOffset = circumference * (1 - progress);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Header with score ring */}
      <div className="text-center mb-12">
        <span className="font-mono-bureau text-[10px] text-[#0C1B33]/25 uppercase tracking-[0.2em] block mb-6">
          Results
        </span>

        <div className="relative w-32 h-32 mx-auto mb-6">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r={radius} fill="none" stroke="#0C1B33" strokeOpacity="0.06" strokeWidth="4" />
            <motion.circle
              cx="60" cy="60" r={radius}
              fill="none" stroke="#2563EB" strokeWidth="4" strokeLinecap="butt"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: dashOffset }}
              transition={{ duration: 1.2, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.span
              className="font-editorial text-3xl text-[#0C1B33]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              {total}
            </motion.span>
            <span className="font-mono-bureau text-[9px] text-[#0C1B33]/30 uppercase tracking-[0.15em]">
              of {totalPrograms}
            </span>
          </div>
        </div>

        <h2 className="font-editorial text-2xl sm:text-3xl text-[#0C1B33] mb-2">
          You may qualify for {total} program{total !== 1 ? "s" : ""}
        </h2>
        <p className="font-mono-bureau text-[11px] text-[#0C1B33]/40 uppercase tracking-[0.1em]">
          Based on your business profile
        </p>
      </div>

      {/* Confidence groups */}
      <div className="space-y-8 mb-12">
        {highMatches.length > 0 && (
          <ConfidenceGroup label="High Match" matches={highMatches} color="#16A34A" />
        )}
        {mediumMatches.length > 0 && (
          <ConfidenceGroup label="Medium Match" matches={mediumMatches} color="#2563EB" />
        )}
        {lowMatches.length > 0 && (
          <ConfidenceGroup label="Worth Exploring" matches={lowMatches} color="#0C1B33" colorOpacity={0.3} />
        )}
      </div>

      {/* Location CTA */}
      <div className="border border-[#0C1B33]/8 bg-[#EFF3FB] p-6 sm:p-8 mb-6">
        <div className="flex items-start gap-4">
          <MapPin className="w-5 h-5 text-[#2563EB] flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-mono-bureau text-[12px] text-[#0C1B33] uppercase tracking-[0.1em] mb-2">
              Location matters too
            </h3>
            <p className="text-[#0C1B33]/50 text-sm leading-relaxed mb-4">
              Many of these programs are tied to specific Chicago zones — TIF districts,
              Enterprise Zones, Opportunity Zones, and more. Enter your address to see
              which location-based programs apply.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 font-mono-bureau text-[11px] text-[#2563EB] uppercase tracking-[0.1em] hover:text-[#0C1B33] transition-colors"
            >
              Check your address
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Retake */}
      <div className="text-center">
        <button
          onClick={onRetake}
          className="font-mono-bureau text-[11px] text-[#0C1B33]/30 uppercase tracking-[0.1em] hover:text-[#0C1B33] transition-colors cursor-pointer"
        >
          Retake survey
        </button>
      </div>
    </motion.div>
  );
}

function ConfidenceGroup({ label, matches, color, colorOpacity = 1 }: {
  label: string;
  matches: ProgramMatch[];
  color: string;
  colorOpacity?: number;
}) {
  const dotStyle = colorOpacity < 1
    ? { backgroundColor: color, opacity: colorOpacity }
    : { backgroundColor: color };

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-2 h-2" style={dotStyle} />
        <span className="font-mono-bureau text-[10px] text-[#0C1B33]/35 uppercase tracking-[0.15em]">
          {label} — {matches.length} program{matches.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-1">
        {matches.map((match) => (
          <ProgramCard key={match.programId} match={match} color={color} colorOpacity={colorOpacity} />
        ))}
      </div>
    </div>
  );
}

function ProgramCard({ match, color, colorOpacity = 1 }: {
  match: ProgramMatch;
  color: string;
  colorOpacity?: number;
}) {
  const dotStyle = colorOpacity < 1
    ? { backgroundColor: color, opacity: colorOpacity }
    : { backgroundColor: color };

  return (
    <div className="group border border-[#0C1B33]/5 bg-white hover:bg-[#EFF3FB] transition-colors">
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <span className="w-1.5 h-1.5 flex-shrink-0" style={dotStyle} />
            <span className="font-mono-bureau text-[12px] text-[#0C1B33] uppercase tracking-[0.05em] truncate">
              {match.program.name}
            </span>
          </div>
          <div className="pl-[18px]">
            <span className="font-mono-bureau text-[10px] text-[#0C1B33]/30 tracking-[0.05em]">
              Matched: {match.reasons.join(" + ")}
            </span>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-[#0C1B33]/15 flex-shrink-0 group-hover:text-[#0C1B33]/30" />
      </div>
    </div>
  );
}
