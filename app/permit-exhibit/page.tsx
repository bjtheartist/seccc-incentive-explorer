import type { Metadata } from "next";
import { PermitExhibitEntryForm } from "@/components/permit-exhibit/PermitExhibitEntryForm";
import { PERMIT_EXHIBIT_ALLOWED_RADIUS_FT, PERMIT_EXHIBIT_DEFAULT_RADIUS_FT } from "@/lib/permit-exhibit";
import { PERMIT_EXHIBIT_EYEBROW, PERMIT_EXHIBIT_UPL_SAFE_LINE } from "@/lib/permit-exhibit-copy";

export const metadata: Metadata = {
  title: "Permit History Exhibit",
  description:
    "Build a Permit History Exhibit for a Chicago parcel: every City building permit linked to the " +
    "parcel plus area context, boundary context, and methods & limits, for zoning-matter preparation.",
};

/**
 * /permit-exhibit — entry point (spec PR2): PIN input with address-assist,
 * plus the radius picker. No nav promotion in this PR — reachable by URL
 * and by the one entry link from the permit-activity brief's scope aside.
 */
export default function PermitExhibitEntryPage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-3xl">
        <span className="font-mono-bureau text-[9px] uppercase tracking-[0.2em] text-[#2563EB]">
          {PERMIT_EXHIBIT_EYEBROW}
        </span>
        <h1 className="mt-3 font-editorial text-[clamp(34px,3.4vw,50px)] leading-[0.98] tracking-[-0.02em] text-[#0C1B33]">
          Permit History Exhibit
        </h1>
        <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-[#0C1B33]/60">{PERMIT_EXHIBIT_UPL_SAFE_LINE}</p>

        <PermitExhibitEntryForm
          radiusOptions={PERMIT_EXHIBIT_ALLOWED_RADIUS_FT}
          defaultRadiusFt={PERMIT_EXHIBIT_DEFAULT_RADIUS_FT}
        />
      </div>
    </div>
  );
}
