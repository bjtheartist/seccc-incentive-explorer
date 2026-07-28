import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_FILES_ADMIN_COOKIE,
  OWNER_FILES_ADMIN_SESSION_MAX_AGE,
  createOwnerFilesAdminSession,
  verifyOwnerFilesAdminPassword,
} from "@/lib/owner-files-admin-auth";

/**
 * Login gate for the admin-gated /investment analysis pages. Sets the SAME
 * signed Owner Files admin session cookie as /api/admin/owner-files/login (the
 * Investment analysis reuses the Owner Files admin session — single sign-on),
 * differing only in that it redirects back into /investment. Cloned from the
 * owner-files login route.
 */
function safeInvestmentRedirect(req: NextRequest, value: FormDataEntryValue | null) {
  const fallback = new URL("/investment", req.url);
  if (typeof value !== "string" || !value.trim()) return fallback;

  const url = new URL(value, req.url);
  if (url.origin !== req.nextUrl.origin || !url.pathname.startsWith("/investment")) {
    return fallback;
  }
  return url;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const password = String(formData.get("password") || "");
  const redirectTo = safeInvestmentRedirect(req, formData.get("redirectTo"));

  if (!verifyOwnerFilesAdminPassword(password)) {
    redirectTo.searchParams.set("error", "1");
    return NextResponse.redirect(redirectTo, { status: 303 });
  }

  redirectTo.searchParams.delete("error");
  const response = NextResponse.redirect(redirectTo, { status: 303 });
  response.cookies.set(OWNER_FILES_ADMIN_COOKIE, createOwnerFilesAdminSession(), {
    httpOnly: true,
    maxAge: OWNER_FILES_ADMIN_SESSION_MAX_AGE,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
