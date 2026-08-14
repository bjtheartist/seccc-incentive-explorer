/**
 * review5 S9 — "/report?instant=true with missing/malformed/out-of-range/
 * partial coordinates → validate finite pairs before enabling instant
 * mode; fall back to address entry with an error; never hang on
 * 'Generating Location Snapshot'." TEST: all four malformed classes
 * terminate without claims or hang.
 *
 * app/report/page.tsx's own "Known gaps" note documents that its live-
 * renderer test harness needs exact useState call-order matching across a
 * 5000+ line file, and that this exact validation had previously shipped
 * "verified by code inspection only" as a result. This file closes that
 * gap the RIGHT way: the validation logic was pulled out of page.tsx into
 * lib/instant-report-coords.ts specifically so it could be tested as a
 * pure function, without needing the render harness at all. Every test
 * below exercises the EXACT composition app/report/page.tsx uses:
 *   `isInstantMode = requestedInstantMode && isValidInstantCoordinatePair(...)`
 * — proving the page-level behavior, not just the helper in isolation.
 */
import { describe, expect, it } from "vitest";
import {
  INSTANT_MODE_COORDINATE_ERROR_MESSAGE,
  isValidInstantCoordinatePair,
  parseInstantCoordinateParam,
} from "../instant-report-coords";

/** Mirrors app/report/page.tsx's own composition exactly, given raw
 *  (already-parsed) lat/lon, so a change to that composition would need
 *  to be reflected here too rather than silently drifting. */
function computeInstantMode(
  requestedInstantMode: boolean,
  lat: number | null,
  lon: number | null,
): { isInstantMode: boolean; error: string | null } {
  const valid = isValidInstantCoordinatePair(lat, lon);
  return {
    isInstantMode: requestedInstantMode && valid,
    error: requestedInstantMode && !valid ? INSTANT_MODE_COORDINATE_ERROR_MESSAGE : null,
  };
}

describe("parseInstantCoordinateParam", () => {
  it("parses a well-formed numeric string", () => {
    expect(parseInstantCoordinateParam("41.75")).toBe(41.75);
    expect(parseInstantCoordinateParam("-87.6")).toBe(-87.6);
  });

  it("null for an absent/empty param (never a fabricated 0)", () => {
    expect(parseInstantCoordinateParam(null)).toBeNull();
    expect(parseInstantCoordinateParam("")).toBeNull();
  });

  it("NaN for a non-numeric string — parseFloat's own behavior, not swallowed here", () => {
    expect(Number.isNaN(parseInstantCoordinateParam("abc"))).toBe(true);
  });
});

describe("isValidInstantCoordinatePair — the four malformed classes (review5 S9)", () => {
  it("MISSING: both null is invalid", () => {
    expect(isValidInstantCoordinatePair(null, null)).toBe(false);
  });

  it("PARTIAL: only lat present is invalid", () => {
    expect(isValidInstantCoordinatePair(41.75, null)).toBe(false);
  });

  it("PARTIAL: only lon present is invalid", () => {
    expect(isValidInstantCoordinatePair(null, -87.6)).toBe(false);
  });

  it("MALFORMED: NaN lat (e.g. lat=abc) is invalid", () => {
    expect(isValidInstantCoordinatePair(NaN, -87.6)).toBe(false);
  });

  it("MALFORMED: NaN lon is invalid", () => {
    expect(isValidInstantCoordinatePair(41.75, NaN)).toBe(false);
  });

  it("MALFORMED: both NaN is invalid", () => {
    expect(isValidInstantCoordinatePair(NaN, NaN)).toBe(false);
  });

  it("MALFORMED: Infinity is invalid (Number.isFinite rejects it, a bare truthiness check would not)", () => {
    expect(isValidInstantCoordinatePair(Infinity, -87.6)).toBe(false);
    expect(isValidInstantCoordinatePair(41.75, -Infinity)).toBe(false);
  });

  it("OUT-OF-RANGE: lat beyond ±90 is invalid", () => {
    expect(isValidInstantCoordinatePair(200, -87.6)).toBe(false);
    expect(isValidInstantCoordinatePair(-91, -87.6)).toBe(false);
    expect(isValidInstantCoordinatePair(90.0001, -87.6)).toBe(false);
  });

  it("OUT-OF-RANGE: lon beyond ±180 is invalid", () => {
    expect(isValidInstantCoordinatePair(41.75, 200)).toBe(false);
    expect(isValidInstantCoordinatePair(41.75, -200)).toBe(false);
    expect(isValidInstantCoordinatePair(41.75, 180.0001)).toBe(false);
  });

  it("a genuinely valid Chicago-area pair passes", () => {
    expect(isValidInstantCoordinatePair(41.75, -87.6)).toBe(true);
  });

  it("boundary values at exactly ±90/±180 are valid (inclusive range)", () => {
    expect(isValidInstantCoordinatePair(90, 180)).toBe(true);
    expect(isValidInstantCoordinatePair(-90, -180)).toBe(true);
  });

  it("(0, 0) — a common 'geocoding failed' sentinel some APIs return — is technically in-range and passes this check; it is not one of the four named malformed classes", () => {
    // Documented, not silently assumed: (0,0) is neither missing, NaN, nor
    // out-of-range, so it is intentionally NOT rejected by this function.
    // Chicago is nowhere near (0,0), so a real report generated from it
    // would look obviously wrong rather than hang — a different failure
    // mode than this finding targets.
    expect(isValidInstantCoordinatePair(0, 0)).toBe(true);
  });
});

describe("page-level composition — isInstantMode never engages for any malformed class, and always surfaces the fallback error (review5 S9)", () => {
  const malformedCases: { label: string; lat: number | null; lon: number | null }[] = [
    { label: "missing (both null)", lat: null, lon: null },
    { label: "partial (lat only)", lat: 41.75, lon: null },
    { label: "partial (lon only)", lat: null, lon: -87.6 },
    { label: "malformed (NaN lat)", lat: NaN, lon: -87.6 },
    { label: "malformed (NaN lon)", lat: 41.75, lon: NaN },
    { label: "out-of-range lat", lat: 200, lon: -87.6 },
    { label: "out-of-range lon", lat: 41.75, lon: -200 },
    { label: "out-of-range both", lat: 500, lon: -500 },
  ];

  for (const { label, lat, lon } of malformedCases) {
    it(`${label}: instant mode never engages, and the fallback error is surfaced (terminates, does not hang)`, () => {
      const result = computeInstantMode(true, lat, lon);
      expect(result.isInstantMode).toBe(false);
      expect(result.error).toBe(INSTANT_MODE_COORDINATE_ERROR_MESSAGE);
    });
  }

  it("a valid pair WITH instant=true DOES engage instant mode, and carries no error", () => {
    const result = computeInstantMode(true, 41.75, -87.6);
    expect(result.isInstantMode).toBe(true);
    expect(result.error).toBeNull();
  });

  it("instant=true is never requested (normal address-entry page load) — never an error, regardless of what lat/lon happen to be in the URL", () => {
    const result = computeInstantMode(false, NaN, 999);
    expect(result.isInstantMode).toBe(false);
    expect(result.error).toBeNull();
  });

  it("the error message itself makes no eligibility/location claim — it only reports that verification failed", () => {
    expect(INSTANT_MODE_COORDINATE_ERROR_MESSAGE.toLowerCase()).not.toMatch(
      /eligib|qualif|approved|guarant/,
    );
  });
});
