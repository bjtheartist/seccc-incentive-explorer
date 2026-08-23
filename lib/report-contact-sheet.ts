// ─── Contact sheet (spec v2 deliverable 8 + late amendment) ─────────────
// Consolidates program-administrator, support-organization, and
// capital-partner contacts into ONE printable, persona-ordered block —
// the review's highest-value new surface. Pure: reads the already-LENSED
// report (goal-matched ∩ persona-tagged, lane-ranked support orgs), never
// re-derives relevance of its own.
//
// Every row carries a WHY-RELEVANT line generated from the SAME structural
// relevance data that selected the contact — a lane match, a program's own
// administration role, or its capital-match reason. Never generic filler.
// A contact whose why-line can't be derived from real data does not make
// the sheet (owner amendment).

import type { GeneratedReport, ReportItem } from "@/lib/report-engine";
import { isSupportOrganizationSectionTitle } from "@/lib/support-organization-copy";
import { CAPITAL_PARTNER_SECTION_TITLE } from "@/lib/capital-partner-report";
import { DEFAULT_PERSONA, type PersonaId } from "@/lib/personas";
import { inferSupportLanes, type LocalSupportLane } from "@/lib/local-business-support";

export interface ContactSheetRow {
  name: string;
  /** Phone, email, or a short "org type" line — whatever the source item published. */
  detail?: string;
  url?: string;
  whyLine: string;
  kind: "program" | "organization" | "financing";
}

const LANE_LABELS: Record<LocalSupportLane, string> = {
  business_navigation: "business navigation",
  capital_readiness: "capital readiness",
  small_business_capital: "small-business capital",
  housing_homeownership: "housing and homeownership",
  property_community_development: "property and community development",
  corridor_place_based: "corridor and place-based support",
  legal_support: "legal support",
  workforce: "workforce",
};

/** Persona → lane-preference order, mirrored from lib/report-personas.ts
 *  (kept as a small local copy rather than an import to avoid a
 *  UI-lib-depending-on-lens-internals coupling; both are derived from the
 *  same LocalSupportLane taxonomy and covered by the drift-free structural
 *  test in report-contact-sheet.test.ts). */
const PERSONA_LANE_PREFERENCE: Record<Exclude<PersonaId, "all">, LocalSupportLane[]> = {
  starting: ["business_navigation", "legal_support", "workforce"],
  growing: ["business_navigation", "capital_readiness", "small_business_capital"],
  supporter: ["corridor_place_based", "business_navigation", "property_community_development"],
  developer: ["property_community_development", "capital_readiness", "small_business_capital"],
  // Gate finding 9/10: "looking" has no specific goal to prefer a lane by
  // yet — business_navigation first (the broadest, most generally useful
  // starting point for someone still exploring), same order as "starting".
  looking: ["business_navigation", "legal_support", "workforce"],
};

function organizationWhyLine(item: ReportItem, persona: PersonaId): string | null {
  if (persona === DEFAULT_PERSONA) {
    // No single lens to explain relevance against on "all" — the item's own
    // published role is the only honest line available.
    return item.value?.trim() || null;
  }
  const lanes = inferSupportLanes({
    name: item.label,
    relationships: [],
    primaryType: [item.label, item.value].filter(Boolean).join(" "),
    supportTypes: item.detail,
    sourceUrls: [],
  });
  const preference = PERSONA_LANE_PREFERENCE[persona as Exclude<PersonaId, "all">] ?? [];
  const matchedLane = preference.find((lane) => lanes.includes(lane));
  if (!matchedLane) return null;
  return `Matches the ${LANE_LABELS[matchedLane]} lane for this view.`;
}

function itemContactDetail(item: ReportItem): string | undefined {
  return item.sourceLabel?.trim() || item.detail?.split("\n")[0]?.trim() || undefined;
}

const MAX_PROGRAM_CONTACTS = 3;
const MAX_ORG_CONTACTS = 3;

/**
 * Build the contact sheet from an already-lensed report. Persona-ordered:
 * the source sections (support orgs, programs) are read in the order the
 * lens already put them in, so this never re-ranks anything on its own.
 */
export function buildContactSheetRows(
  lensed: GeneratedReport,
  persona: PersonaId,
): ContactSheetRow[] {
  const rows: ContactSheetRow[] = [];

  // Financing — the capital-partner handoff's own `reason` is always
  // present (required field), so this row is always derivable when a
  // primary match exists.
  const capitalPrimary = lensed.capitalPartnerHandoff?.primary;
  if (capitalPrimary) {
    rows.push({
      name: capitalPrimary.name,
      detail: capitalPrimary.phone || capitalPrimary.contactEmail || undefined,
      url: capitalPrimary.intakeUrl || capitalPrimary.website,
      whyLine: capitalPrimary.reason,
      kind: "financing",
    });
  }

  // Program administrators — the visible (goal-matched ∩ persona-tagged,
  // per the hard filter already applied to `lensed`) program cards, in
  // their rendered order. Skips the collapsed "Also at this address" pool
  // entirely — a contact whose program isn't in the visible set has no
  // derivable reason to be on THIS view's sheet.
  let programCount = 0;
  for (const section of lensed.sections ?? []) {
    if (section.collapsedByPersona) continue;
    if (isSupportOrganizationSectionTitle(section.title)) continue;
    if (section.title === CAPITAL_PARTNER_SECTION_TITLE) continue;
    for (const item of section.items ?? []) {
      if (!item.programId || programCount >= MAX_PROGRAM_CONTACTS) continue;
      const contact = itemContactDetail(item);
      if (!contact && !item.url) continue; // nothing to actually contact
      rows.push({
        name: item.label,
        detail: contact,
        url: item.url,
        whyLine: `Administers ${item.label}.`,
        kind: "program",
      });
      programCount += 1;
    }
    if (programCount >= MAX_PROGRAM_CONTACTS) break;
  }

  // Support organizations — already lane-ranked by the lens for this
  // persona; skip the summary head row, keep only rows with a derivable
  // why-line, cap at MAX_ORG_CONTACTS.
  const supportSection = (lensed.sections ?? []).find((s) =>
    isSupportOrganizationSectionTitle(s.title),
  );
  if (supportSection) {
    const items = (supportSection.items ?? []).filter((item) => item.programId === undefined);
    // First item is the "N organizations" summary card, not a contact.
    const orgItems = items.slice(1);
    let orgCount = 0;
    for (const item of orgItems) {
      if (orgCount >= MAX_ORG_CONTACTS) break;
      const whyLine = organizationWhyLine(item, persona);
      if (!whyLine) continue;
      rows.push({
        name: item.label,
        detail: itemContactDetail(item),
        url: item.url || item.sourceUrl,
        whyLine,
        kind: "organization",
      });
      orgCount += 1;
    }
  }

  return rows;
}
