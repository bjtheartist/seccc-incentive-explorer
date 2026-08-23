import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Route-level test for /api/support-request (gate review round 2, ───
// NEW-9/row 167): the reviewer's exact point was that only the mocked
// `submitSupportRequest` CLIENT boundary was ever exercised — nothing
// tested the route itself (validation, honeypot, the real lead-write
// call, the env-conditional notify branch). These tests import and call
// the route's real POST handler directly.

const createReportLeadMock = vi.fn();

class FakeStorageUnavailableError extends Error {}

vi.mock("@/lib/report-email-delivery", () => ({
  createReportLead: (...args: unknown[]) => createReportLeadMock(...args),
  ReportEmailStorageUnavailableError: FakeStorageUnavailableError,
}));

const sendMock = vi.fn();
class FakeResend {
  emails = { send: (...args: unknown[]) => sendMock(...args) };
}
vi.mock("resend", () => ({
  Resend: FakeResend,
}));

const { POST } = await import("./route");

function supportRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/support-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const originalEnv = { ...process.env };

beforeEach(() => {
  createReportLeadMock.mockReset();
  createReportLeadMock.mockResolvedValue(1);
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
  delete process.env.RESEND_API_KEY;
  delete process.env.INCENTIVE_HELP_INBOX;
  delete process.env.REPORT_EMAIL_FROM;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("POST /api/support-request", () => {
  it("rejects an invalid email with 400 — no lead write, no notification attempt", async () => {
    const res = await POST(supportRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(createReportLeadMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("honeypot: a filled 'website' field returns a neutral success WITHOUT writing a lead", async () => {
    const res = await POST(
      supportRequest({ email: "owner@business.com", website: "http://spam.example" }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, notified: false });
    expect(createReportLeadMock).not.toHaveBeenCalled();
  });

  it("writes a real lead with wantsHelp: true for a valid submission", async () => {
    const res = await POST(
      supportRequest({
        email: "owner@business.com",
        name: "Jordan",
        address: "123 Main St",
        reportTitle: "Site Incentive Analysis",
        reportType: "site-incentives",
        projectGoal: "Hire or train staff",
      }),
    );
    expect(res.status).toBe(200);
    expect(createReportLeadMock).toHaveBeenCalledTimes(1);
    const [input] = createReportLeadMock.mock.calls[0];
    expect(input).toMatchObject({
      email: "owner@business.com",
      name: "Jordan",
      reportAddress: "123 Main St",
      reportTitle: "Site Incentive Analysis",
      reportType: "site-incentives",
      projectGoal: "Hire or train staff",
      wantsHelp: true,
    });
  });

  it("returns 503 when the lead store is unavailable", async () => {
    createReportLeadMock.mockRejectedValueOnce(new FakeStorageUnavailableError("no db"));
    const res = await POST(supportRequest({ email: "owner@business.com" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Support requests are temporarily unavailable.");
  });

  it("returns 502 on a generic lead-write failure", async () => {
    createReportLeadMock.mockRejectedValueOnce(new Error("unexpected"));
    const res = await POST(supportRequest({ email: "owner@business.com" }));
    expect(res.status).toBe(502);
  });

  it("without RESEND_API_KEY/INCENTIVE_HELP_INBOX configured, the lead is still written but notified is false and Resend is never called (gate review round 2, finding 12's PARTIAL row)", async () => {
    const res = await POST(supportRequest({ email: "owner@business.com" }));
    const body = await res.json();
    expect(createReportLeadMock).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ success: true, notified: false });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("with both env vars configured, sends a real Resend notification to the chamber inbox and returns notified: true", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.INCENTIVE_HELP_INBOX = "help@example.org";

    const res = await POST(
      supportRequest({
        email: "owner@business.com",
        address: "123 Main St",
        projectGoal: "Hire or train staff",
      }),
    );
    const body = await res.json();
    expect(body).toEqual({ success: true, notified: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [sendArgs] = sendMock.mock.calls[0];
    expect(sendArgs.to).toEqual(["help@example.org"]);
    expect(sendArgs.replyTo).toBe("owner@business.com");
    expect(sendArgs.subject).toContain("123 Main St");
  });

  it("a Resend failure still returns success (the lead is captured regardless) with notified: false", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.INCENTIVE_HELP_INBOX = "help@example.org";
    sendMock.mockResolvedValueOnce({ data: null, error: { message: "rejected" } });

    const res = await POST(supportRequest({ email: "owner@business.com" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, notified: false });
  });
});
