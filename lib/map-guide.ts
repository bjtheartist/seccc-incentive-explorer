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
 * v2 (this file): the tour DEMONSTRATES rather than describes. Every stop but
 * the last carries a `perform` hook that drives the real UI — it types the
 * demo address into the real search box and submits it, opens the real dossier
 * section the result populated, flips a real legend preset and hands it back,
 * and reveals a real hint marker on the map. Each `perform` is paired with an
 * `undo` that runs at teardown, so ending or skipping the tour puts the page
 * back the way it was found.
 */

/* ── Preference storage ─────────────────────────────────────────── */

/**
 * Bumped 1 → 2 for the rebuilt five-stop tour. A returning visitor who
 * completed or skipped the old four-stop tour reads as "no preference" once
 * and is offered the new one; their next outcome is written at version 2 and
 * never reopens again.
 */
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

/**
 * Dispatched around a run so components/map/MapView.tsx can snapshot the
 * pre-tour camera on start and restore it — along with removing the demo
 * search marker and closing the demo dossier — on end. The tour itself has no
 * handle on the Mapbox instance; MapView owns it, so MapView owns the restore.
 */
export const MAP_TOUR_START_EVENT = "cie:map-tour-started";
export const MAP_TOUR_END_EVENT = "cie:map-tour-ended";

export type MapGuideStatus = "completed" | "skipped";

export interface MapGuidePreference {
  version: number;
  status: MapGuideStatus;
  updatedAt: string;
}

/* ── Demo constants ─────────────────────────────────────────────── */

/**
 * The address stop one types. On the 87th Street corridor — the Chamber's
 * focus — and on the block of a real NOF award, so the dossier stop that
 * follows has records to show instead of an empty card.
 */
export const MAP_TOUR_DEMO_ADDRESS = "1500 E 87th St, Chicago, IL 60619";

/** Milliseconds between keystrokes when the tour types the demo address. */
export const MAP_TOUR_TYPING_INTERVAL_MS = 25;

/** How long the preset stop holds the swapped view before handing it back. */
export const MAP_TOUR_PRESET_HOLD_MS = 1200;

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

/** Injected by the tour; removed on teardown. */
export const MAP_TOUR_HINT_SELECTOR = '[data-tour="map-hint"]';
export const MAP_TOUR_DEMO_BADGE_TESTID = "map-tour-demo-badge";
export const MAP_TOUR_DEMO_BADGE_TEXT = "Example, for illustration";

/**
 * Shown on every stop that is looking at the demo result, so nobody reads
 * the searched block's zones or records as their own. Rendered in the muted
 * mono label style by `mapTourPopoverHtml`.
 */
export const MAP_TOUR_ILLUSTRATIVE_NOTE =
  "Example address for illustration only. Search your own address to see your results.";

/* ── Step shape ─────────────────────────────────────────────────── */

export interface MapTourStepContext {
  /** True when the visitor asked for reduced motion. */
  reduceMotion: boolean;
  /** True once the run has ended — every wait loop checks it and bails. */
  isCancelled: () => boolean;
}

export interface MapTourStep {
  key: string;
  selector: string;
  title: string;
  description: string;
  /** Muted line appended under the description; see MAP_TOUR_ILLUSTRATIVE_NOTE. */
  note?: string;
  side: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Longer per-step budget for anchors that only exist after an action. */
  waitForElementMs?: number;
  /**
   * Drives the real UI for this stop. Runs AFTER the stop is highlighted, so
   * the visitor watches it happen. Must tolerate a missing anchor (the mobile
   * legend is closed, a geocode can fail) by returning quietly.
   */
  perform?: (ctx: MapTourStepContext) => Promise<void>;
  /** Undoes `perform`. Runs at teardown, in reverse order, always. */
  undo?: (ctx: MapTourStepContext) => void;
}

/* ── Small DOM helpers ──────────────────────────────────────────── */

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Polls `read` until it returns something truthy, the budget runs out, or the run is cancelled. */
async function waitForValue<T>(
  read: () => T | null | undefined,
  ctx: MapTourStepContext,
  timeoutMs: number,
  intervalMs = 120,
): Promise<T | null> {
  const startedAt = Date.now();
  for (;;) {
    if (ctx.isCancelled()) return null;
    const value = read();
    if (value) return value;
    if (Date.now() - startedAt >= timeoutMs) return null;
    await delay(intervalMs);
  }
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
  const match = document.querySelector(selector);
  if (!isVisible(match)) return null;

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

/** Writes to a React-controlled input the way a keystroke would. */
function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/* ── Injected elements: the demo badge and the map hint ─────────── */

function findSearchContainer() {
  return document.querySelector<HTMLElement>('[data-tour="map-search"]');
}

export function mountDemoBadge(): HTMLElement | null {
  const container = findSearchContainer();
  if (!container) return null;
  const existing = container.querySelector<HTMLElement>(
    `[data-testid="${MAP_TOUR_DEMO_BADGE_TESTID}"]`,
  );
  if (existing) return existing;

  const badge = document.createElement("div");
  badge.setAttribute("data-testid", MAP_TOUR_DEMO_BADGE_TESTID);
  badge.textContent = MAP_TOUR_DEMO_BADGE_TEXT;
  badge.style.cssText = [
    "margin-top:6px",
    "display:inline-block",
    "padding:3px 8px",
    "border:1px solid rgba(180,83,9,0.35)",
    "background:#FFFBEB",
    "color:#78350F",
    "font-family:'JetBrains Mono',Menlo,monospace",
    "font-size:9px",
    "letter-spacing:0.12em",
    "text-transform:uppercase",
    "pointer-events:none",
  ].join(";");
  container.appendChild(badge);
  return badge;
}

export function removeDemoBadge() {
  document
    .querySelectorAll(`[data-testid="${MAP_TOUR_DEMO_BADGE_TESTID}"]`)
    .forEach((node) => node.remove());
}

/**
 * The stop-four anchor: a small marker sitting ON the map near the searched
 * address, instead of the whole canvas. Created hidden at the start of the run
 * (so driver.js can resolve it), revealed by stop four, removed on teardown.
 */
export function mountMapTourHint(): HTMLElement | null {
  const canvas = document.querySelector<HTMLElement>('[data-tour="map-canvas"]');
  if (!canvas) return null;
  const host = canvas.parentElement ?? canvas;
  const existing = host.querySelector<HTMLElement>(MAP_TOUR_HINT_SELECTOR);
  if (existing) return existing;

  const hint = document.createElement("div");
  hint.setAttribute("data-tour", "map-hint");
  hint.setAttribute("aria-hidden", "true");
  hint.style.cssText = [
    "position:absolute",
    "width:18px",
    "height:18px",
    "margin:-9px 0 0 -9px",
    "border-radius:9999px",
    "background:#2563EB",
    "box-shadow:0 0 0 6px rgba(37,99,235,0.22)",
    "pointer-events:none",
    "z-index:12",
    "opacity:0",
    "transition:opacity 200ms ease",
  ].join(";");
  host.appendChild(hint);
  positionMapTourHint(hint);
  return hint;
}

/** Parks the hint just off the map's centre — i.e. on a zone beside the searched point. */
function positionMapTourHint(hint: HTMLElement) {
  const canvas = document.querySelector<HTMLElement>('[data-tour="map-canvas"]');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || canvas.offsetWidth;
  const height = rect.height || canvas.offsetHeight;
  hint.style.left = `${Math.round(width / 2 - 64)}px`;
  hint.style.top = `${Math.round(height / 2 - 48)}px`;
}

export function removeMapTourHint() {
  document.querySelectorAll(MAP_TOUR_HINT_SELECTOR).forEach((node) => node.remove());
}

/* ── Step definitions ───────────────────────────────────────────── */

/** Captured by stop one's `perform`, restored by its `undo`. */
let preTourSearchValue: string | null = null;
/** Captured by stop two's `perform` (the section may already be open). */
let preTourDossierOpen: boolean | null = null;
/** Captured by stop three's `perform`: the preset id active before the flip. */
let preTourPresetId: string | null = null;
let presetFlipApplied = false;

function presetButtons(): HTMLButtonElement[] {
  const panel = document.querySelector<HTMLElement>('[data-tour="map-presets"]');
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLButtonElement>("button[data-preset-id]"));
}

function activePresetButton() {
  return presetButtons().find((button) => button.getAttribute("aria-pressed") === "true") ?? null;
}

/**
 * Five stops, each anchored to an element that exists in the map surface (or
 * is created by the tour itself and registered here), and each but the last
 * performing the thing it is describing.
 *
 * On a phone the legend panel starts closed and the nav's Generate Report link
 * lives inside a closed sheet, so stops three and five resolve to no anchor
 * and driver.js skips them; the remaining three still read as a complete tour.
 */
export const MAP_TOUR_STEPS: MapTourStep[] = [
  {
    key: "map-search",
    selector: '[data-tour="map-search"]',
    title: "Search this address",
    // Input honesty, same rule as the sitewide tour: the search resolves a
    // street address or a business name — never name a PIN here.
    description:
      "The search takes a street address or a business name, then the map centers on it with every mapped zone that touches it.",
    note: MAP_TOUR_ILLUSTRATIVE_NOTE,
    side: "bottom",
    align: "end",
    async perform(ctx) {
      const container = findSearchContainer();
      const input = container?.querySelector<HTMLInputElement>("input");
      if (!container || !input) return;

      preTourSearchValue = input.value;
      mountDemoBadge();

      try {
        input.focus({ preventScroll: true });
      } catch {
        input.focus();
      }

      if (ctx.reduceMotion) {
        setControlledInputValue(input, MAP_TOUR_DEMO_ADDRESS);
      } else {
        for (let i = 1; i <= MAP_TOUR_DEMO_ADDRESS.length; i += 1) {
          if (ctx.isCancelled()) return;
          setControlledInputValue(input, MAP_TOUR_DEMO_ADDRESS.slice(0, i));
          await delay(MAP_TOUR_TYPING_INTERVAL_MS);
        }
      }

      // Submit it the way a visitor does: wait for the suggestion list the
      // debounce opens, then pick the address it resolved.
      const choice = await waitForValue(
        () => {
          const list = document.querySelector<HTMLElement>('[data-testid="map-search-results"]');
          if (!list) return null;
          const options = Array.from(list.querySelectorAll<HTMLButtonElement>("button"));
          if (options.length === 0) return null;
          return options.find((o) => /address/i.test(o.textContent ?? "")) ?? options[0];
        },
        ctx,
        15000,
      );
      if (!choice || ctx.isCancelled()) return;
      choice.click();
    },
    undo() {
      removeDemoBadge();
      const input = findSearchContainer()?.querySelector<HTMLInputElement>("input");
      if (input && preTourSearchValue !== null) {
        setControlledInputValue(input, preTourSearchValue);
      }
      preTourSearchValue = null;
    },
  },
  {
    key: "map-dossier",
    selector: '[data-tour="map-dossier"]',
    title: "Here's what touches it",
    // Public-claim guard: overlap is a starting point for review, never a
    // finding. Keep this sentence's meaning intact.
    description:
      "This card gathers the zones and the nearby public records for the searched point. Zones overlapping an address are a starting point for program-by-program review and do not by themselves confirm eligibility or stacking.",
    note: MAP_TOUR_ILLUSTRATIVE_NOTE,
    side: "left",
    align: "start",
    // The dossier only exists once the search result resolves, so this stop
    // waits rather than being skipped past.
    waitForElementMs: 20000,
    async perform(ctx) {
      const section = await waitForValue(
        () => document.querySelector<HTMLDetailsElement>('[data-tour="map-dossier"]'),
        ctx,
        20000,
      );
      if (!section || ctx.isCancelled()) return;

      preTourDossierOpen = section.open;
      section.open = true;

      // Let the zone list and the Nearby records block finish populating
      // before the visitor is asked to read them.
      await waitForValue(
        () => (/nearby records|mapped programs to review/i.test(section.textContent ?? "") ? true : null),
        ctx,
        12000,
      );
    },
    undo() {
      const section = document.querySelector<HTMLDetailsElement>('[data-tour="map-dossier"]');
      if (section && preTourDossierOpen !== null) section.open = preTourDossierOpen;
      preTourDossierOpen = null;
    },
  },
  {
    key: "map-presets",
    selector: '[data-tour="map-presets"]',
    title: "Swap the lens",
    // Deliberately does not enumerate the preset names: frozen tour copy rots
    // the moment a bundle is added or renamed, the same way digits do.
    description:
      "Chicago's incentive geography arrives in layers, so the legend bundles them into one-tap presets — watch one preset swap the whole view, then hand it back.",
    side: "right",
    align: "start",
    async perform(ctx) {
      const buttons = presetButtons();
      if (buttons.length < 2) return;

      const original = activePresetButton();
      preTourPresetId = original?.getAttribute("data-preset-id") ?? null;

      const target = buttons.find((button) => button !== original);
      if (!target) return;

      // Reduced motion asked for no flipping; the copy still explains it.
      if (ctx.reduceMotion) return;

      target.click();
      presetFlipApplied = true;
      await delay(MAP_TOUR_PRESET_HOLD_MS);
      if (ctx.isCancelled()) return;

      // Handing it back: re-click the original, or re-click the swapped-in
      // preset to deselect it when nothing was active before.
      (original ?? target).click();
      presetFlipApplied = false;
    },
    undo() {
      if (presetFlipApplied) {
        const restore = preTourPresetId
          ? presetButtons().find((b) => b.getAttribute("data-preset-id") === preTourPresetId)
          : activePresetButton();
        restore?.click();
        presetFlipApplied = false;
      }
      preTourPresetId = null;
    },
  },
  {
    key: "map-hint",
    selector: MAP_TOUR_HINT_SELECTOR,
    title: "Ask the map anything",
    description:
      "Click any zone for the programs tied to it, right-click anywhere for the zoning classification, or tap it on a phone.",
    note: MAP_TOUR_ILLUSTRATIVE_NOTE,
    side: "right",
    align: "center",
    async perform(ctx) {
      const hint = mountMapTourHint();
      if (!hint) return;
      positionMapTourHint(hint);
      hint.style.opacity = "1";
      if (!ctx.reduceMotion) {
        hint.style.animation = "bureau-pulse 1.6s ease-in-out infinite";
      }
    },
    undo() {
      removeMapTourHint();
    },
  },
  {
    key: "nav-report",
    selector: '[data-tour="nav-report"]',
    title: "Take it with you",
    description:
      "Generate Report turns an address into a written snapshot of the programs, zones, and public records behind it.",
    side: "bottom",
    align: "end",
  },
];

/**
 * The popover body driver.js renders: the step's sentence, plus the muted
 * illustrative line when the stop is showing the demo result. Composed here
 * rather than in the component so the unit tests can assert on exactly what a
 * visitor reads.
 */
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
