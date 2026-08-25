import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPublicInvestmentAccessEmailConfigured,
  publicInvestmentApprovalEmail,
  publicInvestmentMagicLinkUrl,
  publicInvestmentMagicLinkConfirmationUrl,
  publicInvestmentNextAuthCallbackUrl,
  publicInvestmentVerificationEmail,
  publicInvestmentVerificationUrl,
} from "@/lib/public-investment-access-email";

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_URL", "https://chicagoincentiveexplorer.com");
  vi.stubEnv("AUTH_SECRET", "secret");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("PUBLIC_INVESTMENT_ACCESS_EMAILS_ENABLED", "true");
});

afterEach(() => vi.unstubAllEnvs());

describe("Public Investment access email", () => {
  it("is fail-closed behind the explicit email flag", () => {
    expect(isPublicInvestmentAccessEmailConfigured()).toBe(true);
    vi.stubEnv("PUBLIC_INVESTMENT_ACCESS_EMAILS_ENABLED", "false");
    expect(isPublicInvestmentAccessEmailConfigured()).toBe(false);
  });

  it("builds a 24-hour verification message with the public callback", () => {
    const url = publicInvestmentVerificationUrl("BILLY@EXAMPLE.COM", "verify-token");
    const parsed = new URL(url);
    const message = publicInvestmentVerificationEmail(url);
    expect(parsed.pathname).toBe("/public-investment-analysis/verify");
    expect(parsed.searchParams.get("email")).toBe("billy@example.com");
    expect(parsed.searchParams.get("token")).toBe("verify-token");
    expect(message.subject).toBe("Verify your Public Investment Analysis request");
    expect(message.text).toContain("expires in 24 hours");
  });

  it("builds the approved user's NextAuth callback into the protected analysis", () => {
    const url = publicInvestmentMagicLinkUrl("billy@example.com", "magic-token");
    const parsed = new URL(url);
    const message = publicInvestmentApprovalEmail(url);
    expect(parsed.pathname).toBe("/public-investment-analysis/sign-in");
    expect(parsed.searchParams.get("email")).toBe("billy@example.com");
    expect(parsed.searchParams.get("token")).toBe("magic-token");
    const callback = publicInvestmentNextAuthCallbackUrl("billy@example.com", "magic-token");
    expect(publicInvestmentMagicLinkConfirmationUrl(callback)).toBe(url);
    const callbackParsed = new URL(callback);
    expect(callbackParsed.searchParams.get("callbackUrl")).toBe(
      "https://chicagoincentiveexplorer.com/investment",
    );
    expect(message.subject).toBe("Your Public Investment Analysis beta access is ready");
    expect(message.text).toContain("within 30 minutes");
  });
});
