import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUserIdMock, recordReportEventMock } = vi.hoisted(() => ({
  getCurrentUserIdMock: vi.fn(),
  recordReportEventMock: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: getCurrentUserIdMock }));
vi.mock("@/lib/server-analytics", () => ({ recordReportEvent: recordReportEventMock }));

import { POST } from "./route";
import { VISITOR_COOKIE } from "@/lib/activity-identity";

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

const KNOWN_VISITOR = "3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function eventRequest(body: Record<string, unknown>, cookie?: string) {
  return new NextRequest("http://localhost/api/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function storedPayload() {
  expect(recordReportEventMock).toHaveBeenCalledTimes(1);
  return recordReportEventMock.mock.calls[0][1] as {
    userId: string | null;
    anonymousId: string | null;
  };
}

beforeEach(() => {
  getCurrentUserIdMock.mockReset().mockResolvedValue(null);
  recordReportEventMock.mockReset().mockResolvedValue(true);
});

describe("POST /api/events", () => {
  it.each([
    "wizard_step_viewed",
    "refine_cta_shown",
    "refine_clicked",
    "report_generation_failed",
    "save_report_clicked",
    "email_report_clicked",
    "report_email_gate_skipped",
    "persona_chip_selected",
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
    expect(recordReportEventMock).not.toHaveBeenCalled();
    expect(res.cookies.get(VISITOR_COOKIE)).toBeUndefined();
  });
});

describe("POST /api/events — activity identity", () => {
  it("issues a first-party HTTP-only visitor cookie on first contact and stores the same id on the event", async () => {
    const res = await POST(eventRequest({ eventType: "search_performed", address: "8020 S Western Ave" }));

    expect(res.status).toBe(200);
    const cookie = res.cookies.get(VISITOR_COOKIE);
    expect(cookie?.value).toMatch(UUID_V4);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(storedPayload()).toMatchObject({ anonymousId: cookie?.value, userId: null });
  });

  it("reuses an existing visitor cookie and does not re-issue it", async () => {
    const res = await POST(
      eventRequest({ eventType: "search_performed" }, `${VISITOR_COOKIE}=${KNOWN_VISITOR}`),
    );

    expect(res.cookies.get(VISITOR_COOKIE)).toBeUndefined();
    expect(storedPayload().anonymousId).toBe(KNOWN_VISITOR);
  });

  it("never stores a malformed or tampered cookie value; it issues a fresh id instead", async () => {
    const res = await POST(
      eventRequest({ eventType: "search_performed" }, `${VISITOR_COOKIE}=not-a-uuid'); DROP TABLE x;--`),
    );

    const issued = res.cookies.get(VISITOR_COOKIE)?.value;
    expect(issued).toMatch(UUID_V4);
    expect(storedPayload().anonymousId).toBe(issued);
  });

  it("attaches the signed-in user from the server session, ignoring any userId in the body", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-from-session");

    await POST(
      eventRequest(
        { eventType: "refined_report_generated", userId: "spoofed-user" },
        `${VISITOR_COOKIE}=${KNOWN_VISITOR}`,
      ),
    );

    expect(storedPayload()).toMatchObject({
      userId: "user-from-session",
      anonymousId: KNOWN_VISITOR,
    });
  });

  it("still records the event anonymously when the session lookup throws", async () => {
    getCurrentUserIdMock.mockRejectedValue(new Error("auth backend down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(eventRequest({ eventType: "search_performed" }));

    expect(res.status).toBe(200);
    expect(storedPayload().userId).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
