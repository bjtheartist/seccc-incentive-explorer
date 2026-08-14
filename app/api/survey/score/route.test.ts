/**
 * review6 S11 (CRITICAL, S1 reopened) — POST /api/survey/score is the new
 * server-side scoring boundary that replaces the client-side
 * fetch-then-compute pattern (which used to pull the full internal
 * catalog from the now-removed /api/programs/engine-source route). This
 * test proves the response is ALWAYS the safe SurveyResult shape — no
 * internal-only fields (whoQualifies, eligibilityRules-as-raw-object,
 * contacts, requiredDocs, verificationSteps, applicationPortals,
 * suspension/sunset notes) ever appear, for a real request against the
 * real catalog (no DB — Hard Rules; this route never touches getSQL at
 * all, it reads the static catalog directly like
 * lib/owner-file-letter-context.ts already does).
 */
import { describe, expect, it } from "vitest";
import { POST } from "./route";

// Note: `lastVerifiedAt` is intentionally EXCLUDED from this list —
// PublicMatchExplanation.lastVerifiedAt (lib/types.ts) is a deliberate
// part of the safe output contract (it's how "Program information was
// last reviewed on X" gets rendered), not a leaked internal field, even
// though the raw Program record also happens to carry a field by the
// same name.
const INTERNAL_ONLY_KEYS = [
  "whoQualifies",
  "requiredDocs",
  "verificationSteps",
  "applicationPortals",
  "contacts",
  "howToApply",
  "eligibilityRules",
  "sunsetWarning",
  "suspensionNote",
  "oz2Note",
  "boundaryDisclaimer",
  "expirationNote",
  "fastestConfirmingStep",
  "deadlines",
  "expiresOn",
  "zoneKey",
  "summary",
  "benefits",
  "benefitRange",
];

function makeRequest(answers: unknown): Request {
  return new Request("http://localhost/api/survey/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
}

describe("POST /api/survey/score", () => {
  it("returns a SurveyResult for a real answer set, with `program` narrowed to {name, short, level} on every match — never a raw Program object", async () => {
    const res = await POST(
      makeRequest({
        industry: "manufacturing",
        property: "own",
        activities: ["renovations", "hiring"],
        size: "over10m",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.matches)).toBe(true);
    expect(body.matches.length).toBeGreaterThan(0);
    expect(Array.isArray(body.universal)).toBe(true);
    expect(Array.isArray(body.usedAnswers)).toBe(true);
    expect(Array.isArray(body.unusedAnswers)).toBe(true);

    for (const match of [...body.matches, ...body.universal]) {
      expect(Object.keys(match.program).sort()).toEqual(["level", "name", "short"]);
    }
  });

  it("no internal-only catalog key appears anywhere in the serialized response, for a request that touches many programs", async () => {
    const res = await POST(
      makeRequest({
        industry: "ev",
        property: "buyBuild",
        activities: ["renovations", "energy", "hiring", "equipment", "capitalGains", "expanding"],
        size: "over10m",
      }) as never,
    );
    const raw = JSON.stringify(await res.json());
    for (const key of INTERNAL_ONLY_KEYS) {
      expect(raw, key).not.toContain(`"${key}"`);
    }
  });

  it("rejects a malformed JSON body with 400, not a crash", async () => {
    const req = new Request("http://localhost/api/survey/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("rejects an answers payload with the wrong shape with 400", async () => {
    const res = await POST(makeRequest({ industry: 12345 }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects a missing answers field with 400", async () => {
    const req = new Request("http://localhost/api/survey/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("accepts an empty answers object and returns only the universal entry", async () => {
    const res = await POST(makeRequest({}) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matches).toEqual([]);
    expect(body.universal.length).toBeGreaterThan(0);
  });
});
