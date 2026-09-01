import { cache } from "react";
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

/**
 * Result of asking storage whether a signed-in email is an approved beta user.
 *
 * R2 finding 7. The lookup's `PublicInvestmentEarlyAccessStorageUnavailableError`
 * used to be caught and swallowed, and the function fell through to the same
 * `hasSession: false` a genuine rejection produces. So a signed-in, APPROVED
 * beta tester hitting a moment of database trouble was shown the staff
 * password wall — a screen telling them access is restricted to corridor
 * partners and inviting them to type an admin password they do not have and
 * never will. "We cannot check right now" was being reported as "you are not
 * allowed", which is a different and much more discouraging claim.
 */
type BetaAccessProbe =
  | { state: "approved" }
  | { state: "not_approved" }
  | { state: "storage_unavailable" }
  | { state: "no_session" };

/**
 * Memoized per request by React's `cache()`, so `getInvestmentAdminState()`
 * and `InvestmentLoginForm` (which renders only after it) share one answer and
 * one database round trip. Outside a request (tests) it simply runs again,
 * which is correct, just not free.
 */
const probeBetaAccess = cache(async (): Promise<BetaAccessProbe> => {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return { state: "no_session" };
  try {
    return (await hasApprovedPublicInvestmentAccess(email))
      ? { state: "approved" }
      : { state: "not_approved" };
  } catch (error) {
    if (error instanceof PublicInvestmentEarlyAccessStorageUnavailableError) {
      return { state: "storage_unavailable" };
    }
    throw error;
  }
});

/** Reads the admin cookies once and reports whether the gate is configured and
 * whether the current request carries a valid session. */
export async function getInvestmentAdminState(): Promise<{
  configured: boolean;
  hasSession: boolean;
  accessMode?: InvestmentAccessMode;
  /**
   * True when the beta-access lookup could not be COMPLETED — distinct from a
   * completed lookup that said no. Callers that only destructure
   * `configured`/`hasSession`/`accessMode` are unaffected; `InvestmentLoginForm`
   * reads the same underlying probe and swaps the password wall for an honest
   * "temporarily unavailable" screen.
   */
  storageUnavailable?: boolean;
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
    const probe = await probeBetaAccess();
    if (probe.state === "approved") {
      return { configured: true, hasSession: true, accessMode: "beta" };
    }
    if (probe.state === "storage_unavailable") {
      return {
        configured: true,
        hasSession: false,
        accessMode: null,
        storageUnavailable: true,
      };
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

/**
 * Shown to a signed-in beta user when the access lookup could not be
 * completed. NOT the password wall: this person may well be approved, and we
 * have no idea either way — so the screen says exactly that, and asks them to
 * retry rather than to produce a staff password they do not have.
 */
export function InvestmentTemporarilyUnavailable() {
  return (
    <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
      <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6">
        <span className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#2563EB]">
          Investment &amp; Impact
        </span>
        <h1 className="mt-4 font-editorial text-[38px]">Access check temporarily unavailable</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-[#0C1B33]/45">
          We could not verify your access just now — this is a problem on our side, not a decision
          about your account. Please try again in a few minutes.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-[#0C1B33]/45">
          If it keeps happening, the{" "}
          <Link href="/public-investment-analysis" className="text-[#2563EB] hover:underline">
            Public Investment Analysis page
          </Link>{" "}
          has the request form and contact details.
        </p>
      </div>
    </main>
  );
}

/**
 * The password wall — mirrors the Owner Files login UX, posting to the
 * investment login route so it redirects back to `redirectTo` under
 * /investment.
 *
 * Async (R2 finding 7) so it can consult the SAME per-request beta-access
 * probe `getInvestmentAdminState()` already ran. When that probe could not
 * reach storage, this renders {@link InvestmentTemporarilyUnavailable} instead
 * of a password wall — without any caller having to pass a new prop, which
 * matters because every caller of this component lives outside this round's
 * fence. React's `cache()` makes the second call free within a request.
 *
 * Only a signed-in visitor gets the swap. For an anonymous visitor the
 * password wall is still exactly the right screen: they have no beta identity
 * to check, so storage never mattered to them.
 */
export async function InvestmentLoginForm({
  redirectTo,
  hasAuthError,
}: {
  redirectTo: string;
  hasAuthError: boolean;
}) {
  if (isPublicInvestmentAccessEmailConfigured()) {
    const probe = await probeBetaAccess();
    if (probe.state === "storage_unavailable") {
      return <InvestmentTemporarilyUnavailable />;
    }
  }

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
