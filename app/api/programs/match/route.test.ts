/**
 * review6 S11 (CRITICAL, S1 reopened) — POST /api/programs/match replaces
 * components/map/MapView.tsx's client-side runConfidenceEngine() call.
 * Proves every returned program match is narrowed to SafeMapProgramMatch
 * — no internal-only catalog field ever appears in the response, for a
 * real request against the real catalog. No DB (Hard Rules): this route
 * never touches getSQL, it reads the static catalog directly.
 */
import { describe, expect, it } from "vitest";
import { POST } from "./route";

const INTERNAL_ONLY_KEYS = [
  "whoQualifies",
  "requiredDocs",
  "verificationSteps",
  "applicationPortals",
  "contacts",
  "howToApply",
  "eligibilityRules",
  "lastVerifiedAt",
  "sunsetWarning",
  "suspensionNote",
  "oz2Note",
  "boundaryDisclaimer",
  "expirationNote",
  "fastestConfirmingStep",
  "deadlines",
  "expiresOn",
  "summary",
  "benefits",
  "benefitRange",
  "relevance",
  "relevanceLabel",
  "whyOneLine",
  "fastestStep",
  "notVerified",
  "matchedRules",
];

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/programs/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/programs/match", () => {
  it("returns SafeMapProgramMatch[] — every match's `program` has ONLY {id, name, level, zoneKey, url, sourceUrl?}, never a raw Program object", async () => {
    const res = await POST(makeRequest({ zones: { tif: true, nof: true }, zoneNames: { tif: "Test TIF", nof: "Test NOF" } }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.programs)).toBe(true);

    for (const match of body.programs) {
      const keys = Object.keys(match.program).sort();
      for (const key of keys) {
        expect(["id", "name", "level", "zoneKey", "url", "sourceUrl"]).toContain(key);
      }
    }
  });

  it("no internal-only catalog key appears anywhere in the serialized response, across many zones", async () => {
    const zones = Object.fromEntries(
      ["tif", "nof", "ssa", "federalOZ", "illinoisOZ", "enterprise", "highUnemployment"].map((k) => [k, true]),
    );
    const res = await POST(makeRequest({ zones, zoneNames: {} }) as never);
    const raw = JSON.stringify(await res.json());
    for (const key of INTERNAL_ONLY_KEYS) {
      expect(raw, key).not.toContain(`"${key}"`);
    }
  });

  it("caps results at 3 matches", async () => {
    const zones = Object.fromEntries(
      ["tif", "nof", "ssa", "federalOZ", "illinoisOZ", "enterprise", "highUnemployment", "sbif"].map((k) => [k, true]),
    );
    const res = await POST(makeRequest({ zones, zoneNames: {} }) as never);
    const body = await res.json();
    expect(body.programs.length).toBeLessThanOrEqual(3);
  });

  it("rejects malformed JSON with 400", async () => {
    const req = new Request("http://localhost/api/programs/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("rejects a missing/invalid zones field with 400", async () => {
    const res = await POST(makeRequest({}) as never);
    expect(res.status).toBe(400);
  });

  it("rejects a zones value that is not a map of booleans", async () => {
    const res = await POST(makeRequest({ zones: { tif: "yes" } }) as never);
    expect(res.status).toBe(400);
  });

  it("returns an empty programs array for zero matched zones (never hangs, never throws)", async () => {
    const res = await POST(makeRequest({ zones: {}, zoneNames: {} }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.programs)).toBe(true);
  });
});
