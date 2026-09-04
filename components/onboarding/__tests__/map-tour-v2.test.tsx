// @vitest-environment jsdom
/**
 * Render tests for the rebuilt map walkthrough, reaching the behaviour through
 * the real components rather than grepping for it:
 *
 * - the map header's single entry point (MapTourButton) actually swaps from
 *   the "Show me around" pill to the labelled replay control once an outcome
 *   is recorded, and dispatches the replay event either way;
 * - stop one's `perform` drives the REAL MapSearch component — it types the
 *   demo address into its input, the illustrative badge appears while it holds
 *   it, the suggestion the search opened is submitted the way a click submits
 *   it, and stop one's `undo` hands the box back empty with the badge gone.
 *
 * Deliberately NOT a mock of the search box: the thing under test is whether
 * the tour can drive a React-controlled input at all, which a hand-rolled
 * fixture input would answer "yes" to regardless.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import MapSearch from "@/components/map/MapSearch";
import { MapTourButton } from "@/components/onboarding/MapTourButton";
import {
  MAP_GUIDE_OPEN_EVENT,
  MAP_GUIDE_RESOLVED_EVENT,
  MAP_GUIDE_STORAGE_KEY,
  MAP_GUIDE_VERSION,
  MAP_TOUR_DEMO_ADDRESS,
  MAP_TOUR_DEMO_BADGE_TESTID,
  MAP_TOUR_DEMO_BADGE_TEXT,
  MAP_TOUR_STEPS,
  type MapTourStepContext,
} from "@/lib/map-guide";

const liveContext: MapTourStepContext = { reduceMotion: false, isCancelled: () => false };
const reducedContext: MapTourStepContext = { reduceMotion: true, isCancelled: () => false };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

describe("MapTourButton — the map's one entry point", () => {
  it("offers the 'Show me around' pill until an outcome is recorded", async () => {
    render(<MapTourButton />);
    const pill = await screen.findByRole("button", { name: "Show me around" });

    const opened = vi.fn();
    window.addEventListener(MAP_GUIDE_OPEN_EVENT, opened);
    pill.click();
    window.removeEventListener(MAP_GUIDE_OPEN_EVENT, opened);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("collapses to a labelled replay control for a visitor who already resolved it", async () => {
    window.localStorage.setItem(
      MAP_GUIDE_STORAGE_KEY,
      JSON.stringify({
        version: MAP_GUIDE_VERSION,
        status: "completed",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }),
    );
    render(<MapTourButton />);

    const replay = await screen.findByRole("button", { name: "Replay the map tour" });
    expect(replay).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show me around" })).toBeNull();
  });

  it("demotes itself the moment a run records its outcome, without a reload", async () => {
    render(<MapTourButton />);
    await screen.findByRole("button", { name: "Show me around" });

    window.dispatchEvent(new Event(MAP_GUIDE_RESOLVED_EVENT));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Replay the map tour" })).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Show me around" })).toBeNull();
  });
});

describe("stop one performs the search against the real search box", () => {
  const searchStep = MAP_TOUR_STEPS[0];
  const geocoded = { lat: 41.7364, lon: -87.5893, displayName: MAP_TOUR_DEMO_ADDRESS };

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      // No business matches the demo address string, so the search falls
      // through to the geocoder — exactly what it does in production against
      // the static business file.
      if (url.includes("/api/businesses")) {
        return new Response("[]", { headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/geocode")) {
        return new Response(JSON.stringify(geocoded), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  });

  it("types the demo address, badges it as an example, and submits the suggestion", async () => {
    const onResult = vi.fn();
    render(<MapSearch onResult={onResult} />);

    await searchStep.perform!(liveContext);

    const input = document.querySelector<HTMLInputElement>('[data-tour="map-search"] input')!;
    expect(input.value).toBe(MAP_TOUR_DEMO_ADDRESS);

    // The persistent "this is an example" badge, visible while the tour holds
    // the demo address.
    const badge = screen.getByTestId(MAP_TOUR_DEMO_BADGE_TESTID);
    expect(badge.textContent).toBe(MAP_TOUR_DEMO_BADGE_TEXT);

    // Submitted the way a visitor submits it — by picking the suggestion the
    // search opened, which is what centers the map.
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0][0]).toMatchObject({ lat: geocoded.lat, lon: geocoded.lon });
  }, 30000);

  it("skips the typing animation under prefers-reduced-motion but still submits", async () => {
    const onResult = vi.fn();
    render(<MapSearch onResult={onResult} />);

    const startedAt = Date.now();
    await searchStep.perform!(reducedContext);
    const elapsed = Date.now() - startedAt;

    const input = document.querySelector<HTMLInputElement>('[data-tour="map-search"] input')!;
    expect(input.value).toBe(MAP_TOUR_DEMO_ADDRESS);
    expect(onResult).toHaveBeenCalledTimes(1);
    // Character-by-character would spend ~25ms per character on top of the
    // search debounce; this must not.
    expect(elapsed).toBeLessThan(MAP_TOUR_DEMO_ADDRESS.length * 25);
  }, 30000);

  it("hands the search box back empty, with the badge gone, when the tour ends", async () => {
    render(<MapSearch onResult={vi.fn()} />);
    await searchStep.perform!(liveContext);

    searchStep.undo!(liveContext);

    await waitFor(() => {
      const input = document.querySelector<HTMLInputElement>('[data-tour="map-search"] input')!;
      expect(input.value).toBe("");
    });
    expect(screen.queryByTestId(MAP_TOUR_DEMO_BADGE_TESTID)).toBeNull();
  }, 30000);
});

describe("stop four's hint marker", () => {
  const hintStep = MAP_TOUR_STEPS.find((step) => step.key === "map-hint")!;

  it("mounts a small marker over the map canvas and removes it on undo", async () => {
    // The tour's own anchor: a tiny element on the map, NOT the whole canvas.
    const surface = document.createElement("div");
    const canvas = document.createElement("div");
    canvas.setAttribute("data-tour", "map-canvas");
    surface.appendChild(canvas);
    document.body.appendChild(surface);

    await hintStep.perform!(liveContext);

    const hint = document.querySelector<HTMLElement>('[data-tour="map-hint"]');
    expect(hint).not.toBeNull();
    expect(hint!.parentElement).toBe(surface);
    expect(hint!.style.opacity).toBe("1");
    expect(hint!.style.animation).toContain("bureau-pulse");

    hintStep.undo!(liveContext);
    expect(document.querySelector('[data-tour="map-hint"]')).toBeNull();
  });

  it("does not pulse under prefers-reduced-motion", async () => {
    const canvas = document.createElement("div");
    canvas.setAttribute("data-tour", "map-canvas");
    document.body.appendChild(canvas);

    await hintStep.perform!(reducedContext);

    const hint = document.querySelector<HTMLElement>('[data-tour="map-hint"]')!;
    expect(hint.style.opacity).toBe("1");
    expect(hint.style.animation).toBe("");
    hintStep.undo!(reducedContext);
  });
});
