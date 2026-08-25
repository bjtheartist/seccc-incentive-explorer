import { NextRequest, NextResponse } from "next/server";
import {
  ANALYTICS_ADMIN_COOKIE,
  ANALYTICS_ADMIN_SESSION_MAX_AGE,
  createAnalyticsAdminSession,
  verifyAnalyticsAdminPassword,
} from "@/lib/analytics-admin-auth";

const ALLOWED_ADMIN_REDIRECTS = new Set([
  "/admin/analytics",
  "/admin/future-of-commerce",
  "/admin/zoning-changes",
  "/admin/support-network",
  "/admin/public-investment-access",
]);

function safeDashboardRedirect(req: NextRequest, value: FormDataEntryValue | null) {
  const fallback = new URL("/admin/analytics", req.url);
  if (typeof value !== "string" || !value.trim()) return fallback;

  const url = new URL(value, req.url);
  if (url.origin !== req.nextUrl.origin || !ALLOWED_ADMIN_REDIRECTS.has(url.pathname)) {
    return fallback;
  }
  return url;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const password = String(formData.get("password") || "");
  const redirectTo = safeDashboardRedirect(req, formData.get("redirectTo"));

  if (!verifyAnalyticsAdminPassword(password)) {
    redirectTo.searchParams.set("error", "1");
    return NextResponse.redirect(redirectTo, { status: 303 });
  }

  redirectTo.searchParams.delete("error");
  const response = NextResponse.redirect(redirectTo, { status: 303 });
  response.cookies.set(ANALYTICS_ADMIN_COOKIE, createAnalyticsAdminSession(), {
    httpOnly: true,
    maxAge: ANALYTICS_ADMIN_SESSION_MAX_AGE,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
