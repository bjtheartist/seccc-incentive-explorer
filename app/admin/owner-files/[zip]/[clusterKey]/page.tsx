import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { ChevronRight } from "lucide-react";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";
import { ANALYTICS_ADMIN_COOKIE } from "@/lib/analytics-admin-auth";
import { getOwnerFile } from "@/lib/owner-file";
import { DataPendingRow, DataRow } from "@/components/corridors/CorridorSignalsUI";
import { OwnerFileViewTracker } from "@/components/owner-file/OwnerFileViewTracker";
import { OwnerFileVerificationForm } from "@/components/owner-file/OwnerFileVerificationForm";
import { OwnerFileDossierButton } from "@/components/owner-file/OwnerFileDossierButton";
import { OutreachLog } from "@/components/owner-file/OutreachLog";
import { clerkRecordsUrl, cookViewerUrl } from "@/lib/cook-viewer";

export const dynamic = "force-dynamic";

const TIER_STYLES: Record<string, string> = {
  A: "bg-[#DCFCE7] text-[#16A34A] border-[#16A34A]/30",
  B: "bg-[#2563EB]/10 text-[#2563EB] border-[#2563EB]/30",
  C: "bg-[#FEF3C7] text-[#D97706] border-[#D97706]/30",
  D: "bg-[#0C1B33]/5 text-[#0C1B33]/50 border-[#0C1B33]/15",
};

const TIER_DESCRIPTIONS: Record<string, string> = {
  A: "Human-verified entity with a current contact path (IL SOS lookup on file).",
  B: "Strong records match — grouped by recorded owner mailing address, unverified.",
  C: "Taxpayer-of-record only — grouped by recorded owner name, unverified.",
  D: "Conflicting or stale records; treat as a starting point for research, not a contact list.",
};

type Params = Promise<{ zip: string; clusterKey: string }>;

export default async function OwnerFileDetailPage({ params }: { params: Params }) {
  const { zip, clusterKey: rawClusterKey } = await params;
  // App Router route params arrive percent-encoded; cluster keys contain ':'.
  const clusterKey = decodeURIComponent(rawClusterKey);
  if (!/^\d{5}$/.test(zip)) notFound();

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
          <input
            type="hidden"
            name="redirectTo"
            value={`/admin/owner-files/${zip}/${encodeURIComponent(clusterKey)}`}
          />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            className="mt-5 w-full border border-[#0C1B33]/15 bg-white px-4 py-3 text-[14px] outline-none focus:border-[#2563EB]"
            placeholder="Owner Files password"
          />
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

  const ownerFile = await getOwnerFile(zip, clusterKey);
  if (!ownerFile) notFound();

  const { cluster, verification, notes, outreachEvents, resolvedTier, isEntityOwner, snapshotGeneratedAt } =
    ownerFile;
  const ds = cluster.distressSignals;

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <OwnerFileViewTracker zip={zip} clusterKey={clusterKey} resolvedTier={resolvedTier} />

      <div className="mx-auto max-w-5xl">
        <nav className="mb-6 flex items-center gap-1.5 font-mono-bureau text-[12px] text-[#0C1B33]/50">
          <Link href="/admin" className="hover:text-[#2563EB]">
            Admin
          </Link>
          <ChevronRight className="h-3 w-3" />
          <Link href={`/admin/owner-files/${zip}`} className="hover:text-[#2563EB]">
            Owner Files — ZIP {zip}
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-[#0C1B33]/80">{cluster.ownerName || "Owner record unavailable"}</span>
        </nav>

        {/* Identity header */}
        <div className="border border-[#0C1B33]/10 bg-white p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#2563EB]">
                Owner File
              </span>
              <h1 className="mt-2 font-editorial text-[36px] leading-tight text-[#0C1B33] sm:text-[44px]">
                {cluster.ownerName || "Owner record unavailable"}
              </h1>
              <p className="mt-2 text-[14px] text-[#0C1B33]/55">
                {cluster.ownerMailingAddress || "Mailing address unavailable"}
              </p>
              <p className="mt-1 font-mono-bureau text-[11px] uppercase tracking-[0.12em] text-[#0C1B33]/35">
                {cluster.ownerType || "Owner type not recorded"}
              </p>
            </div>
            <div className={`shrink-0 border px-4 py-3 text-center ${TIER_STYLES[resolvedTier]}`}>
              <p className="font-mono-bureau text-[10px] uppercase tracking-[0.14em]">Confidence tier</p>
              <p className="font-editorial text-[32px] leading-none">{resolvedTier}</p>
            </div>
          </div>
          <p className="mt-4 max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/45">
            {TIER_DESCRIPTIONS[resolvedTier]} Records indicate — verify before relying.
          </p>
          <p className="mt-2 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/35">
            {snapshotGeneratedAt
              ? `Records snapshot as of ${new Date(snapshotGeneratedAt).toLocaleDateString("en-US")} — records indicate, verify before relying.`
              : "Records snapshot date unavailable — records indicate, verify before relying."}
          </p>
          {!isEntityOwner && (
            <div className="mt-4 border border-amber-500/30 bg-amber-500/10 px-5 py-4">
              <p className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-amber-700">
                Individually owned
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#0C1B33]/70">
                Individually owned (public taxpayer record). Automated outreach letters are reserved for
                entity owners — coordinate personal contact through a local partner. Completing an IL SOS
                lookup that shows this owner is a registered entity will unlock letters.
              </p>
            </div>
          )}
          <div className="mt-5">
            <OwnerFileDossierButton ownerFile={ownerFile} />
          </div>
        </div>

        {/* Parcels */}
        <section className="mt-6">
          <h2 className="font-editorial text-[24px] text-[#0C1B33]">Parcels</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <DataRow
              label="Parcel footprint"
              value={`${cluster.parcelCount} parcels`}
              detail={`${cluster.vacantParcelCount} carry a vacancy signal in the current snapshot.`}
            />
            <DataRow
              label={`PINs on file (${cluster.pins.length})`}
              value={cluster.pins.length > 0 ? cluster.pins.slice(0, 3).join(", ") + (cluster.pins.length > 3 ? "…" : "") : "Not available"}
              detail="The durable per-parcel join key this Owner File's verification snapshots onto."
            />
            <DataRow
              label="Sample addresses"
              value={cluster.sampleAddresses.length > 0 ? cluster.sampleAddresses.slice(0, 2).join("; ") : "Not available"}
              detail={cluster.sampleAddresses.length > 2 ? `+${cluster.sampleAddresses.length - 2} more sampled` : "All sampled addresses shown."}
            />
          </div>
          {/* Per-parcel record links — paired official destinations: CookViewer
              (parcel record) + Cook County Clerk (recorded deeds). Links only —
              no owner names leave the admin surface, no scraping, and no implied
              title search. Only PINs that normalize to 14 digits are linked. */}
          {cluster.pins.some((pin) => cookViewerUrl(pin)) && (
            <div className="mt-4 border border-[#0C1B33]/10 bg-white p-4">
              <p className="font-mono-bureau text-[9px] uppercase tracking-[0.18em] text-[#0C1B33]/40">
                Property &amp; ownership records
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-[#0C1B33]/45">
                CookViewer opens Cook County&rsquo;s official parcel record; Clerk opens the
                County&rsquo;s recorded deeds, grantors, grantees, liens, and releases for the PIN.
                Each opens in a new tab.
              </p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
                {cluster.pins.map((pin) => {
                  const url = cookViewerUrl(pin);
                  const clerkUrl = clerkRecordsUrl(pin);
                  if (!url || !clerkUrl) return null;
                  return (
                    <span key={pin} className="font-mono-bureau text-[11px] text-[#0C1B33]/70">
                      {pin}{" "}
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Opens Cook County's official parcel record in a new tab."
                        className="text-[#2563EB] hover:underline"
                      >
                        CookViewer ↗
                      </a>
                      <span className="text-[#0C1B33]/30"> · </span>
                      <a
                        href={clerkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Review recorded deeds, grantors, grantees, liens, releases, and other documents associated with this parcel."
                        className="text-[#2563EB] hover:underline"
                      >
                        Clerk ↗
                      </a>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Distress signals */}
        <section className="mt-6">
          <h2 className="font-editorial text-[24px] text-[#0C1B33]">Distress Signals</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {ds.buildingViolationCount != null ? (
              <DataRow
                label="Building violations"
                value={`${ds.buildingViolationCount} recorded`}
                detail="Joined from Chicago Building Violations (22u3-xenr) by normalized site address."
              />
            ) : (
              <DataPendingRow label="Building violations" />
            )}
            {ds.vacantBuildingViolationCount != null ? (
              <DataRow
                label="Vacant-building violations"
                value={`${ds.vacantBuildingViolationCount} recorded`}
                detail="Joined from Chicago Vacant/Abandoned Building Violations (u7si-yh3t) by normalized site address."
              />
            ) : (
              <DataPendingRow label="Vacant-building violations" />
            )}
            <DataPendingRow
              label="Delinquent-tax exposure"
              detail="Requires the Cook County Clerk's monthly delinquency file (manual import) — sale-exposure below is the public signal in the meantime."
            />
            {ds.scavengerOrAnnualSaleFlag != null ? (
              <DataRow
                label="Scavenger / annual tax sale exposure"
                value={ds.scavengerOrAnnualSaleFlag ? "Sale exposure found" : "No sale exposure found in the loaded records"}
                detail={
                  ds.scavengerOrAnnualSaleFlag
                    ? [
                        cluster.latestTaxSaleYear != null ? `Latest tax-sale year on file: ${cluster.latestTaxSaleYear}.` : null,
                        cluster.taxSaleSoldCount != null
                          ? `${cluster.taxSaleSoldCount} matched entr${cluster.taxSaleSoldCount === 1 ? "y" : "ies"} actually sold at auction.`
                          : null,
                        "Joined by PIN from the Cook County Treasurer scavenger (ydgz-vkrp) and annual (55ju-2fs9) tax-sale datasets.",
                      ]
                        .filter(Boolean)
                        .join(" ")
                    : "Joined by PIN from the Cook County Treasurer scavenger (ydgz-vkrp) and annual (55ju-2fs9) tax-sale datasets — none of this cluster's PINs appear in either."
                }
              />
            ) : (
              <DataPendingRow label="Scavenger / annual tax sale exposure" />
            )}
            <DataPendingRow
              label="Cook County Land Bank inventory"
              detail="CCLBA publishes no public API — needs a periodic manual snapshot import."
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[#0C1B33]/40">
            Vacant-building violations and tax-sale exposure are live. Delinquent-tax exposure and Cook County
            Land Bank inventory require a periodic manual import — neither source publishes a public API.
            &quot;Not yet available&quot; always means the source hasn&apos;t loaded — never a silent zero.
          </p>
        </section>

        {/* Transfer + business-license context */}
        <section className="mt-6">
          <h2 className="font-editorial text-[24px] text-[#0C1B33]">Transfer &amp; Business-License Context</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DataRow
              label="Latest transfer"
              value={cluster.latestTransferDate ? new Date(cluster.latestTransferDate).toLocaleDateString("en-US") : "No transfer on file"}
              detail={
                cluster.latestTransferDate
                  ? `Buyer: ${cluster.latestBuyerName || "n/a"}. Seller: ${cluster.latestSellerName || "n/a"}.`
                  : "No property-transfer record attached to this cluster in the current snapshot."
              }
            />
            <DataRow
              label={`Business-license site matches (${cluster.businessCount})`}
              value={cluster.businessNames.length > 0 ? cluster.businessNames.slice(0, 2).join("; ") : "None found"}
              detail="Matched by normalized site address / legal name to Chicago business licenses."
            />
          </div>
        </section>

        {/* Verification */}
        <section className="mt-6">
          <OwnerFileVerificationForm
            zip={zip}
            clusterKey={clusterKey}
            verification={verification}
            resolvedTier={resolvedTier}
          />
        </section>

        {/* Notes */}
        {notes.length > 0 && (
          <section className="mt-6 border border-[#0C1B33]/10 bg-white p-6">
            <h2 className="font-editorial text-[24px] text-[#0C1B33]">Notes</h2>
            <div className="mt-3 divide-y divide-[#0C1B33]/6">
              {notes.map((note) => (
                <div key={note.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#2563EB]">
                      {note.noteType.replace(/_/g, " ")}
                    </span>
                    <span className="font-mono-bureau text-[10px] text-[#0C1B33]/35">
                      {note.authorName} — {new Date(note.createdAt).toLocaleDateString("en-US")}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-[#0C1B33]/65">{note.body}</p>
                  {note.sourceUrl && (
                    <a
                      href={note.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-[12px] text-[#2563EB] hover:underline"
                    >
                      {note.sourceUrl}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Outreach */}
        <section className="mt-6 mb-12">
          <OutreachLog
            zip={zip}
            clusterKey={clusterKey}
            ownerName={cluster.ownerName}
            ownerMailingAddress={cluster.ownerMailingAddress}
            verificationStatus={verification?.status ?? null}
            isEntityOwner={isEntityOwner}
            events={outreachEvents}
          />
        </section>
      </div>
    </main>
  );
}
