/**
 * Session persistence for the admin "Ownership clusters" map-layer toggle
 * (components/map/MapView.tsx).
 *
 * Why this exists: the demo flow round-trips through a FULL page navigation —
 * map → search → snapshot → "Generate report" (window.location.href =
 * /report?... in handleGenerateSnapshot) → Back — which remounts MapView and
 * resets every useState, silently unchecking the admin toggle and dropping
 * the layer (live-verified 2026-07-16). Backing just this toggle with
 * sessionStorage keeps it stable across remounts/reloads within the tab.
 *
 * sessionStorage (not localStorage) deliberately: per-tab and cleared when
 * the tab closes, so the stored preference can never outlive the working
 * session the way a localStorage flag would outlive the 8h admin cookie.
 * The flag is only a UI preference — rendering the ADMIN section requires a
 * live /api/owner-file/session 204 on every mount, and the geo data itself
 * is gated server-side, so a stale stored `true` shows a non-admin nothing.
 *
 * Pattern cloned from lib/personas.ts (SSR-safe, try/catch, best-effort —
 * a full/blocked store must never break the map).
 */

export const OWNER_CLUSTERS_VISIBLE_STORAGE_KEY = "cie_owner_clusters_visible";

/** Read the persisted toggle. False on SSR, missing key, or a blocked store. */
export function loadStoredOwnerClustersVisible(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(OWNER_CLUSTERS_VISIBLE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the toggle. Off (the default) is stored as key-removal, mirroring personas. */
export function storeOwnerClustersVisible(visible: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (visible) {
      window.sessionStorage.setItem(OWNER_CLUSTERS_VISIBLE_STORAGE_KEY, "1");
    } else {
      window.sessionStorage.removeItem(OWNER_CLUSTERS_VISIBLE_STORAGE_KEY);
    }
  } catch {
    // Persistence is best-effort; a full/blocked store must never break the map.
  }
}
