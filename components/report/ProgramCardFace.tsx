"use client";

// ─── Program-card face (gate finding 11; reordered gate round 3 BLOCKER 11
// RULING) ───────────────────────────────────────────────────────────────
// Administrator line, status/window pills, a glance row, cost signals,
// "What it funds," and "Commonly required" — moved out of the collapsed
// "Program review details" accordion onto the card FACE, matching the R5
// board's own SBIF card sequence. Gate round 3's RULING resolved a
// conflict the reviewer flagged between spec v2's prose ordering and the
// board's actual pixel layout: THE BOARD WINS. Board order for this
// component's slice: header (administrator + status/window pills) ->
// glance row -> cost signals (moved IN from ProgramCardExtras, which used
// to render it after the accordion split) -> "What it funds" -> Commonly
// required (+ footer). "Can combine with" / next-step+contact / "What to
// expect" / "Verify at the source" now render AFTER ReasonChips, in
// ProgramCardExtras — see that file's own header comment for why
// next-step+contact moved OUT of this component to sit there instead.
//
// "What it funds" reads `item.detail`, which for every real program item
// IS `program.summary` (see programReportItem() in lib/report-engine.ts:
// `detail: availabilityNote ? \`${availabilityNote}\n${program.summary}\`
// : program.summary`) — the program's own real, structured description,
// never invented for this block. The generic top-of-card detail render
// (app/report/page.tsx and components/report/ReportDisplay.tsx's shared
// per-item layout) is suppressed for real program items specifically
// (gated on `item.programId`) so the same text is never duplicated in two
// places on one card.
//
// Every field here is read from data report-engine.ts already computes on
// this same ReportItem (buildAdministrator/buildDecisionBy/buildCostSignals,
// all derived from the program's own contacts[]/howToApply[]/costSignals[]
// — never invented here). "Amount" and "Type" tiles from the board are
// deliberately NOT built: no non-blocklisted amount field exists
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
  const hasCostSignals = Boolean(item.costSignals?.length);
  const hasWhatItFunds = Boolean(item.programId && item.detail);
  const hasCommonlyRequired = Boolean(item.eligibilityRules?.length);
  if (
    !item.administrator &&
    !item.availability &&
    !hasGlance &&
    !hasCostSignals &&
    !hasWhatItFunds &&
    !hasCommonlyRequired
  ) {
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

      {/* Cost signals — moved IN from ProgramCardExtras (gate round 3
          BLOCKER 11 RULING: board order places this right after the
          glance row, well before "Can combine with"/"Verify at the
          source", which stayed in ProgramCardExtras). Same structured
          field (`buildCostSignals`), same non-suppressible caption. */}
      {hasCostSignals && (
        <div className="border-t border-[#0C1B33]/8 pt-2.5">
          <span className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/35 block mb-1">
            Cost signals
          </span>
          <div className="flex flex-wrap gap-1.5">
            {item.costSignals!.map((signal) => (
              <span
                key={signal.label}
                className={
                  signal.severity === "amber"
                    ? "font-mono-bureau text-[9px] tracking-[0.06em] uppercase text-[#9A3412] bg-[#FFF7ED] border border-[#FDBA74] px-2 py-1"
                    : "font-mono-bureau text-[9px] tracking-[0.06em] uppercase text-[#2563EB] bg-[#EFF3FB] border border-[#2563EB] px-2 py-1"
                }
              >
                {signal.label}
              </span>
            ))}
          </div>
          {/* Non-suppressible per gate finding 4 — always renders alongside
              at least one real signal, never omitted or made optional. */}
          <p className="mt-1 text-[10px] text-[#0C1B33]/40 leading-relaxed">
            Signals, not estimates — actual costs depend on your project and contractor.
          </p>
        </div>
      )}

      {/* "What it funds" — gate round 3 BLOCKER 11 RULING addition. Reads
          `item.detail`, which for a real program item IS `program.summary`
          (see this file's header comment). The generic top-of-card detail
          render is suppressed for real program items (`item.programId`
          truthy) so this is the only place it renders — never duplicated. */}
      {hasWhatItFunds && (
        <div className="border-t border-[#0C1B33]/8 pt-2.5">
          <span className="font-mono-bureau text-[8px] tracking-[0.14em] uppercase text-[#0C1B33]/35 block mb-1">
            What it funds
          </span>
          <p className="text-[11.5px] leading-relaxed text-[#0C1B33]/60 whitespace-pre-line">{item.detail}</p>
        </div>
      )}

      {hasCommonlyRequired && (
        <div className="border-t border-[#0C1B33]/8 pt-2.5">
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
    </div>
  );
}
