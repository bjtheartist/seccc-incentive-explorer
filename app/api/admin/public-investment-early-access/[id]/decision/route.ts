import { NextRequest, NextResponse } from "next/server";
import {
  ANALYTICS_ADMIN_COOKIE,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
} from "@/lib/analytics-admin-auth";
import {
  isPublicInvestmentAccessEmailConfigured,
  publicInvestmentMagicLinkUrl,
  sendPublicInvestmentMagicLinkEmail,
} from "@/lib/public-investment-access-email";
import {
  createPublicInvestmentMagicSignInToken,
  decidePublicInvestmentAccess,
  getPublicInvestmentAccessById,
  PublicInvestmentEarlyAccessStorageUnavailableError,
} from "@/lib/public-investment-early-access-storage";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;
type Decision = "approve" | "deny" | "revoke" | "resend";

function dashboardUrl(request: NextRequest, key: "updated" | "error", value: string) {
  const url = new URL("/admin/public-investment-access", request.url);
  url.searchParams.set(key, value);
  return url;
}

function redirect(request: NextRequest, key: "updated" | "error", value: string) {
  return NextResponse.redirect(dashboardUrl(request, key, value), { status: 303 });
}

export async function POST(request: NextRequest, { params }: { params: Params }) {
  if (!isAnalyticsAdminConfigured()) {
    return NextResponse.json({ error: "Admin access is not configured" }, { status: 503 });
  }
  if (
    !hasValidAnalyticsAdminSession(
      request.cookies.get(ANALYTICS_ADMIN_COOKIE)?.value,
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!/^\d+$/.test(id)) return redirect(request, "error", "not-found");
  const form = await request.formData();
  const decision = String(form.get("decision") || "") as Decision;
  if (!["approve", "deny", "revoke", "resend"].includes(decision)) {
    return redirect(request, "error", "invalid-decision");
  }

  try {
    const current = await getPublicInvestmentAccessById(id);
    if (!current) return redirect(request, "error", "not-found");

    if (decision === "approve" || decision === "resend") {
      if (!isPublicInvestmentAccessEmailConfigured()) {
        return redirect(request, "error", "email-config");
      }
      if (!current.emailVerifiedAt) {
        return redirect(request, "error", "verify-first");
      }

      const approved =
        decision === "approve"
          ? await decidePublicInvestmentAccess(id, "approve")
          : current.status === "approved"
            ? current
            : null;
      if (!approved) return redirect(request, "error", "not-approved");

      const { token } = await createPublicInvestmentMagicSignInToken(approved.email);
      await sendPublicInvestmentMagicLinkEmail(
        approved.email,
        publicInvestmentMagicLinkUrl(approved.email, token),
      );
      return redirect(request, "updated", decision === "approve" ? "approved" : "resent");
    }

    await decidePublicInvestmentAccess(id, decision);
    return redirect(request, "updated", decision === "deny" ? "denied" : "revoked");
  } catch (error) {
    if (error instanceof PublicInvestmentEarlyAccessStorageUnavailableError) {
      return redirect(request, "error", "storage");
    }
    console.error("Public Investment access decision failed:", error);
    return redirect(request, "error", "invite");
  }
}
