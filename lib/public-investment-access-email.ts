import "server-only";

import { Resend } from "resend";

const DEFAULT_SITE_URL = "https://chicagoincentiveexplorer.com";

function siteUrl(): string {
  return (
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (process.env.NODE_ENV === "production" ? DEFAULT_SITE_URL : "http://localhost:3000")
  );
}

function emailFrom(): string {
  return (
    process.env.AUTH_EMAIL_FROM ||
    process.env.REPORT_EMAIL_FROM ||
    "Chicago Incentive Explorer <reports@chicagoincentiveexplorer.com>"
  );
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function isPublicInvestmentAccessEmailConfigured(): boolean {
  return Boolean(
    process.env.PUBLIC_INVESTMENT_ACCESS_EMAILS_ENABLED === "true" &&
      process.env.RESEND_API_KEY &&
      (process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET),
  );
}

export function publicInvestmentVerificationUrl(email: string, token: string): string {
  const url = new URL("/public-investment-analysis/verify", siteUrl());
  url.searchParams.set("email", email.trim().toLowerCase());
  url.searchParams.set("token", token);
  return url.toString();
}

export function publicInvestmentMagicLinkUrl(email: string, token: string): string {
  const url = new URL("/public-investment-analysis/sign-in", siteUrl());
  url.searchParams.set("token", token);
  url.searchParams.set("email", email.trim().toLowerCase());
  return url.toString();
}

export function publicInvestmentNextAuthCallbackUrl(email: string, token: string): string {
  const url = new URL("/api/auth/callback/email", siteUrl());
  url.searchParams.set("callbackUrl", `${siteUrl()}/investment`);
  url.searchParams.set("token", token);
  url.searchParams.set("email", email.trim().toLowerCase());
  return url.toString();
}

export function publicInvestmentMagicLinkConfirmationUrl(nextAuthUrl: string): string {
  const url = new URL(nextAuthUrl);
  const email = url.searchParams.get("email") || "";
  const token = url.searchParams.get("token") || "";
  return publicInvestmentMagicLinkUrl(email, token);
}

export function publicInvestmentVerificationEmail(url: string) {
  return {
    subject: "Verify your Public Investment Analysis request",
    text: [
      "Verify your Public Investment Analysis request",
      "",
      "Confirm your email address so we can review your early-access request.",
      "This one-time link expires in 24 hours:",
      url,
      "",
      "If you did not make this request, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#0C1B33;line-height:1.6;max-width:560px;margin:0 auto;padding:32px 20px;">
        <p style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#2563EB;margin:0 0 18px;">Chicago Incentive Explorer</p>
        <h1 style="font-family:Georgia,serif;font-size:30px;font-weight:normal;line-height:1.2;margin:0 0 16px;">Verify your early-access request</h1>
        <p style="font-size:15px;margin:0 0 24px;">Confirm your email address so we can review your request for Public Investment Analysis. This one-time link expires in 24 hours.</p>
        <p style="margin:0 0 24px;"><a href="${htmlEscape(url)}" style="display:inline-block;background:#0C1B33;color:#ffffff;text-decoration:none;padding:13px 20px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Verify email address</a></p>
        <p style="font-size:13px;color:#5B6472;margin:0;">If you did not make this request, you can ignore this email.</p>
      </div>
    `,
  };
}

export function publicInvestmentApprovalEmail(url: string) {
  return {
    subject: "Your Public Investment Analysis beta access is ready",
    text: [
      "Your Public Investment Analysis beta access is ready",
      "",
      "Your early-access request has been approved.",
      "Use this one-time link within 30 minutes to sign in:",
      url,
      "",
      "You can request another sign-in link from the Public Investment Analysis page.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#0C1B33;line-height:1.6;max-width:560px;margin:0 auto;padding:32px 20px;">
        <p style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#2563EB;margin:0 0 18px;">Chicago Incentive Explorer</p>
        <h1 style="font-family:Georgia,serif;font-size:30px;font-weight:normal;line-height:1.2;margin:0 0 16px;">Your beta access is ready</h1>
        <p style="font-size:15px;margin:0 0 24px;">Your request for Public Investment Analysis has been approved. Use this one-time link within 30 minutes to sign in.</p>
        <p style="margin:0 0 24px;"><a href="${htmlEscape(url)}" style="display:inline-block;background:#0C1B33;color:#ffffff;text-decoration:none;padding:13px 20px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Open Public Investment Analysis</a></p>
        <p style="font-size:13px;color:#5B6472;margin:0;">You can request another sign-in link from the Public Investment Analysis page.</p>
      </div>
    `,
  };
}

async function sendAccessEmail(
  to: string,
  message: { subject: string; html: string; text: string },
): Promise<void> {
  if (!isPublicInvestmentAccessEmailConfigured()) {
    throw new Error("Public Investment access email is not configured");
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const delivery = await resend.emails.send({
    from: emailFrom(),
    to: [to.trim().toLowerCase()],
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  if (delivery.error) {
    throw new Error("Resend rejected the Public Investment access email");
  }
}

export async function sendPublicInvestmentVerificationEmail(
  email: string,
  token: string,
): Promise<void> {
  const url = publicInvestmentVerificationUrl(email, token);
  await sendAccessEmail(email, publicInvestmentVerificationEmail(url));
}

export async function sendPublicInvestmentMagicLinkEmail(
  email: string,
  url: string,
): Promise<void> {
  await sendAccessEmail(email, publicInvestmentApprovalEmail(url));
}
