import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import VerifyPage from "./verify/page";
import SignInPage from "./sign-in/page";

describe("Public Investment email-link confirmation pages", () => {
  it("requires an explicit POST before consuming the email-verification token", async () => {
    const page = await VerifyPage({
      searchParams: Promise.resolve({ email: "billy@example.com", token: "verify-token" }),
    });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/public-investment-early-access/verify"');
    expect(html).toContain('value="verify-token"');
  });

  it("requires an explicit POST before consuming the passwordless sign-in token", async () => {
    const page = await SignInPage({
      searchParams: Promise.resolve({ email: "billy@example.com", token: "magic-token" }),
    });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/public-investment-early-access/sign-in"');
    expect(html).toContain('value="magic-token"');
  });
});
