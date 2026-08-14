/**
 * review6 S11 (CRITICAL, S1 reopened) — POST /api/report/generate replaces
 * app/report/page.tsx's five direct `generateReportData()` call sites,
 * all of which used to run the report engine client-side against the
 * full internal catalog fetched from the now-removed
 * /api/programs/engine-source route. This test proves a real request
 * against the real catalog produces a report with no internal-only
 * catalog field ever appearing in the response — and that the removed
 * `whoQualifies` field (the review6 S11 investigation finding, a raw-
 * prose leak found while auditing this route) genuinely never resurfaces.
 * No DB (Hard Rules): this route never touches getSQL.
 */
import { describe, expect, it } from "vitest";
import { POST } from "./route";
import { INITIAL_WIZARD_STATE } from "@/lib/report-wizard-config";

const INTERNAL_ONLY_KEYS = [
  "whoQualifies",
  "contacts",
  "howToApply",
  "suspensionNote",
  "oz2Note",
  "boundaryDisclaimer",
  "expirationNote",
];

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/report/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/report/generate", () => {
  it("generates a real report for a site-incentives request with zones — no internal-only catalog key anywhere in the response", async () => {
    const res = await POST(
      makeRequest({
        state: {
          ...INITIAL_WIZARD_STATE,
          reportType: "site-incentives",
          address: "100 E Test St",
          lat: 41.75,
          lon: -87.6,
        },
        ctx: {
          zones: { tif: true, sbif: true },
          zoneNames: { tif: "Test TIF" },
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sections.length).toBeGreaterThan(0);

    const raw = JSON.stringify(body);
    for (const key of INTERNAL_ONLY_KEYS) {
      expect(raw, key).not.toContain(`"${key}"`);
    }
  });

  it("rejects malformed JSON with 400", async () => {
    const req = new Request("http://localhost/api/report/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("rejects a missing state field with 400", async () => {
    const res = await POST(makeRequest({ ctx: {} }) as never);
    expect(res.status).toBe(400);
  });

  it("accepts a request with no ctx at all (defaults to {})", async () => {
    const res = await POST(
      makeRequest({ state: { ...INITIAL_WIZARD_STATE, reportType: "site-incentives" } }) as never,
    );
    expect(res.status).toBe(200);
  });

  it("generates a corridor-intelligence report without zones/parcel context", async () => {
    const res = await POST(
      makeRequest({
        state: { ...INITIAL_WIZARD_STATE, reportType: "corridor-intelligence", neighborhood: "Chatham" },
        ctx: {},
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reportType).toBe("corridor-intelligence");
  });
});
