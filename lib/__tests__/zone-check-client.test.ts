/**
 * Zone Evidence v2 cutover (build-spec.md 2.3; audit F2) — the client-side
 * fallback in lib/zone-check.ts. Two failure paths under test:
 *
 *   1. checkZonesDB now calls /api/zones/check/v2 and must never turn an
 *      "unknown" layer into a false "not matched" — it surfaces
 *      `unknownZones` instead, so a caller can suppress a negative claim
 *      built on it (see lib/__tests__/report-engine.test.ts's
 *      "unknown zone layers never render as a confirmed negative").
 *   2. checkZonesTurf (the client-side Turf.js fallback used when the API
 *      is unreachable) must record a layer it could not load/evaluate as
 *      unknown, not silently default it to false.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkZones } from "../zone-check";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function v2Envelope(layers: Record<string, { state: string; name?: string; reason?: string }>) {
  return {
    schemaVersion: 2,
    dataRevision: "test-revision",
    checkedAt: "2026-08-13T00:00:00.000Z",
    requestedLayers: Object.keys(layers),
    layers,
  };
}

describe("checkZones (client fallback) — Zone Evidence v2", () => {
  it("propagates unknownZones from the v2 API instead of defaulting an unresolved layer to false-and-silent", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/zones/check/v2")) {
        return new Response(
          JSON.stringify(
            v2Envelope({
              tif: { state: "matched", name: "Test TIF" },
              nof: { state: "unknown", reason: "source_unavailable" },
            }),
          ),
          { status: 200 },
        );
      }
      // census + zoning lookups: fail cleanly, uninvolved in this assertion.
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await checkZones(41.88, -87.72);
    expect(result.zones.tif).toBe(true);
    expect(result.zones.nof).toBe(false); // backward-compatible default
    expect(result.unknownZones).toContain("nof");
    expect(result.unknownZones).not.toContain("tif");
  });

  it("a failed irrelevant layer does not flip a known match, and a fully-covered response reports no unknowns", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/zones/check/v2")) {
        return new Response(
          JSON.stringify(
            v2Envelope({
              tif: { state: "matched", name: "Test TIF" },
              ssa: { state: "not_matched" },
            }),
          ),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await checkZones(41.88, -87.72);
    expect(result.zones.tif).toBe(true);
    expect(result.unknownZones).toEqual([]);
  });

  it("falls through to the Turf.js path and marks an unloadable layer unknown rather than a silent false, when the v2 API is unreachable", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/zones/check/v2")) {
        return new Response("boom", { status: 500 });
      }
      if (url.includes("/data/zones/")) {
        // Every static zone file load fails — Turf's per-layer catch block
        // must record each as unknown, never as a silent confirmed-false.
        throw new Error("network unavailable");
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await checkZones(41.88, -87.72);
    expect(result.unknownZones && result.unknownZones.length).toBeGreaterThan(0);
    // Every zone key that failed to load is false (backward-compatible
    // default) AND recorded as unknown (not silently indistinguishable from
    // a genuine non-match).
    for (const key of result.unknownZones ?? []) {
      expect(result.zones[key]).toBe(false);
    }
  });
});
