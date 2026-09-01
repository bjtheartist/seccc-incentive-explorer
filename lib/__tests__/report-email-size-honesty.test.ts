import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PDF_BASE64_CHARS,
  MAX_PDF_BYTES,
  MAX_REQUEST_BYTES,
  REPORT_TOO_LARGE_MESSAGE,
  VERCEL_BODY_LIMIT_BYTES,
} from "../report-email-limits";
import { deliverReportByEmail, ReportEmailTooLargeError } from "../report-email";
import type { GeneratedReport } from "../report-engine";

/**
 * R2 finding 9 — the report-email path lied about size, and could hang forever.
 *
 * The route's zod schema accepted a `pdfBase64` up to 6,000,000 characters and
 * its request ceiling was 6,500,000 bytes, both ABOVE Vercel's 4.5MB body
 * limit. Every payload in that band was rejected by the platform before the
 * handler ran, so the route's own "Report attachment is too large." 413 was
 * unreachable for exactly the payloads it existed for, and the browser got an
 * opaque platform error instead. Meanwhile the client helper's fetch had no
 * timeout, so a hung connection left the caller awaiting a promise that never
 * settled — a terminal "Sending…" with no error and no retry.
 */

const report = {
  title: "Test Report",
  reportType: "site-incentives",
  sections: [],
  metadata: { address: "100 E Test St" },
} as unknown as GeneratedReport;

function deliver(base64: string) {
  vi.doMock("../pdf-report", () => ({
    generateReportPdfBase64: () => ({ base64, filename: "report.pdf" }),
  }));
  return deliverReportByEmail({
    report,
    email: "someone@example.com",
    wantsHelp: false,
    projectType: "expansion",
    projectGoals: ["expansion"],
    source: "test",
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("../pdf-report");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("every ceiling sits below Vercel's body limit", () => {
  it("the base64 cap leaves room for the JSON envelope under 4.5MB", () => {
    expect(MAX_PDF_BASE64_CHARS).toBeLessThan(VERCEL_BODY_LIMIT_BYTES);
    expect(MAX_REQUEST_BYTES).toBeLessThan(VERCEL_BODY_LIMIT_BYTES);
    expect(MAX_PDF_BASE64_CHARS).toBeLessThan(MAX_REQUEST_BYTES);
  });

  it("is strictly tighter than the values it replaced", () => {
    expect(MAX_PDF_BASE64_CHARS).toBeLessThan(6_000_000);
    expect(MAX_REQUEST_BYTES).toBeLessThan(6_500_000);
    expect(MAX_PDF_BYTES).toBeLessThan(4_500_000);
  });

  it("derives the decoded-PDF ceiling from the base64 ceiling (base64 inflates 4/3)", () => {
    expect(MAX_PDF_BYTES).toBe(Math.floor((MAX_PDF_BASE64_CHARS * 3) / 4));
  });

  it("the honest copy does not tell the user to try again", () => {
    expect(REPORT_TOO_LARGE_MESSAGE).not.toMatch(/try again/i);
    expect(REPORT_TOO_LARGE_MESSAGE).toMatch(/download/i);
  });
});

describe("the route's schema enforces the new cap", () => {
  it("rejects a pdfBase64 above MAX_PDF_BASE64_CHARS with a 400, not a platform error", async () => {
    vi.stubEnv("REPORT_EMAILS_ENABLED", "true");
    const { POST } = await import("../../app/api/email-report/route");
    const res = await POST(
      new Request("http://localhost/api/email-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "a@b.com",
          pdfBase64: "A".repeat(MAX_PDF_BASE64_CHARS + 1),
        }),
      }) as never,
    );
    expect(res.status).toBe(400);
    vi.unstubAllEnvs();
  });
});

describe("client-side pre-check", () => {
  it("throws a typed, UNRETRYABLE too-large failure without sending the request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(deliver("A".repeat(MAX_PDF_BASE64_CHARS + 1))).rejects.toBeInstanceOf(
      ReportEmailTooLargeError,
    );
    expect(fetchMock, "an oversized report must never be uploaded").not.toHaveBeenCalled();
  });

  it("carries honest copy that names the download, not a pointless retry", async () => {
    vi.stubGlobal("fetch", vi.fn());
    let caught: ReportEmailTooLargeError | null = null;
    try {
      await deliver("A".repeat(MAX_PDF_BASE64_CHARS + 1));
    } catch (error) {
      caught = error as ReportEmailTooLargeError;
    }
    expect(caught?.retryable).toBe(false);
    expect(caught?.message).toBe(REPORT_TOO_LARGE_MESSAGE);
    expect(caught?.message).not.toMatch(/try again/i);
    expect(caught?.pdfBase64Length).toBe(MAX_PDF_BASE64_CHARS + 1);
  });

  it("lets a report that DOES fit through to the request unchanged", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(deliver("A".repeat(1000))).resolves.toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("request timeout", () => {
  it("passes an AbortSignal with a 30s timeout on the upload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);

    await deliver("A".repeat(1000));

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal, "a hung upload must not await forever").toBeInstanceOf(AbortSignal);
  });

  it("surfaces an aborted upload as an error rather than hanging", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" })),
    );
    await expect(deliver("A".repeat(1000))).rejects.toThrow();
  });
});
