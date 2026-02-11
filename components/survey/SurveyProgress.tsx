"use client";

import { Check } from "lucide-react";

interface SurveyProgressProps {
  currentStep: number;
  totalSteps?: number;
}

export function SurveyProgress({ currentStep, totalSteps = 4 }: SurveyProgressProps) {
  return (
    <div className="flex items-center gap-0 w-full max-w-md mx-auto">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isCompleted = step < currentStep;
        const isActive = step === currentStep;

        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            <div
              className={`w-8 h-8 flex items-center justify-center border flex-shrink-0 ${
                isCompleted
                  ? "bg-[#2563EB] border-[#2563EB]"
                  : isActive
                    ? "bg-transparent border-[#2563EB]"
                    : "bg-transparent border-[#0C1B33]/10"
              }`}
            >
              {isCompleted ? (
                <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
              ) : (
                <span
                  className={`font-mono-bureau text-[11px] font-medium ${
                    isActive ? "text-[#2563EB]" : "text-[#0C1B33]/20"
                  }`}
                >
                  {step}
                </span>
              )}
            </div>

            {step < totalSteps && (
              <div className="flex-1 h-[1px] mx-2">
                <div className={`h-full ${isCompleted ? "bg-[#2563EB]" : "bg-[#0C1B33]/8"}`} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
