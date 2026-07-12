// ─── Persona lens core (Tier 1b, audit BM4) ─────────────────────────
// Zero-dependency persona primitives shared by the persona chip UI, the
// report lens, the Program data type, and the analytics layer. Kept free
// of report/engine imports so `lib/types.ts` can reference `PersonaId`
// without a circular dependency.
//
// Product boundary: a persona is a *viewing lens* over the same snapshot —
// it re-orders and collapses existing content. It never certifies
// eligibility. All persona copy stays descriptive ("programs most often
// used by developers"), never determinative.

export type PersonaId = "all" | "starting" | "growing" | "developer";

export interface PersonaChip {
  id: PersonaId;
  /** Uppercased at render; stored in title case for reuse in copy. */
  label: string;
  /** Descriptive framing used in the "Also at this address" copy. */
  descriptor: string;
}

/** Chip vocabulary — exact copy from docs/refine-tier1b-design.md §1. */
export const PERSONA_CHIPS: readonly PersonaChip[] = [
  { id: "all", label: "All", descriptor: "all programs tied to this address" },
  {
    id: "starting",
    label: "Starting a business",
    descriptor: "programs most often used by new and small businesses",
  },
  {
    id: "growing",
    label: "Growing / property owner",
    descriptor:
      "programs most often used by existing businesses and property owners",
  },
  {
    id: "developer",
    label: "Developer or investor",
    descriptor: "programs most often used by developers and investors",
  },
] as const;

export const DEFAULT_PERSONA: PersonaId = "all";

/** sessionStorage key + share-URL query param (round-trips a forwarded lens). */
export const PERSONA_STORAGE_KEY = "seccc.persona";
export const PERSONA_QUERY_KEY = "persona";

const VALID_PERSONAS = new Set<PersonaId>(PERSONA_CHIPS.map((c) => c.id));

export function isPersonaId(value: unknown): value is PersonaId {
  return typeof value === "string" && VALID_PERSONAS.has(value as PersonaId);
}

/** Coerce any input to a valid persona, defaulting to "all". */
export function normalizePersona(value: unknown): PersonaId {
  return isPersonaId(value) ? value : DEFAULT_PERSONA;
}

export function personaLabel(persona: PersonaId): string {
  return PERSONA_CHIPS.find((c) => c.id === persona)?.label ?? "All";
}

export function personaDescriptor(persona: PersonaId): string {
  return (
    PERSONA_CHIPS.find((c) => c.id === persona)?.descriptor ??
    "all programs tied to this address"
  );
}

// ─── URL round-trip ──────────────────────────────────────────────────

/** Read the persona lens from a query string / URLSearchParams. */
export function personaFromSearch(
  search: string | URLSearchParams | null | undefined,
): PersonaId {
  if (!search) return DEFAULT_PERSONA;
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  return normalizePersona(params.get(PERSONA_QUERY_KEY));
}

/**
 * Serialize a persona for the share URL. "all" is the default lens, so it is
 * omitted (keeps forwarded links clean); every other lens round-trips.
 */
export function personaShareParam(persona: PersonaId): string | null {
  return persona === DEFAULT_PERSONA ? null : persona;
}

// ─── sessionStorage (SSR-safe; never throws) ─────────────────────────

export function loadStoredPersona(): PersonaId {
  if (typeof window === "undefined") return DEFAULT_PERSONA;
  try {
    return normalizePersona(window.sessionStorage.getItem(PERSONA_STORAGE_KEY));
  } catch {
    return DEFAULT_PERSONA;
  }
}

export function storePersona(persona: PersonaId): void {
  if (typeof window === "undefined") return;
  try {
    if (persona === DEFAULT_PERSONA) {
      window.sessionStorage.removeItem(PERSONA_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(PERSONA_STORAGE_KEY, persona);
    }
  } catch {
    // Persistence is best-effort; a full/blocked store must never break the view.
  }
}

/**
 * Resolve the initial lens for a freshly opened snapshot: an explicit
 * `?persona=` in the URL wins (a forwarded link opens in its sender's lens),
 * otherwise fall back to the per-session choice, otherwise "All".
 */
export function resolveInitialPersona(
  search?: string | URLSearchParams | null,
): PersonaId {
  const fromUrl = personaFromSearch(search);
  if (fromUrl !== DEFAULT_PERSONA) return fromUrl;
  return loadStoredPersona();
}
