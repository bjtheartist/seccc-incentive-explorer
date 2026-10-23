import { NextRequest, NextResponse } from "next/server";
import {
  INVESTMENT_SHARE_COOKIE,
  createInvestmentShareSession,
  investmentShareCookieMaxAge,
  isInvestmentShareConfigured,
} from "@/lib/investment-share-session";
import {
  InvestmentShareLinkStorageUnavailableError,
  redeemInvestmentShareLink,
} from "@/lib/investment-share-links-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

function investmentUrl(request: NextRequest, share?: "invalid" | "unavailable") {
  const url = new URL("/investment", request.url);
  if (share) url.searchParams.set("share", share);
  return url;
}

/**
 * Opening a partner share link. The raw token lives only in this URL; it is
 * exchanged here for a signed httpOnly cookie and the partner lands on the
 * analysis without ever seeing a password.
 */
export async function GET(request: NextRequest, { params }: { params: Params }) {
  if (!isInvestmentShareConfigured()) {
    return NextResponse.redirect(investmentUrl(request, "unavailable"), { status: 303 });
  }
  const { token } = await params;

  try {
    const link = await redeemInvestmentShareLink(token);
    if (!link) {
      return NextResponse.redirect(investmentUrl(request, "invalid"), { status: 303 });
    }
    const expiresAt = new Date(link.expiresAt);
    const response = NextResponse.redirect(investmentUrl(request), { status: 303 });
    response.cookies.set(INVESTMENT_SHARE_COOKIE, createInvestmentShareSession(link.id, expiresAt), {
      httpOnly: true,
      maxAge: investmentShareCookieMaxAge(expiresAt),
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error) {
    if (!(error instanceof InvestmentShareLinkStorageUnavailableError)) {
      console.error("Investment share link redemption failed:", error);
    }
    return NextResponse.redirect(investmentUrl(request, "unavailable"), { status: 303 });
  }
}
