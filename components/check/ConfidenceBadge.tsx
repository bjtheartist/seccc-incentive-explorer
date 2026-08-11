"use client";

import type { ProgramRelevance } from "@/lib/types";

const BADGE_STYLES: Record<
  ProgramRelevance,
  { bg: string; text: string; border: string }
> = {
  mapped_with_matching_answers: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  mapped_at_location: {
    bg: "bg-emerald-50",
    text: "text-emerald-600",
    border: "border-emerald-200",
  },
  review_suggested: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  context_dependent: {
    bg: "bg-gray-50",
    text: "text-gray-600",
    border: "border-gray-200",
  },
  not_mapped_at_location: {
    bg: "bg-gray-50",
    text: "text-gray-400",
    border: "border-gray-100",
  },
};

interface RelevanceBadgeProps {
  relevance: ProgramRelevance;
  label: string;
}

export function ConfidenceBadge({ relevance, label }: RelevanceBadgeProps) {
  const style = BADGE_STYLES[relevance];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono-bureau tracking-[0.1em] uppercase border rounded-full ${style.bg} ${style.text} ${style.border}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          relevance === "mapped_with_matching_answers" || relevance === "mapped_at_location"
            ? "bg-emerald-500"
            : relevance === "review_suggested"
            ? "bg-amber-500"
            : "bg-gray-300"
        }`}
      />
      {label}
    </span>
  );
}
