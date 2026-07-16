import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";
import { listOwnerClusters } from "@/lib/owner-file";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const CONFIDENCE_BADGE: Record<string, string> = {
  High: "bg-[#DCFCE7] text-[#16A34A]",
  Medium: "bg-[#FEF3C7] text-[#D97706]",
  Low: "bg-[#0C1B33]/5 text-[#0C1B33]/45",
};

export default async function OwnerFilesIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ zip: string }>;
  searchParams: SearchParams;
}) {
  const { zip } = await params;
  if (!/^\d{5}$/.test(zip)) notFound();

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
  const hasSession = hasValidOwnerFilesAdminSession(cookieStore.get(OWNER_FILES_ADMIN_COOKIE)?.value);

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
          <input type="hidden" name="redirectTo" value={`/admin/owner-files/${zip}`} />
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
          <button className="mt-4 w-full bg-[#0C1B33] px-4 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.16em] text-white">
            Open Owner Files
          </button>
        </form>
      </main>
    );
  }

  // Same data source as /api/corridor/owners (lib/corridor-owners.ts) — live
  // DB first, then the committed static export.
  const clusters = (await listOwnerClusters(zip, 200))
    .slice()
    .sort((a, b) => b.vacantParcelCount - a.vacantParcelCount);

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-6 flex items-center gap-1.5 font-mono-bureau text-[12px] text-[#0C1B33]/50">
          <Link href="/admin" className="hover:text-[#2563EB]">
            Admin
          </Link>
          <span>/</span>
          <span className="text-[#0C1B33]/80">Owner Files — ZIP {zip}</span>
        </nav>

        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          Who Owns It?
        </span>
        <h1 className="mt-3 font-editorial text-[44px] leading-none sm:text-[56px]">
          Owner Files — ZIP {zip}
        </h1>
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[#0C1B33]/45">
          Ownership clusters over vacant parcels in this ZIP, ranked by vacant-parcel footprint. Records
          indicate — verify before relying; each Owner File carries its own confidence tier.
        </p>

        <div className="mt-8 divide-y divide-[#0C1B33]/8 border border-[#0C1B33]/10 bg-white">
          {clusters.length === 0 ? (
            <p className="p-6 text-[13px] text-[#0C1B33]/45">No ownership clusters found for ZIP {zip} yet.</p>
          ) : (
            clusters.map((cluster) => (
              <Link
                key={cluster.clusterKey}
                href={`/admin/owner-files/${zip}/${encodeURIComponent(cluster.clusterKey)}`}
                className="flex flex-col gap-3 p-5 transition-colors hover:bg-[#FAF9F6] sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-editorial text-[20px] text-[#0C1B33]">
                    {cluster.ownerName || "Owner record unavailable"}
                  </p>
                  <p className="mt-1 text-[12px] text-[#0C1B33]/45">
                    {cluster.ownerMailingAddress || "Mailing address unavailable"}
                  </p>
                  {cluster.sampleAddresses.length > 0 && (
                    <p className="mt-1 text-[11px] text-[#0C1B33]/35">
                      {cluster.sampleAddresses.slice(0, 2).join("; ")}
                      {cluster.parcelCount > 2 ? ` +${cluster.parcelCount - 2} more` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 font-mono-bureau text-[11px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
                  <span>
                    {cluster.vacantParcelCount} vacant / {cluster.parcelCount} parcels
                  </span>
                  <span className={`px-2 py-1 ${CONFIDENCE_BADGE[cluster.confidence] ?? CONFIDENCE_BADGE.Low}`}>
                    {cluster.confidence}
                  </span>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
