import Link from "next/link";
import { cookies } from "next/headers";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";
import { ANALYTICS_ADMIN_COOKIE } from "@/lib/analytics-admin-auth";
import { listOwnerClusters } from "@/lib/owner-file";
import { loadStaticOwnerClustersGeneratedAt } from "@/lib/corridor-owners";
import { PILOT_ZIPS } from "@/lib/pilot-zips";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Owner Files landing page — the neighborhood-first entry point above the
 * 9 pilot-ZIP dossier lists (app/admin/owner-files/[zip]/page.tsx). Gated
 * identically to every other Owner Files route (shared-password session,
 * lib/owner-files-admin-auth.ts); the per-ZIP cluster counts/vacant totals
 * come from the same listOwnerClusters data source as the ZIP page and the
 * admin map layer (live DB first, then the committed static export).
 */
export default async function OwnerFilesLandingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const hasAuthError = paramValue(sp.error) === "1";

  if (!isOwnerFilesAdminConfigured()) {
    return (
      <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
        <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6">
          <h1 className="font-editorial text-[38px]">Owner Files not configured</h1>
          <p className="mt-3 text-[#0C1B33]/45">
            Set <code>OWNER_FILES_ADMIN_PASSWORD</code> before using the Owner Files admin tool.
          </p>
        </div>
      </main>
    );
  }

  const cookieStore = await cookies();
  const hasSession = hasValidOwnerFilesAdminSession(
    cookieStore.get(OWNER_FILES_ADMIN_COOKIE)?.value,
    cookieStore.get(ANALYTICS_ADMIN_COOKIE)?.value
  );

  if (!hasSession) {
    return (
      <main className="min-h-screen bg-[#FAF9F6] px-6 py-12 text-[#0C1B33]">
        <form
          method="post"
          action="/api/admin/owner-files/login"
          className="mx-auto max-w-md border border-[#0C1B33]/10 bg-white p-6"
        >
          <span className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-[#2563EB]">
            Owner Files
          </span>
          <h1 className="mt-4 font-editorial text-[38px]">Enter admin password</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-[#0C1B33]/45">
            Owner Files carry named ownership records — mailing addresses, IL SOS lookups, and outreach
            history. Access is restricted to corridor-management partners.
          </p>
          <input type="hidden" name="redirectTo" value="/admin/owner-files" />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            className="mt-5 w-full border border-[#0C1B33]/15 bg-white px-4 py-3 text-[14px] outline-none focus:border-[#2563EB]"
            placeholder="Owner Files password"
          />
          {hasAuthError ? (
            <p className="mt-3 text-[12px] text-red-600">That password did not match. Try again.</p>
          ) : null}
          <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/45">
            Your analytics admin session also opens Owner Files — log in there once and this gate
            disappears.
          </p>
          <button className="mt-4 w-full bg-[#0C1B33] px-4 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.16em] text-white">
            Open Owner Files
          </button>
        </form>
      </main>
    );
  }

  const zipSummaries = await Promise.all(
    PILOT_ZIPS.map(async (entry) => {
      const clusters = await listOwnerClusters(entry.zip, 200);
      const totalVacant = clusters.reduce((sum, cluster) => sum + cluster.vacantParcelCount, 0);
      return { ...entry, clusterCount: clusters.length, totalVacant };
    })
  );
  const snapshotGeneratedAt = loadStaticOwnerClustersGeneratedAt();

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-6 flex items-center justify-between gap-1.5 font-mono-bureau text-[12px] text-[#0C1B33]/50">
          <div className="flex items-center gap-1.5">
            <Link href="/admin" className="hover:text-[#2563EB]">
              Admin
            </Link>
            <span>/</span>
            <span className="text-[#0C1B33]/80">Owner Files</span>
          </div>
          <Link href="/admin/analytics" className="hover:text-[#2563EB]">
            Analytics
          </Link>
        </nav>

        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          Who Owns It?
        </span>
        <h1 className="mt-3 font-editorial text-[44px] leading-none sm:text-[56px]">Owner Files</h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[#0C1B33]/45">
          Named ownership clusters over vacant parcels across the nine pilot ZIPs, organized by
          neighborhood. Records indicate — verify before relying; each Owner File carries its own
          confidence tier.
        </p>
        <p className="mt-2 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/35">
          {snapshotGeneratedAt
            ? `Records snapshot as of ${new Date(snapshotGeneratedAt).toLocaleDateString("en-US")} — records indicate, verify before relying.`
            : "Records snapshot date unavailable — records indicate, verify before relying."}
        </p>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {zipSummaries.map((entry) => (
            <Link
              key={entry.zip}
              href={`/admin/owner-files/${entry.zip}`}
              className="flex flex-col border border-[#0C1B33]/10 bg-white p-5 transition-colors hover:border-[#2563EB]/40 hover:bg-[#FAF9F6]"
            >
              <p className="font-editorial text-[26px] leading-tight text-[#0C1B33]">
                {entry.primaryNeighborhood}
              </p>
              <p className="mt-1 font-mono-bureau text-[11px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                ZIP {entry.zip}
              </p>
              {entry.secondaryAreas.length > 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/40">
                  Also covers {entry.secondaryAreas.join(" · ")}
                </p>
              )}
              <div className="mt-4 flex items-center gap-3 font-mono-bureau text-[11px] uppercase tracking-[0.1em] text-[#0C1B33]/60">
                <span>{entry.clusterCount} clusters</span>
                <span>{entry.totalVacant} vacant parcels</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
