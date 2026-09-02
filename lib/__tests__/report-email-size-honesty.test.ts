import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PDF_BASE64_CHARS,
  MAX_PDF_BYTES,
  MAX_REQUEST_BYTES,
  REPORT_TOO_LARGE_MESSAGE,
  VERCEL_BODY_LIMIT_BYTES,
} from "../report-email-limits";

/**
 * R2 finding 9 — the report-email path lied about size.
 *
 * The route's zod schema accepted a `pdfBase64` up to 6,000,000 characters and
 * its request ceiling was 6,500,000 bytes, both ABOVE Vercel's 4.5MB body
 * limit. Every payload in that band was rejected by the platform before the
 * handler ran, so the route's own "Report attachment is too large." 413 was
 * unreachable for exactly the payloads it existed for, and the browser got an
 * opaque platform error instead.
 *
 * PR #250 follow-up: the client-side pre-check and its 30s upload timeout
 * lived in `deliverReportByEmail`, which had no callers anywhere in the repo
 * and has been deleted. The ceilings below are still enforced — by the route's
 * own schema, which every live `/api/email-report` caller goes through.
 */

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
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
