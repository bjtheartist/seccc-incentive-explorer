import { NextRequest, NextResponse } from "next/server";
import { hashPassword, isStrongEnoughPassword } from "@/lib/password";
import {
  consumePasswordResetToken,
  PasswordResetStorageUnavailableError,
} from "@/lib/password-reset";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (token.length < 32 || token.length > 200) {
    return NextResponse.json(
      { error: "This password reset link is invalid or has expired." },
      { status: 400 }
    );
  }
  if (!isStrongEnoughPassword(password)) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  try {
    const passwordHash = await hashPassword(password);
    const changed = await consumePasswordResetToken(token, passwordHash);
    if (!changed) {
      return NextResponse.json(
        { error: "This password reset link is invalid or has expired." },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PasswordResetStorageUnavailableError) {
      return NextResponse.json(
        { error: "Password recovery is temporarily unavailable." },
        { status: 503 }
      );
    }
    console.error("Password reset failed:", error);
    return NextResponse.json(
      { error: "We could not reset your password. Please try again." },
      { status: 500 }
    );
  }
}
