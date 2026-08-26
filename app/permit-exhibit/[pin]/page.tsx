import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PermitExhibitHeader } from "@/components/permit-exhibit/PermitExhibitHeader";
import { SubjectParcelSection } from "@/components/permit-exhibit/SubjectParcelSection";
import { AreaContextSection } from "@/components/permit-exhibit/AreaContextSection";
import { BoundaryContextSection } from "@/components/permit-exhibit/BoundaryContextSection";
import { MethodsFooter } from "@/components/permit-exhibit/MethodsFooter";
import PermitExhibitAccessGate from "@/components/permit-exhibit/PermitExhibitAccessGate";
import { SavePermitExhibitSnapshotButton } from "@/components/permit-exhibit/SavePermitExhibitSnapshotButton";
import { loadPermitExhibit } from "@/lib/permit-exhibit-source";
import { PERMIT_EXHIBIT_ALLOWED_RADIUS_FT, PERMIT_EXHIBIT_DEFAULT_RADIUS_FT } from "@/lib/permit-exhibit";
import { PERMIT_EXHIBIT_UNAVAILABLE_COPY } from "@/lib/permit-exhibit-copy";
import { SHORTLIST_ACCESS_COOKIE, hasValidShortlistAccessSession } from "@/lib/shortlist-access";

export const dynamic = "force-dynamic";

type Params = Promise<{ pin: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value)?.trim() || null;
}

function resolveRadiusFt(raw: string | null): number {
  const parsed = raw ? Number(raw) : NaN;
  return (PERMIT_EXHIBIT_ALLOWED_RADIUS_FT as readonly number[]).includes(parsed)
    ? parsed
    : PERMIT_EXHIBIT_DEFAULT_RADIUS_FT;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Permit History Exhibit",
    robots: { index: false, follow: false },
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-6 flex flex-wrap items-center gap-1.5 font-mono-bureau text-[12px] text-[#0C1B33]/50">
          <Link href="/permit-exhibit" className="hover:text-[#2563EB]">
            Permit History Exhibit
          </Link>
        </nav>
        {children}
      </div>
    </div>
  );
}

function UnavailableState({ kind }: { kind: keyof typeof PERMIT_EXHIBIT_UNAVAILABLE_COPY }) {
  return (
    <Shell>
      <h1 className="font-editorial text-[36px] leading-[0.98]">Permit History Exhibit</h1>
      <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-[#0C1B33]/60">
        {PERMIT_EXHIBIT_UNAVAILABLE_COPY[kind]}
      </p>
      <Link
        href="/permit-exhibit"
        className="mt-6 inline-flex min-h-11 items-center gap-2 bg-[#2563EB] px-4 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" strokeWidth={1.8} />
        Try another PIN or address
      </Link>
    </Shell>
  );
}

export default async function PermitExhibitPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { pin: rawPin } = await params;
  const sp = await searchParams;
  const radiusFt = resolveRadiusFt(firstParam(sp.radius));

  const result = await loadPermitExhibit({ pin: rawPin, radiusFt });
  if (!result.ok) {
    return <UnavailableState kind={result.error.kind} />;
  }

  const { data } = result;
  const address = data.meta.subjectParcel.situsAddress ?? "Address not on record";

  const cookieStore = await cookies();
  const hasAccess = hasValidShortlistAccessSession(cookieStore.get(SHORTLIST_ACCESS_COOKIE)?.value);

  return (
    <Shell>
      <PermitExhibitHeader
        meta={data.meta}
        radiusFt={radiusFt}
        actions={
          hasAccess ? (
            <>
              <SavePermitExhibitSnapshotButton
                pin={data.meta.subjectParcel.pin}
                radiusFt={radiusFt}
                requestId={randomUUID()}
              />
              <Link
                href={`/print/permit-exhibit/${data.meta.subjectParcel.pin}?radius=${radiusFt}`}
                className="inline-flex min-h-9 items-center border border-[#0C1B33]/20 bg-white px-3 py-1.5 font-mono-bureau text-[10px] font-medium uppercase tracking-[0.08em] text-[#0C1B33]/65 hover:border-[#2563EB] hover:text-[#2563EB]"
              >
                Print current exhibit
                <ArrowRight aria-hidden className="ml-1.5 h-3.5 w-3.5" strokeWidth={1.8} />
              </Link>
            </>
          ) : null
        }
      />

      {hasAccess ? (
        <>
          <SubjectParcelSection subject={data.subject} />
          <AreaContextSection area={data.area} radiusFt={radiusFt} />
          <BoundaryContextSection boundaryContext={data.boundaryContext} />
          <MethodsFooter meta={data.meta} coverage={data.coverage} />
        </>
      ) : (
        <PermitExhibitAccessGate address={address} />
      )}
    </Shell>
  );
}
