// ─── "Just looking" overview panels (gate finding 9/10) ──────────────────
// R5LookingFinal board: Location snapshot, What's notable, Explore by
// interest, the full-picture line. Every field here is read off data the
// engine ALREADY resolved elsewhere in the SAME lensed report — no new
// fetch, no new derivation risk, no invented "notable" judgment beyond
// "the first real item this report already surfaces in each of these
// three real categories." Nothing here is persona-tag-filtered (see
// programMatchesPersona's "looking" branch) — this panel summarizes the
// SAME full program set "all" would show, just condensed.

import { deadlinesSectionItems } from "@/lib/report-charts";
import { visiblePersonaProgramItems } from "@/lib/report-personas";
import { SECTION_IDS } from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";

export interface LocationSnapshot {
  zoneClass: string | null;
  zoneType: string | null;
  mappedZoneCount: number | null;
  programCount: number;
  dataVerified: string | null;
}

/**
 * Location snapshot stat row. `mappedZoneCount` comes from
 * `executiveSummary.zoneCount` (the same count the verdict/summary already
 * cites) — null when the report carries no executive summary. `dataVerified`
 * is a short month/year formatted from the report's real `generatedAt`,
 * matching the same "real freshness, never today" rule gate finding 14
 * established for the Brief.
 */
export function buildLocationSnapshot(lensed: GeneratedReport): LocationSnapshot {
  const generated = new Date(lensed.generatedAt);
  const dataVerified = Number.isNaN(generated.getTime())
    ? null
    : generated.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return {
    zoneClass: lensed.metadata?.zoneClass ?? null,
    zoneType: lensed.metadata?.zoneType ?? null,
    mappedZoneCount: lensed.executiveSummary?.zoneCount ?? null,
    programCount: visiblePersonaProgramItems(lensed).length,
    dataVerified,
  };
}

export interface NotableFact {
  label: string;
  detail: string;
}

/**
 * "What's notable" — up to 3 highlighted facts, each pulled from a real
 * item this report ALREADY surfaces elsewhere (never a new claim, never
 * editorial judgment about which program is "best"):
 *   1. The first upcoming deadline (SBIF window or TIF expiration) — the
 *      exact same source FundingWindowChart/IncentiveHorizonChart plot.
 *   2. The first Civic Representation item that carries its own `detail`
 *      (e.g. an active SSA/corridor line) — the exact same section the
 *      Civic Representation guidepost renders in full.
 *   3. The first visible program's own first published match reason
 *      (matchExplanation.whyItAppears[0]) — the exact same source
 *      ReasonChips renders on that program's own card.
 * A category with nothing real to show simply contributes no fact — never
 * a placeholder, never a generic filler line.
 */
export function buildWhatsNotable(lensed: GeneratedReport): NotableFact[] {
  const facts: NotableFact[] = [];

  const deadline = deadlinesSectionItems(lensed)[0];
  if (deadline) {
    facts.push({ label: deadline.label, detail: deadline.value });
  }

  const civicSection = lensed.sections?.find(
    (s) => s.id === SECTION_IDS.civicRepresentation || s.title === "Civic Representation",
  );
  const civicFact = civicSection?.items.find((item) => item.detail);
  if (civicFact) {
    facts.push({ label: civicFact.label, detail: civicFact.value });
  }

  const firstProgramWithReason = visiblePersonaProgramItems(lensed).find(
    (p) => p.item.matchExplanation?.whyItAppears?.[0],
  );
  if (firstProgramWithReason) {
    facts.push({
      label: firstProgramWithReason.label,
      detail: firstProgramWithReason.item.matchExplanation!.whyItAppears[0],
    });
  }

  return facts.slice(0, 3);
}

/** "Explore by interest" — real, additive persona-switch destinations.
 *  Fixed, closed set (the board's own three): owner, supporter, developer.
 *  Never "looking" or "all" — this panel exists to move someone OFF this
 *  lens once they know what they're looking for. */
export const EXPLORE_BY_INTEREST_OPTIONS = [
  { persona: "starting", label: "I own a business" },
  { persona: "supporter", label: "I support businesses" },
  { persona: "developer", label: "I develop property" },
] as const;
