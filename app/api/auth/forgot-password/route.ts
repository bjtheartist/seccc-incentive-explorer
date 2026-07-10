import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { normalizeEmail } from "@/lib/password";
import {
  createPasswordResetToken,
  deletePasswordResetToken,
  findPasswordResetUser,
  markPasswordResetRequest,
  PASSWORD_RESET_RESPONSE,
  PasswordResetStorageUnavailableError,
  passwordResetClientIdentifier,
  passwordResetUrl,
  reservePasswordResetRequest,
  storePasswordResetToken,
} from "@/lib/password-reset";

export const runtime = "nodejs";

function resetEmailHtml(url: string): string {
  return `
    <div style="font-family:Arial,sans-serif;color:#0C1B33;line-height:1.6;max-width:560px;margin:0 auto;padding:32px 20px;">
      <p style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#2563EB;margin:0 0 18px;">Chicago Incentive Explorer</p>
      <h1 style="font-family:Georgia,serif;font-size:30px;font-weight:normal;line-height:1.2;margin:0 0 16px;">Reset your password</h1>
      <p style="font-size:15px;margin:0 0 24px;">Use the button below to choose a new password. This one-time link expires in one hour.</p>
      <p style="margin:0 0 24px;"><a href="${url}" style="display:inline-block;background:#0C1B33;color:#ffffff;text-decoration:none;padding:13px 20px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Choose a new password</a></p>
      <p style="font-size:13px;color:#5B6472;margin:0;">If you did not request this, you can ignore this email. Your password will not change.</p>
    </div>
  `;
}

export async function POST(req: NextRequest) {
  if (
    process.env.PASSWORD_RESET_EMAILS_ENABLED !== "true" ||
    !process.env.RESEND_API_KEY
  ) {
    return NextResponse.json(
      { error: "Password recovery is temporarily unavailable." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const email =
    typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!email || !email.includes("@") || email.length > 320) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 }
    );
  }

  let requestId: number | null = null;
  let userId: string | null = null;

  try {
    const reservation = await reservePasswordResetRequest(
      email,
      passwordResetClientIdentifier(req.headers)
    );
    if (!reservation.allowed) {
      return NextResponse.json({ message: PASSWORD_RESET_RESPONSE });
    }
    requestId = reservation.id;

    const user = await findPasswordResetUser(email);
    if (!user) {
      await markPasswordResetRequest(requestId, "ignored");
      return NextResponse.json({ message: PASSWORD_RESET_RESPONSE });
    }
    userId = user.id;

    const token = createPasswordResetToken();
    await storePasswordResetToken(user.id, token);
    const url = passwordResetUrl(token);
    const resend = new Resend(process.env.RESEND_API_KEY);
    const delivery = await resend.emails.send({
      from:
        process.env.AUTH_EMAIL_FROM ||
        process.env.REPORT_EMAIL_FROM ||
        "Chicago Incentive Explorer <reports@chicagoincentiveexplorer.com>",
      to: [email],
      subject: "Reset your Chicago Incentive Explorer password",
      html: resetEmailHtml(url),
      text: [
        "Reset your Chicago Incentive Explorer password",
        "",
        "Use this one-time link within one hour:",
        url,
        "",
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
    });
    if (delivery.error) {
      throw new Error("Resend rejected the password reset email");
    }

    await markPasswordResetRequest(requestId, "sent");
    return NextResponse.json({ message: PASSWORD_RESET_RESPONSE });
  } catch (error) {
    if (userId) {
      await deletePasswordResetToken(userId).catch(() => undefined);
    }
    if (requestId != null) {
      await markPasswordResetRequest(requestId, "failed").catch(
        () => undefined
      );
    }
    if (error instanceof PasswordResetStorageUnavailableError) {
      return NextResponse.json(
        { error: "Password recovery is temporarily unavailable." },
        { status: 503 }
      );
    }
    console.error("Password reset request failed:", error);
    return NextResponse.json({ message: PASSWORD_RESET_RESPONSE });
  }
}
