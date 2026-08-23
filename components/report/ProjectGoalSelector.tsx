"use client";

import { Check } from "lucide-react";
import {
  MAX_ENGINE_GOALS,
  MAX_PROJECT_GOALS,
  SITE_PROJECT_TYPE_OPTIONS,
} from "@/lib/report-wizard-config";

interface ProjectGoalSelectorProps {
  goals: string[];
  customGoal: string;
  onChange: (goals: string[], customGoal: string) => void;
  disabled?: boolean;
  label?: string;
  helper?: string;
  required?: boolean;
  compact?: boolean;
}

export function ProjectGoalSelector({
  goals,
  customGoal,
  onChange,
  disabled = false,
  label = "Project goals",
  helper = "Choose up to three outcomes you want the report to support.",
  required = false,
  compact = false,
}: ProjectGoalSelectorProps) {
  // Gate review round 2, NEW-3/ruling #4: read against MAX_ENGINE_GOALS
  // (now 5), not MAX_PROJECT_GOALS (3) — a gate-produced report can
  // legitimately carry more than 3 real goal ids, and this display read
  // used to silently truncate them the instant this component rendered,
  // before the visitor touched anything. `atLimit` (below) intentionally
  // STAYS at MAX_PROJECT_GOALS — that's the wizard's own "pick up to 3"
  // fresh-selection growth limit, untouched by this fix.
  const selectedGoals = Array.from(new Set(goals)).slice(0, MAX_ENGINE_GOALS);
  const atLimit = selectedGoals.length >= MAX_PROJECT_GOALS;
  // Gate review round 3, MINOR R3-2: the counter and "at limit" copy used
  // to hardcode MAX_PROJECT_GOALS/"Three" even when a gate-seeded report
  // already has MORE goals selected than that — rendering the genuinely
  // confusing "4/3 selected" and "Three goals selected." with 4 checked.
  // Both now derive from whichever is actually larger: the normal 3-goal
  // cap, or however many are already selected (only possible via a
  // pre-existing seed, never through this component's own growth path,
  // which `atLimit` — unchanged — still blocks at 3).
  const displayCap = Math.max(MAX_PROJECT_GOALS, selectedGoals.length);

  const toggleGoal = (goalId: string) => {
    if (disabled) return;
    const selected = selectedGoals.includes(goalId);
    const next = selected
      ? selectedGoals.filter((value) => value !== goalId)
      : atLimit
        ? selectedGoals
        : [...selectedGoals, goalId];
    onChange(next, goalId === "other" && selected ? "" : customGoal);
  };

  return (
    <fieldset disabled={disabled}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <legend className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#0C1B33]/50">
          {label}
        </legend>
        <span className="font-mono-bureau text-[8px] uppercase tracking-[0.14em] text-[#0C1B33]/30">
          {selectedGoals.length}/{displayCap}{required ? " selected" : ""}
        </span>
      </div>
      <p className="mb-3 text-[12px] leading-relaxed text-[#0C1B33]/45">
        {helper}
      </p>

      <div className={`grid grid-cols-1 gap-2 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        {SITE_PROJECT_TYPE_OPTIONS.map((option) => {
          const selected = selectedGoals.includes(option.id);
          const unavailable = !selected && atLimit;
          return (
            <label
              key={option.id}
              className={`flex min-h-11 items-center gap-2.5 border px-3.5 py-2.5 transition-colors ${
                selected
                  ? "border-[#2563EB]/50 bg-[#EFF3FB] text-[#0C1B33]"
                  : unavailable || disabled
                    ? "cursor-not-allowed border-[#0C1B33]/6 bg-[#0C1B33]/[0.015] text-[#0C1B33]/25"
                    : "cursor-pointer border-[#0C1B33]/10 bg-white text-[#0C1B33]/55 hover:border-[#0C1B33]/20"
              }`}
            >
              <input
                type="checkbox"
                value={option.id}
                checked={selected}
                disabled={disabled || unavailable}
                onChange={() => toggleGoal(option.id)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                  selected
                    ? "border-[#2563EB] bg-[#2563EB] text-white"
                    : "border-[#0C1B33]/20 bg-white"
                }`}
              >
                {selected && <Check className="h-3 w-3" />}
              </span>
              <span className="text-[12px] font-medium leading-snug">{option.label}</span>
            </label>
          );
        })}
      </div>

      {selectedGoals.includes("other") && (
        <label className="mt-4 block">
          <span className="mb-2 block font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/45">
            Describe the other goal
          </span>
          <textarea
            value={customGoal}
            onChange={(event) => onChange(selectedGoals, event.target.value.slice(0, 240))}
            required={required}
            rows={3}
            maxLength={240}
            placeholder="For example: prepare a commercial kitchen for shared use."
            className="w-full resize-y border border-[#0C1B33]/15 bg-white px-3.5 py-3 text-[13px] leading-relaxed text-[#0C1B33] outline-none placeholder:text-[#0C1B33]/30 focus:border-[#2563EB] disabled:opacity-55"
          />
          <span className="mt-1 block text-right font-mono-bureau text-[8px] text-[#0C1B33]/25">
            {customGoal.length}/240
          </span>
        </label>
      )}

      {atLimit && (
        <p className="mt-2 text-[10px] leading-relaxed text-[#0C1B33]/40">
          {displayCap} goal{displayCap === 1 ? "" : "s"} selected. Remove one to choose another.
        </p>
      )}
    </fieldset>
  );
}
