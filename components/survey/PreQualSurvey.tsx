"use client";

import { useState, useCallback } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { SURVEY_QUESTIONS, scoreSurvey } from "@/lib/survey-engine";
import { SurveyProgress } from "./SurveyProgress";
import { SurveyStep } from "./SurveyStep";
import { SurveyResults } from "./SurveyResults";
import type { SurveyAnswers, SurveyResult } from "@/lib/types";

export function PreQualSurvey() {
  const [currentStep, setCurrentStep] = useState(1);
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [results, setResults] = useState<SurveyResult | null>(null);
  const [direction, setDirection] = useState(1);
  // review5 S1 / review6 S11: scoreSurvey() is async — it POSTs the raw
  // answers to /api/survey/score (server-side scoring against the full
  // internal catalog, narrow SurveyResult returned) rather than bundling
  // the full internal catalog into every /qualify page load, or (as of
  // S11) fetching it client-side from the now-removed unauthenticated
  // /api/programs/engine-source route.
  const [scoring, setScoring] = useState(false);

  const totalSteps = SURVEY_QUESTIONS.length;
  const currentQuestion = SURVEY_QUESTIONS[currentStep - 1];
  const currentValue = answers[currentQuestion.id as keyof SurveyAnswers];

  const canProceed = currentQuestion.type === "multi"
    ? Array.isArray(currentValue) && currentValue.length > 0
    : Boolean(currentValue);

  const handleChange = useCallback(
    (value: string | string[]) => {
      setAnswers((prev) => ({ ...prev, [currentQuestion.id]: value }));
    },
    [currentQuestion.id]
  );

  const handleNext = useCallback(() => {
    if (!canProceed) return;
    if (currentStep < totalSteps) {
      setDirection(1);
      setCurrentStep((s) => s + 1);
    } else {
      setScoring(true);
      scoreSurvey(answers)
        .then(setResults)
        .finally(() => setScoring(false));
    }
  }, [canProceed, currentStep, totalSteps, answers]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setDirection(-1);
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  const handleRetake = useCallback(() => {
    setAnswers({});
    setCurrentStep(1);
    setResults(null);
    setDirection(1);
  }, []);

  if (results) {
    return <SurveyResults results={results} onRetake={handleRetake} />;
  }

  return (
    <div className="flex flex-col min-h-[60vh]">
      <div className="mb-10">
        <SurveyProgress currentStep={currentStep} totalSteps={totalSteps} />
      </div>

      <div className="flex-1">
        <SurveyStep
          question={currentQuestion}
          value={currentValue}
          onChange={handleChange}
          direction={direction}
        />
      </div>

      <div className="flex items-center justify-between mt-10 pt-6 border-t border-[#0C1B33]/6">
        <button
          onClick={handleBack}
          disabled={currentStep === 1}
          className={`inline-flex items-center gap-2 font-mono-bureau text-[11px] uppercase tracking-[0.1em] cursor-pointer ${
            currentStep === 1
              ? "text-[#0C1B33]/10 cursor-default"
              : "text-[#0C1B33]/35 hover:text-[#0C1B33]"
          }`}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>

        <button
          onClick={handleNext}
          disabled={!canProceed || scoring}
          className={`inline-flex items-center gap-2 font-mono-bureau text-[11px] uppercase tracking-[0.1em] px-6 py-3 border cursor-pointer transition-colors ${
            canProceed && !scoring
              ? "bg-[#0C1B33] text-white border-[#0C1B33] hover:bg-[#2563EB] hover:border-[#2563EB]"
              : "bg-transparent text-[#0C1B33]/15 border-[#0C1B33]/8 cursor-default"
          }`}
        >
          {scoring ? "Reviewing…" : currentStep === totalSteps ? "See Results" : "Next"}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
