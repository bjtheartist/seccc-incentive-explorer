import type { PersonaId } from "./personas";

// ─── Email-gate persona grouping (email-gate redesign, spec §gate anatomy 2) ──
// The gate's "Which best describes you?" row shows exactly the 4 chips the
// blessed board draws — fewer and plainer than the 6-entry PERSONA_CHIPS
// list (lib/personas.ts) the report's own "Viewing As" row renders.
// Presentation-only, additive: no PersonaId is re-keyed, no new id is
// invented. "starting" and "growing" — already grouped under one
// "Business owner" copy label in lib/personas.ts's own `group` field —
// collapse into ONE clickable gate chip here; selecting it when neither is
// already active defaults to "starting" (first in the existing vocabulary
// order, and the inference module's own fallback for a generic business-
// owner signal). "all" (the default, unlensed view) is not offered here —
// the gate always resolves to one of the four real, chip-backed lenses.

export interface GatePersonaChip {
  /** Stable id for THIS chip (gate-local — not re-used as a PersonaId). */
  id: string;
  /** Exact board copy (R6GateBlessed.dc.html persona row). */
  label: string;
  /** Every PersonaId this chip represents as "selected". */
  personaIds: readonly PersonaId[];
  /** PersonaId applied when the chip is clicked and none of personaIds is already active. */
  defaultPersonaId: PersonaId;
}

export const GATE_PERSONA_CHIPS: readonly GatePersonaChip[] = [
  { id: "looking", label: "Just looking", personaIds: ["looking"], defaultPersonaId: "looking" },
  {
    id: "business-owner",
    label: "Business owner",
    personaIds: ["starting", "growing"],
    defaultPersonaId: "starting",
  },
  {
    id: "supporter",
    label: "Supporting businesses",
    personaIds: ["supporter"],
    defaultPersonaId: "supporter",
  },
  { id: "developer", label: "Developer", personaIds: ["developer"], defaultPersonaId: "developer" },
] as const;

export function gatePersonaChipForPersona(persona: PersonaId): GatePersonaChip | undefined {
  return GATE_PERSONA_CHIPS.find((chip) => chip.personaIds.includes(persona));
}
