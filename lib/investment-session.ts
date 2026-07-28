/**
 * Shared "working session" for the admin Investment & Impact surfaces — the one
 * small context that follows the admin across Map ↔ /investment analysis ↔
 * /investment/compare (Sol #1, pragmatic v1). Three fields:
 *   • communityArea — the CA the admin last focused (the map fly-to target /
 *     the analysis page they came from).
 *   • yearWindow    — an INVESTMENT_YEAR_RANGES id (the map's year filter);
 *     absent means the "All" default.
 *   • funderTypes   — the active funder types (the map's funderType checkboxes);
 *     ABSENT means "all on" (the default), an explicit ARRAY (possibly empty)
 *     means exactly that subset.
 *
 * Persisted in sessionStorage so it survives the full-page navigations between
 * the map and the analysis pages within one tab, and mirrored to/from the URL
 * query on those surfaces so a link is shareable and the map deep-link
 * (?investment=1&area=…&year=…&types=…) can seed it. The map's investment layer
 * reads the SAME store, so year/funderType survive a map ↔ analysis round-trip.
 *
 * Client-safe: no fs, no map deps; sessionStorage guarded and every read is
 * defensive (a malformed or absent value yields the empty default, never a
 * throw). Mirrors components/investment/local-store.ts. It imports only VALUES
 * from the client-safe lib/community-investment-layer.ts (never from
 * lib/community-investment.ts, which pulls node:fs) and a type-only FunderType.
 */

import type { FunderType } from "@/lib/community-investment";
import {
  DEFAULT_INVESTMENT_YEAR_RANGE,
  FUNDER_TYPE_ORDER,
  INVESTMENT_YEAR_RANGES,
} from "@/lib/community-investment-layer";

export interface InvestmentSession {
  communityArea?: string;
  /** An INVESTMENT_YEAR_RANGES id; absent = the "All" default. */
  yearWindow?: string;
  /** Active funder types; ABSENT = all on, an explicit array = exactly that set. */
  funderTypes?: FunderType[];
}

export const INVESTMENT_SESSION_STORAGE_KEY = "cie_investment_session";
/** Dispatched on every mutation so sibling client widgets re-read (mirrors the
 * local-store event bus). */
export const INVESTMENT_SESSION_EVENT = "investment:session-changed";

const FUNDER_TYPE_SET: ReadonlySet<string> = new Set<string>(FUNDER_TYPE_ORDER);

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function isValidYearWindow(id: unknown): id is string {
  return typeof id === "string" && INVESTMENT_YEAR_RANGES.some((r) => r.id === id);
}

/**
 * Normalize an arbitrary funder-type list into the canonical representation:
 *   • the FULL set (or an unusable input) → `undefined` — the "all on" default,
 *     stored as absence so a fresh session reads "all".
 *   • any strict SUBSET (including the empty set = "none") → that subset in
 *     FUNDER_TYPE_ORDER.
 * Unknown tokens are dropped. Deterministic.
 */
function coerceFunderTypes(value: unknown): FunderType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  for (const v of value) if (typeof v === "string" && FUNDER_TYPE_SET.has(v)) seen.add(v);
  if (seen.size === FUNDER_TYPE_ORDER.length) return undefined; // full set == "all"
  return FUNDER_TYPE_ORDER.filter((t) => seen.has(t)); // strict subset (may be [])
}

/** Read the persisted session. Empty object on SSR, missing key, or malformed JSON. */
export function loadInvestmentSession(): InvestmentSession {
  if (!isBrowser()) return {};
  try {
    const raw = window.sessionStorage.getItem(INVESTMENT_SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: InvestmentSession = {};
    if (typeof parsed.communityArea === "string" && parsed.communityArea) {
      out.communityArea = parsed.communityArea;
    }
    if (isValidYearWindow(parsed.yearWindow)) out.yearWindow = parsed.yearWindow;
    const ft = coerceFunderTypes(parsed.funderTypes);
    if (ft !== undefined) out.funderTypes = ft;
    return out;
  } catch {
    return {};
  }
}

function persist(session: InvestmentSession): void {
  if (!isBrowser()) return;
  try {
    // Store only the non-default keys ("off = removed", mirroring the toggle /
    // view-mode convention) so a fresh tab reads clean defaults.
    const clean: Record<string, unknown> = {};
    if (session.communityArea) clean.communityArea = session.communityArea;
    if (session.yearWindow && session.yearWindow !== DEFAULT_INVESTMENT_YEAR_RANGE) {
      clean.yearWindow = session.yearWindow;
    }
    if (session.funderTypes !== undefined) clean.funderTypes = session.funderTypes;
    if (Object.keys(clean).length === 0) {
      window.sessionStorage.removeItem(INVESTMENT_SESSION_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(INVESTMENT_SESSION_STORAGE_KEY, JSON.stringify(clean));
    }
    window.dispatchEvent(new CustomEvent(INVESTMENT_SESSION_EVENT));
  } catch {
    // Persistence is best-effort; a full/blocked store must never break a page.
  }
}

/**
 * Merge a partial patch into the session and persist. Only keys PRESENT on the
 * patch are touched (so a caller can update just `yearWindow` without clobbering
 * `communityArea`). Passing an explicit `undefined` for a present key clears it;
 * passing the full funder-type set clears the override (back to "all"). Returns
 * the resulting session.
 */
export function patchInvestmentSession(patch: Partial<InvestmentSession>): InvestmentSession {
  const next: InvestmentSession = { ...loadInvestmentSession() };
  if ("communityArea" in patch) {
    if (patch.communityArea) next.communityArea = patch.communityArea;
    else delete next.communityArea;
  }
  if ("yearWindow" in patch) {
    if (patch.yearWindow && patch.yearWindow !== DEFAULT_INVESTMENT_YEAR_RANGE) {
      next.yearWindow = patch.yearWindow;
    } else {
      delete next.yearWindow;
    }
  }
  if ("funderTypes" in patch) {
    const ft = coerceFunderTypes(patch.funderTypes);
    if (ft !== undefined) next.funderTypes = ft;
    else delete next.funderTypes;
  }
  persist(next);
  return next;
}

/** Wipe the whole working session (all three fields). */
export function clearInvestmentSession(): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(INVESTMENT_SESSION_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(INVESTMENT_SESSION_EVENT));
  } catch {
    // best-effort
  }
}

// ── URL <-> session (the /investment cross-links + the map deep-link) ─────────

/**
 * Build the map deep-link query for a session: `investment=1` (turns the layer
 * on) plus `area`, `year`, and `types` when they carry non-default context. The
 * "Show on map →" links serialize the live session through this so the map
 * restores the exact filter view; MapView reads it back with sessionFromQuery.
 * `communityArea` may be overridden by the caller (an area page passes its own).
 */
export function sessionToMapQuery(session: InvestmentSession): URLSearchParams {
  const params = new URLSearchParams();
  params.set("investment", "1");
  if (session.communityArea) params.set("area", session.communityArea);
  if (session.yearWindow && session.yearWindow !== DEFAULT_INVESTMENT_YEAR_RANGE) {
    params.set("year", session.yearWindow);
  }
  if (session.funderTypes !== undefined) params.set("types", session.funderTypes.join(","));
  return params;
}

/**
 * The full `/map?…` href for a session (optionally forcing a specific area — an
 * analysis page passes its own CA name). Pure string assembly, safe to call from
 * a server component.
 */
export function mapHrefForSession(session: InvestmentSession, area?: string): string {
  const params = sessionToMapQuery({ ...session, communityArea: area ?? session.communityArea });
  return `/map?${params.toString()}`;
}

/**
 * Extract investment context out of a URLSearchParams (the map deep-link). Only
 * present + valid keys appear on the result; `types` present with a full/absent
 * set leaves funderTypes off (= "all"). A `types=` that carries NO valid token —
 * an empty `…&types=`, a truncated `…&types=phi`, or all-unknown tokens — is
 * treated as the "all types" default rather than the empty set, so a hand-edited
 * or clipped shared link never lands the recipient on a blank, seemingly-broken
 * layer with every dot filtered off. (The deliberate all-off state is only ever
 * reached through the map's own checkboxes / sessionStorage, not this URL seam.)
 */
export function sessionFromQuery(params: URLSearchParams): InvestmentSession {
  const out: InvestmentSession = {};
  const area = params.get("area");
  if (area) out.communityArea = area;
  const year = params.get("year");
  if (isValidYearWindow(year)) out.yearWindow = year;
  const types = params.get("types");
  if (types !== null) {
    const ft = coerceFunderTypes(
      types.split(",").map((s) => s.trim()).filter((s) => s !== ""),
    );
    // Only apply a real, non-empty subset. undefined (full/unusable set) OR an
    // empty subset (no valid token) both fall through to the "all types" default.
    if (ft !== undefined && ft.length > 0) out.funderTypes = ft;
  }
  return out;
}

// ── useSyncExternalStore adapters (client widgets that read the live session) ──

let sessionSnapshot: InvestmentSession = {};
let sessionSnapshotKey = "__init__";

/** Referentially-stable snapshot for useSyncExternalStore (client). */
export function getInvestmentSessionSnapshot(): InvestmentSession {
  const s = loadInvestmentSession();
  const key = JSON.stringify(s);
  if (key !== sessionSnapshotKey) {
    sessionSnapshotKey = key;
    sessionSnapshot = s;
  }
  return sessionSnapshot;
}

const EMPTY_SESSION: InvestmentSession = {};
/** Server/hydration snapshot — always empty (sessionStorage is client-only). */
export function getInvestmentSessionServerSnapshot(): InvestmentSession {
  return EMPTY_SESSION;
}

/** Subscribe to session changes (returns an unsubscribe). Also listens to the
 * native `storage` event so a change in another tab propagates. */
export function subscribeInvestmentSession(handler: () => void): () => void {
  if (!isBrowser()) return () => {};
  window.addEventListener(INVESTMENT_SESSION_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(INVESTMENT_SESSION_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

// ── Map-layer bridge (MapView init + change) ─────────────────────────────────

/**
 * Convert the session's funderTypes into the map's per-type checkbox record
 * (every canonical type → boolean). Absent session funderTypes → all true.
 */
export function funderTypeRecordFromSession(
  funderTypes: readonly FunderType[] | undefined,
): Record<FunderType, boolean> {
  const active = funderTypes ? new Set<string>(funderTypes) : null;
  return Object.fromEntries(
    FUNDER_TYPE_ORDER.map((t) => [t, active ? active.has(t) : true]),
  ) as Record<FunderType, boolean>;
}

/**
 * Convert the map's per-type checkbox record into the session's canonical
 * funderTypes (the full set collapses to `undefined` = "all on"). Inverse of
 * funderTypeRecordFromSession.
 */
export function sessionFunderTypesFromRecord(
  record: Record<FunderType, boolean>,
): FunderType[] | undefined {
  const active = FUNDER_TYPE_ORDER.filter((t) => record[t]);
  return active.length === FUNDER_TYPE_ORDER.length ? undefined : active;
}
