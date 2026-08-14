// @vitest-environment jsdom
/**
 * build-spec.md 2.7 (audit F15; consult item 11) — AddressSearch's
 * coordinate-less business match no longer falls into the legacy
 * IncentiveReport fork. It geocodes the business's own stored address and
 * routes to /report exactly like a coordinate-bearing match; a failed
 * geocode is an honest unavailable state.
 *
 * Covers the spec's named test list: direct selection, address match, name
 * match, null coordinates, geocode failure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { AddressSearch } from "../AddressSearch";
import { invalidateClientCache } from "@/lib/fetch-cache";

const BUSINESS_WITH_COORDS = {
  id: "b1",
  name: "Justice of the Pies",
  address: "1000 E 111th St",
  category: "Bakery",
  lat: 41.6934,
  lon: -87.6064,
};

const BUSINESS_NO_COORDS = {
  id: "b2",
  name: "Coordinate-less Cafe",
  address: "2000 S Halsted St",
  category: "Cafe",
  lat: null,
  lon: null,
};

function stubFetch(handlers: Record<string, () => unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      for (const [pattern, handler] of Object.entries(handlers)) {
        if (url.includes(pattern)) {
          const body = handler();
          if (body === null) return new Response("not found", { status: 404 });
          return new Response(JSON.stringify(body), { status: 200 });
        }
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

afterEach(() => {
  cleanup();
  pushMock.mockClear();
  vi.restoreAllMocks();
  // cachedFetch (lib/fetch-cache.ts) keeps a module-level cache keyed by
  // URL — without clearing it, a later test's mock for the SAME geocode URL
  // (e.g. re-querying "2000 S Halsted St" for a different scenario) would
  // silently reuse a prior test's cached response instead of hitting this
  // test's own mock.
  invalidateClientCache();
});

describe("AddressSearch — geocode-then-route cutover (F15)", () => {
  it("direct selection of a business WITH coordinates routes straight to /report (no geocode call)", async () => {
    const geocodeSpy = vi.fn();
    stubFetch({
      "/api/businesses": () => [BUSINESS_WITH_COORDS],
      "/api/geocode": () => {
        geocodeSpy();
        return { lat: 0, lon: 0 };
      },
    });
    render(<AddressSearch />);

    const input = await screen.findByPlaceholderText("Enter a Chicago address...");
    fireEvent.change(input, { target: { value: "Justice" } });
    const suggestion = await screen.findByText("Justice of the Pies");
    fireEvent.click(suggestion);

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(String(pushMock.mock.calls[0][0])).toContain("/report?");
    expect(String(pushMock.mock.calls[0][0])).toContain("lat=41.69340");
    expect(geocodeSpy).not.toHaveBeenCalled();
  });

  it("an address-text match for a business with NULL coordinates geocodes the business's own stored address and routes to /report", async () => {
    stubFetch({
      "/api/businesses": () => [BUSINESS_NO_COORDS],
      "/api/geocode": () => ({ lat: 41.8, lon: -87.65, displayName: "2000 S Halsted St, Chicago, IL" }),
    });
    render(<AddressSearch />);

    const input = await screen.findByPlaceholderText("Enter a Chicago address...");
    fireEvent.change(input, { target: { value: "2000 S Halsted St" } });
    fireEvent.click(screen.getByText("Generate Free Location Snapshot"));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const pushedUrl = String(pushMock.mock.calls[0][0]);
    expect(pushedUrl).toContain("/report?");
    expect(pushedUrl).toContain("lat=41.80000");
    expect(pushedUrl).not.toContain("IncentiveReport");
  });

  it("a NAME match (single result) for a business with null coordinates also geocodes and routes", async () => {
    stubFetch({
      "/api/businesses": () => [BUSINESS_NO_COORDS],
      "/api/geocode": () => ({ lat: 41.85, lon: -87.6, displayName: "Coordinate-less Cafe location" }),
    });
    render(<AddressSearch />);

    const input = await screen.findByPlaceholderText("Enter a Chicago address...");
    fireEvent.change(input, { target: { value: "Coordinate-less Cafe" } });
    fireEvent.click(screen.getByText("Generate Free Location Snapshot"));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(String(pushMock.mock.calls[0][0])).toContain("lat=41.85000");
  });

  it("null coordinates + a FAILED geocode shows an honest unavailable error — never a legacy report render", async () => {
    stubFetch({
      "/api/businesses": () => [BUSINESS_NO_COORDS],
      "/api/geocode": () => null, // 404
    });
    render(<AddressSearch />);

    const input = await screen.findByPlaceholderText("Enter a Chicago address...");
    fireEvent.change(input, { target: { value: "2000 S Halsted St" } });
    fireEvent.click(screen.getByText("Generate Free Location Snapshot"));

    await waitFor(() =>
      expect(
        screen.getByText(/couldn't confirm a mapped location for it right now/i),
      ).toBeTruthy(),
    );
    expect(pushMock).not.toHaveBeenCalled();
    // No legacy report markup of any kind — this component no longer imports
    // IncentiveReport, so there is nothing to assert against by name; the
    // absence of a router push plus the honest error message is the contract.
  });

  it("a raw address query with no business match geocodes the typed text directly (unaffected control path)", async () => {
    stubFetch({
      "/api/businesses": () => [],
      "/api/geocode": () => ({ lat: 41.9, lon: -87.7, displayName: "123 Random St" }),
    });
    render(<AddressSearch />);

    const input = await screen.findByPlaceholderText("Enter a Chicago address...");
    fireEvent.change(input, { target: { value: "123 Random St" } });
    fireEvent.click(screen.getByText("Generate Free Location Snapshot"));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(String(pushMock.mock.calls[0][0])).toContain("lat=41.90000");
  });
});
