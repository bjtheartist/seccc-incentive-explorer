/**
 * Preflight for the interactive map.
 *
 * Mapbox GL JS v3 requires WebGL2. Older iOS Safari and most in-app
 * browsers (Instagram, LinkedIn, Facebook) don't provide it, and today
 * the map constructor simply produces a blank canvas there — the
 * "map doesn't render on mobile" report. Detecting it up front lets the
 * page show an honest state with a way forward instead of silence.
 */

export type MapFailureReason =
  | "no-token"
  | "no-webgl2"
  | "init-error"
  | "style-error"
  | "context-lost";

/**
 * Cheap check for the WebGL2 API. Mapbox creates the real context and its
 * constructor failure is handled by MapView. Creating a throwaway context
 * here duplicates GPU initialization before the map can request its style.
 *
 * `?mapgl=0` forces the unsupported path — a support and testing escape
 * so this state can be seen in any browser without hunting for a device
 * that lacks WebGL2.
 */
export function webgl2Available(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (new URLSearchParams(window.location.search).get("mapgl") === "0") {
      return false;
    }
    return typeof window.WebGL2RenderingContext !== "undefined";
  } catch {
    return false;
  }
}
