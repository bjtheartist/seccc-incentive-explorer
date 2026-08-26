import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SubjectParcelSection } from "@/components/permit-exhibit/SubjectParcelSection";
import { AreaContextSection } from "@/components/permit-exhibit/AreaContextSection";
import { BoundaryContextSection } from "@/components/permit-exhibit/BoundaryContextSection";
import { MethodsFooter } from "@/components/permit-exhibit/MethodsFooter";
import {
  PermitExhibitSnapshotCertificate,
  PermitExhibitSnapshotProvenance,
  formatPermitExhibitSnapshotSavedDate,
} from "@/components/permit-exhibit/PermitExhibitSnapshotCertificate";
import {
  loadPermitExhibitSnapshot,
  PermitExhibitSnapshotCorruptError,
  PermitExhibitSnapshotStorageUnavailableError,
} from "@/lib/permit-exhibit-snapshot";
import {
  SHORTLIST_ACCESS_COOKIE,
  hasValidShortlistAccessSession,
} from "@/lib/shortlist-access";

export const dynamic = "force-dynamic";

type Params = Promise<{ snapshotId: string }>;

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Saved Permit History Exhibit — Print",
    robots: { index: false, follow: false },
  };
}

const PRINT_CSS = `
@page { size: letter; margin: 0.5in; }
@media print {
  html, body { background: #ffffff !important; }
  body > header, body > footer, nav, footer.no-print, .no-print { display: none !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .permit-exhibit-print { background: #ffffff !important; padding: 0 !important; }
  .brief-sheet { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; padding: 0 !important; width: 100% !important; }
  .brief-sheet .overflow-x-auto { overflow: visible !important; }
  .brief-sheet table { min-width: 0 !important; table-layout: fixed !important; width: 100% !important; }
  .brief-sheet th, .brief-sheet td { overflow-wrap: anywhere; word-break: normal; }
  section { break-inside: auto; }
  h1, h2 { break-after: avoid; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  p, li { orphans: 3; widows: 3; }
}
`;

function NotAuthorized({ snapshotId }: { snapshotId: string }) {
  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33]">
      <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6 text-[14px] text-[#0C1B33]/65">
        Sign up for exhibit access on the saved exhibit page, then return here to print.
        <Link href={`/permit-exhibit/snapshots/${snapshotId}`} className="mt-4 block font-medium text-[#2563EB] hover:underline">
          Open saved exhibit access
        </Link>
      </div>
    </main>
  );
}

function Unavailable({ corrupt = false }: { corrupt?: boolean }) {
  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33]">
      <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6 text-[14px] text-[#0C1B33]/65">
        {corrupt
          ? "This saved exhibit did not pass its integrity or version check. It was not rebuilt from current records."
          : "Snapshot storage is temporarily unavailable. No current exhibit was substituted."}
      </div>
    </main>
  );
}

function NotFound() {
  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33]">
      <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6 text-[14px] text-[#0C1B33]/65">
        That saved exhibit was not found. No current exhibit was substituted.
      </div>
    </main>
  );
}

export default async function SavedPermitExhibitPrintPage({ params }: { params: Params }) {
  const { snapshotId } = await params;
  const cookieStore = await cookies();
  const hasAccess = hasValidShortlistAccessSession(cookieStore.get(SHORTLIST_ACCESS_COOKIE)?.value);
  if (!hasAccess) return <NotAuthorized snapshotId={snapshotId} />;

  let snapshot;
  try {
    snapshot = await loadPermitExhibitSnapshot(snapshotId);
  } catch (error) {
    if (error instanceof PermitExhibitSnapshotCorruptError) return <Unavailable corrupt />;
    if (error instanceof PermitExhibitSnapshotStorageUnavailableError) return <Unavailable />;
    throw error;
  }
  if (!snapshot) return <NotFound />;

  const { exhibit } = snapshot;
  const radiusFt = exhibit.meta.queryParams.radiusFt;
  const address = exhibit.meta.subjectParcel.situsAddress ?? "Address not on record";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <main className="permit-exhibit-print min-h-screen bg-[#E9E7E1] px-4 py-8 text-[#0C1B33] print:p-0">
        <div className="brief-sheet mx-auto max-w-[7.5in] bg-white p-8 shadow-sm sm:p-10">
          <p className="no-print mb-6 text-[11px] leading-relaxed text-[#0C1B33]/45">
            Print or Save as PDF (letter, background graphics on).
          </p>
          <header className="border-b-2 border-[#0C1B33] pb-4">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
                Community evidence brief · saved public record
              </span>
              <span className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#697485]">
                Saved {formatPermitExhibitSnapshotSavedDate(snapshot.savedAt)}
              </span>
            </div>
            <h1 className="mt-2 font-editorial text-[36px] leading-none">{address}</h1>
            <p className="mt-1 font-editorial text-[16px] italic text-[#0C1B33]/70">
              Permit History Exhibit · PIN {exhibit.meta.subjectParcel.pinFormatted} · Radius{" "}
              {radiusFt.toLocaleString("en-US")} ft · Snapshot {snapshot.displayId}
            </p>
          </header>

          <PermitExhibitSnapshotCertificate snapshot={snapshot} printMode />
          <SubjectParcelSection subject={exhibit.subject} />
          <AreaContextSection area={exhibit.area} radiusFt={radiusFt} />
          <BoundaryContextSection boundaryContext={exhibit.boundaryContext} />
          <MethodsFooter meta={exhibit.meta} coverage={exhibit.coverage} />
          <PermitExhibitSnapshotProvenance snapshot={snapshot} forceExpanded />
        </div>
      </main>
    </>
  );
}
