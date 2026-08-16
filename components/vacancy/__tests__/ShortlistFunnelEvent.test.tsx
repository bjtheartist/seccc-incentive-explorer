// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ShortlistFunnelStats } from "@/lib/shortlist-engine";

const { trackEventMock } = vi.hoisted(() => ({ trackEventMock: vi.fn() }));
vi.mock("@/lib/analytics-events", () => ({ trackEvent: trackEventMock }));

import ShortlistFunnelEvent from "@/components/vacancy/ShortlistFunnelEvent";

function funnel(overrides: Partial<ShortlistFunnelStats> = {}): ShortlistFunnelStats {
  return {
    trackedEvidence: 10,
    canonicalSites: 8,
    withResolvedPin: 6,
    withMeasuredArea: 5,
    insideBand: 4,
    survivingTransitScreen: 3,
    survivingZoningScreen: 3,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  trackEventMock.mockReset();
});

describe("ShortlistFunnelEvent", () => {
  it("includes survivingZoningScreen in the emitted metadata — telemetry must match the on-screen funnel's true final stage (zoning-alignment-rank change)", () => {
    render(<ShortlistFunnelEvent zip="60619" funnel={funnel({ survivingZoningScreen: 2 })} />);
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    const [eventType, payload] = trackEventMock.mock.calls[0];
    expect(eventType).toBe("site_shortlist_funnel_shown");
    expect(payload.metadata.survivingZoningScreen).toBe(2);
  });

  it("reports every funnel stage present on ShortlistFunnelStats — no field silently dropped from telemetry", () => {
    const stats = funnel({
      trackedEvidence: 100,
      canonicalSites: 80,
      withResolvedPin: 60,
      withMeasuredArea: 50,
      insideBand: 40,
      survivingTransitScreen: 30,
      survivingZoningScreen: 12,
    });
    render(<ShortlistFunnelEvent zip="60619" funnel={stats} />);
    const payload = trackEventMock.mock.calls[0][1];
    for (const [key, value] of Object.entries(stats)) {
      expect(payload.metadata[key]).toBe(value);
    }
  });

  it("fires exactly once per mount", () => {
    const { rerender } = render(<ShortlistFunnelEvent zip="60619" funnel={funnel()} />);
    rerender(<ShortlistFunnelEvent zip="60619" funnel={funnel({ survivingZoningScreen: 1 })} />);
    expect(trackEventMock).toHaveBeenCalledTimes(1);
  });
});
