import Link from "next/link";
import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { authOptions } from "@/auth";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";
import { ANALYTICS_ADMIN_COOKIE } from "@/lib/analytics-admin-auth";
import { InvestmentSessionGuard } from "@/components/investment/SessionGuard";
import { isPublicInvestmentAccessEmailConfigured } from "@/lib/public-investment-access-email";
import {
  hasApprovedPublicInvestmentAccess,
  PublicInvestmentEarlyAccessStorageUnavailableError,
} from "@/lib/public-investment-early-access-storage";

/**
 * Access gate for the Investment & Impact Analysis pages. Existing Owner Files
 * and analytics admin sessions keep their original access. Verified beta users
 * may also enter through the ordinary NextAuth session after staff approval.
 */

export type InvestmentAccessMode = "admin" | "beta" | null;

/** Reads the admin cookies once and reports whether the gate is configured and
 * whether the current request carries a valid session. */
export async function getInvestmentAdminState(): Promise<{
  configured: boolean;
  hasSession: boolean;
  accessMode?: InvestmentAccessMode;
}> {
  const adminConfigured = isOwnerFilesAdminConfigured();
  const betaConfigured = isPublicInvestmentAccessEmailConfigured();
  const configured = adminConfigured || betaConfigured;
  if (!configured) return { configured: false, hasSession: false };
  const cookieStore = await cookies();
  if (
    adminConfigured &&
    hasValidOwnerFilesAdminSession(
      cookieStore.get(OWNER_FILES_ADMIN_COOKIE)?.value,
      cookieStore.get(ANALYTICS_ADMIN_COOKIE)?.value,
    )
  ) {
    return { configured: true, hasSession: true, accessMode: "admin" };
  }

  if (betaConfigured) {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (email) {
      try {
        if (await hasApprovedPublicInvestmentAccess(email)) {
          return { configured: true, hasSession: true, accessMode: "beta" };
        }
      } catch (error) {
        if (!(error instanceof PublicInvestmentEarlyAccessStorageUnavailableError)) {
          throw error;
        }
      }
    }
  }

  return { configured: true, hasSession: false, accessMode: null };
}

/** Shown when neither staff access nor beta email access is configured. */
export function InvestmentNotConfigured() {
  return (
    <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
      <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6">
        <h1 className="font-editorial text-[38px]">Investment analysis not configured</h1>
        <p className="mt-3 text-[#0C1B33]/45">
          Configure the staff gate or Public Investment beta access before using the Investment &amp; Impact
          analysis.
        </p>
      </div>
    </main>
  );
}

/** The password wall — mirrors the Owner Files login UX, posting to the
 * investment login route so it redirects back to `redirectTo` under /investment. */
export function InvestmentLoginForm({
  redirectTo,
  hasAuthError,
}: {
  redirectTo: string;
  hasAuthError: boolean;
}) {
  return (
    <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
      {/* No live admin session on this surface → wipe any working set left in this
          browser (shared-machine hygiene) before anyone re-authenticates. */}
      <InvestmentSessionGuard />
      <form
        method="post"
        action="/api/admin/investment/login"
        className="mx-auto max-w-md border border-[#0C1B33]/10 bg-white p-6"
      >
        <span className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#2563EB]">
          Investment &amp; Impact
        </span>
        <h1 className="mt-4 font-editorial text-[38px]">Enter admin password</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-[#0C1B33]/45">
          The investment analysis draws on named grantee and business records — the same admin-only data
          behind the map&rsquo;s community-investment layer. Access is restricted to corridor-management
          partners.
        </p>
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          className="mt-5 w-full border border-[#0C1B33]/15 bg-white px-4 py-3 text-[14px] outline-none focus:border-[#2563EB]"
          placeholder="Admin password"
        />
        {hasAuthError ? (
          <p className="mt-3 text-[12px] text-red-600">That password did not match. Try again.</p>
        ) : null}
        <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/45">
          Your analytics or Owner Files admin session also opens this — log in there once and this gate
          disappears.
        </p>
        <button className="mt-4 w-full bg-[#0C1B33] px-4 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.16em] text-white">
          Open investment analysis
        </button>
        <p className="mt-5 border-t border-[#0C1B33]/10 pt-5 text-[12px] leading-relaxed text-[#0C1B33]/45">
          Approved beta tester? Request a passwordless sign-in link from the{" "}
          <Link href="/public-investment-analysis" className="text-[#2563EB] hover:underline">
            Public Investment Analysis page
          </Link>
          .
        </p>
      </form>
    </main>
  );
}
