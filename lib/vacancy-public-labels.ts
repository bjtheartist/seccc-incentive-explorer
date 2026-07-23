/**
 * Public-facing plain-language labels for the Vacant Sites experience — the
 * PUBLIC vocabulary the consult adopted (GPT-5.6 IA consult, "Plain-language
 * naming"). CLIENT-SAFE (no fs): importable from the map popup card, the new
 * public Opportunity Area pages, and their tests.
 *
 * Scope fence: these are used ONLY by the redesigned site card and the new
 * public Vacant Sites pages. The app-wide OWNER_TYPE_LABELS (lib/owner-classify)
 * and the admin Owner Files surfaces are intentionally left untouched — the
 * admin experience stays ownership-and-workflow-led while the public one is
 * place-and-action-led.
 *
 * Anonymization rail: these are CATEGORY labels only. No owner name or mailing
 * address is ever represented here or reaches any public surface.
 */

import type { OwnerType } from "./owner-classify";

/**
 * Public ownership-TYPE labels. "Not yet classified" replaces "Unknown"
 * (honest, less terminal-sounding). The five real owner types map to the
 * consult's public vocabulary; no owner is ever named.
 */
export const PUBLIC_OWNER_TYPE_LABELS: Record<OwnerType, string> = {
  city_public: "Public agency",
  corporate_llc: "Company or LLC",
  out_of_state: "Out-of-area owner",
  local_private: "Local individual",
  unknown: "Not yet classified",
};

/** The public column/section header for an ownership-type value. */
export const PUBLIC_OWNERSHIP_TYPE_HEADER = "Ownership type";

/** The standing discovery-not-availability disclaimer every public Opportunity
 * Area surface carries (rail 3). */
export const OPPORTUNITY_AREA_DISCLAIMER =
  "These are early possibilities identified from public records — not availability listings. " +
  "Ownership, condition, and feasibility must be verified.";
