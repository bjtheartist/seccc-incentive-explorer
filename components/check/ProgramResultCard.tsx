"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { NotVerifiedSection } from "./NotVerifiedSection";
import type { ProgramCheckResult } from "@/lib/types";

interface ProgramResultCardProps {
  result: ProgramCheckResult;
  defaultExpanded?: boolean;
}

export function ProgramResultCard({
  result,
  defaultExpanded = false,
}: ProgramResultCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isCollapsed = result.confidence === "not_applicable";

  if (isCollapsed && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full text-left p-3 bg-gray-50/50 border border-gray-100 rounded-lg flex items-center justify-between group hover:border-gray-200 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm text-[#0C1B33]/30">{result.program.name}</span>
          <ConfidenceBadge
            confidence={result.confidence}
            label={result.confidenceLabel}
          />
        </div>
        <ChevronDown className="w-4 h-4 text-[#0C1B33]/20 group-hover:text-[#0C1B33]/40 shrink-0" />
      </button>
    );
  }

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${
        result.confidence === "appears_eligible" || result.confidence === "location_eligible"
          ? "border-emerald-200 bg-white"
          : result.confidence === "may_qualify"
          ? "border-amber-200 bg-white"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h4 className="text-sm font-semibold text-[#0C1B33]/90">
                {result.program.name}
              </h4>
              <span className="text-[10px] font-mono-bureau tracking-[0.1em] uppercase text-[#0C1B33]/30">
                {result.program.level}
              </span>
            </div>
            <ConfidenceBadge
              confidence={result.confidence}
              label={result.confidenceLabel}
            />
          </div>
          {isCollapsed && (
            <button
              onClick={() => setExpanded(false)}
              className="text-[#0C1B33]/30 hover:text-[#0C1B33]/60"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Why one-line */}
        <p className="text-sm text-[#0C1B33]/60 mt-2 leading-relaxed">
          {result.whyOneLine}
        </p>

        {/* Benefit range */}
        <div className="mt-3 flex flex-wrap gap-4">
          <div>
            <span className="text-[10px] font-mono-bureau tracking-[0.1em] uppercase text-[#0C1B33]/30">
              Benefit
            </span>
            <p className="text-sm font-medium text-[#0C1B33]/80 mt-0.5">
              {result.benefitRange}
            </p>
          </div>
        </div>

        {/* Fastest step */}
        <div className="mt-3 flex items-center gap-2 text-[#2563EB]">
          <ArrowRight className="w-3.5 h-3.5 shrink-0" />
          <p className="text-xs leading-snug">{result.fastestStep}</p>
        </div>

        {/* Not verified */}
        {result.notVerified.length > 0 && (
          <NotVerifiedSection items={result.notVerified} />
        )}
      </div>
    </div>
  );
}
