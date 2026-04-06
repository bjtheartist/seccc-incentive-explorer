"use client";

import { useState } from "react";
import { ZONE_KEYS, ZONE_LABELS, ZONE_COLORS } from "@/lib/constants";
import type { LookupResult, Program } from "@/lib/types";
import { ChevronDown, FileDown, Layers, MapPin, DollarSign, Building2, Mail } from "lucide-react";
import { EmailReportDialog } from "./EmailReportDialog";

interface ReportPreviewProps {
  result: LookupResult;
  programs: Program[];
  onExpand?: () => void;
}

/**
 * Compact inline report preview card.
 * Shows stacking score, top 3 programs, census snapshot, and zoning.
 * "View Full Breakdown" expands to existing detailed view.
 */
export function ReportPreview({ result, programs, onExpand }: ReportPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const eligibleKeys = ZONE_KEYS.filter((k) => result.zones[k]);
  const programMap = new Map(programs.map((p) => [p.zoneKey, p]));
  const topPrograms = eligibleKeys
    .map((k) => programMap.get(k))
    .filter(Boolean)
    .slice(0, 3);

  const scoreColor =
    result.incentiveCount >= 7
      ? "#4ADE80"
      : result.incentiveCount >= 4
        ? "#FBBF24"
        : result.incentiveCount >= 1
          ? "#FB923C"
          : "#EF4444";

  const handleExpand = () => {
    setExpanded(!expanded);
    if (!expanded && onExpand) onExpand();
  };

  const handleDownloadPDF = async () => {
    try {
      const { generateReport } = await import("@/lib/pdf-report");
      const programsRes = await fetch("/data/programs.json");
      const allPrograms = await programsRes.json();
      generateReport(result, allPrograms);
    } catch {
      // Silently fail
    }
  };

  return (
    <div className="border border-[#0C1B33]/10 bg-white overflow-hidden">
      {/* Header row: score + address */}
      <div className="flex items-center gap-4 px-5 py-4 border-b border-[#0C1B33]/6">
        {/* Score badge */}
        <div
          className="w-12 h-12 flex flex-col items-center justify-center flex-shrink-0"
          style={{ backgroundColor: scoreColor + "15" }}
        >
          <span
            className="font-editorial text-xl leading-none"
            style={{ color: scoreColor }}
          >
            {result.incentiveCount}
          </span>
          <span className="font-mono-bureau text-[7px] tracking-[0.1em] text-[#0C1B33]/30 uppercase">
            of {ZONE_KEYS.length}
          </span>
        </div>

        {/* Location info */}
        <div className="min-w-0 flex-1">
          {result.business ? (
            <>
              <div className="text-sm text-[#0C1B33]/80 font-medium truncate">
                {result.business.name}
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3 text-[#0C1B33]/30 flex-shrink-0" />
                <span className="text-[11px] text-[#0C1B33]/40 truncate">
                  {result.business.address}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-1">
              <MapPin className="w-3 h-3 text-[#0C1B33]/30 flex-shrink-0" />
              <span className="text-[12px] text-[#0C1B33]/60 truncate">
                {result.address || `${result.lat.toFixed(4)}, ${result.lon.toFixed(4)}`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Zone dots row */}
      <div className="flex items-center gap-1.5 px-5 py-3 border-b border-[#0C1B33]/6">
        <Layers className="w-3 h-3 text-[#0C1B33]/25 flex-shrink-0" />
        <div className="flex gap-1 flex-wrap">
          {ZONE_KEYS.map((key) => (
            <div
              key={key}
              className="w-2.5 h-2.5 rounded-full"
              style={{
                backgroundColor: result.zones[key]
                  ? ZONE_COLORS[key]
                  : "#0C1B33" + "10",
              }}
              title={`${ZONE_LABELS[key]}: ${result.zones[key] ? "Yes" : "No"}`}
            />
          ))}
        </div>
        <span className="font-mono-bureau text-[10px] text-[#0C1B33]/30 ml-auto">
          {eligibleKeys.length} zone{eligibleKeys.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Top programs */}
      {topPrograms.length > 0 && (
        <div className="px-5 py-3 border-b border-[#0C1B33]/6">
          <div className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#2563EB]/40 mb-2">
            Top Eligible Programs
          </div>
          <div className="space-y-1.5">
            {topPrograms.map((p) =>
              p ? (
                <div key={p.id} className="flex items-start gap-2">
                  <div
                    className="w-1.5 h-1.5 mt-1 flex-shrink-0 rounded-full"
                    style={{
                      backgroundColor: ZONE_COLORS[p.zoneKey] || "#2563EB",
                    }}
                  />
                  <div className="min-w-0">
                    <span className="text-[11px] text-[#0C1B33]/70 font-medium">
                      {p.name}
                    </span>
                    {p.benefits?.[0] && (
                      <span className="text-[10px] text-[#0C1B33]/35 ml-1.5">
                        — {p.benefits[0]}
                      </span>
                    )}
                  </div>
                </div>
              ) : null
            )}
          </div>
        </div>
      )}

      {/* Census + Zoning snapshot */}
      <div className="grid grid-cols-2 gap-0 border-b border-[#0C1B33]/6">
        {/* Census data */}
        {result.census ? (
          <div className="px-5 py-3 border-r border-[#0C1B33]/6">
            <div className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 mb-2">
              Census Snapshot
            </div>
            <div className="space-y-1">
              {result.census.medianIncome && (
                <div className="flex items-center gap-1.5">
                  <DollarSign className="w-2.5 h-2.5 text-[#0C1B33]/20" />
                  <span className="font-mono-bureau text-[10px] text-[#0C1B33]/50">
                    ${result.census.medianIncome.toLocaleString()} income
                  </span>
                </div>
              )}
              {result.census.medianHomeValue && (
                <div className="flex items-center gap-1.5">
                  <Building2 className="w-2.5 h-2.5 text-[#0C1B33]/20" />
                  <span className="font-mono-bureau text-[10px] text-[#0C1B33]/50">
                    ${result.census.medianHomeValue.toLocaleString()} home
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="px-5 py-3 border-r border-[#0C1B33]/6">
            <div className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 mb-2">
              Census
            </div>
            <span className="text-[10px] text-[#0C1B33]/25 italic">
              Not available
            </span>
          </div>
        )}

        {/* City zoning */}
        <div className="px-5 py-3">
          <div className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 mb-2">
            City Zoning
          </div>
          {result.cityZoning ? (
            <div>
              <span className="font-mono-bureau text-[12px] text-[#0C1B33]/70">
                {result.cityZoning.zoneClass}
              </span>
              {result.cityZoning.zoneType && (
                <span className="text-[10px] text-[#0C1B33]/35 ml-1">
                  {result.cityZoning.zoneType}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[10px] text-[#0C1B33]/25 italic">
              Not available
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-between px-5 py-3">
        <button
          onClick={handleExpand}
          className="flex items-center gap-1.5 text-[11px] text-[#2563EB]/70 hover:text-[#2563EB] font-mono-bureau tracking-wide transition-colors"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "Collapse" : "View Full Breakdown"}
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setEmailOpen(true)}
            className="flex items-center gap-1.5 text-[10px] text-[#0C1B33]/40 hover:text-[#0C1B33]/70 font-mono-bureau tracking-[0.1em] uppercase transition-colors"
          >
            <Mail className="w-3 h-3" />
            Email
          </button>
          <button
            onClick={handleDownloadPDF}
            className="flex items-center gap-1.5 text-[10px] text-[#0C1B33]/40 hover:text-[#0C1B33]/70 font-mono-bureau tracking-[0.1em] uppercase transition-colors"
          >
            <FileDown className="w-3 h-3" />
            PDF
          </button>
        </div>
      </div>

      {/* Email Dialog */}
      <EmailReportDialog
        result={result}
        programs={programs}
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
      />
    </div>
  );
}
