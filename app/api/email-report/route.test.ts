import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  createLeadMock,
  markDeliveryMock,
  markLeadMock,
  reserveMock,
  sendMock,
} = vi.hoisted(() => ({
  createLeadMock: vi.fn(),
  markDeliveryMock: vi.fn(),
  markLeadMock: vi.fn(),
  reserveMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock("@/lib/report-email-delivery", () => ({
  createReportLead: createLeadMock,
  markReportEmailDelivery: markDeliveryMock,
  markReportLeadDelivered: markLeadMock,
  reportEmailClientIdentifier: () => "test-client",
  ReportEmailStorageUnavailableError: class ReportEmailStorageUnavailableError extends Error {},
  reserveReportEmailDelivery: reserveMock,
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { POST } from "./route";

function validPdfBase64(): string {
  return Buffer.from(`%PDF-1.4\n${"report-content\n".repeat(100)}`).toString("base64");
}

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/email-report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify({
      email: "owner@example.com",
      pdfBase64: validPdfBase64(),
      filename: "report.pdf",
      name: "Taylor",
      address: "4200 S California Ave, Chicago, IL 60632",
      projectGoal: "Hire or retain employees",
      projectType: "hiring",
      wantsHelp: false,
      source: "report_email_gate",
      ...overrides,
    }),
  });
}

beforeEach(() => {
  vi.stubEnv("REPORT_EMAILS_ENABLED", "true");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  reserveMock.mockReset().mockResolvedValue({ allowed: true, id: 11 });
  createLeadMock.mockReset().mockResolvedValue(22);
  markDeliveryMock.mockReset().mockResolvedValue(undefined);
  markLeadMock.mockReset().mockResolvedValue(undefined);
  sendMock.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/email-report", () => {
  it("fails closed until report email delivery is explicitly enabled", async () => {
    vi.stubEnv("REPORT_EMAILS_ENABLED", "false");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects attachments that are not PDFs", async () => {
    const invalid = Buffer.from(`NOT-A-PDF\n${"content\n".repeat(100)}`).toString("base64");
    const response = await POST(request({ pdfBase64: invalid }));
    expect(response.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("enforces the persistent delivery reservation limit", async () => {
    reserveMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 3600 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("delivers the PDF and records consent-aware identity data", async () => {
    const response = await POST(request({
      name: "<script>alert(1)</script>",
    }));
    expect(response.status).toBe(200);
    // PR #250 follow-up: this route is report delivery only. The Chamber
    // follow-up opt-in lives at /api/support-request, so every lead this
    // route writes is wantsHelp: false.
    expect(createLeadMock).toHaveBeenCalledWith(expect.objectContaining({
      email: "owner@example.com",
      projectGoal: "Hire or retain employees",
      wantsHelp: false,
      source: "report_email_gate",
    }));
    expect(sendMock).toHaveBeenCalledTimes(1);
    const delivery = sendMock.mock.calls[0][0];
    expect(delivery.to).toEqual(["owner@example.com"]);
    expect(delivery.attachments[0].filename).toBe("report.pdf");
    expect(Buffer.isBuffer(delivery.attachments[0].content)).toBe(true);
    expect(delivery.html).toContain("&lt;script&gt;");
    expect(delivery.html).not.toContain("<script>");
    expect(markDeliveryMock).toHaveBeenCalledWith(11, "sent");
    expect(markLeadMock).toHaveBeenCalledWith(22);
  });

  it("never sends a second, Chamber-inbox email — even with the help inbox configured (PR #250 follow-up: that branch was unreachable dead code and is gone)", async () => {
    vi.stubEnv("INCENTIVE_HELP_INBOX", "help@example.com");
    const response = await POST(request({ wantsHelp: true }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toEqual(["owner@example.com"]);
  });

  /**
   * HARD delivery failure. Every case above either short-circuits before the
   * provider or lets the send succeed, so the branch that matters most to a
   * user was unpinned: when the report itself never leaves, the route must
   * say so. A regression that let a provider outage return `success: true`
   * would tell someone their report is on the way when nothing was sent, and
   * no test would have caught it.
   */
  it("returns an honest 5xx when the provider throws on the report send", async () => {
    sendMock.mockReset().mockRejectedValue(new Error("Resend is down"));

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(payload).not.toHaveProperty("success");
    expect(payload.error).toBe("We could not email the report. Please try again.");
    // The reservation is settled as failed, not left claiming a delivery.
    expect(markDeliveryMock).toHaveBeenCalledWith(11, "failed");
    expect(markDeliveryMock).not.toHaveBeenCalledWith(11, "sent");
    expect(markLeadMock).not.toHaveBeenCalled();
  });

  it("returns an honest 5xx when the provider rejects the report send with an error payload", async () => {
    // Resend reports some failures by resolving with `{ error }` rather than
    // throwing — the quieter half of the same outage, and the one most likely
    // to be mistaken for a success.
    sendMock
      .mockReset()
      .mockResolvedValue({ data: null, error: { name: "validation_error", message: "rejected" } });

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).not.toHaveProperty("success");
    expect(payload.error).toBe("We could not email the report. Please try again.");
    expect(markDeliveryMock).toHaveBeenCalledWith(11, "failed");
    expect(markDeliveryMock).not.toHaveBeenCalledWith(11, "sent");
  });
});
