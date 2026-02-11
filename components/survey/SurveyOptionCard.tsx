"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";

interface SurveyOptionCardProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  index: number;
}

export function SurveyOptionCard({ label, selected, onClick, index }: SurveyOptionCardProps) {
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
      className={`group relative w-full text-left cursor-pointer border transition-colors duration-150 ${
        selected
          ? "bg-[#EFF3FB] border-[#2563EB]/40"
          : "bg-white border-[#0C1B33]/8 hover:border-[#0C1B33]/15"
      }`}
    >
      {/* Left accent bar */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-[3px] transition-colors duration-150 ${
          selected ? "bg-[#2563EB]" : "bg-transparent"
        }`}
      />

      <div className="flex items-center justify-between px-5 py-4">
        <span
          className={`font-mono-bureau text-[11px] tracking-[0.08em] uppercase ${
            selected ? "text-[#0C1B33]" : "text-[#0C1B33]/50"
          }`}
        >
          {label}
        </span>

        <div
          className={`w-5 h-5 border flex items-center justify-center flex-shrink-0 ${
            selected
              ? "border-[#2563EB] bg-[#2563EB]"
              : "border-[#0C1B33]/15 bg-transparent"
          }`}
        >
          {selected && <Check className="w-3 h-3 text-white" strokeWidth={2.5} />}
        </div>
      </div>
    </motion.button>
  );
}
