"use client";

import { motion, AnimatePresence } from "framer-motion";
import { SurveyOptionCard } from "./SurveyOptionCard";
import type { SurveyQuestion } from "@/lib/types";

interface SurveyStepProps {
  question: SurveyQuestion;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
  direction: number;
}

export function SurveyStep({ question, value, onChange, direction }: SurveyStepProps) {
  const isMulti = question.type === "multi";

  const handleSelect = (optionId: string) => {
    if (isMulti) {
      const current = Array.isArray(value) ? value : [];
      if (current.includes(optionId)) {
        onChange(current.filter((id) => id !== optionId));
      } else {
        onChange([...current, optionId]);
      }
    } else {
      onChange(optionId);
    }
  };

  const isSelected = (optionId: string) => {
    if (isMulti) return Array.isArray(value) && value.includes(optionId);
    return value === optionId;
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={question.id}
        initial={{ opacity: 0, x: direction > 0 ? 60 : -60 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: direction > 0 ? -60 : 60 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="mb-8">
          <span className="font-mono-bureau text-[10px] text-[#0C1B33]/25 uppercase tracking-[0.2em] block mb-3">
            Step {question.step} of 4
          </span>
          <h2 className="font-editorial text-2xl sm:text-3xl text-[#0C1B33] mb-2">
            {question.title}
          </h2>
          <p className="font-mono-bureau text-[11px] text-[#0C1B33]/40 uppercase tracking-[0.1em]">
            {question.subtitle}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {question.options.map((option, i) => (
            <SurveyOptionCard
              key={option.id}
              label={option.label}
              selected={isSelected(option.id)}
              onClick={() => handleSelect(option.id)}
              index={i}
            />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
