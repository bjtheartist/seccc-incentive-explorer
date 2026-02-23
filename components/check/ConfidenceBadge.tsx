"use client";

import type { EligibilityConfidence } from "@/lib/types";

const BADGE_STYLES: Record<
  EligibilityConfidence,
  { bg: string; text: string; border: string }
> = {
  appears_eligible: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  location_eligible: {
    bg: "bg-emerald-50",
    text: "text-emerald-600",
    border: "border-emerald-200",
  },
  may_qualify: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  worth_exploring: {
    bg: "bg-gray-50",
    text: "text-gray-600",
    border: "border-gray-200",
  },
  not_applicable: {
    bg: "bg-gray-50",
    text: "text-gray-400",
    border: "border-gray-100",
  },
};

interface ConfidenceBadgeProps {
  confidence: EligibilityConfidence;
  label: string;
}

export function ConfidenceBadge({ confidence, label }: ConfidenceBadgeProps) {
  const style = BADGE_STYLES[confidence];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono-bureau tracking-[0.1em] uppercase border rounded-full ${style.bg} ${style.text} ${style.border}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          confidence === "appears_eligible" || confidence === "location_eligible"
            ? "bg-emerald-500"
            : confidence === "may_qualify"
            ? "bg-amber-500"
            : "bg-gray-300"
        }`}
      />
      {label}
    </span>
  );
}
