import { formatPermitAreaDate } from "@/lib/permit-area";
import type { PermitExhibitMeta } from "@/lib/permit-exhibit";
import {
  PERMIT_EXHIBIT_EYEBROW,
  PERMIT_EXHIBIT_HEADER_SCOPE_STATEMENT,
} from "@/lib/permit-exhibit-copy";

/**
 * The standardized evidence-brief header anatomy (matches
 * app/investment/[area]/page.tsx exactly, per the master spec): eyebrow,
 * serif title, single meta line, scope-statement aside. Shared by the
 * on-screen exhibit page; the print route inlines its own compact variant
 * (matching the /print/investment precedent) rather than reusing this.
 */
export function PermitExhibitHeader({
  meta,
  radiusFt,
  actions,
}: {
  meta: PermitExhibitMeta;
  radiusFt: number;
  actions?: React.ReactNode;
}) {
  const address = meta.subjectParcel.situsAddress ?? "Address not on record";

  return (
    <header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-start lg:gap-[26px]">
        <div>
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.2em] text-[#2563EB]">
            {PERMIT_EXHIBIT_EYEBROW}
          </span>
          <h1 className="mt-3 max-w-[720px] font-editorial text-[clamp(34px,4vw,55px)] leading-[1.02] tracking-[-0.035em] text-[#0C1B33]">
            Permit History Exhibit · {address}
          </h1>
          <p className="mt-[11px] max-w-[760px] font-mono-bureau text-[9px] uppercase leading-[1.65] tracking-[0.12em] text-[#697485]">
            PIN {meta.subjectParcel.pinFormatted} · Radius {radiusFt.toLocaleString("en-US")} ft · Snapshot{" "}
            {formatPermitAreaDate(meta.snapshotDate)} · Exhibit {meta.exhibitId}
          </p>
        </div>
        <aside className="border border-[#0C1B33]/75 bg-white/60 p-4 sm:mt-[30px] sm:p-5" aria-label="Scope statement">
          <p className="font-mono-bureau text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0C1B33]">
            Scope statement
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/65">
            {PERMIT_EXHIBIT_HEADER_SCOPE_STATEMENT}
          </p>
        </aside>
      </div>
      {actions ? <div className="mt-5 flex flex-wrap items-center gap-2 no-print">{actions}</div> : null}
    </header>
  );
}
