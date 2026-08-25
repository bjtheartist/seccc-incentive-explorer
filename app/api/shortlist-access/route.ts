import { NextRequest, NextResponse } from "next/server";
import {
  SHORTLIST_ACCESS_COOKIE,
  SHORTLIST_ACCESS_MAX_AGE,
  ShortlistAccessSignupSchema,
  createShortlistAccessSession,
  isShortlistAccessConfigured,
} from "@/lib/shortlist-access";
import {
  ShortlistAccessStorageUnavailableError,
  reserveShortlistAccessSignup,
  saveShortlistAccessSignup,
  shortlistAccessClientIdentifier,
} from "@/lib/shortlist-access-storage";

export const runtime = "nodejs";

function json(body: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body?.website === "string" && body.website.trim()) {
      return json({ success: true });
    }

    if (!isShortlistAccessConfigured()) {
      return json({ error: "Shortlist signup is temporarily unavailable." }, 503);
    }

    const parsed = ShortlistAccessSignupSchema.safeParse(body);
    if (!parsed.success) {
      return json(
        {
          error: "Please check your name, title, and email address.",
          fields: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const reservation = await reserveShortlistAccessSignup(
      shortlistAccessClientIdentifier(request.headers),
    );
    if (!reservation.allowed) {
      return json(
        { error: "Too many signup attempts. Please try again later." },
        429,
        { "Retry-After": String(reservation.retryAfterSeconds) },
      );
    }

    await saveShortlistAccessSignup(parsed.data);
    const response = json({ success: true, message: "Your shortlist is unlocked." });
    response.cookies.set(SHORTLIST_ACCESS_COOKIE, createShortlistAccessSession(), {
      httpOnly: true,
      maxAge: SHORTLIST_ACCESS_MAX_AGE,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error) {
    if (error instanceof ShortlistAccessStorageUnavailableError) {
      return json({ error: "Shortlist signup is temporarily unavailable." }, 503);
    }
    console.error("Shortlist access signup failed:", error);
    return json({ error: "We could not open the shortlist. Please try again." }, 500);
  }
}
