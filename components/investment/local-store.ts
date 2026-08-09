/**
 * Client-safe localStorage helpers for the Investment analysis working session:
 * the pinned-areas set (Compare) and the saved-records shortlist (Working set).
 *
 * Admin-side only — the whole /investment tree is behind the Owner Files gate, so
 * this stores a working session on the admin's own machine, never anything the
 * public sees. Pure DOM/localStorage; no fs, no network. Every mutation dispatches
 * a window CustomEvent so sibling widgets (a save button and the working-set
 * panel, a pin button and the compare bar) stay in sync without shared React state.
 *
 * All reads are defensive: a malformed or absent value yields the empty default,
 * never a throw, so a hand-edited localStorage entry can't break the page.
 */

import { clearInvestmentSession } from "@/lib/investment-session";
import {
  GOVERNMENT_FUNDING_PURPOSE_LABELS,
  type GovernmentFundingPurpose,
} from "@/lib/government-funding-purpose";

export const PINNED_AREAS_KEY = "investment.pinnedAreas";
export const SHORTLIST_KEY = "investment.shortlist";

/** Max community areas that can be pinned for a side-by-side compare (Sol: 2–4). */
export const MAX_PINNED_AREAS = 4;

export const PINS_EVENT = "investment:pins-changed";
export const SHORTLIST_EVENT = "investment:shortlist-changed";

/** One saved record in the working-set shortlist. `notes` is the admin's own
 * meeting note; everything else mirrors the source record so an export needs no
 * re-lookup. */
export interface ShortlistRecord {
  id: string;
  recipient: string;
  funderName: string;
  source: string;
  governmentFundingPurpose: GovernmentFundingPurpose | null;
  year: number | null;
  amountAwarded: number;
  communityArea: string;
  notes: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readJson<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown, eventName: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(eventName));
  } catch {
    // Storage full / disabled — fail silently; the working session is best-effort.
  }
}

// ── Pinned areas ──────────────────────────────────────────────────────────────

/** The pinned community areas, deduped and capped to MAX_PINNED_AREAS. */
export function readPinnedAreas(): string[] {
  const list = readJson<unknown>(PINNED_AREAS_KEY, []);
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === "string" && item && !seen.has(item)) {
      seen.add(item);
      out.push(item);
      if (out.length >= MAX_PINNED_AREAS) break;
    }
  }
  return out;
}

export function isAreaPinned(area: string): boolean {
  return readPinnedAreas().includes(area);
}

/**
 * Toggle a community area in the pinned set. Returns the new pinned list. Adding
 * past MAX_PINNED_AREAS is a no-op on the addition (the cap is honored) — the
 * caller can surface a "max reached" hint from the returned length.
 */
export function togglePinnedArea(area: string): string[] {
  const current = readPinnedAreas();
  const next = current.includes(area)
    ? current.filter((a) => a !== area)
    : current.length >= MAX_PINNED_AREAS
      ? current
      : [...current, area];
  writeJson(PINNED_AREAS_KEY, next, PINS_EVENT);
  return next;
}

export function clearPinnedAreas(): void {
  writeJson(PINNED_AREAS_KEY, [], PINS_EVENT);
}

// ── Shortlist (working set) ───────────────────────────────────────────────────

/** The saved-record shortlist, filtered to well-formed entries. */
export function readShortlist(): ShortlistRecord[] {
  const list = readJson<unknown>(SHORTLIST_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.filter(
    (r): r is ShortlistRecord =>
      !!r && typeof r === "object" && typeof (r as ShortlistRecord).id === "string",
  );
}

export function isRecordSaved(id: string): boolean {
  return readShortlist().some((r) => r.id === id);
}

/** Toggle a record in the shortlist. A newly-added record starts with empty
 * notes; toggling an existing one removes it (notes and all). Returns the new list. */
export function toggleShortlistRecord(record: Omit<ShortlistRecord, "notes">): ShortlistRecord[] {
  const current = readShortlist();
  const next = current.some((r) => r.id === record.id)
    ? current.filter((r) => r.id !== record.id)
    : [...current, { ...record, notes: "" }];
  writeJson(SHORTLIST_KEY, next, SHORTLIST_EVENT);
  return next;
}

/** Update the meeting note on a saved record (no-op when the id isn't saved). */
export function setShortlistNote(id: string, notes: string): ShortlistRecord[] {
  const next = readShortlist().map((r) => (r.id === id ? { ...r, notes } : r));
  writeJson(SHORTLIST_KEY, next, SHORTLIST_EVENT);
  return next;
}

export function removeShortlistRecord(id: string): ShortlistRecord[] {
  const next = readShortlist().filter((r) => r.id !== id);
  writeJson(SHORTLIST_KEY, next, SHORTLIST_EVENT);
  return next;
}

export function clearShortlist(): void {
  writeJson(SHORTLIST_KEY, [], SHORTLIST_EVENT);
}

// ── Whole-working-set wipe (shared-machine hygiene) ───────────────────────────

/**
 * Wipe the ENTIRE admin working set from this browser: the saved-records shortlist
 * (named grantees + the admin's private meeting notes), the pinned compare areas,
 * and the cross-surface session (year / funderType / area filters). Used by the
 * manual "Clear working set" button AND by the unauthenticated-session guard, so a
 * departing admin leaves no named records or private notes behind for the next
 * person on a shared machine to recover via DevTools or a fresh login. The session
 * key lives in lib/investment-session (sessionStorage); it is cleared here too so
 * one call leaves nothing behind. Best-effort — a blocked store never throws.
 */
export function clearInvestmentWorkingSet(): void {
  clearShortlist();
  clearPinnedAreas();
  clearInvestmentSession();
}

/** Subscribe to a working-session change event (returns an unsubscribe fn). Also
 * listens to the native `storage` event so a change in another tab propagates. */
export function subscribe(eventName: string, handler: () => void): () => void {
  if (!isBrowser()) return () => {};
  window.addEventListener(eventName, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(eventName, handler);
    window.removeEventListener("storage", handler);
  };
}

// ── useSyncExternalStore adapters ─────────────────────────────────────────────
// The store is external (localStorage + our event bus), so useSyncExternalStore
// is the idiomatic read path — hydration-safe and effect-free. getSnapshot must
// return a REFERENTIALLY STABLE value while the data is unchanged (React compares
// with Object.is), so each snapshot is cached behind a cheap serialized key and a
// new reference is minted only when the underlying data actually changes.

const EMPTY_STRINGS: string[] = [];
let pinnedSnapshot: string[] = EMPTY_STRINGS;
let pinnedSnapshotKey = "\u0000__init__";

/** Stable snapshot of the pinned-areas list for useSyncExternalStore (client). */
export function getPinnedSnapshot(): string[] {
  const list = readPinnedAreas();
  const key = list.join("\u0000");
  if (key !== pinnedSnapshotKey) {
    pinnedSnapshotKey = key;
    pinnedSnapshot = list;
  }
  return pinnedSnapshot;
}

/** Server/hydration snapshot — always the empty set (localStorage is client-only). */
export function getPinnedServerSnapshot(): string[] {
  return EMPTY_STRINGS;
}

/** Subscribe wrapper for useSyncExternalStore (pins). */
export function subscribePins(handler: () => void): () => void {
  return subscribe(PINS_EVENT, handler);
}

const EMPTY_SHORTLIST: ShortlistRecord[] = [];
let shortlistSnapshot: ShortlistRecord[] = EMPTY_SHORTLIST;
let shortlistSnapshotKey = "\u0000__init__";

/** Stable snapshot of the shortlist for useSyncExternalStore (client). */
export function getShortlistSnapshot(): ShortlistRecord[] {
  const list = readShortlist();
  const key = JSON.stringify(list);
  if (key !== shortlistSnapshotKey) {
    shortlistSnapshotKey = key;
    shortlistSnapshot = list;
  }
  return shortlistSnapshot;
}

/** Server/hydration snapshot — always empty (localStorage is client-only). */
export function getShortlistServerSnapshot(): ShortlistRecord[] {
  return EMPTY_SHORTLIST;
}

/** Subscribe wrapper for useSyncExternalStore (shortlist). */
export function subscribeShortlist(handler: () => void): () => void {
  return subscribe(SHORTLIST_EVENT, handler);
}

// ── CSV export (client-side, no server round-trip) ────────────────────────────

/** RFC-4180-safe CSV cell: quote when it contains a comma, quote, or newline. */
function csvCell(value: string | number | null): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize the shortlist to CSV text (header + one row per saved record). */
export function shortlistToCsv(records: readonly ShortlistRecord[]): string {
  const header = [
    "Recipient",
    "Funder",
    "Program",
    "Government funding purpose",
    "Year",
    "Awarded",
    "Community area",
    "Notes",
  ];
  const rows = records.map((r) =>
    [
      r.recipient,
      r.funderName,
      r.source,
      r.governmentFundingPurpose
        ? GOVERNMENT_FUNDING_PURPOSE_LABELS[r.governmentFundingPurpose]
        : "Not government",
      r.year ?? "",
      r.amountAwarded,
      r.communityArea,
      r.notes,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

/** Trigger a client-side CSV file download (no network). Safe no-op off-browser. */
export function downloadCsv(filename: string, csv: string): void {
  if (!isBrowser()) return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
