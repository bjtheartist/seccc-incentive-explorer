/**
 * SITE-CARD VIEWPORT FIT — the pure geometry behind "selecting a site must not
 * push the card off screen".
 *
 * The Property Map's site card is a mapbox Popup anchored to the selected dot.
 * mapbox-gl picks an anchor side but does NOT pan to keep the popup on screen,
 * and the card grows when its <details> accordions are opened — so a site near
 * a map edge, or a reader who expanded "Why it was flagged", ended up with the
 * card's lower sections (DATA AND SOURCES) clipped outside the map frame.
 *
 * Two independent mechanisms, both driven from here:
 *   1. OFFSET — siteCardPanDelta() returns the map.panBy() vector that brings
 *      an overflowing card fully inside the frame. Applied on open and again on
 *      every accordion toggle.
 *   2. GUARANTEE — siteCardMaxHeight() / siteCardMaxWidth() cap the card to the
 *      frame so it can always fit, with internal scroll for the overflow. This
 *      is what makes the behavior correct on a phone, where the frame is small
 *      enough that no amount of panning would seat a fully-expanded card.
 *
 * Pure, DOM-free, dependency-free: the component passes plain rectangles in and
 * gets numbers out, so all of it is unit-testable without a map runtime.
 */

/** A screen-space rectangle (the subset of DOMRect this module needs). */
export interface FitRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Breathing room kept between the card and the map frame, in CSS px. */
export const CARD_VIEWPORT_MARGIN = 12;

/** The card never collapses below this, even in an absurdly short frame. */
export const CARD_MIN_HEIGHT = 140;

/**
 * First-guess reserve for the popup's own chrome — its padding, close button
 * and tip — which wrap the card content and are NOT part of the capped
 * scroller. Measured at ~35px on mapbox-gl 3.x; kept a little generous so the
 * first paint is already inside the frame. Once the popup is in the DOM the
 * chrome is measured exactly and the cap is corrected via fittedContentHeight.
 */
export const CARD_ANCHOR_GAP = 44;

/** Widest the card is ever allowed to be (the established popup maxWidth). */
export const CARD_MAX_WIDTH = 320;

/** Narrowest useful card before the two-column action row breaks down. */
export const CARD_MIN_WIDTH = 220;

/**
 * The tallest the card may render inside a map frame of `containerHeight` px.
 * Everything past this scrolls INSIDE the card instead of off the frame.
 *
 * A non-finite or non-positive height (a container measured before layout)
 * yields `null` — "no cap", which is strictly safer than clamping the card to
 * a bogus few pixels.
 */
export function siteCardMaxHeight(
  containerHeight: number,
  margin: number = CARD_VIEWPORT_MARGIN,
  anchorGap: number = CARD_ANCHOR_GAP,
): number | null {
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) return null;
  return Math.max(CARD_MIN_HEIGHT, Math.floor(containerHeight - 2 * margin - anchorGap));
}

/**
 * The widest the card may render inside a map frame of `containerWidth` px —
 * CARD_MAX_WIDTH on any normal viewport, narrowed only when the frame itself is
 * narrow (a phone), and never below CARD_MIN_WIDTH.
 */
export function siteCardMaxWidth(
  containerWidth: number,
  margin: number = CARD_VIEWPORT_MARGIN,
): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return CARD_MAX_WIDTH;
  const available = Math.floor(containerWidth - 2 * margin);
  return Math.max(CARD_MIN_WIDTH, Math.min(CARD_MAX_WIDTH, available));
}

/**
 * How far the card overflows each inset edge of the frame, in px (0 = inside).
 * Exported for its own tests and because the component logs nothing else about
 * why it decided to pan.
 */
export function cardOverflow(
  card: FitRect,
  container: FitRect,
  margin: number = CARD_VIEWPORT_MARGIN,
): { left: number; right: number; top: number; bottom: number } {
  return {
    left: Math.max(0, container.left + margin - card.left),
    right: Math.max(
      0,
      card.left + card.width - (container.left + container.width - margin),
    ),
    top: Math.max(0, container.top + margin - card.top),
    bottom: Math.max(
      0,
      card.top + card.height - (container.top + container.height - margin),
    ),
  };
}

/**
 * The `map.panBy([dx, dy])` vector that seats an overflowing card inside the
 * frame — WITHOUT moving the selected pin out of it, since panning by exactly
 * the overflow moves pin and card together by the same amount and the pin sits
 * inside the card's own footprint edge.
 *
 * Sign convention: panBy moves the CAMERA, so page content shifts the opposite
 * way. A card overflowing the TOP by 40px needs the content to move down 40px,
 * which is `panBy([0, -40])` — hence `bottom - top` (and `right - left`).
 *
 * When the card is larger than the available space in an axis (only reachable
 * if the max-height/width caps were not applied), the overflowing far edge is
 * unwinnable, so that axis aligns to the near edge instead of oscillating.
 * Returns `[0, 0]` when the card already fits — the caller can skip the pan.
 */
export function siteCardPanDelta(
  card: FitRect,
  container: FitRect,
  margin: number = CARD_VIEWPORT_MARGIN,
): [number, number] {
  const over = cardOverflow(card, container, margin);
  const availableWidth = container.width - 2 * margin;
  const availableHeight = container.height - 2 * margin;

  const dx = card.width > availableWidth ? -over.left : over.right - over.left;
  const dy = card.height > availableHeight ? -over.top : over.bottom - over.top;

  return [Math.round(dx), Math.round(dy)];
}

/**
 * The card-content cap that makes the WHOLE popup fit, given the chrome the
 * popup wraps the content in (padding + close button + tip), measured from the
 * live element. This is the correction pass: siteCardMaxHeight can only guess
 * the chrome before the popup exists, and guessing 7px short is enough to leave
 * "Data and sources" hanging past the frame once every accordion is open.
 */
export function fittedContentHeight(
  frameHeight: number,
  chromeHeight: number,
  margin: number = CARD_VIEWPORT_MARGIN,
): number {
  const chrome = Number.isFinite(chromeHeight) && chromeHeight > 0 ? chromeHeight : 0;
  if (!Number.isFinite(frameHeight) || frameHeight <= 0) return CARD_MIN_HEIGHT;
  return Math.max(CARD_MIN_HEIGHT, Math.floor(frameHeight - 2 * margin - chrome));
}

/**
 * Intersection of two rectangles, clamped to non-negative size.
 *
 * The map frame is NOT automatically the visible frame: the map is 560px tall
 * inside a scrolling page, so on a short window (or with the page scrolled
 * mid-map) part of it is past the fold. Seating the card inside the map element
 * alone can still leave it below the window edge, so both surfaces constrain it.
 */
export function intersectRects(a: FitRect, b: FitRect): FitRect {
  const top = Math.max(a.top, b.top);
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/** True when the card is fully inside the inset frame (nothing to do). */
export function cardFitsInside(
  card: FitRect,
  container: FitRect,
  margin: number = CARD_VIEWPORT_MARGIN,
): boolean {
  const over = cardOverflow(card, container, margin);
  return over.left === 0 && over.right === 0 && over.top === 0 && over.bottom === 0;
}
