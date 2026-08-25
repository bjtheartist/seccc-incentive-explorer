import { NextRequest, NextResponse } from "next/server";
import { publicInvestmentNextAuthCallbackUrl } from "@/lib/public-investment-access-email";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const form = await request.formData();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const token = String(form.get("token") || "");
  if (!email || !email.includes("@") || !token) {
    const invalid = new URL("/public-investment-analysis", request.url);
    invalid.searchParams.set("signin", "invalid");
    return NextResponse.redirect(invalid, { status: 303 });
  }

  return NextResponse.redirect(publicInvestmentNextAuthCallbackUrl(email, token), {
    status: 303,
  });
}
