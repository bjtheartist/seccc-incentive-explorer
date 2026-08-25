import { NextRequest, NextResponse } from "next/server";
import { PublicInvestmentEarlyAccessSchema } from "@/lib/public-investment-early-access";
import {
  isPublicInvestmentAccessEmailConfigured,
  publicInvestmentMagicLinkUrl,
  sendPublicInvestmentMagicLinkEmail,
  sendPublicInvestmentVerificationEmail,
} from "@/lib/public-investment-access-email";
import {
  createPublicInvestmentEmailVerificationToken,
  createPublicInvestmentMagicSignInToken,
  PublicInvestmentEarlyAccessStorageUnavailableError,
  publicInvestmentEarlyAccessClientIdentifier,
  reservePublicInvestmentEarlyAccessRequest,
  savePublicInvestmentEarlyAccessRequest,
} from "@/lib/public-investment-early-access-storage";

export const runtime = "nodejs";

function json(body: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (typeof body?.website === "string" && body.website.trim()) {
      return json({ success: true });
    }

    const parsed = PublicInvestmentEarlyAccessSchema.safeParse(body);
    if (!parsed.success) {
      return json(
        {
          error: "Please check the details in your request.",
          fields: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    if (!isPublicInvestmentAccessEmailConfigured()) {
      return json({ error: "Early-access email verification is temporarily unavailable." }, 503);
    }

    const reservation = await reservePublicInvestmentEarlyAccessRequest(
      publicInvestmentEarlyAccessClientIdentifier(request.headers),
    );
    if (!reservation.allowed) {
      return json(
        { error: "Too many requests. Please try again later." },
        429,
        { "Retry-After": String(reservation.retryAfterSeconds) },
      );
    }

    const saved = await savePublicInvestmentEarlyAccessRequest(parsed.data);
    let message = "Your request is recorded for review.";
    if (saved.status === "approved" && saved.emailVerifiedAt) {
      const { token } = await createPublicInvestmentMagicSignInToken(saved.email);
      const url = publicInvestmentMagicLinkUrl(saved.email, token);
      await sendPublicInvestmentMagicLinkEmail(saved.email, url);
      message = "Check your email for a passwordless sign-in link.";
    } else if (saved.status === "pending_verification") {
      const token = await createPublicInvestmentEmailVerificationToken(saved.email);
      await sendPublicInvestmentVerificationEmail(saved.email, token);
      message = "Check your email to verify this early-access request.";
    } else if (saved.status === "pending_review") {
      message = "Your verified early-access request is already under review.";
    }

    return json({
      success: true,
      message,
    });
  } catch (error) {
    if (error instanceof PublicInvestmentEarlyAccessStorageUnavailableError) {
      return json({ error: "Early-access signup is temporarily unavailable." }, 503);
    }
    console.error("Public Investment early-access signup failed:", error);
    return json({ error: "We could not save your request. Please try again." }, 500);
  }
}
