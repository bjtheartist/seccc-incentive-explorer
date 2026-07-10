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
      wantsHelp: true,
    }));
    expect(response.status).toBe(200);
    expect(createLeadMock).toHaveBeenCalledWith(expect.objectContaining({
      email: "owner@example.com",
      projectGoal: "Hire or retain employees",
      wantsHelp: true,
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

  it("notifies the configured help inbox only after explicit consent", async () => {
    vi.stubEnv("INCENTIVE_HELP_INBOX", "help@example.com");
    const response = await POST(request({ wantsHelp: true }));
    expect(response.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[1][0]).toMatchObject({
      to: ["help@example.com"],
      replyTo: "owner@example.com",
    });
  });

  it("still succeeds when the optional staff notification fails after delivery", async () => {
    vi.stubEnv("INCENTIVE_HELP_INBOX", "help@example.com");
    sendMock
      .mockResolvedValueOnce({ data: { id: "email-1" }, error: null })
      .mockRejectedValueOnce(new Error("notification unavailable"));

    const response = await POST(request({ wantsHelp: true }));
    expect(response.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(markDeliveryMock).toHaveBeenCalledWith(11, "sent");
  });
});
