"use client";

import { CheckCircle2, XCircle, ChevronDown, ChevronUp, ExternalLink, Square, CheckSquare } from "lucide-react";
import { useState } from "react";
import type { Program } from "@/lib/types";
import { ZONE_COLORS } from "@/lib/constants";

interface ZoneResultCardProps {
  zoneKey: string;
  inZone: boolean;
  program?: Program;
}

export function ZoneResultCard({ zoneKey, inZone, program }: ZoneResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [checkedDocs, setCheckedDocs] = useState<Set<number>>(new Set());
  const [checkedCriteria, setCheckedCriteria] = useState(false);
  const color = ZONE_COLORS[zoneKey] || "#6b7280";

  const toggleDoc = (index: number) => {
    setCheckedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const totalChecklist = (program?.requiredDocs.length || 0) + 1; // +1 for whoQualifies
  const completedChecklist = checkedDocs.size + (checkedCriteria ? 1 : 0);
  const allComplete = completedChecklist === totalChecklist && totalChecklist > 0;

  return (
    <div
      className={`border transition-all ${
        inZone ? "border-white/15 bg-white/[0.04]" : "border-white/5 opacity-40"
      }`}
      style={inZone ? { borderLeftWidth: "3px", borderLeftColor: color } : undefined}
    >
      <button
        className="w-full px-5 py-4 flex items-center gap-4 text-left"
        onClick={() => program && setExpanded(!expanded)}
      >
        {inZone ? (
          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-white/20 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white/80">{program?.name || zoneKey}</div>
          {program && (
            <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-white/30 mt-0.5 inline-block">
              {program.level}
            </span>
          )}
        </div>
        {inZone && expanded && completedChecklist > 0 && (
          <span className={`font-mono-bureau text-[9px] tracking-[0.1em] px-2 py-1 shrink-0 ${
            allComplete ? "text-green-400 border border-green-400/30" : "text-white/30"
          }`}>
            {completedChecklist}/{totalChecklist}
          </span>
        )}
        {inZone && (
          <span
            className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase px-2 py-1 border shrink-0"
            style={{ color, borderColor: `${color}40` }}
          >
            Eligible
          </span>
        )}
        {program && (
          <span className="shrink-0 text-white/20">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        )}
      </button>

      {expanded && program && (
        <div className="px-5 pb-5 space-y-4 border-t border-white/5 pt-4">
          <p className="text-sm text-white/40 leading-relaxed">{program.summary}</p>

          <div>
            <h4 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-white/30 mb-2">
              Benefits
            </h4>
            <ul className="text-sm space-y-1.5">
              {program.benefits.map((b, i) => (
                <li key={i} className="flex gap-2 text-white/50">
                  <span className="text-green-400 shrink-0">+</span>
                  {b}
                </li>
              ))}
            </ul>
          </div>

          {/* Eligibility Checklist */}
          {inZone && (
            <div className="border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-white/50">
                  Eligibility Checklist
                </h4>
                {allComplete && (
                  <span className="font-mono-bureau text-[9px] tracking-[0.1em] text-green-400 uppercase">
                    Ready to apply
                  </span>
                )}
              </div>

              {/* Who Qualifies — as a checkable item */}
              <button
                onClick={(e) => { e.stopPropagation(); setCheckedCriteria(!checkedCriteria); }}
                className="w-full flex gap-3 text-left py-2 group"
              >
                {checkedCriteria ? (
                  <CheckSquare className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                ) : (
                  <Square className="w-4 h-4 text-white/20 shrink-0 mt-0.5 group-hover:text-white/40" />
                )}
                <span className={`text-sm leading-relaxed ${checkedCriteria ? "text-white/60 line-through decoration-white/20" : "text-white/45"}`}>
                  {program.whoQualifies}
                </span>
              </button>

              {/* Required Docs — each checkable */}
              <div className="mt-2 pt-2 border-t border-white/5 space-y-0.5">
                <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-white/20 block mb-1">
                  Required Documents
                </span>
                {program.requiredDocs.map((doc, i) => (
                  <button
                    key={i}
                    onClick={(e) => { e.stopPropagation(); toggleDoc(i); }}
                    className="w-full flex gap-3 text-left py-1.5 group"
                  >
                    {checkedDocs.has(i) ? (
                      <CheckSquare className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                    ) : (
                      <Square className="w-4 h-4 text-white/20 shrink-0 mt-0.5 group-hover:text-white/40" />
                    )}
                    <span className={`text-sm ${checkedDocs.has(i) ? "text-white/60 line-through decoration-white/20" : "text-white/45"}`}>
                      {doc}
                    </span>
                  </button>
                ))}
              </div>

              {/* Progress bar */}
              <div className="mt-3 pt-3 border-t border-white/5">
                <div className="h-1 bg-white/5 w-full">
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${(completedChecklist / totalChecklist) * 100}%`,
                      backgroundColor: allComplete ? "#4ADE80" : color,
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className="font-mono-bureau text-[8px] text-white/20 tracking-[0.1em]">
                    {completedChecklist} of {totalChecklist} verified
                  </span>
                  {allComplete && (
                    <span className="font-mono-bureau text-[8px] text-green-400 tracking-[0.1em] uppercase">
                      Complete
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          <div>
            <h4 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-white/30 mb-2">
              How to Apply
            </h4>
            <ol className="text-sm space-y-1.5 text-white/50 list-decimal list-inside">
              {program.howToApply.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-white/5 text-sm">
            <span className="text-white/30 font-mono-bureau text-[10px]">{program.contact}</span>
            {program.url && (
              <a
                href={program.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/50 hover:text-white inline-flex items-center gap-1 font-mono-bureau text-[10px] tracking-[0.1em] uppercase"
              >
                Learn More <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
