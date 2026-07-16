import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_FILES_ADMIN_COOKIE,
  OWNER_FILES_ADMIN_SESSION_MAX_AGE,
  createOwnerFilesAdminSession,
  verifyOwnerFilesAdminPassword,
} from "@/lib/owner-files-admin-auth";

/** Only ever redirect back into /admin/owner-files — cloned from the analytics admin login route. */
function safeOwnerFilesRedirect(req: NextRequest, value: FormDataEntryValue | null) {
  const fallback = new URL("/admin/owner-files", req.url);
  if (typeof value !== "string" || !value.trim()) return fallback;

  const url = new URL(value, req.url);
  if (url.origin !== req.nextUrl.origin || !url.pathname.startsWith("/admin/owner-files")) {
    return fallback;
  }
  return url;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const password = String(formData.get("password") || "");
  const redirectTo = safeOwnerFilesRedirect(req, formData.get("redirectTo"));

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
