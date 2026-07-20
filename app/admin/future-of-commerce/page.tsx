import Link from "next/link";
import { cookies } from "next/headers";
import { Download, Mail, MapPin, Users } from "lucide-react";
import {
  ANALYTICS_ADMIN_COOKIE,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
} from "@/lib/analytics-admin-auth";
import { getFutureCommerceSignupAdminData } from "@/lib/future-commerce-signup-storage";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function FutureCommerceAdminPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const hasAuthError = paramValue(params.error) === "1";
  const cookieStore = await cookies();
  const hasSession = hasValidAnalyticsAdminSession(
    cookieStore.get(ANALYTICS_ADMIN_COOKIE)?.value,
  );

  if (!isAnalyticsAdminConfigured()) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
        <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6">
          <h1 className="font-editorial text-[38px]">Signup list not configured</h1>
          <p className="mt-3 text-[#0C1B33]/45">
            Set `ANALYTICS_ADMIN_PASSWORD` before using this private list.
          </p>
        </div>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
        <form
          method="post"
          action="/api/admin/analytics/login"
          className="mx-auto max-w-md border border-[#0C1B33]/10 bg-white p-6"
        >
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#2563EB]">
            Private Event List
          </span>
          <h1 className="mt-4 font-editorial text-[38px]">Enter dashboard password</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-[#0C1B33]/45">
            This list contains attendee contact and location information.
          </p>
          <input type="hidden" name="redirectTo" value="/admin/future-of-commerce" />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            className="mt-5 w-full border border-[#0C1B33]/15 bg-white px-4 py-3 text-[14px] outline-none focus:border-[#2563EB]"
            placeholder="Dashboard password"
          />
          {hasAuthError ? (
            <p className="mt-3 text-[12px] text-red-600">
              That password did not match. Try again.
            </p>
          ) : null}
          <button className="mt-4 w-full bg-[#0C1B33] px-4 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.16em] text-white">
            Open Signup List
          </button>
        </form>
      </div>
    );
  }

  const data = await getFutureCommerceSignupAdminData();
  const latest = data.rows[0]?.signedUpAt;

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-5 border-b border-[#0C1B33]/10 pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
              CommuniData + Chicago Incentive Explorer
            </span>
            <h1 className="mt-3 font-editorial text-[44px] leading-none sm:text-[58px]">
              Future of Commerce Signups
            </h1>
            <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[#0C1B33]/48">
              Private, consented event contacts. Location details are shown here only for follow-up and geographic understanding.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/analytics"
              className="inline-flex h-11 items-center border border-[#0C1B33]/12 bg-white px-4 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55"
            >
              Analytics
            </Link>
            <a
              href="/api/admin/future-of-commerce-signups?format=csv"
              className="inline-flex h-11 items-center gap-2 bg-[#0C1B33] px-4 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-white"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download CSV
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 py-7 sm:grid-cols-3">
          <div className="border border-[#0C1B33]/10 bg-white p-5">
            <Users className="h-5 w-5 text-[#2563EB]" aria-hidden="true" />
            <div className="mt-4 font-editorial text-[36px] leading-none">{data.total}</div>
            <p className="mt-2 font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/38">
              Active signups
            </p>
          </div>
          <div className="border border-[#0C1B33]/10 bg-white p-5">
            <MapPin className="h-5 w-5 text-[#16A34A]" aria-hidden="true" />
            <div className="mt-4 font-editorial text-[36px] leading-none">
              {data.neighborhoods.length}
            </div>
            <p className="mt-2 font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/38">
              Neighborhoods represented
            </p>
          </div>
          <div className="border border-[#0C1B33]/10 bg-white p-5">
            <Mail className="h-5 w-5 text-[#F59E0B]" aria-hidden="true" />
            <div className="mt-4 text-[16px] font-medium leading-6">
              {latest ? formatDate(latest) : "No signups yet"}
            </div>
            <p className="mt-2 font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/38">
              Latest signup
            </p>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_260px]">
          <div className="overflow-x-auto border border-[#0C1B33]/10 bg-white">
            <table className="w-full min-w-[840px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#0C1B33]/10 font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/38">
                  <th className="px-4 py-3">Email address</th>
                  <th className="px-4 py-3">Neighborhood</th>
                  <th className="px-4 py-3">Business or project address</th>
                  <th className="px-4 py-3">ZIP</th>
                  <th className="px-4 py-3">Signed up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0C1B33]/6">
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[#0C1B33]/38">
                      No signups yet.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 font-medium text-[#0C1B33]/72">{row.email}</td>
                      <td className="px-4 py-3 text-[#0C1B33]/58">{row.neighborhood}</td>
                      <td className="px-4 py-3 text-[#0C1B33]/58">{row.address}</td>
                      <td className="px-4 py-3 font-mono-bureau text-[10px] text-[#0C1B33]/48">
                        {row.zipCode}
                      </td>
                      <td className="px-4 py-3 text-[#0C1B33]/45">{formatDate(row.signedUpAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <aside className="border-t-2 border-[#16A34A] bg-white p-5">
            <h2 className="font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#0C1B33]">
              Neighborhoods
            </h2>
            <div className="mt-4 divide-y divide-[#0C1B33]/6">
              {data.neighborhoods.length === 0 ? (
                <p className="py-3 text-[12px] text-[#0C1B33]/35">No location data yet.</p>
              ) : (
                data.neighborhoods.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 py-3">
                    <span className="text-[12px] text-[#0C1B33]/62">{row.label}</span>
                    <span className="font-mono-bureau text-[10px] text-[#0C1B33]/38">
                      {row.count}
                    </span>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
