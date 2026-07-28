import { cookies } from "next/headers";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";
import { ANALYTICS_ADMIN_COOKIE } from "@/lib/analytics-admin-auth";

/**
 * Admin gate for the Investment & Impact Analysis pages (/investment and
 * /investment/[area]). Reuses the Owner Files admin session — the same gate the
 * admin map layer and Owner Files pages use, so a signed-in analytics/owner-files
 * admin never hits a second wall (single sign-on). An unauthenticated visitor
 * gets the same not-configured / password UX as Owner Files (never a 404).
 */

/** Reads the admin cookies once and reports whether the gate is configured and
 * whether the current request carries a valid session. */
export async function getInvestmentAdminState(): Promise<{ configured: boolean; hasSession: boolean }> {
  const configured = isOwnerFilesAdminConfigured();
  if (!configured) return { configured: false, hasSession: false };
  const cookieStore = await cookies();
  const hasSession = hasValidOwnerFilesAdminSession(
    cookieStore.get(OWNER_FILES_ADMIN_COOKIE)?.value,
    cookieStore.get(ANALYTICS_ADMIN_COOKIE)?.value,
  );
  return { configured: true, hasSession };
}

/** Shown when neither the Owner Files nor the analytics admin gate is configured. */
export function InvestmentNotConfigured() {
  return (
    <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
      <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6">
        <h1 className="font-editorial text-[38px]">Investment analysis not configured</h1>
        <p className="mt-3 text-[#0C1B33]/45">
          Set <code>OWNER_FILES_ADMIN_PASSWORD</code> (or the analytics admin password) before using the
          Investment &amp; Impact analysis.
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
      </form>
    </main>
  );
}
