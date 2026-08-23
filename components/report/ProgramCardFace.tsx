"use client";

// ─── Program-card face (gate finding 11) ──────────────────────────────────
// Administrator line, status/window pills, a glance row, "Commonly
// required," and next-step/contact — moved out of the collapsed "Program
// review details" accordion onto the card FACE, matching the R5 board.
// Every field is read from data report-engine.ts already computes on this
// same ReportItem (buildAdministrator/buildDecisionBy/buildNextStep/
// buildPrimaryContact, all derived from the program's own contacts[]/
// howToApply[] — never invented here). "Amount" and "Type" tiles from the
// board are deliberately NOT built: no non-blocklisted amount field exists
// (Program.benefitRange is blocked from the canonical report — see gate
// finding 7's doc comment on ReportItem.nextWindow) and no structured
// program-category field exists in the catalog at all. Renders only the
// tiles/rows it has real data for — honest omission, never a placeholder
// tile.

import type { AvailabilityState } from "@/lib/program-gating";
import type { ReportItem } from "@/lib/report-engine";

const STATUS_LABEL: Record<AvailabilityState, string> = {
  active: "Active",
  "window-closed": "Window closed",
  "lapsed-notice": "Lapsed — confirm status",
  expired: "Expired",
};

export function ProgramCardFace({ item }: { item: ReportItem }) {
  const hasGlance = Boolean(item.nextWindow?.expected || item.nextWindow?.note || item.decisionBy);
  const hasCommonlyRequired = Boolean(item.eligibilityRules?.length);
  const hasNextStep = Boolean(item.nextStep || item.primaryContact);
  if (!item.administrator && !item.availability && !hasGlance && !hasCommonlyRequired && !hasNextStep) {
    return null;
  }

  return (
    <div className="mt-2.5 space-y-2.5" data-testid="program-card-face">
      {(item.administrator || item.availability) && (
        <div className="flex flex-wrap items-center gap-2">
          {item.administrator && (
            <span className="text-[11px] text-[#0C1B33]/50">Administered by {item.administrator}</span>
          )}
          {item.availability && (
            <span className="font-mono-bureau text-[8.5px] tracking-[0.1em] uppercase text-[#0C1B33]/45 border border-[#0C1B33]/15 px-1.5 py-0.5">
              {STATUS_LABEL[item.availability]}
            </span>
          )}
        </div>
      )}

      {hasGlance && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-b border-[#0C1B33]/8 py-2.5 sm:grid-cols-2">
          {(item.nextWindow?.note || item.nextWindow?.expected) && (
            <div>
              <span className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/35 block">
                Window
              </span>
              <span className="text-[12px] text-[#0C1B33]/70">
                {item.nextWindow?.note || `Expected ${item.nextWindow?.expected}`}
              </span>
            </div>
          )}
          {item.decisionBy && (
            <div>
              <span className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/35 block">
                Decision by
              </span>
              <span className="text-[12px] text-[#0C1B33]/70">{item.decisionBy}</span>
            </div>
          )}
        </div>
      )}

      {hasCommonlyRequired && (
        <div>
          <span className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/35 block mb-1">
            Commonly required
          </span>
          <ul className="space-y-1">
            {item.eligibilityRules!.map((rule, index) => (
              <li key={index} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[#0C1B33]/60">
                <span className="mt-0.5 flex-shrink-0 text-[#0C1B33]/25">
                  {rule.required ? "●" : "○"}
                </span>
                <span>{rule.description}</span>
              </li>
            ))}
          </ul>
          {/* Non-suppressible per gate finding 11 — always renders alongside
              a real "Commonly required" list, never omitted. */}
          <p className="mt-1 text-[9.5px] text-[#0C1B33]/35">
            Your program administrator confirms current eligibility.
          </p>
        </div>
      )}

      {hasNextStep && (
        <div className="flex flex-col gap-1 border-t border-[#0C1B33]/8 pt-2.5">
          {item.nextStep && (
            <span className="text-[11.5px] leading-relaxed text-[#0C1B33]/60">
              <span className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/35 mr-1.5">
                Next step
              </span>
              {item.nextStep}
            </span>
          )}
          {item.primaryContact && (
            <span className="text-[11px] text-[#0C1B33]/50">
              {item.primaryContact.agency}
              {item.primaryContact.phone ? ` · ${item.primaryContact.phone}` : ""}
              {item.primaryContact.email ? ` · ${item.primaryContact.email}` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
