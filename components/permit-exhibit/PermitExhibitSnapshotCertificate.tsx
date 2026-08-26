import Link from "next/link";
import { BadgeCheck, ChevronRight } from "lucide-react";
import type { PermitExhibitSnapshot } from "@/lib/permit-exhibit-snapshot";
import { PermitExhibitPrintButton } from "@/components/permit-exhibit/PermitExhibitPrintButton";

export function formatPermitExhibitSnapshotSavedDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatSavedAt(value: string): string {
  const date = formatPermitExhibitSnapshotSavedDate(value);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
  return `${date} · ${time}`;
}

function formatVintage(value: string | null): string {
  if (!value) return "Not recorded";
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: isDateOnly ? "UTC" : "America/Chicago",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function sourceVintageLine(snapshot: PermitExhibitSnapshot): string {
  const { sourceVintages } = snapshot;
  const archive = sourceVintages.zoningArchive;
  const archiveLabel =
    archive.snapshotCount > 0 && archive.latest
      ? `${archive.snapshotCount.toLocaleString("en-US")} archived through ${formatVintage(archive.latest)}`
      : "Not recorded";
  return [
    `City permits ${formatVintage(sourceVintages.permitDatasetUpdatedAt)}`,
    `Parcel context ${formatVintage(sourceVintages.parcelContextResolvedAt)}`,
    `Zoning record ${formatVintage(sourceVintages.zoningRecordUpdatedAt)}`,
    `Zoning archive ${archiveLabel}`,
  ].join(" · ");
}

export function PermitExhibitSnapshotCertificate({
  snapshot,
  printMode = false,
}: {
  snapshot: PermitExhibitSnapshot;
  printMode?: boolean;
}) {
  const pin = snapshot.exhibit.meta.subjectParcel.pin;
  const radiusFt = snapshot.exhibit.meta.queryParams.radiusFt;

  return (
    <section
      className="mt-3 grid items-center gap-5 border border-[#2563EB] bg-white px-5 py-4 md:grid-cols-[84px_minmax(0,1fr)_282px] md:gap-[26px] md:px-[26px]"
      aria-labelledby="snapshot-certificate-title"
      data-testid="snapshot-certificate"
    >
      <div className="grid h-16 w-16 place-items-center border-r border-[#0C1B33]/12 text-[#2563EB]">
        <BadgeCheck aria-hidden className="h-12 w-12" strokeWidth={1.35} />
      </div>
      <div>
        <h2
          id="snapshot-certificate-title"
          className="font-mono-bureau text-[14px] font-medium uppercase tracking-[0.14em] text-[#0C1B33]"
        >
          Saved snapshot · Read only
        </h2>
        <p className="mt-2 font-mono-bureau text-[11px] leading-relaxed text-[#0C1B33]/65">
          Saved {formatSavedAt(snapshot.savedAt)}
        </p>
        <p className="font-mono-bureau text-[11px] leading-relaxed text-[#0C1B33]/65">
          Snapshot {snapshot.displayId}
        </p>
        <p className="mt-2 text-[12px] font-semibold leading-relaxed text-[#0C1B33]">
          This saved exhibit does not change when source records change.
        </p>
      </div>
      <div className="grid gap-2 no-print">
        {printMode ? (
          <PermitExhibitPrintButton />
        ) : (
          <Link
            href={`/print/permit-exhibit/snapshots/${snapshot.publicId}`}
            className="inline-flex min-h-11 items-center justify-center border border-[#0C1B33] bg-[#0C1B33] px-4 py-2 font-mono-bureau text-[10px] font-medium uppercase tracking-[0.09em] text-white transition-colors hover:border-[#2563EB] hover:bg-[#2563EB]"
          >
            Print / Save PDF
          </Link>
        )}
        <Link
          href={`/permit-exhibit/${pin}?radius=${radiusFt}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center justify-center border border-[#2563EB] bg-white px-4 py-2 font-mono-bureau text-[10px] font-medium uppercase tracking-[0.09em] text-[#2563EB] transition-colors hover:bg-[#2563EB]/5"
        >
          Open current exhibit
        </Link>
      </div>
    </section>
  );
}

export function PermitExhibitSnapshotProvenance({
  snapshot,
  forceExpanded = false,
}: {
  snapshot: PermitExhibitSnapshot;
  forceExpanded?: boolean;
}) {
  const { exhibit } = snapshot;
  const radiusFt = exhibit.meta.queryParams.radiusFt;

  const details = (
    <div className="border-t border-[#0C1B33]/12 bg-white px-5 py-5" data-testid="snapshot-provenance-details">
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#697485]">Snapshot ID</dt>
          <dd className="mt-1 break-all font-mono-bureau text-[10px] text-[#0C1B33]">{snapshot.displayId}</dd>
        </div>
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#697485]">Subject PIN</dt>
          <dd className="mt-1 font-mono-bureau text-[10px] text-[#0C1B33]">{exhibit.meta.subjectParcel.pinFormatted}</dd>
        </div>
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#697485]">Application revision</dt>
          <dd className="mt-1 break-all font-mono-bureau text-[10px] text-[#0C1B33]">{snapshot.appRevision}</dd>
        </div>
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#697485]">Query</dt>
          <dd className="mt-1 font-mono-bureau text-[10px] text-[#0C1B33]">
            PIN {exhibit.meta.subjectParcel.pin} · radius {radiusFt.toLocaleString("en-US")} ft
          </dd>
        </div>
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#697485]">Permit rows preserved</dt>
          <dd className="mt-1 font-mono-bureau text-[10px] text-[#0C1B33]">
            {(exhibit.subject.length + exhibit.area.rows.length).toLocaleString("en-US")}
          </dd>
        </div>
        <div>
          <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#697485]">Unlocated records disclosed</dt>
          <dd className="mt-1 font-mono-bureau text-[10px] text-[#0C1B33]">
            {exhibit.coverage.area.unlocatedCount.toLocaleString("en-US")}
          </dd>
        </div>
      </dl>
      <p className="mt-5 max-w-3xl border-t border-[#0C1B33]/10 pt-4 font-mono-bureau text-[9px] leading-relaxed text-[#0C1B33]/65">
        This copy reopens the evidence exactly as it was generated. It does not silently refresh when City or County
        source records change.
      </p>
    </div>
  );

  if (forceExpanded) {
    return (
      <section className="mt-3 border border-[#0C1B33]/12 bg-white/40" aria-labelledby="snapshot-provenance-title">
        <div className="px-5 py-4">
          <h2 id="snapshot-provenance-title" className="font-mono-bureau text-[9px] font-medium uppercase tracking-[0.11em]">
            Snapshot provenance
          </h2>
          <p className="mt-2 font-mono-bureau text-[9px] leading-relaxed text-[#0C1B33]/65">
            Source vintages: {sourceVintageLine(snapshot)}
          </p>
          <p className="mt-1 break-all font-mono-bureau text-[9px] leading-relaxed text-[#0C1B33]/65">
            SHA-256: {snapshot.contentHash}
          </p>
        </div>
        {details}
      </section>
    );
  }

  return (
    <details
      className="group mt-3 border border-[#0C1B33]/12 bg-white/40"
      data-testid="snapshot-provenance"
    >
      <summary className="grid min-h-12 cursor-pointer list-none items-center gap-4 px-5 py-3 marker:hidden sm:grid-cols-[minmax(0,1fr)_auto] [&::-webkit-details-marker]:hidden">
        <div>
          <h2 className="font-mono-bureau text-[9px] font-medium uppercase tracking-[0.11em]">
            Snapshot provenance <span className="group-open:hidden">(preview)</span>
          </h2>
          <p className="mt-1 font-mono-bureau text-[9px] leading-relaxed text-[#0C1B33]/65">
            Source vintages: {sourceVintageLine(snapshot)}
          </p>
          <p className="mt-1 break-all font-mono-bureau text-[9px] leading-relaxed text-[#0C1B33]/65">
            SHA-256: {snapshot.contentHash}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 font-mono-bureau text-[9px] font-medium text-[#2563EB] no-print">
          <span className="group-open:hidden">View full provenance</span>
          <span className="hidden group-open:inline">Close provenance</span>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
        </span>
      </summary>
      {details}
    </details>
  );
}
