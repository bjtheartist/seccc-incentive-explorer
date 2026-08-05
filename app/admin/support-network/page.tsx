import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { SupportNetworkDirectory } from "@/components/admin/SupportNetworkDirectory";
import {
  ANALYTICS_ADMIN_COOKIE,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
} from "@/lib/analytics-admin-auth";
import { supportNetworkDirectory } from "@/lib/support-network-directory";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chamber Support Network",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SupportNetworkPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const hasAuthError = paramValue(params.error) === "1";
  const cookieStore = await cookies();
  const hasSession = hasValidAnalyticsAdminSession(
    cookieStore.get(ANALYTICS_ADMIN_COOKIE)?.value
  );

  if (!isAnalyticsAdminConfigured()) {
    return (
      <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
        <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6">
          <h1 className="font-editorial text-[38px]">Chamber workspace not configured</h1>
          <p className="mt-3 text-[#0C1B33]/45">
            Set `ANALYTICS_ADMIN_PASSWORD` before using the private support-network directory.
          </p>
        </div>
      </main>
    );
  }

  if (!hasSession) {
    return (
      <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
        <form
          method="post"
          action="/api/admin/analytics/login"
          className="mx-auto max-w-md border border-[#0C1B33]/10 bg-white p-6"
        >
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#2563EB]">
            Private Chamber Workspace
          </span>
          <h1 className="mt-4 font-editorial text-[38px] leading-tight">
            Enter workspace password
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-[#0C1B33]/45">
            This view contains the chamber&apos;s working relationship and referral contacts.
          </p>
          <input type="hidden" name="redirectTo" value="/admin/support-network" />
          <input
            name="username"
            type="text"
            autoComplete="username"
            value="chamber-admin"
            readOnly
            tabIndex={-1}
            className="sr-only"
          />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            className="mt-5 w-full border border-[#0C1B33]/15 bg-white px-4 py-3 text-[14px] outline-none focus:border-[#2563EB]"
            placeholder="Workspace password"
          />
          {hasAuthError ? (
            <p className="mt-3 text-[12px] text-red-600">
              That password did not match. Try again.
            </p>
          ) : null}
          <button className="mt-4 w-full bg-[#0C1B33] px-4 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.16em] text-white">
            Open Directory
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
              South East Chicago Chamber of Commerce
            </span>
            <h1 className="mt-3 font-editorial text-[40px] leading-none sm:text-[48px]">
              Support Network Directory
            </h1>
            <p className="mt-4 max-w-3xl text-[14px] leading-relaxed text-[#0C1B33]/50">
              Public-source organization and contact research for referrals, partnership development, and local-resource coordination.
            </p>
          </div>
          <Link
            href="/admin/analytics"
            className="inline-flex h-11 items-center justify-center border border-[#0C1B33]/15 bg-white px-4 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55 hover:border-[#2563EB] hover:text-[#2563EB]"
          >
            Mission Analytics
          </Link>
        </div>

        <div className="mb-7 border border-amber-500/25 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-900">
          Relationship notes, outreach history, and private contact details belong in the protected Chamber CRM and are not stored in this repository.
        </div>

        <SupportNetworkDirectory
          organizations={supportNetworkDirectory.organizations}
          generatedAt={supportNetworkDirectory.generatedAt}
        />
      </div>
    </main>
  );
}
