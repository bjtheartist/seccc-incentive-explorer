import Link from "next/link";
import { cookies } from "next/headers";
import { getSQL } from "@/lib/db";
import {
  ANALYTICS_ADMIN_COOKIE,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
} from "@/lib/analytics-admin-auth";
import {
  getAnalyticsDashboardData,
  normalizeAnalyticsWindow,
  type AnalyticsDashboardSummary,
} from "@/lib/analytics-dashboard";
import {
  PRACTITIONER_VALIDATION_CASES,
  practitionerValidationStartPath,
} from "@/lib/practitioner-validation";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" ? value.toLocaleString() : "n/a";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function dashboardHref(days: number, mode: "founder" | "partner") {
  const params = new URLSearchParams({ days: String(days), mode });
  return `/admin/analytics?${params.toString()}`;
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5">
      <span className="font-mono-bureau text-[9px] tracking-[0.18em] uppercase text-[#0C1B33]/35">
        {label}
      </span>
      <div className="mt-3 font-editorial text-[34px] leading-none text-[#0C1B33]">
        {value}
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/45">{detail}</p>
    </div>
  );
}

function RankingList({
  title,
  rows,
  empty = "No activity yet.",
}: {
  title: string;
  rows: { label: string; count: number }[];
  empty?: string;
}) {
  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5">
      <h2 className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#0C1B33]">
        {title}
      </h2>
      <div className="mt-4 divide-y divide-[#0C1B33]/6">
        {rows.length === 0 ? (
          <p className="py-3 text-[12px] text-[#0C1B33]/35">{empty}</p>
        ) : (
          rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-3">
              <span className="text-[13px] text-[#0C1B33]/65">{row.label}</span>
              <span className="font-mono-bureau text-[11px] text-[#0C1B33]/40">
                {row.count.toLocaleString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TrafficTable({
  title,
  rows,
  mode,
}: {
  title: string;
  rows: { day?: string; weekStart?: string; pageViews: number; uniqueVisitorSessions: number }[];
  mode: "daily" | "weekly";
}) {
  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5">
      <h2 className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#0C1B33]">
        {title}
      </h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[360px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-[#0C1B33]/8 font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/35">
              <th className="py-2 pr-4">{mode === "daily" ? "Day" : "Week"}</th>
              <th className="py-2 pr-4">Page Views</th>
              <th className="py-2 pr-4">Visitors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0C1B33]/5">
            {rows.length === 0 ? (
              <tr>
                <td className="py-3 pr-4 text-[#0C1B33]/35" colSpan={3}>
                  No traffic events captured yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const key = row.day || row.weekStart || "unknown";
                return (
                  <tr key={`${mode}-${key}`}>
                    <td className="py-3 pr-4 text-[#0C1B33]/55">
                      {formatDay(key)}
                    </td>
                    <td className="py-3 pr-4 font-mono-bureau text-[11px] text-[#0C1B33]/45">
                      {row.pageViews.toLocaleString()}
                    </td>
                    <td className="py-3 pr-4 font-mono-bureau text-[11px] text-[#0C1B33]/45">
                      {row.uniqueVisitorSessions.toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeviceBreakdown({
  rows,
}: {
  rows: { label: string; count: number; percent: number }[];
}) {
  return (
    <div className="border border-[#0C1B33]/10 bg-white p-5">
      <h2 className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#0C1B33]">
        Device Breakdown
      </h2>
      <div className="mt-4 divide-y divide-[#0C1B33]/6">
        {rows.length === 0 ? (
          <p className="py-3 text-[12px] text-[#0C1B33]/35">
            No device data captured yet.
          </p>
        ) : (
          rows.map((row) => (
            <div key={row.label} className="py-3">
              <div className="mb-2 flex items-center justify-between gap-4">
                <span className="capitalize text-[13px] text-[#0C1B33]/65">
                  {row.label}
                </span>
                <span className="font-mono-bureau text-[11px] text-[#0C1B33]/40">
                  {row.count.toLocaleString()} · {row.percent}%
                </span>
              </div>
              <div className="h-1.5 bg-[#0C1B33]/5">
                <div
                  className="h-full bg-[#2563EB]"
                  style={{ width: `${Math.max(row.percent, row.count > 0 ? 4 : 0)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ValidationPilotPanel({
  data,
}: {
  data: AnalyticsDashboardSummary["validationPilot"];
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#2563EB]">
            Five-case learning sprint
          </span>
          <h2 className="mt-2 font-editorial text-[30px] leading-tight text-[#0C1B33]">
            Practitioner Validation
          </h2>
        </div>
        <p className="max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/45">
          Campaign-tagged product events only. Requests are recorded requests awaiting review and
          routing, not acknowledgments, completed connections, approvals, or outcomes.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Pilot Starts"
          value={formatNumber(data.totals.starts)}
          detail="Visits to one of the five facilitated case links. This is an event count, not a participant count."
        />
        <MetricCard
          label="Searches"
          value={formatNumber(data.totals.searches)}
          detail="Address or business searches carrying a recognized validation campaign."
        />
        <MetricCard
          label="Reports Generated"
          value={formatNumber(data.totals.reportsGenerated)}
          detail="Distinct campaign-tagged report keys generated during pilot sessions."
        />
        <MetricCard
          label="Support Viewed"
          value={formatNumber(data.totals.supportViews)}
          detail="Distinct pilot reports where the local-support section was surfaced."
        />
        <MetricCard
          label="Support Actions"
          value={formatNumber(data.totals.supportActions)}
          detail="Distinct pilot reports with a support or financing-resource contact action."
        />
        <MetricCard
          label="Requests Recorded"
          value={formatNumber(data.totals.requestsRecorded)}
          detail={`${data.totals.introductionRequests} introduction and ${data.totals.materialsReviewRequests} 1:1 review request events recorded.`}
        />
      </div>

      <div className="overflow-x-auto border border-[#0C1B33]/10 bg-white p-5">
        <table className="w-full min-w-[920px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-[#0C1B33]/8 font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/35">
              <th className="py-2 pr-4">Case</th>
              <th className="py-2 pr-4">Starts</th>
              <th className="py-2 pr-4">Searches</th>
              <th className="py-2 pr-4">Reports</th>
              <th className="py-2 pr-4">Support viewed</th>
              <th className="py-2 pr-4">Support actions</th>
              <th className="py-2 pr-4">Requests recorded</th>
              <th className="py-2">Session link</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0C1B33]/5">
            {data.cases.map((row) => {
              const validationCase = PRACTITIONER_VALIDATION_CASES.find(
                (item) => item.id === row.caseId,
              );
              return (
                <tr key={row.caseId}>
                  <td className="py-3 pr-4 font-medium text-[#0C1B33]/70">{row.label}</td>
                  <td className="py-3 pr-4 font-mono-bureau text-[#0C1B33]/45">{row.starts}</td>
                  <td className="py-3 pr-4 font-mono-bureau text-[#0C1B33]/45">{row.searches}</td>
                  <td className="py-3 pr-4 font-mono-bureau text-[#0C1B33]/45">{row.reportsGenerated}</td>
                  <td className="py-3 pr-4 font-mono-bureau text-[#0C1B33]/45">{row.supportViews}</td>
                  <td className="py-3 pr-4 font-mono-bureau text-[#0C1B33]/45">{row.supportActions}</td>
                  <td className="py-3 pr-4 font-mono-bureau text-[#0C1B33]/45">{row.requestsRecorded}</td>
                  <td className="py-3">
                    {validationCase ? (
                      <Link
                        href={practitionerValidationStartPath(validationCase)}
                        className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#2563EB] hover:underline"
                      >
                        Open case
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FounderView({ data }: { data: AnalyticsDashboardSummary }) {
  const funnel = [
    { label: "Searches", value: data.totals.searches },
    { label: "Snapshot requests", value: data.totals.snapshotRequests },
    { label: "Reports generated", value: data.totals.reportsGenerated },
    { label: "Reports acted on", value: data.totals.activatedReports },
    { label: "Resource contacts", value: data.totals.localResourceConnections },
  ];
  const maxFunnel = Math.max(...funnel.map((item) => item.value), 1);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Site Page Views"
          value={formatNumber(data.totals.pageViews)}
          detail="First-party page views tracked across public pages. Admin traffic is excluded."
        />
        <MetricCard
          label="Visitor Sessions"
          value={formatNumber(data.totals.uniqueVisitorSessions)}
          detail="Anonymous browser sessions in this window, useful as a lightweight traffic proxy."
        />
        <MetricCard
          label="Weekly Traffic Rows"
          value={formatNumber(data.weeklyTraffic.length)}
          detail="Weeks with tracked public page activity inside the selected date range."
        />
        <MetricCard
          label="Top Page"
          value={data.topPages[0]?.label || "n/a"}
          detail="Most viewed public page among first-party traffic events."
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <TrafficTable title="Daily Traffic" rows={data.dailyTraffic} mode="daily" />
        <TrafficTable title="Weekly Traffic" rows={data.weeklyTraffic} mode="weekly" />
        <RankingList title="Top Pages" rows={data.topPages} />
        <DeviceBreakdown rows={data.deviceBreakdown} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Activation Rate"
          value={`${data.totals.activationRate}%`}
          detail="Activated reports divided by generated reports. Activation means someone took a post-report action."
        />
        <MetricCard
          label="Local Resource Connections"
          value={formatNumber(data.totals.localResourceConnections)}
          detail="Clicks to support organizations, contact methods, or resource links surfaced inside reports."
        />
        <MetricCard
          label="Financing Resources Shown"
          value={formatNumber(data.totals.capitalPartnerReferralsShown)}
          detail="Reports where a potentially relevant financing resource was surfaced for consideration."
        />
        <MetricCard
          label="Financing Resource Actions"
          value={formatNumber(
            data.totals.capitalPartnerClicks + data.totals.capitalPartnerContactsStarted,
          )}
          detail="Tracked visits, calls, or emails toward a surfaced financing resource."
        />
      </div>

      <div className="border border-[#0C1B33]/10 bg-white p-5">
        <h2 className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#0C1B33]">
          Discovery To Action Funnel
        </h2>
        <div className="mt-5 space-y-4">
          {funnel.map((step) => (
            <div key={step.label}>
              <div className="mb-1 flex items-center justify-between gap-4">
                <span className="text-[13px] text-[#0C1B33]/60">{step.label}</span>
                <span className="font-mono-bureau text-[11px] text-[#0C1B33]/40">
                  {step.value.toLocaleString()}
                </span>
              </div>
              <div className="h-2 bg-[#0C1B33]/5">
                <div
                  className="h-full bg-[#2563EB]"
                  style={{ width: `${Math.max((step.value / maxFunnel) * 100, step.value > 0 ? 4 : 0)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <ValidationPilotPanel data={data.validationPilot} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RankingList title="Top Report Types" rows={data.reportsByType} />
        <RankingList title="Top Neighborhoods / ZIPs" rows={data.topNeighborhoods} />
        <RankingList title="Program Links Clicked" rows={data.topPrograms} />
        <RankingList title="Support Organizations Clicked" rows={data.topSupportOrganizations} />
        <RankingList title="Financing Resources Contacted" rows={data.topCapitalPartners} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-4">
        <div className="border border-[#0C1B33]/10 bg-white p-5">
          <h2 className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#0C1B33]">
            Recent Activity
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#0C1B33]/8 font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/35">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Event</th>
                  <th className="py-2 pr-4">Address / Area</th>
                  <th className="py-2 pr-4">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0C1B33]/5">
                {data.recentActivity.map((item) => (
                  <tr key={`${item.createdAt}-${item.eventType}-${item.summary}`}>
                    <td className="py-3 pr-4 text-[#0C1B33]/35">{formatDate(item.createdAt)}</td>
                    <td className="py-3 pr-4 font-mono-bureau text-[10px] text-[#0C1B33]/55">
                      {item.eventType}
                    </td>
                    <td className="py-3 pr-4 text-[#0C1B33]/45">{item.address || "n/a"}</td>
                    <td className="py-3 pr-4 text-[#0C1B33]/60">{item.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border border-[#0C1B33]/10 bg-white p-5">
          <h2 className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#0C1B33]">
            Report Recipients
          </h2>
          <div className="mt-4 divide-y divide-[#0C1B33]/6">
            {data.followUpQueue.length === 0 ? (
              <p className="py-3 text-[12px] text-[#0C1B33]/35">
                No report recipients captured yet.
              </p>
            ) : (
              data.followUpQueue.map((lead) => (
                <div key={`${lead.email}-${lead.createdAt}`} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-semibold text-[#0C1B33]">{lead.name}</p>
                      <p className="text-[12px] text-[#0C1B33]/45">{lead.email}</p>
                    </div>
                    <span className={`font-mono-bureau text-[10px] ${
                      lead.wantsIncentiveHelp ? "text-[#2563EB]" : "text-[#0C1B33]/35"
                    }`}>
                      {lead.wantsIncentiveHelp ? "Help requested" : "Delivery only"}
                    </span>
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-[#0C1B33]/40">
                    {lead.reportTitle || lead.reportAddress || "Report inquiry"}
                  </p>
                  {lead.projectGoal && (
                    <p className="mt-1 text-[12px] leading-relaxed text-[#0C1B33]/50">
                      Primary goal: {lead.projectGoal}
                    </p>
                  )}
                  <p className="mt-1 font-mono-bureau text-[10px] text-[#0C1B33]/30">
                    {lead.zipCode || "ZIP not provided"}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PartnerView({ data }: { data: AnalyticsDashboardSummary }) {
  return (
    <div className="space-y-6">
      <div className="border border-[#0C1B33]/10 bg-white p-6">
        <span className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#2563EB]">
          Partner-ready summary
        </span>
        <h2 className="mt-4 font-editorial text-[34px] leading-tight text-[#0C1B33]">
          {data.partnerSummary.headline}
        </h2>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard
            label="Reports Generated"
            value={formatNumber(data.totals.reportsGenerated)}
            detail="Address, vacancy, and project-aware reports generated."
          />
          <MetricCard
            label="Reports Acted On"
            value={formatNumber(data.totals.activatedReports)}
            detail="Reports that led to a save, email, download, inquiry, export, or support click."
          />
          <MetricCard
            label="Resource Connections"
            value={formatNumber(data.totals.localResourceConnections)}
            detail="Tracked clicks toward local support organizations and contact pathways."
          />
          <MetricCard
            label="Financing Resources Shown"
            value={formatNumber(data.totals.capitalPartnerReferralsShown)}
            detail="Reports that surfaced a potentially relevant financing resource."
          />
        </div>
      </div>

      <div className="border border-[#0C1B33]/10 bg-white p-6">
        <h2 className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#0C1B33]">
          Copy For Partner Update
        </h2>
        <div className="mt-4 rounded-none border border-[#0C1B33]/8 bg-[#FAF9F6] p-5 text-[14px] leading-relaxed text-[#0C1B33]/65">
          <p>{data.partnerSummary.headline}</p>
          <ul className="mt-4 list-disc space-y-2 pl-5">
            {data.partnerSummary.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          <p className="mt-4 text-[12px] text-[#0C1B33]/40">
            These are product-usage and connection signals, not proof that a business received capital or won an incentive.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RankingList title="Neighborhoods / ZIPs Reached" rows={data.topNeighborhoods} />
        <RankingList title="Support Organizations Clicked" rows={data.topSupportOrganizations} />
        <RankingList title="Financing Resources Contacted" rows={data.topCapitalPartners} />
      </div>
    </div>
  );
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const mode = paramValue(params.mode) === "partner" ? "partner" : "founder";
  const days = normalizeAnalyticsWindow(Number(paramValue(params.days) ?? 30));
  const hasAuthError = paramValue(params.error) === "1";
  const currentPath = dashboardHref(days, mode);
  const cookieStore = await cookies();
  const hasSession = hasValidAnalyticsAdminSession(
    cookieStore.get(ANALYTICS_ADMIN_COOKIE)?.value
  );

  if (!isAnalyticsAdminConfigured()) {
    return (
      <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
        <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6">
          <h1 className="font-editorial text-[38px]">Analytics not configured</h1>
          <p className="mt-3 text-[#0C1B33]/45">
            Set `ANALYTICS_ADMIN_PASSWORD` before using the private analytics dashboard.
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
          <span className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#2563EB]">
            Private Analytics
          </span>
          <h1 className="mt-4 font-editorial text-[38px]">Enter dashboard password</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-[#0C1B33]/45">
            This view includes founder-facing product usage and follow-up signals.
          </p>
          <input type="hidden" name="redirectTo" value={currentPath} />
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
            Open Dashboard
          </button>
        </form>
      </main>
    );
  }

  const sql = getSQL();
  if (!sql) {
    return (
      <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
        <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6">
          <h1 className="font-editorial text-[38px]">Database not configured</h1>
          <p className="mt-3 text-[#0C1B33]/45">
            The analytics dashboard needs `DATABASE_URL` to read product events.
          </p>
        </div>
      </main>
    );
  }

  const data = await getAnalyticsDashboardData(sql, days);

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#2563EB]">
              Chicago Incentive Explorer
            </span>
            <h1 className="mt-3 font-editorial text-[44px] leading-none sm:text-[64px]">
              Mission Analytics
            </h1>
            <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[#0C1B33]/45">
              Measures whether the tool moves people from incentive discovery to useful next steps, especially finding local support partners they can contact.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/support-network"
              className="border border-[#2563EB] bg-[#2563EB] px-3 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-white"
            >
              Support Directory
            </Link>
            {[7, 30, 90, 365].map((option) => (
              <Link
                key={option}
                href={dashboardHref(option, mode)}
                className={`border px-3 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] ${
                  days === option
                    ? "border-[#0C1B33] bg-[#0C1B33] text-white"
                    : "border-[#0C1B33]/12 bg-white text-[#0C1B33]/45"
                }`}
              >
                {option}d
              </Link>
            ))}
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Link
              href={dashboardHref(days, "founder")}
              className={`border px-4 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] ${
                mode === "founder"
                  ? "border-[#2563EB] bg-[#2563EB] text-white"
                  : "border-[#0C1B33]/12 bg-white text-[#0C1B33]/45"
              }`}
            >
              Founder View
            </Link>
            <Link
              href={dashboardHref(days, "partner")}
              className={`border px-4 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] ${
                mode === "partner"
                  ? "border-[#2563EB] bg-[#2563EB] text-white"
                  : "border-[#0C1B33]/12 bg-white text-[#0C1B33]/45"
              }`}
            >
              Partner Summary
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/owner-files"
              className="border border-[#0C1B33]/12 bg-white px-4 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45"
            >
              Owner Files
            </Link>
            <Link
              href="/investment"
              className="border border-[#0C1B33]/12 bg-white px-4 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45"
            >
              Investment Analysis
            </Link>
            <Link
              href="/admin/future-of-commerce"
              className="border border-[#0C1B33]/12 bg-white px-4 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45"
            >
              Event Signups
            </Link>
          </div>
        </div>

        {mode === "partner" ? <PartnerView data={data} /> : <FounderView data={data} />}
      </div>
    </main>
  );
}
