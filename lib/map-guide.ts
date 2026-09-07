/**
 * Walkthrough tour for the public /map page. Kept entirely separate from
 * lib/first-visit-guide.ts (the sitewide tour) and lib/investment-guide.ts
 * (the gated /investment tour): its own storage key, its own version counter,
 * its own replay event — so completing one tour can never be mistaken for
 * completing another, and a version bump on one never silently reopens the
 * others.
 *
 * Single-page like the investment tour (no cross-page handoff), so no
 * session-storage leg machinery.
 *
 * The guide explains controls at the visitor's pace. It never submits a
 * search, changes a layer, or resets map state when it closes.
 */

/* ── Preference storage ─────────────────────────────────────────── */

/** Keep existing dismissals respected; the revised guide is always replayable. */
export const MAP_GUIDE_VERSION = 2;
export const MAP_GUIDE_STORAGE_KEY = "cie:map-guide";
/** Dispatched by the persistent replay control to re-trigger the tour. */
export const MAP_GUIDE_OPEN_EVENT = "cie:open-map-guide";
/**
 * Dispatched once an outcome (completed or skipped) is recorded, so the map
 * header's entry point can swap from the "Show me around" pill to the small
 * replay icon without a reload.
 */
export const MAP_GUIDE_RESOLVED_EVENT = "cie:map-guide-resolved";

export type MapGuideStatus = "completed" | "skipped";

export interface MapGuidePreference {
  version: number;
  status: MapGuideStatus;
  updatedAt: string;
}

/**
 * The site header is `sticky top-0` and 56px tall (`h-14`). Scrolling an
 * anchor with `scrollIntoView` alone parks it UNDER that bar — which is
 * exactly how stop one shipped pointing at nothing in production. Every
 * pre-stop scroll subtracts this, plus a little breathing room.
 */
export const STICKY_NAV_OFFSET_PX = 56;
const SCROLL_BREATHING_ROOM_PX = 16;

/**
 * A highlight bigger than this share of the viewport stops reading as a
 * highlight: the cut-out swallows the screen and every un-highlighted thing
 * looks ghosted behind the dim. That is what anchoring a stop to the whole
 * map canvas did.
 */
export const MAX_HIGHLIGHT_VIEWPORT_RATIO = 0.6;

export interface MapTourStep {
  key: string;
  selector: string;
  title: string;
  description: string;
  /** Optional guidance below the description. */
  note?: string;
  side: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

function isVisible(element: Element | null | undefined): element is HTMLElement {
  if (!element || !(element instanceof HTMLElement)) return false;
  return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}

/** Pure, so it can be unit-tested without a layout engine. */
export function fitsHighlightBudget(
  rect: { width: number; height: number },
  viewport: { width: number; height: number },
): boolean {
  const viewportArea = viewport.width * viewport.height;
  if (viewportArea <= 0) return true;
  return (rect.width * rect.height) / viewportArea <= MAX_HIGHLIGHT_VIEWPORT_RATIO;
}

/**
 * Resolves a step's anchor for driver.js, as a function so driver re-evaluates
 * it on every attempt (its `waitForElement` MutationObserver and its
 * `skipMissingElement` check both call through this).
 *
 * Returns null — which driver reads as "missing", and therefore skips or waits
 * for — when the match is absent OR present-but-not-rendered. The nav's
 * Generate Report link is the case that forces this: on a phone it is inside a
 * closed sheet, so `document.querySelector` finds it while it has no layout at
 * all, and a plain selector step would highlight a zero-box element and float
 * the popover over nothing.
 *
 * When the match is real but oversized (over MAX_HIGHLIGHT_VIEWPORT_RATIO of
 * the viewport), the largest descendant that fits is preferred so the stop
 * still happens instead of dimming the whole screen.
 */
export function resolveTourAnchor(selector: string): HTMLElement | null {
  const match = Array.from(document.querySelectorAll(selector)).find(isVisible);
  if (!match) return null;

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  if (fitsHighlightBudget(match.getBoundingClientRect(), viewport)) return match;

  let candidate: HTMLElement = match;
  for (let depth = 0; depth < 3; depth += 1) {
    const fitting = Array.from(candidate.children)
      .filter(isVisible)
      .filter((child) => fitsHighlightBudget(child.getBoundingClientRect(), viewport))
      .sort(
        (a, b) =>
          b.getBoundingClientRect().width * b.getBoundingClientRect().height -
          a.getBoundingClientRect().width * a.getBoundingClientRect().height,
      );
    if (fitting[0]) return fitting[0];

    const next = Array.from(candidate.children).filter(isVisible)[0];
    if (!next) break;
    candidate = next;
  }
  return match;
}

/**
 * Picks the side with real room, falling back to the preferred one. driver.js
 * clamps a popover to the viewport on every side and, when NO side has room,
 * centres it over the page ("over") on its own — this only keeps it from
 * choosing a side that has to be clamped in the first place.
 *
 * Pure, so it is unit-tested directly.
 */
export function chooseTourSide(
  rect: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
  preferred: MapTourStep["side"],
  needed = 220,
): MapTourStep["side"] {
  const room: Record<MapTourStep["side"], number> = {
    top: rect.top,
    bottom: viewport.height - rect.bottom,
    left: rect.left,
    right: viewport.width - rect.right,
  };
  if (room[preferred] >= needed) return preferred;
  const best = (Object.keys(room) as MapTourStep["side"][]).sort((a, b) => room[b] - room[a])[0];
  return room[best] > room[preferred] ? best : preferred;
}

/** Scrolls an anchor fully clear of the sticky nav, instantly (never mid-position). */
export function scrollTourAnchorIntoView(element: HTMLElement) {
  try {
    const rect = element.getBoundingClientRect();
    const safeTop = STICKY_NAV_OFFSET_PX + SCROLL_BREATHING_ROOM_PX;
    const safeBottom = window.innerHeight - SCROLL_BREATHING_ROOM_PX;
    if (rect.top >= safeTop && rect.bottom <= safeBottom) return;

    // Centre it in the space BELOW the nav when it fits there, otherwise pin
    // its top just under the nav.
    const usableHeight = safeBottom - safeTop;
    const targetTop =
      rect.height <= usableHeight ? safeTop + (usableHeight - rect.height) / 2 : safeTop;
    window.scrollTo({ top: window.scrollY + rect.top - targetTop, behavior: "auto" });
  } catch {
    // No layout (jsdom) or a browser that refuses the scroll — the stop still
    // renders, it just may not be re-centred.
  }
}

/** Stable controls exist before any search or layer request completes. */
export const MAP_TOUR_STEPS: MapTourStep[] = [
  {
    key: "map-search",
    selector: '[data-tour="map-search"]',
    title: "Start with your location",
    description:
      "Search a street address or a business name, then choose a result. The map centers on that location and opens its area details.",
    note: "Take your time. Use Next and Back, or close this guide to try the map.",
    side: "bottom",
    align: "end",
  },
  {
    key: "map-layers",
    selector: '[data-tour="map-layer-control"]',
    title: "Choose the layers you need",
    description:
      "Open the legend with this control. Select individual layers or a preset to explore incentive areas. Selected layers load as you need them.",
    side: "bottom",
    align: "start",
  },
  {
    key: "map-inspect",
    selector: '[data-tour="map-inspect"]',
    title: "Explore a location",
    description:
      "Click or tap the map for area details. On a computer, right-click for zoning. Overlapping zones are a starting point for program-by-program review and do not by themselves confirm eligibility or stacking.",
    side: "top",
    align: "start",
  },
  {
    key: "nav-report",
    selector: '[data-tour="nav-report"], [data-tour="nav-menu"]',
    title: "Take it with you",
    description:
      "Choose Generate Report in the main navigation to create a written snapshot for an address. On a phone, open this menu to find it.",
    side: "bottom",
    align: "end",
  },
];

/** Escape the description and optional note before driver.js renders them. */
export function mapTourPopoverHtml(step: MapTourStep): string {
  const escape = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  if (!step.note) return escape(step.description);
  return `${escape(step.description)}<span class="cie-tour-note">${escape(step.note)}</span>`;
}

/* ── Preference read/write ──────────────────────────────────────── */

export function readMapGuidePreference(
  storage: Pick<Storage, "getItem">,
): MapGuidePreference | null {
  try {
    const raw = storage.getItem(MAP_GUIDE_STORAGE_KEY);
    if (!raw) return null;

    const value = JSON.parse(raw) as Partial<MapGuidePreference>;
    if (
      value.version !== MAP_GUIDE_VERSION ||
      (value.status !== "completed" && value.status !== "skipped") ||
      typeof value.updatedAt !== "string"
    ) {
      return null;
    }

    return value as MapGuidePreference;
  } catch {
    return null;
  }
}

export function writeMapGuidePreference(
  storage: Pick<Storage, "setItem">,
  status: MapGuideStatus,
) {
  const preference: MapGuidePreference = {
    version: MAP_GUIDE_VERSION,
    status,
    updatedAt: new Date().toISOString(),
  };

  try {
    storage.setItem(MAP_GUIDE_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // The tour remains optional when storage is blocked or unavailable.
  }

  return preference;
}
