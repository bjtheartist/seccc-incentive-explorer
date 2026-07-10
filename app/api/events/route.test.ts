import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

/**
 * Tier 0 report-workflow audit (2026-07-10): several new event types were
 * added to light up previously-dark funnel steps (map snapshot requests,
 * wizard step navigation, refine exposure/click, save/email click-level
 * telemetry, silent-engine-failure visibility). This route validates
 * incoming events against ANALYTICS_EVENT_TYPES via
 * sanitizeAnalyticsEventPayload — the same one-line-per-event pattern used
 * for map_preview_clicked in PR #48 — so these tests confirm the new types
 * are actually wired end-to-end through the real POST handler, not just
 * present in the type union.
 */

function eventRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/events", () => {
  it.each([
    "wizard_step_viewed",
    "refine_cta_shown",
    "refine_clicked",
    "report_generation_failed",
    "save_report_clicked",
    "email_report_clicked",
    "report_email_gate_skipped",
  ])("accepts the new %s event", async (eventType) => {
    const res = await POST(
      eventRequest({
        eventType,
        source: "test",
        metadata: { step: "si-industry" },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("still rejects unknown event types", async () => {
    const res = await POST(eventRequest({ eventType: "not_a_real_event" }));
    expect(res.status).toBe(400);
  });
});
