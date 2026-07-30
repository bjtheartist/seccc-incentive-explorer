/**
 * Site-card viewport fit — the geometry that keeps a selected site's card
 * (pin AND full card) inside the map frame.
 *
 * Regression under test: selecting a site opened the card anchored to the dot
 * with no accounting for the card's own footprint, so a site near the top of a
 * 560px map — or a reader who expanded the accordions — lost the card's lower
 * sections (DATA AND SOURCES) off the frame.
 *
 * Two mechanisms, asserted independently:
 *   OFFSET    siteCardPanDelta — the map.panBy vector that reseats the card.
 *   GUARANTEE siteCardMaxHeight / siteCardMaxWidth — the caps that make the
 *             card fit any frame, phone included, with internal scroll.
 */

import { describe, expect, it } from "vitest";
import {
  CARD_ANCHOR_GAP,
  CARD_MAX_WIDTH,
  CARD_MIN_HEIGHT,
  CARD_MIN_WIDTH,
  CARD_VIEWPORT_MARGIN,
  cardFitsInside,
  cardOverflow,
  fittedContentHeight,
  intersectRects,
  siteCardMaxHeight,
  siteCardMaxWidth,
  siteCardPanDelta,
  type FitRect,
} from "../vacancy-card-fit";

/** The live map frame: h-[560px], full width, at the top of the page. */
const DESKTOP_FRAME: FitRect = { top: 100, left: 0, width: 1024, height: 560 };
/** A phone: the same component, a narrow viewport. */
const PHONE_FRAME: FitRect = { top: 60, left: 0, width: 375, height: 560 };

describe("siteCardMaxHeight", () => {
  it("caps the card to the frame minus its margins and anchor gap", () => {
    expect(siteCardMaxHeight(560)).toBe(560 - 2 * CARD_VIEWPORT_MARGIN - CARD_ANCHOR_GAP);
  });

  it("keeps a usable card even in an absurdly short frame", () => {
    expect(siteCardMaxHeight(120)).toBe(CARD_MIN_HEIGHT);
    expect(siteCardMaxHeight(1)).toBe(CARD_MIN_HEIGHT);
  });

  it("declines to cap on an unmeasured container rather than clamping to nonsense", () => {
    expect(siteCardMaxHeight(0)).toBeNull();
    expect(siteCardMaxHeight(-40)).toBeNull();
    expect(siteCardMaxHeight(Number.NaN)).toBeNull();
  });

  it("guarantees the fully expanded card fits: capped height always seats inside the frame", () => {
    for (const frameHeight of [320, 480, 560, 720, 1080]) {
      const cap = siteCardMaxHeight(frameHeight)!;
      // A card rendered at the cap, top-aligned inside the margin, is inside.
      const card: FitRect = {
        top: CARD_VIEWPORT_MARGIN,
        left: CARD_VIEWPORT_MARGIN,
        width: 300,
        height: cap,
      };
      const frame: FitRect = { top: 0, left: 0, width: 1024, height: frameHeight };
      // Only fails for the CARD_MIN_HEIGHT floor in a sub-164px frame, which is
      // shorter than the component ever renders.
      if (frameHeight >= CARD_MIN_HEIGHT + 2 * CARD_VIEWPORT_MARGIN) {
        expect(cardFitsInside(card, frame)).toBe(true);
      }
    }
  });
});

describe("siteCardMaxWidth", () => {
  it("uses the established popup width on a normal viewport", () => {
    expect(siteCardMaxWidth(1024)).toBe(CARD_MAX_WIDTH);
  });

  it("narrows to the frame on a phone rather than overflowing it", () => {
    expect(siteCardMaxWidth(340)).toBe(340 - 2 * CARD_VIEWPORT_MARGIN);
    expect(siteCardMaxWidth(340)).toBeLessThan(CARD_MAX_WIDTH);
  });

  it("never collapses below a usable card", () => {
    expect(siteCardMaxWidth(180)).toBe(CARD_MIN_WIDTH);
  });

  it("falls back to the default on an unmeasured container", () => {
    expect(siteCardMaxWidth(0)).toBe(CARD_MAX_WIDTH);
    expect(siteCardMaxWidth(Number.NaN)).toBe(CARD_MAX_WIDTH);
  });
});

describe("fittedContentHeight", () => {
  /**
   * Regression from live verification: a 558px map frame with every accordion
   * open produced a 541px popup — 7px past the inset frame — because the
   * pre-mount estimate under-reserved the popup's own chrome (padding + close
   * button + tip). The measured-chrome pass must close that gap exactly.
   */
  it("makes the WHOLE popup fit once the real chrome is measured", () => {
    const frameHeight = 558;
    const chrome = 35; // measured on mapbox-gl 3.x
    const content = fittedContentHeight(frameHeight, chrome);
    expect(content + chrome).toBeLessThanOrEqual(frameHeight - 2 * CARD_VIEWPORT_MARGIN);
  });

  it("holds for any frame/chrome pair large enough to render a card", () => {
    for (const frameHeight of [400, 480, 558, 700, 1000]) {
      for (const chrome of [0, 20, 35, 60]) {
        const content = fittedContentHeight(frameHeight, chrome);
        expect(content).toBeGreaterThanOrEqual(CARD_MIN_HEIGHT);
        if (content > CARD_MIN_HEIGHT) {
          expect(content + chrome + 2 * CARD_VIEWPORT_MARGIN).toBeLessThanOrEqual(frameHeight);
        }
      }
    }
  });

  it("ignores a nonsense chrome measurement rather than collapsing the card", () => {
    expect(fittedContentHeight(558, Number.NaN)).toBe(558 - 2 * CARD_VIEWPORT_MARGIN);
    expect(fittedContentHeight(558, -10)).toBe(558 - 2 * CARD_VIEWPORT_MARGIN);
    expect(fittedContentHeight(0, 35)).toBe(CARD_MIN_HEIGHT);
  });
});

describe("intersectRects", () => {
  /**
   * The map is 560px tall inside a scrolling page, so the frame the card must
   * fit is the map ∩ window — not the map element, part of which can sit past
   * the fold.
   */
  it("clips a map frame that runs past the bottom of the window", () => {
    const map: FitRect = { top: 411, left: 129, width: 1022, height: 558 }; // ends at 969
    const window900: FitRect = { top: 0, left: 0, width: 1280, height: 900 };
    expect(intersectRects(map, window900)).toEqual({
      top: 411,
      left: 129,
      width: 1022,
      height: 489,
    });
  });

  it("clips a map frame that starts above the top of the window", () => {
    const map: FitRect = { top: -120, left: 0, width: 1022, height: 558 };
    const win: FitRect = { top: 0, left: 0, width: 1280, height: 900 };
    const out = intersectRects(map, win);
    expect(out.top).toBe(0);
    expect(out.height).toBe(438);
  });

  it("is a no-op when the map is entirely on screen", () => {
    const map: FitRect = { top: 90, left: 129, width: 1022, height: 558 };
    const win: FitRect = { top: 0, left: 0, width: 1280, height: 900 };
    expect(intersectRects(map, win)).toEqual(map);
  });

  it("never yields a negative box when the two do not overlap", () => {
    const out = intersectRects(
      { top: 2000, left: 0, width: 100, height: 100 },
      { top: 0, left: 0, width: 1280, height: 900 },
    );
    expect(out.width).toBeGreaterThanOrEqual(0);
    expect(out.height).toBe(0);
  });

  it("a card capped to the CLIPPED frame fits the window, not just the map", () => {
    const map: FitRect = { top: 411, left: 129, width: 1022, height: 558 };
    const win: FitRect = { top: 0, left: 0, width: 1280, height: 900 };
    const frame = intersectRects(map, win);
    const chrome = 35;
    const card: FitRect = {
      top: frame.top + CARD_VIEWPORT_MARGIN,
      left: frame.left + CARD_VIEWPORT_MARGIN,
      width: 320,
      height: fittedContentHeight(frame.height, chrome) + chrome,
    };
    expect(cardFitsInside(card, frame)).toBe(true);
    expect(card.top + card.height).toBeLessThanOrEqual(win.height);
  });
});

describe("cardOverflow", () => {
  it("reports zero on every edge for a centered card", () => {
    const card: FitRect = { top: 200, left: 300, width: 300, height: 200 };
    expect(cardOverflow(card, DESKTOP_FRAME)).toEqual({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    });
  });

  it("measures each edge against the INSET frame, not the raw frame", () => {
    // Card flush with the raw left edge still overflows by the margin.
    const card: FitRect = { top: 200, left: 0, width: 300, height: 200 };
    expect(cardOverflow(card, DESKTOP_FRAME).left).toBe(CARD_VIEWPORT_MARGIN);
  });
});

describe("siteCardPanDelta", () => {
  it("is a no-op when the card already fits", () => {
    const card: FitRect = { top: 200, left: 300, width: 300, height: 200 };
    expect(siteCardPanDelta(card, DESKTOP_FRAME)).toEqual([0, 0]);
    expect(cardFitsInside(card, DESKTOP_FRAME)).toBe(true);
  });

  it("pans UP (negative dy) when the card runs off the TOP — the reported defect", () => {
    // Card anchored above a dot near the top of the frame: 40px past the inset.
    const card: FitRect = {
      top: DESKTOP_FRAME.top + CARD_VIEWPORT_MARGIN - 40,
      left: 300,
      width: 300,
      height: 300,
    };
    const [dx, dy] = siteCardPanDelta(card, DESKTOP_FRAME);
    expect(dx).toBe(0);
    // panBy moves the camera; content must move DOWN 40px, so the camera goes up.
    expect(dy).toBe(-40);
  });

  it("pans DOWN when the card's lower sections (DATA AND SOURCES) run off the bottom", () => {
    const frameBottom = DESKTOP_FRAME.top + DESKTOP_FRAME.height;
    const card: FitRect = {
      top: frameBottom - 200,
      left: 300,
      width: 300,
      height: 300, // ends 100px past the frame, 112 past the inset
    };
    const [, dy] = siteCardPanDelta(card, DESKTOP_FRAME);
    expect(dy).toBe(100 + CARD_VIEWPORT_MARGIN);
  });

  it("pans horizontally for a card clipped at the right edge", () => {
    const card: FitRect = { top: 200, left: DESKTOP_FRAME.width - 100, width: 300, height: 200 };
    const [dx, dy] = siteCardPanDelta(card, DESKTOP_FRAME);
    expect(dx).toBe(200 + CARD_VIEWPORT_MARGIN);
    expect(dy).toBe(0);
  });

  it("moves the card fully inside in one pan (applying the delta clears every overflow)", () => {
    const cases: FitRect[] = [
      { top: 40, left: -30, width: 300, height: 260 }, // top-left
      { top: 600, left: 900, width: 300, height: 260 }, // bottom-right
      { top: 120, left: 800, width: 300, height: 480 }, // right, tall
    ];
    for (const card of cases) {
      const [dx, dy] = siteCardPanDelta(card, DESKTOP_FRAME);
      // panBy([dx,dy]) moves content by (-dx,-dy) on screen.
      const moved: FitRect = { ...card, left: card.left - dx, top: card.top - dy };
      expect(cardFitsInside(moved, DESKTOP_FRAME)).toBe(true);
    }
  });

  it("works on a phone frame too — the card is reseated, not left clipped", () => {
    const card: FitRect = { top: 20, left: 40, width: 351, height: 400 };
    const [dx, dy] = siteCardPanDelta(card, PHONE_FRAME);
    const moved: FitRect = { ...card, left: card.left - dx, top: card.top - dy };
    expect(cardFitsInside(moved, PHONE_FRAME)).toBe(true);
  });

  it("aligns to the near edge (never oscillates) when the card is bigger than the frame", () => {
    // Only reachable if the max-height cap was skipped; must still be sane.
    const tooTall: FitRect = { top: 0, left: 300, width: 300, height: 900 };
    const [, dy] = siteCardPanDelta(tooTall, DESKTOP_FRAME);
    const moved = { ...tooTall, top: tooTall.top - dy };
    // Top edge is seated at the inset; the unwinnable bottom is left overflowing.
    expect(moved.top).toBe(DESKTOP_FRAME.top + CARD_VIEWPORT_MARGIN);

    const tooWide: FitRect = { top: 200, left: -50, width: 1200, height: 200 };
    const [dx] = siteCardPanDelta(tooWide, DESKTOP_FRAME);
    const movedX = { ...tooWide, left: tooWide.left - dx };
    expect(movedX.left).toBe(DESKTOP_FRAME.left + CARD_VIEWPORT_MARGIN);
  });

  it("returns integers — panBy takes pixels, not fractions", () => {
    const card: FitRect = { top: 103.4, left: 2.7, width: 300.6, height: 200.2 };
    const [dx, dy] = siteCardPanDelta(card, DESKTOP_FRAME);
    expect(Number.isInteger(dx)).toBe(true);
    expect(Number.isInteger(dy)).toBe(true);
  });
});
