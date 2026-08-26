import { formatPermitAreaDate } from "@/lib/permit-area";
import { PERMIT_EXHIBIT_S3_HONEST_LIMIT } from "@/lib/permit-exhibit-copy";
import type { PermitExhibitBoundaryContext } from "@/lib/permit-exhibit-types";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center border border-[#0C1B33]/15 bg-white px-2 py-1 font-mono-bureau text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/65">
      {children}
    </span>
  );
}

/**
 * S3 — boundary context, TODAY only. The HONEST LIMIT is binding per the
 * spec: no per-permit historical boundary claim is rendered — one clearly
 * labeled line says district boundaries at each permit's issue date are
 * not yet reconstructable.
 */
export function BoundaryContextSection({
  boundaryContext,
}: {
  boundaryContext: PermitExhibitBoundaryContext;
}) {
  return (
    <section className="mt-8" aria-labelledby="s3-boundary-title">
      <p className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#2563EB]">S3 · Boundary context</p>
      <h2 id="s3-boundary-title" className="mt-1 font-editorial text-[24px] leading-tight text-[#0C1B33]">
        This parcel today
      </h2>

      <div className="mt-4 flex flex-wrap items-center gap-2 border border-[#0C1B33]/10 bg-white p-4">
        <Chip>Zoning {boundaryContext.zoningDistrict ?? "Not on record"}</Chip>
        {boundaryContext.tifDistricts.length > 0
          ? boundaryContext.tifDistricts.map((tif) => <Chip key={tif}>TIF · {tif}</Chip>)
          : <Chip>No TIF district on record</Chip>}
        {boundaryContext.overlays.map((overlay) => (
          <Chip key={overlay}>{overlay}</Chip>
        ))}
      </div>

      <p className="mt-3 border-l-2 border-[#A45B00]/40 pl-3 text-[12px] leading-relaxed text-[#A45B00]">
        Boundary context is as of {formatPermitAreaDate(boundaryContext.asOfDate)}. {PERMIT_EXHIBIT_S3_HONEST_LIMIT}
      </p>
    </section>
  );
}
