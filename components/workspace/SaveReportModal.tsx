"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import type { GeneratedReport } from "@/lib/report-engine";
import type { WizardState } from "@/lib/report-wizard-config";
import { GOAL_OPTIONS, type GoalType } from "@/lib/workspace";

export interface PendingSavedReport {
  reportData: GeneratedReport;
  wizardState?: WizardState;
}

export function SaveReportModal({
  reportData,
  wizardState,
  onClose,
}: PendingSavedReport & {
  onClose: () => void;
}) {
  const router = useRouter();
  const [goalType, setGoalType] = useState<GoalType>("improve-storefront");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/saved-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalType, reportData, wizardState: wizardState || {} }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not save report");
      }

      const projectId = data.report?.projectId;
      if (projectId) {
        router.push(`/workspace/projects/${projectId}`);
      } else {
        router.push("/workspace");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save report");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white border border-[#0C1B33]/10 shadow-2xl">
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-[#0C1B33]/8">
          <div>
            <p className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/60 mb-2">
              Save to Workspace
            </p>
            <h3 className="font-editorial text-2xl text-[#0C1B33] leading-tight">
              What goal does this report support?
            </h3>
            <p className="text-[13px] text-[#0C1B33]/45 mt-2 leading-relaxed">
              We will create a project workspace with a starter checklist.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#0C1B33]/35 hover:text-[#0C1B33] p-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {GOAL_OPTIONS.map((goal) => {
              const selected = goal.id === goalType;
              return (
                <button
                  key={goal.id}
                  onClick={() => setGoalType(goal.id)}
                  className={`text-left border px-4 py-3 transition-all ${
                    selected
                      ? "border-[#2563EB] bg-[#2563EB]/5"
                      : "border-[#0C1B33]/10 hover:border-[#0C1B33]/25"
                  }`}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm text-[#0C1B33]/75">{goal.label}</span>
                    {selected && <Check className="w-4 h-4 text-[#2563EB]" />}
                  </span>
                </button>
              );
            })}
          </div>

          {error && (
            <p className="mt-4 text-[12px] text-red-600 bg-red-50 border border-red-100 px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 pb-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button
            onClick={onClose}
            className="px-5 py-3 border border-[#0C1B33]/10 text-[#0C1B33]/50 font-mono-bureau text-[10px] tracking-[0.15em] uppercase hover:border-[#0C1B33]/25"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-3 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase hover:bg-[#1E3054] disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Report
          </button>
        </div>
      </div>
    </div>
  );
}
