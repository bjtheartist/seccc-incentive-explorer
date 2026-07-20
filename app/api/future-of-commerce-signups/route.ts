import { NextRequest, NextResponse } from "next/server";
import { FutureCommerceSignupSchema } from "@/lib/future-commerce-signup";
import {
  FutureCommerceSignupStorageUnavailableError,
  futureCommerceClientIdentifier,
  reserveFutureCommerceSignup,
  saveFutureCommerceSignup,
} from "@/lib/future-commerce-signup-storage";

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

    // Quietly accept the honeypot so automated submissions do not learn how
    // the public form is screened.
    if (typeof body?.website === "string" && body.website.trim()) {
      return json({ success: true });
    }

    const parsed = FutureCommerceSignupSchema.safeParse(body);
    if (!parsed.success) {
      return json(
        {
          error: "Please check the highlighted information and try again.",
          fields: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const reservation = await reserveFutureCommerceSignup(
      futureCommerceClientIdentifier(request.headers),
    );
    if (!reservation.allowed) {
      return json(
        { error: "Too many signup attempts. Please try again later." },
        429,
        { "Retry-After": String(reservation.retryAfterSeconds) },
      );
    }

    await saveFutureCommerceSignup(parsed.data);
    return json({
      success: true,
      message: "You're on the list.",
    });
  } catch (error) {
    if (error instanceof FutureCommerceSignupStorageUnavailableError) {
      return json({ error: "Signup storage is temporarily unavailable." }, 503);
    }
    console.error("Future of Commerce signup failed:", error);
    return json({ error: "We could not save your signup. Please try again." }, 500);
  }
}
