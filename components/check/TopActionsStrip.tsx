"use client";

import { Phone, FileText, Calendar, ExternalLink } from "lucide-react";
import type { TopAction } from "@/lib/types";

const ACTION_ICONS = {
  call: Phone,
  gather: FileText,
  book: Calendar,
  check: ExternalLink,
};

interface TopActionsStripProps {
  actions: TopAction[];
  hasSurvey: boolean;
}

export function TopActionsStrip({ actions, hasSurvey }: TopActionsStripProps) {
  if (actions.length === 0) return null;

  return (
    <div className="mb-8">
      <h3 className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/40 mb-3">
        {hasSurvey
          ? "Recommended next steps"
          : "Best next steps based on your location"}
      </h3>
      <div className="flex flex-col sm:flex-row gap-2">
        {actions.map((action, i) => {
          const Icon = ACTION_ICONS[action.type];
          const href =
            action.type === "call" && action.contact?.phone
              ? `tel:${action.contact.phone.replace(/\D/g, "")}`
              : action.contact?.url || "#";

          return (
            <a
              key={i}
              href={href}
              className="flex items-center gap-3 px-4 py-3 bg-white border border-[#0C1B33]/10 rounded-lg hover:border-[#2563EB]/30 hover:shadow-sm transition-all group flex-1"
            >
              <div className="w-8 h-8 rounded-full bg-[#2563EB]/5 flex items-center justify-center shrink-0 group-hover:bg-[#2563EB]/10 transition-colors">
                <Icon className="w-4 h-4 text-[#2563EB]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-[#0C1B33]/80 font-medium truncate">
                  {action.label}
                </p>
                {action.contact?.phone && (
                  <p className="text-[11px] text-[#0C1B33]/40 font-mono-bureau">
                    {action.contact.phone}
                  </p>
                )}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
