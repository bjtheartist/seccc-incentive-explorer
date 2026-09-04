// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MapSpotlight } from "@/components/onboarding/MapSpotlight";
import { MapTourButton } from "@/components/onboarding/MapTourButton";
import { MAP_GUIDE_OPEN_EVENT, MAP_GUIDE_STORAGE_KEY } from "@/lib/map-guide";

// Forces every import of driver.js — static or the component's dynamic
// `await import("driver.js")` — to fail, so the failure path (catch block,
// not a user decision) is exercised the same way a redeploy-invalidated
// chunk or an offline visitor would trigger it in the browser.
vi.mock("driver.js", () => {
  throw new Error("driver.js chunk failed to load");
});

describe("MapTourButton — the map's one entry point", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders the 'Show me around' pill, which is a real labelled control", async () => {
    render(<MapTourButton />);
    expect(await screen.findByRole("button", { name: "Show me around" })).toBeTruthy();
  });

  it("dispatches the map guide's own open event on click, not another tour's", async () => {
    const handler = vi.fn();
    window.addEventListener(MAP_GUIDE_OPEN_EVENT, handler);
    render(<MapTourButton />);
    (await screen.findByRole("button", { name: "Show me around" })).click();
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(MAP_GUIDE_OPEN_EVENT, handler);
  });

  it("still dispatches that event from the demoted replay control", async () => {
    window.localStorage.setItem(
      MAP_GUIDE_STORAGE_KEY,
      JSON.stringify({ version: 2, status: "skipped", updatedAt: "2026-09-01T00:00:00.000Z" }),
    );
    const handler = vi.fn();
    window.addEventListener(MAP_GUIDE_OPEN_EVENT, handler);
    render(<MapTourButton />);
    (await screen.findByRole("button", { name: "Replay the map tour" })).click();
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(MAP_GUIDE_OPEN_EVENT, handler);
  });
});

describe("MapSpotlight — failed driver.js import leaves state unset", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not write the storage key on the first-visit auto-start path", async () => {
    // Auto-start only fires once the sitewide tour is resolved (collision
    // guard) — resolve it so the failure path under test is reachable.
    window.localStorage.setItem(
      "cie:first-visit-guide",
      JSON.stringify({ version: 1, status: "completed", updatedAt: "2026-08-10T00:00:00.000Z" }),
    );
    render(<MapSpotlight />);

    // The auto-start effect fires on a real timer (900ms for the map's slower
    // mount); wait for the component's catch block to report the load failure
    // rather than asserting a fixed delay.
    await waitFor(
      () => {
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining("driver.js failed to load"),
          expect.any(Error),
        );
      },
      { timeout: 4000 },
    );

    // The load failure must never be recorded as a skip or a completion —
    // storage stays exactly as it started (unset) so the tour can try again
    // next visit instead of being permanently suppressed.
    expect(window.localStorage.getItem(MAP_GUIDE_STORAGE_KEY)).toBeNull();
  });

  it("does not write or mutate the storage key on the replay-button path", async () => {
    const seeded = JSON.stringify({
      version: 1,
      status: "skipped",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    // Pre-seed a preference so the auto-start effect no-ops, isolating the
    // replay path from the auto-start path.
    window.localStorage.setItem(MAP_GUIDE_STORAGE_KEY, seeded);

    render(<MapSpotlight />);
    window.dispatchEvent(new Event(MAP_GUIDE_OPEN_EVENT));

    await waitFor(() => {
      expect(console.error).toHaveBeenCalled();
    });

    // Not just "still skipped" — byte-identical, so a bug that re-wrote a
    // fresh "skipped" preference (new updatedAt) would still fail this.
    expect(window.localStorage.getItem(MAP_GUIDE_STORAGE_KEY)).toBe(seeded);
  });

  it("never throws past the component boundary on a load failure", async () => {
    expect(() => render(<MapSpotlight />)).not.toThrow();
    window.dispatchEvent(new Event(MAP_GUIDE_OPEN_EVENT));
    await waitFor(() => {
      expect(console.error).toHaveBeenCalled();
    });
  });
});

describe("collision guard: sitewide tour owns the first visit", () => {
  it("does NOT auto-start while the public site tour is unresolved", async () => {
    // Both keys empty = a genuinely first-time visitor. The sitewide guide
    // will claim this visit; the map tour must stay silent until it is
    // resolved. The wait must outlast the component's 900ms auto-start delay.
    window.localStorage.clear();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MapSpotlight />);
    await new Promise((r) => setTimeout(r, 1400));
    // no start attempt: the failing driver import was never even reached
    expect(errSpy).not.toHaveBeenCalled();
    // and critically: no outcome was invented for either tour
    expect(window.localStorage.getItem("cie:map-guide")).toBeNull();
    expect(window.localStorage.getItem("cie:first-visit-guide")).toBeNull();
    vi.restoreAllMocks();
  });

  it("ATTEMPTS auto-start once the public site tour has been resolved", async () => {
    // Under this file's driver mock every start attempt fails at import, so
    // "the component tried to start" is observable as the logged load
    // failure. With the public key resolved, that attempt must happen.
    window.localStorage.clear();
    window.localStorage.setItem(
      "cie:first-visit-guide",
      JSON.stringify({ version: 1, status: "completed", updatedAt: "2026-08-10T00:00:00.000Z" }),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MapSpotlight />);
    await waitFor(
      () =>
        expect(errSpy).toHaveBeenCalledWith(
          expect.stringContaining("driver.js failed to load"),
          expect.any(Error),
        ),
      { timeout: 4000 },
    );
    vi.restoreAllMocks();
  });
});
