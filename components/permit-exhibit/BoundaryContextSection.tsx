import { formatPermitAreaDate } from "@/lib/permit-area";
import type { PermitExhibitBoundaryContext } from "@/lib/permit-exhibit";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center border border-[#0C1B33]/15 bg-white px-2 py-1 font-mono-bureau text-[10px] uppercase tracking-[0.06em] text-[#0C1B33]/65">
      {children}
    </span>
  );
}

/** Zoning status is rendered per its own distinct fact — `not_found` (the
 *  City published nothing there) and `unavailable` (the live lookup
 *  itself failed) are never collapsed into one "no zoning shown" state. */
function ZoningChip({ zoningDistrict }: { zoningDistrict: PermitExhibitBoundaryContext["zoningDistrict"] }) {
  if (zoningDistrict.status === "resolved") {
    return <Chip>Zoning {zoningDistrict.zoneClass ?? "Not on record"}</Chip>;
  }
  if (zoningDistrict.status === "not_found") {
    return <Chip>No zoning district published at this point</Chip>;
  }
  return <Chip>Zoning lookup unavailable</Chip>;
}

function ArchiveAvailability({
  archiveVintageRange,
}: {
  archiveVintageRange: PermitExhibitBoundaryContext["archiveVintageRange"];
}) {
  if (archiveVintageRange.snapshotCount === 0 || !archiveVintageRange.earliest || !archiveVintageRange.latest) {
    return (
      <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/45">
        No dated zoning-boundary snapshots are archived yet.
      </p>
    );
  }
  return (
    <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/45">
      Dated zoning-boundary snapshots archived: {formatPermitAreaDate(archiveVintageRange.earliest)}–
      {formatPermitAreaDate(archiveVintageRange.latest)} ({archiveVintageRange.snapshotCount.toLocaleString("en-US")}
      ).
    </p>
  );
}

/**
 * S3 — boundary context, TODAY only. The HONEST LIMIT is binding per the
 * spec: no per-permit historical boundary claim is rendered — one clearly
 * labeled line (from the spine, `boundaryContext.limitNote`) says district
 * boundaries at each permit's issue date are not yet reconstructable.
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
        <ZoningChip zoningDistrict={boundaryContext.zoningDistrict} />
        {boundaryContext.tifDistricts.length > 0
          ? boundaryContext.tifDistricts.map((tif) => <Chip key={tif.key}>TIF · {tif.name}</Chip>)
          : <Chip>No TIF district on record</Chip>}
        {boundaryContext.overlays.map((overlay) => (
          <Chip key={overlay.key}>{overlay.name}</Chip>
        ))}
      </div>

      <p className="mt-3 border-l-2 border-[#A45B00]/40 pl-3 text-[12px] leading-relaxed text-[#A45B00]">
        {boundaryContext.limitNote}
      </p>

      <ArchiveAvailability archiveVintageRange={boundaryContext.archiveVintageRange} />
    </section>
  );
}
