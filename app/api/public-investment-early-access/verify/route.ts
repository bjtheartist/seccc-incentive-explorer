import { NextRequest, NextResponse } from "next/server";
import {
  PublicInvestmentEarlyAccessStorageUnavailableError,
  verifyPublicInvestmentEmail,
} from "@/lib/public-investment-early-access-storage";

export const runtime = "nodejs";

function resultUrl(request: NextRequest, result: "verified" | "invalid" | "unavailable") {
  const url = new URL("/public-investment-analysis", request.url);
  url.searchParams.set("verification", result);
  return url;
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const form = await request.formData();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const token = String(form.get("token") || "");
  if (!email || !email.includes("@") || !token) {
    return NextResponse.redirect(resultUrl(request, "invalid"), { status: 303 });
  }

  try {
    const verified = await verifyPublicInvestmentEmail(email, token);
    return NextResponse.redirect(resultUrl(request, verified ? "verified" : "invalid"), {
      status: 303,
    });
  } catch (error) {
    if (error instanceof PublicInvestmentEarlyAccessStorageUnavailableError) {
      return NextResponse.redirect(resultUrl(request, "unavailable"), { status: 303 });
    }
    console.error("Public Investment email verification failed:", error);
    return NextResponse.redirect(resultUrl(request, "unavailable"), { status: 303 });
  }
}
