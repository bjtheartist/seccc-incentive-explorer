// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import MapSearch from "../MapSearch";

/**
 * REAL mount tests for the search dropdown — the thing the audit's
 * vacuous-test finding was about. The sibling map-search.test.tsx pins the
 * component's source shape (its AST), which stays green even when the dropdown
 * is rendered behind `false &&`; these tests mount the component in jsdom,
 * drive the input the way a user does, and assert against the DOM. The
 * `false &&` experiment that exposed the vacuous suite fails HERE.
 */

const BIZ = [
  { name: "South Shore Brew", address: "1745 E 71st St", lat: 41.766, lon: -87.57 },
];

describe("MapSearch dropdown — mounted", () => {
  beforeEach(() => {
    // shouldAdvanceTime lets waitFor's real-time polling coexist with the
    // component's 400ms debounce timer — plain fake timers deadlock waitFor.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("/api/businesses")) {
          return { ok: true, json: async () => BIZ } as Response;
        }
        return { ok: false, json: async () => ({}) } as Response;
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function typeQuery(value: string) {
    const input = screen.getByRole<HTMLInputElement>("textbox");
    // Drive React's controlled input, then run the debounce timer.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(450); // past the 400ms debounce
  }

  it("mounts, searches, and actually shows the dropdown with the result", async () => {
    render(<MapSearch onResult={() => {}} />);
    await typeQuery("south shore");
    await waitFor(() => {
      expect(screen.getByText(/South Shore Brew/)).toBeTruthy();
    });
  });

  it("clicking a result fires onResult with the business coordinates", async () => {
    const onResult = vi.fn();
    render(<MapSearch onResult={onResult} />);
    await typeQuery("south shore");
    const option = await waitFor(() => screen.getByText(/South Shore Brew/));
    option.click();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0][0]).toMatchObject({ lat: 41.766, lon: -87.57 });
  });

  it("shows nothing for a sub-3-character query", async () => {
    render(<MapSearch onResult={() => {}} />);
    await typeQuery("so");
    expect(screen.queryByText(/South Shore Brew/)).toBeNull();
  });
});
