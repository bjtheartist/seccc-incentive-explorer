import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PermitExhibitHeader } from "@/components/permit-exhibit/PermitExhibitHeader";
import { SubjectParcelSection } from "@/components/permit-exhibit/SubjectParcelSection";
import { AreaContextSection } from "@/components/permit-exhibit/AreaContextSection";
import { BoundaryContextSection } from "@/components/permit-exhibit/BoundaryContextSection";
import { MethodsFooter } from "@/components/permit-exhibit/MethodsFooter";
import PermitExhibitAccessGate from "@/components/permit-exhibit/PermitExhibitAccessGate";
import {
  PermitExhibitSnapshotCertificate,
  PermitExhibitSnapshotProvenance,
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
    title: "Saved Permit History Exhibit",
    robots: { index: false, follow: false },
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-[1144px]">{children}</div>
    </div>
  );
}

function AccessRequired() {
  return (
    <Shell>
      <h1 className="font-editorial text-[clamp(34px,3.4vw,50px)] leading-[0.98] tracking-[-0.02em]">
        Saved Permit History Exhibit
      </h1>
      <p className="mt-4 max-w-xl text-[13px] leading-relaxed text-[#0C1B33]/55">
        Sign up or refresh your professional-access session to reopen this saved exhibit.
      </p>
      <PermitExhibitAccessGate address="Saved permit exhibit" />
    </Shell>
  );
}

function Unavailable({ corrupt = false }: { corrupt?: boolean }) {
  return (
    <Shell>
      <h1 className="font-editorial text-[36px] leading-[0.98]">Saved exhibit unavailable</h1>
      <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-[#0C1B33]/60">
        {corrupt
          ? "This saved exhibit did not pass its integrity or version check. It was not rebuilt from current records."
          : "Snapshot storage is temporarily unavailable. The saved exhibit was not replaced with current records."}
      </p>
      <Link
        href="/permit-exhibit"
        className="mt-6 inline-flex min-h-11 items-center gap-2 bg-[#2563EB] px-4 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" strokeWidth={1.8} />
        Build a new exhibit
      </Link>
    </Shell>
  );
}

export default async function SavedPermitExhibitPage({ params }: { params: Params }) {
  const cookieStore = await cookies();
  const hasAccess = hasValidShortlistAccessSession(cookieStore.get(SHORTLIST_ACCESS_COOKIE)?.value);
  if (!hasAccess) return <AccessRequired />;

  const { snapshotId } = await params;
  let snapshot;
  try {
    snapshot = await loadPermitExhibitSnapshot(snapshotId);
  } catch (error) {
    if (error instanceof PermitExhibitSnapshotCorruptError) return <Unavailable corrupt />;
    if (error instanceof PermitExhibitSnapshotStorageUnavailableError) return <Unavailable />;
    throw error;
  }
  if (!snapshot) notFound();

  const { exhibit } = snapshot;
  const radiusFt = exhibit.meta.queryParams.radiusFt;

  return (
    <Shell>
      <PermitExhibitHeader meta={exhibit.meta} radiusFt={radiusFt} />
      <PermitExhibitSnapshotCertificate snapshot={snapshot} />
      <SubjectParcelSection subject={exhibit.subject} />
      <AreaContextSection area={exhibit.area} radiusFt={radiusFt} />
      <BoundaryContextSection boundaryContext={exhibit.boundaryContext} />
      <MethodsFooter meta={exhibit.meta} coverage={exhibit.coverage} />
      <PermitExhibitSnapshotProvenance snapshot={snapshot} />
    </Shell>
  );
}
