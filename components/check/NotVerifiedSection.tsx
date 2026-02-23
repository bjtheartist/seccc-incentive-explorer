"use client";

import { AlertTriangle } from "lucide-react";

interface NotVerifiedSectionProps {
  items: string[];
}

export function NotVerifiedSection({ items }: NotVerifiedSectionProps) {
  if (items.length === 0) return null;

  return (
    <div className="mt-3 p-3 bg-amber-50/50 border border-amber-100 rounded-lg">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-[10px] font-mono-bureau tracking-[0.1em] uppercase text-amber-600 mb-1.5">
            What we didn't verify
          </p>
          <ul className="space-y-1">
            {items.map((item, i) => (
              <li
                key={i}
                className="text-xs text-[#0C1B33]/50 leading-snug"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
