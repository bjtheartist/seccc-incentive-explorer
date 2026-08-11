"use client";

// ─── Verdict, Match Explanation & Executive Summary ──────────────────
// Shared by BOTH ReportDisplay forks (the local copy in app/report/page.tsx
// and components/report/ReportDisplay.tsx). The forks themselves have
// diverged and are intentionally NOT consolidated here (audit RF2 is a
// separate refactor); sharing these sections keeps the verdict framing and
// summary copy from diverging further.
//
// Product boundary: the verdict and explanations describe why programs
// appear and what still needs confirming — never an eligibility guarantee
// or award amount.

import { Phone, Mail, Calendar } from "lucide-react";
import type { GeneratedReport } from "@/lib/report-engine";
import type { ExecutiveSummary, PublicMatchExplanation } from "@/lib/types";

export function VerdictCard({ verdict }: { verdict: NonNullable<GeneratedReport["verdict"]> }) {
  return (
    <div className="mb-12">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-2 h-2 rounded-full bg-[#0C1B33]" />
        <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/40">
          Location findings
        </span>
      </div>
      <h3 className="font-editorial text-[22px] sm:text-[26px] text-[#0C1B33] leading-snug mb-2">
        {verdict.headline}
      </h3>
      <p className="text-[#0C1B33]/45 text-[14px] leading-relaxed mb-5 max-w-prose">
        {verdict.subheadline}
      </p>
      {verdict.topReasons.length > 0 && (
        <div className="border-l border-[#0C1B33]/10 pl-5 space-y-2">
          {verdict.topReasons.map((reason, i) => (
            <p key={i} className="text-[13px] text-[#0C1B33]/50 leading-relaxed">
              {reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Executive Summary Component ─────────────────────────────────────

export function MatchExplanationDetails({ explanation }: { explanation?: PublicMatchExplanation }) {
  if (!explanation) return null;
  const groups = [
    ["Why it appears", explanation.whyItAppears],
    ["Known from public data", explanation.knownFromPublicData],
    ["Based on your answers", explanation.basedOnUserAnswers],
    ["Still to confirm", explanation.stillToConfirm],
    ["Documents to gather", explanation.currentDocumentsToGather],
  ] as const;

  return (
    <div className="space-y-3">
      {groups.map(([label, items]) => items.length > 0 && (
        <div key={label}>
          <span className="font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#0C1B33]/35 block mb-1">
            {label}
          </span>
          <ul className="space-y-1">
            {items.map((text, index) => (
              <li key={`${label}-${index}`} className="flex items-start gap-2 text-[11px] leading-relaxed text-[#0C1B33]/55">
                <span className="text-[#0C1B33]/20">&bull;</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {explanation.confirmWith.length > 0 && (
        <div>
          <span className="font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#0C1B33]/35 block mb-1">Confirm with</span>
          <ul className="space-y-1">
            {explanation.confirmWith.map((contact, index) => (
              <li key={`${contact.agency}-${index}`} className="text-[11px] leading-relaxed text-[#0C1B33]/55">
                {contact.url ? <a className="text-[#2F5BEA] hover:underline" href={contact.url} target="_blank" rel="noopener noreferrer">{contact.agency}</a> : contact.agency}
                {contact.phone ? ` · ${contact.phone}` : ""}{contact.email ? ` · ${contact.email}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#0C1B33]/45">
        {explanation.officialSource && (
          <a className="text-[#2F5BEA] hover:underline" href={explanation.officialSource.url} target="_blank" rel="noopener noreferrer">
            {explanation.officialSource.label}
          </a>
        )}
        {explanation.lastVerifiedAt && <span>Information reviewed {explanation.lastVerifiedAt}</span>}
      </div>
    </div>
  );
}

export function ExecutiveSummarySection({
  summary,
  isEditing,
  editedText,
  onToggleEdit,
  onTextChange,
}: {
  summary: ExecutiveSummary;
  isEditing: boolean;
  editedText: string;
  onToggleEdit: () => void;
  onTextChange: (text: string) => void;
}) {
  const actionIcons: Record<string, typeof Phone> = {
    call: Phone,
    email: Mail,
    book: Calendar,
  };

  return (
    <div className="border border-[#0C1B33]/8 p-6 sm:p-8 mb-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <span className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/50">
          Executive Summary
        </span>
        <button
          onClick={onToggleEdit}
          className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/30 hover:text-[#0C1B33]/60 transition-colors cursor-pointer print:hidden"
        >
          {isEditing ? "Done" : "Edit"}
        </button>
      </div>

      {/* Programs to review — bullet points */}
      {summary.topPrograms.length > 0 && (
        <div className="mb-6">
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-3">
            {summary.projectGoalLabels?.length || summary.projectGoalLabel
              ? `Programs to Review for ${(summary.projectGoalLabels || [summary.projectGoalLabel]).filter(Boolean).join(", ")}`
              : "Programs to Review for Your Location"}
          </span>
          <ul className="space-y-2">
            {summary.topPrograms.map((prog) => {
              const why = prog.explanation.whyItAppears[0];
              return (
                <li
                  key={prog.programId}
                  className="flex items-baseline gap-3"
                >
                  <span className="text-[#0C1B33]/20 flex-shrink-0 text-[10px]">&bull;</span>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 min-w-0">
                    <span className="text-[14px] font-semibold text-[#0C1B33]">
                      {prog.name}
                    </span>
                    {why && (
                      <span className="basis-full text-[11px] leading-relaxed text-[#0C1B33]/45">
                        {why}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Top Actions — only show action-type icons */}
      {summary.topActions.length > 0 && (
        <div className="mb-6">
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-3">
            Best Next Steps
          </span>
          <ul className="space-y-1.5">
            {summary.topActions.map((action, i) => {
              const Icon = actionIcons[action.type];
              return (
                <li
                  key={i}
                  className="flex items-center gap-2.5 text-[13px] text-[#0C1B33]/60"
                >
                  {Icon ? (
                    <Icon className="w-3 h-3 text-[#0C1B33]/30 flex-shrink-0" />
                  ) : (
                    <span className="text-[#0C1B33]/15 flex-shrink-0 text-[10px]">&bull;</span>
                  )}
                  {action.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Why These Matter — editable */}
      {isEditing ? (
        <textarea
          value={editedText}
          onChange={(e) => onTextChange(e.target.value)}
          className="w-full text-[#0C1B33]/60 text-[14px] leading-[1.7] bg-[#0C1B33]/[0.02] border border-[#0C1B33]/10 p-3 resize-y min-h-[80px] focus:outline-none focus:border-[#0C1B33]/20"
          rows={4}
        />
      ) : (
        <p className="text-[#0C1B33]/60 text-[14px] leading-[1.7]">
          {editedText || summary.whyTheseMatter}
        </p>
      )}
    </div>
  );
}
