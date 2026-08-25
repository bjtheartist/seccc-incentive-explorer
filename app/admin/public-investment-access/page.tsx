import Link from "next/link";
import { cookies } from "next/headers";
import {
  ANALYTICS_ADMIN_COOKIE,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
} from "@/lib/analytics-admin-auth";
import {
  listPublicInvestmentEarlyAccessRequests,
  PublicInvestmentEarlyAccessStorageUnavailableError,
  type PublicInvestmentEarlyAccessRecord,
} from "@/lib/public-investment-early-access-storage";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_LABELS: Record<PublicInvestmentEarlyAccessRecord["status"], string> = {
  pending_verification: "Awaiting verification",
  pending_review: "Ready for review",
  approved: "Approved",
  denied: "Denied",
  revoked: "Revoked",
};

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Chicago",
      }).format(new Date(value))
    : "—";
}

function Login({ hasError }: { hasError: boolean }) {
  return (
    <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
      <form
        method="post"
        action="/api/admin/analytics/login"
        className="mx-auto max-w-md border border-[#0C1B33]/10 bg-white p-6"
      >
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#2563EB]">
          Private beta operations
        </span>
        <h1 className="mt-4 font-editorial text-[38px]">Public Investment access</h1>
        <p className="mt-3 text-[13px] leading-6 text-[#0C1B33]/48">
          Review verified requests, approve access, resend sign-in links, or revoke access.
        </p>
        <input type="hidden" name="redirectTo" value="/admin/public-investment-access" />
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          className="mt-5 w-full border border-[#0C1B33]/15 bg-white px-4 py-3 text-[14px] outline-none focus:border-[#2563EB]"
          placeholder="Dashboard password"
        />
        {hasError ? <p className="mt-3 text-[12px] text-red-600">That password did not match.</p> : null}
        <button className="mt-4 w-full bg-[#0C1B33] px-4 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.16em] text-white">
          Open access queue
        </button>
      </form>
    </main>
  );
}

function DecisionButton({
  id,
  decision,
  label,
  tone = "default",
}: {
  id: string;
  decision: "approve" | "deny" | "revoke" | "resend";
  label: string;
  tone?: "default" | "primary" | "danger";
}) {
  const classes =
    tone === "primary"
      ? "border-[#2563EB] bg-[#2563EB] text-white"
      : tone === "danger"
        ? "border-red-200 bg-white text-red-700"
        : "border-[#0C1B33]/15 bg-white text-[#0C1B33]/65";
  return (
    <form method="post" action={`/api/admin/public-investment-early-access/${id}/decision`}>
      <input type="hidden" name="decision" value={decision} />
      <button className={`border px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.12em] ${classes}`}>
        {label}
      </button>
    </form>
  );
}

export default async function PublicInvestmentAccessAdminPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const hasSession = hasValidAnalyticsAdminSession(
    cookieStore.get(ANALYTICS_ADMIN_COOKIE)?.value,
  );

  if (!isAnalyticsAdminConfigured()) {
    return (
      <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
        <p className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6">
          Set <code>ANALYTICS_ADMIN_PASSWORD</code> before using the access queue.
        </p>
      </main>
    );
  }
  if (!hasSession) return <Login hasError={paramValue(params.error) === "1"} />;

  let requests: PublicInvestmentEarlyAccessRecord[] = [];
  try {
    requests = await listPublicInvestmentEarlyAccessRequests();
  } catch (error) {
    if (!(error instanceof PublicInvestmentEarlyAccessStorageUnavailableError)) throw error;
  }

  const updated = paramValue(params.updated);
  const error = paramValue(params.error);
  const counts = requests.reduce(
    (current, request) => {
      if (request.status === "pending_review") current.ready += 1;
      if (request.status === "pending_verification") current.awaitingVerification += 1;
      if (request.status === "approved") current.approved += 1;
      return current;
    },
    { ready: 0, awaitingVerification: 0, approved: 0 },
  );

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
              Private beta operations
            </span>
            <h1 className="mt-3 font-editorial text-[44px] leading-none sm:text-[60px]">
              Public Investment access
            </h1>
            <p className="mt-4 max-w-2xl text-[13px] leading-6 text-[#0C1B33]/48">
              Only email-verified requests can be approved. Approval sends a 30-minute passwordless sign-in
              link; revocation takes effect on the next protected page request.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/admin/analytics"
              className="border border-[#0C1B33]/15 bg-white px-4 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55"
            >
              Analytics
            </Link>
            <a
              href="/api/admin/public-investment-early-access?format=csv"
              className="border border-[#0C1B33]/15 bg-white px-4 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55"
            >
              Export CSV
            </a>
          </div>
        </div>

        {updated ? (
          <p className="mt-6 border-l-2 border-[#16A34A] bg-[#F0FDF4] px-4 py-3 text-[13px] text-[#166534]">
            Access queue updated: {updated}.
          </p>
        ) : null}
        {error ? (
          <p className="mt-6 border-l-2 border-red-600 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            The request could not be updated ({error}).
          </p>
        ) : null}

        <div className="mt-8 grid gap-px border border-[#0C1B33]/10 bg-[#0C1B33]/10 sm:grid-cols-3">
          {[
            ["Ready for review", counts.ready],
            ["Awaiting verification", counts.awaitingVerification],
            ["Approved testers", counts.approved],
          ].map(([label, count]) => (
            <div key={label} className="bg-white p-4">
              <p className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/40">
                {label}
              </p>
              <p className="mt-2 font-editorial text-[34px] text-[#0C1B33]">{count}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 space-y-4">
          {requests.length === 0 ? (
            <p className="border border-[#0C1B33]/10 bg-white p-6 text-[14px] text-[#0C1B33]/50">
              No early-access requests yet.
            </p>
          ) : (
            requests.map((request) => (
              <article key={request.id} className="border border-[#0C1B33]/10 bg-white p-5 sm:p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-editorial text-[28px]">{request.name}</h2>
                      <span className="border border-[#0C1B33]/12 bg-[#F7F8FA] px-2 py-1 font-mono-bureau text-[8px] uppercase tracking-[0.12em] text-[#0C1B33]/55">
                        {STATUS_LABELS[request.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-[#0C1B33]/58">
                      {request.title} · {request.organization || "Organization not captured"}
                    </p>
                    <a href={`mailto:${request.email}`} className="mt-1 block text-[13px] text-[#2563EB]">
                      {request.email}
                    </a>
                    <p className="mt-4 max-w-3xl border-l-2 border-[#0C1B33]/10 pl-4 text-[13px] leading-6 text-[#0C1B33]/58">
                      {request.useCase || "Use case was not captured for this legacy request."}
                    </p>
                    <p className="mt-4 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/35">
                      Requested {formatDate(request.requestedAt)} · Verified {formatDate(request.emailVerifiedAt)} ·
                      Last invite {formatDate(request.lastInvitedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {request.status === "pending_review" || request.status === "denied" || request.status === "revoked" ? (
                      <DecisionButton id={request.id} decision="approve" label="Approve + invite" tone="primary" />
                    ) : null}
                    {request.status === "approved" ? (
                      <>
                        <DecisionButton id={request.id} decision="resend" label="Resend sign-in" />
                        <DecisionButton id={request.id} decision="revoke" label="Revoke" tone="danger" />
                      </>
                    ) : null}
                    {request.status === "pending_verification" || request.status === "pending_review" ? (
                      <DecisionButton id={request.id} decision="deny" label="Deny" tone="danger" />
                    ) : null}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
