// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MapRenderFallback } from "../MapRenderFallback";
import { webgl2Available, type MapFailureReason } from "@/lib/map-support";

afterEach(cleanup);

const REASONS: MapFailureReason[] = [
  "no-token",
  "no-webgl2",
  "init-error",
  "style-error",
  "context-lost",
];

describe("MapRenderFallback", () => {
  it("renders a headline, detail, and both ways forward for every reason", () => {
    for (const reason of REASONS) {
      const { unmount } = render(<MapRenderFallback reason={reason} onRetry={() => {}} />);
      expect(screen.getByRole("status")).toBeTruthy();
      expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
      const report = screen.getByRole("link", { name: /without the map/i });
      expect(report.getAttribute("href")).toBe("/report");
      unmount();
    }
  });

  it("names the in-app-browser cause for the WebGL2 case", () => {
    render(<MapRenderFallback reason="no-webgl2" onRetry={() => {}} />);
    expect(screen.getByText(/WebGL2/)).toBeTruthy();
    expect(screen.getByText(/Safari or Chrome/)).toBeTruthy();
  });

  it("calls the retry handler", () => {
    const onRetry = vi.fn();
    render(<MapRenderFallback reason="init-error" onRetry={onRetry} />);
    screen.getByRole("button", { name: /try again/i }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("never blames the user or claims the product is broken elsewhere", () => {
    for (const reason of REASONS) {
      const { container, unmount } = render(
        <MapRenderFallback reason={reason} onRetry={() => {}} />,
      );
      expect(container.textContent).not.toMatch(/your fault|unsupported device|error code/i);
      unmount();
    }
  });
});

describe("webgl2Available", () => {
  it("returns false when the browser cannot create a webgl2 context (jsdom)", () => {
    // jsdom has no WebGL at all, which stands in for the in-app-browser case.
    expect(webgl2Available()).toBe(false);
  });

  it("respects the ?mapgl=0 testing escape", () => {
    const original = window.location;
    Object.defineProperty(window, "location", {
      value: new URL("https://example.com/map?mapgl=0"),
      writable: true,
    });
    expect(webgl2Available()).toBe(false);
    Object.defineProperty(window, "location", { value: original, writable: true });
  });
});
