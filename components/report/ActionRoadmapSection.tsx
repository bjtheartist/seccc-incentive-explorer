"use client";

// ─── Action Roadmap ──────────────────────────────────────────────────
// Shared by BOTH ReportDisplay forks (the local copy in app/report/page.tsx
// and components/report/ReportDisplay.tsx). The forks themselves have
// diverged and are intentionally NOT consolidated here (audit RF2 is a
// separate refactor); sharing this section keeps the roadmap tiers from
// diverging further.
//
// Analytics stay at the call site: the live /report flow passes
// onContactClick to record support_resource_clicked; the public display
// fork renders without it, exactly as before consolidation.

import { Phone, Mail } from "lucide-react";
import type { ActionRoadmapItem } from "@/lib/report-engine";
import { PreparationCostBadge } from "@/components/report/PreparationCostBadge";

export function ActionRoadmapSection({
  items,
  onContactClick,
}: {
  items: ActionRoadmapItem[];
  onContactClick?: (
    item: ActionRoadmapItem,
    contactMethod: "phone" | "email",
  ) => void;
}) {
  const doThisWeek = items.filter((i) => i.tier === "do-this-week");
  const worthExploring = items.filter((i) => i.tier === "worth-exploring");

  return (
    <div className="mb-10">
      <div className="mb-6">
        <span className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/50 block mb-1">
          Your Next Steps
        </span>
        <p className="text-[#0C1B33]/35 text-[13px] leading-relaxed max-w-prose">
          Practical actions to prepare for program review and local support.
        </p>
      </div>

      {/* Tier 1: Do This Week */}
      {doThisWeek.length > 0 && (
        <div className="mb-8">
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/40 block mb-3">
            Do This Week
          </span>
          <div className="space-y-4">
            {doThisWeek.map((item, i) => (
              <div
                key={i}
                className="border border-[#0C1B33]/8 p-5"
              >
                <div className="flex items-start gap-3 mb-2">
                  <span className="font-mono-bureau text-[11px] text-[#0C1B33]/30 flex-shrink-0 w-5 text-right pt-0.5">
                    {i + 1}.
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-[#0C1B33]">
                        {item.label}
                      </span>
                      {item.preparationCost && <PreparationCostBadge signal={item.preparationCost} />}
                    </div>
                    <span className="text-[12px] text-[#0C1B33]/40 block mt-0.5">
                      {item.description}
                    </span>
                  </div>
                </div>

                {/* Contact card */}
                {item.contact && (
                  <div className="ml-8 mt-3 border-l border-[#0C1B33]/8 pl-4 space-y-1.5">
                    <span className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/25 block">
                      {item.contact.role || "Contact"}
                    </span>
                    <span className="text-[13px] text-[#0C1B33]/60 font-medium block">
                      {item.contact.agency}
                    </span>
                    <div className="flex flex-wrap gap-3">
                      {item.contact.phone && (
                        <a
                          href={`tel:${item.contact.phone}`}
                          onClick={onContactClick ? () => onContactClick(item, "phone") : undefined}
                          className="inline-flex items-center gap-1.5 text-[12px] text-[#0C1B33]/50 hover:text-[#0C1B33] transition-colors"
                        >
                          <Phone className="w-3 h-3" />
                          {item.contact.phone}
                        </a>
                      )}
                      {item.contact.email && (
                        <a
                          href={`mailto:${item.contact.email}`}
                          onClick={onContactClick ? () => onContactClick(item, "email") : undefined}
                          className="inline-flex items-center gap-1.5 text-[12px] text-[#0C1B33]/50 hover:text-[#0C1B33] transition-colors"
                        >
                          <Mail className="w-3 h-3" />
                          {item.contact.email}
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Call script */}
                {item.callScript && (
                  <div className="ml-8 mt-3 border-l border-[#0C1B33]/8 pl-4">
                    <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 block mb-1">
                      What to say
                    </span>
                    <p className="text-[12px] text-[#0C1B33]/50 italic leading-relaxed">
                      {item.callScript}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tier 2: Worth Exploring */}
      {worthExploring.length > 0 && (
        <div>
          <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-3">
            Worth Exploring
          </span>
          <div className="space-y-0 divide-y divide-[#0C1B33]/6">
            {worthExploring.map((item, i) => (
              <div
                key={i}
                className="py-4 first:pt-0 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] text-[#0C1B33]/60 font-medium">
                      {item.programName || item.label}
                    </span>
                    {item.preparationCost && <PreparationCostBadge signal={item.preparationCost} />}
                  </div>
                  <span className="text-[11px] text-[#0C1B33]/35 block mt-0.5">
                    {item.description}
                  </span>
                </div>
                {item.contact?.phone && (
                  <a
                    href={`tel:${item.contact.phone}`}
                    onClick={onContactClick ? () => onContactClick(item, "phone") : undefined}
                    className="flex items-center gap-1 text-[10px] font-mono-bureau text-[#0C1B33]/40 hover:text-[#0C1B33] transition-colors flex-shrink-0"
                  >
                    <Phone className="w-3 h-3" />
                    {item.contact.phone}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
