import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  SHORTLIST_ACCESS_COOKIE,
  SHORTLIST_ACCESS_MAX_AGE,
  createShortlistAccessSession,
  isShortlistAccessConfigured,
} from "@/lib/shortlist-access";

export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

/** Owner-issued bookmark. Only its SHA-256 hash is stored in configuration. */
export async function GET(request: NextRequest) {
  const expectedHash = process.env.SHORTLIST_ACCESS_LINK_SHA256;
  if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash) || !isShortlistAccessConfigured()) {
    return NextResponse.json(
      { error: "Direct shortlist access is not configured." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }

  const token = request.nextUrl.searchParams.get("token") || "";
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token) && timingSafeEqual(
    createHash("sha256").update(token).digest(),
    Buffer.from(expectedHash, "hex"),
  );
  if (!valid) {
    return NextResponse.json(
      { error: "This access link is invalid. Open Site Matchmaker to sign up for access." },
      { status: 403, headers: PRIVATE_HEADERS },
    );
  }

  // Remove the token before rendering a page or loading third-party assets.
  // The destination is fixed; a supplied return URL cannot redirect elsewhere.
  const response = NextResponse.redirect(new URL("/locate", request.url), {
    status: 303,
    headers: PRIVATE_HEADERS,
  });
  response.cookies.set(SHORTLIST_ACCESS_COOKIE, createShortlistAccessSession(), {
    httpOnly: true,
    maxAge: SHORTLIST_ACCESS_MAX_AGE,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
