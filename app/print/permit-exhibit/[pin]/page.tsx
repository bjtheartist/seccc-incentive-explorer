import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SubjectParcelSection } from "@/components/permit-exhibit/SubjectParcelSection";
import { AreaContextSection } from "@/components/permit-exhibit/AreaContextSection";
import { BoundaryContextSection } from "@/components/permit-exhibit/BoundaryContextSection";
import { MethodsFooter } from "@/components/permit-exhibit/MethodsFooter";
import { PermitExhibitTruncationNotice } from "@/components/permit-exhibit/PermitExhibitTruncationNotice";
import { loadPermitExhibit } from "@/lib/permit-exhibit-source";
import { PERMIT_EXHIBIT_ALLOWED_RADIUS_FT, PERMIT_EXHIBIT_DEFAULT_RADIUS_FT } from "@/lib/permit-exhibit";
import { PERMIT_EXHIBIT_UNAVAILABLE_COPY } from "@/lib/permit-exhibit-copy";
import { formatPermitAreaDate } from "@/lib/permit-area";
import { SHORTLIST_ACCESS_COOKIE, hasValidShortlistAccessSession } from "@/lib/shortlist-access";

/**
 * /print/permit-exhibit/[pin] — exhibit-ready print route, per the
 * established /print/investment pattern: same gate (server-side, this
 * feature's shared shortlist-access session — content absent from the HTML
 * entirely when unauthenticated, matching the on-screen page's gate), a
 * dedicated print stylesheet, and a single continuous flow of S1-S4 rather
 * than the on-screen page's chrome.
 */

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
    title: "Permit History Exhibit — Print",
    robots: { index: false, follow: false },
  };
}

const PRINT_CSS = `
@page { size: letter; margin: 0.5in; }
@media print {
  html, body { background: #ffffff !important; }
  nav, footer.no-print, .no-print { display: none !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .permit-exhibit-print { background: #ffffff !important; padding: 0 !important; }
  .brief-sheet { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; width: 100% !important; }
  section { break-inside: avoid-page; }
  h1, h2 { break-after: avoid; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  p, li { orphans: 3; widows: 3; }
}
`;

function NotAuthorized() {
  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33]">
      <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6 text-[14px] text-[#0C1B33]/65">
        Sign up for exhibit access on the on-screen exhibit page, then return here to print.
      </div>
    </main>
  );
}

function Unavailable({ kind }: { kind: keyof typeof PERMIT_EXHIBIT_UNAVAILABLE_COPY }) {
  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33]">
      <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6 text-[14px] text-[#0C1B33]/65">
        {PERMIT_EXHIBIT_UNAVAILABLE_COPY[kind]}
      </div>
    </main>
  );
}

export default async function PermitExhibitPrintPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const cookieStore = await cookies();
  const hasAccess = hasValidShortlistAccessSession(cookieStore.get(SHORTLIST_ACCESS_COOKIE)?.value);
  if (!hasAccess) return <NotAuthorized />;

  const { pin: rawPin } = await params;
  const sp = await searchParams;
  const radiusFt = resolveRadiusFt(firstParam(sp.radius));

  const result = await loadPermitExhibit({ pin: rawPin, radiusFt });
  if (!result.ok) return <Unavailable kind={result.error.kind} />;

  const { data } = result;
  const address = data.meta.subjectParcel.situsAddress ?? "Address not on record";

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
                Community evidence brief · public records
              </span>
              <span className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
                As of {formatPermitAreaDate(data.meta.snapshotDate)}
              </span>
            </div>
            <h1 className="mt-2 font-editorial text-[36px] leading-none">{address}</h1>
            <p className="mt-1 font-editorial text-[16px] italic text-[#0C1B33]/70">
              Permit History Exhibit · PIN {data.meta.subjectParcel.pinFormatted} · Radius{" "}
              {radiusFt.toLocaleString("en-US")} ft · Exhibit {data.meta.exhibitId}
            </p>
          </header>

          {/* A printed exhibit is handed to a reader who cannot ask whether it
              is complete — the cap disclosure goes on page one, not only in
              the methods footer at the end. */}
          <PermitExhibitTruncationNotice truncation={data.meta.truncation} className="mt-4" />

          <SubjectParcelSection subject={data.subject} />
          <AreaContextSection area={data.area} radiusFt={radiusFt} />
          <BoundaryContextSection boundaryContext={data.boundaryContext} />
          <MethodsFooter meta={data.meta} coverage={data.coverage} />
        </div>
      </main>
    </>
  );
}
