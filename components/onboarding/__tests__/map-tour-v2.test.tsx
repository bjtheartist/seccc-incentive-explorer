// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MapTourButton } from "@/components/onboarding/MapTourButton";
import {
  MAP_GUIDE_OPEN_EVENT,
  MAP_GUIDE_RESOLVED_EVENT,
  MAP_GUIDE_STORAGE_KEY,
  MAP_GUIDE_VERSION,
} from "@/lib/map-guide";

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
