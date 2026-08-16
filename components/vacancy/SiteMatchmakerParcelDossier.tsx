"use client";

import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import { assessorRecordUrl, clerkRecordsUrl, cookViewerUrl, formatPin14, normalizePin14 } from "@/lib/cook-viewer";
import { googleMapsSearchUrl } from "@/lib/google-maps";
import { OWNER_SECTOR_LABELS, type OwnerSector } from "@/lib/owner-sector";
import { OWNER_STRUCTURE_LABELS, type OwnerStructure } from "@/lib/owner-taxonomy";
import { squareFeetLabel, type ParcelSpaceFacts } from "@/lib/parcel-space";
import type { CandidateParcelEnrichmentState } from "@/lib/site-matchmaker-results";
import type { CandidateParcelResolution } from "@/lib/site-matchmaker-parcel-resolution";
import { assessedYearLabel } from "@/lib/site-shortlist";

export interface ParcelDossierRecord {
  address: string | null;
  pin: string | null;
  lat: number | null;
  lon: number | null;
  space: ParcelSpaceFacts;
  ownerSector: OwnerSector;
  ownerStructure: OwnerStructure;
}

function currency(value: number | null): string {
  return value == null ? "Not published" : `$${value.toLocaleString("en-US")}`;
}

type CountyAreaField = "lotAreaSqft" | "assessorBuildingSqft";

function countyAreaFactLabel(
  record: ParcelDossierRecord,
  enrichment: CandidateParcelEnrichmentState,
  field: CountyAreaField,
): string {
  const snapshotValue = record.space[field];
  const snapshotLabel = squareFeetLabel(snapshotValue);
  if (enrichment.status === "checked") {
    const status = field === "lotAreaSqft"
      ? enrichment.facts.lotAreaStatus
      : enrichment.facts.assessorBuildingAreaStatus;
    const liveValue = enrichment.facts[field];
    if (status === "available" && liveValue != null) return `${squareFeetLabel(liveValue)} · current County record`;
    if (snapshotValue != null) {
      if (status === "unavailable") return `${snapshotLabel} · saved snapshot; current check unavailable`;
      if (status === "not_published") return `${snapshotLabel} · saved snapshot; current record did not publish an area`;
      return `${snapshotLabel} · saved snapshot`;
    }
    if (status === "unavailable") return "Unavailable";
    if (status === "not_requested") return "Not requested — PIN needs verification";
    return "Not published";
  }
  if (enrichment.status === "loading") {
    return snapshotValue == null
      ? "Checking County record..."
      : `${snapshotLabel} · saved snapshot; checking current record`;
  }
  if (enrichment.status === "unavailable") {
    return snapshotValue == null ? "Unavailable" : `${snapshotLabel} · saved snapshot; current check unavailable`;
  }
  if (enrichment.status === "not_requested") {
    return snapshotValue == null
      ? "Not requested — confirmed PIN required"
      : `${snapshotLabel} · saved snapshot; current check not requested — confirmed PIN required`;
  }
  return snapshotValue == null ? "Not checked" : `${snapshotLabel} · saved snapshot; current record not checked`;
}

function assessorBuildingYearLabel(
  record: ParcelDossierRecord,
  enrichment: CandidateParcelEnrichmentState,
): string {
  if (
    enrichment.status === "checked" &&
    enrichment.facts.assessorBuildingAreaStatus === "available" &&
    enrichment.facts.assessorBuildingYear
  ) {
    return `${assessedYearLabel(enrichment.facts.assessorBuildingYear) ?? enrichment.facts.assessorBuildingYear} · current County record`;
  }
  if (record.space.assessorBuildingYear != null) {
    const suffix = enrichment.status === "loading"
      ? "; checking current record"
      : enrichment.status === "unavailable" ||
          (enrichment.status === "checked" && enrichment.facts.assessorBuildingAreaStatus === "unavailable")
        ? "; current check unavailable"
        : enrichment.status === "checked" && enrichment.facts.assessorBuildingAreaStatus === "not_published"
          ? "; current record did not publish a building year"
          : enrichment.status === "not_requested"
            ? "; current check not requested — confirmed PIN required"
            : enrichment.status === "not_checked"
              ? "; current record not checked"
          : "";
    return `${record.space.assessorBuildingYear} · saved snapshot${suffix}`;
  }
  if (enrichment.status === "loading") return "Checking County record...";
  if (enrichment.status === "unavailable") return "Unavailable";
  if (enrichment.status === "not_requested") return "Not requested — confirmed PIN required";
  if (enrichment.status === "not_checked") return "Not checked";
  if (enrichment.facts.assessorBuildingAreaStatus === "unavailable") return "Unavailable";
  if (enrichment.facts.assessorBuildingAreaStatus === "not_requested") {
    return "Not requested — PIN needs verification";
  }
  return "Not published";
}

function countyClassFactLabel(enrichment: CandidateParcelEnrichmentState): string {
  if (enrichment.status === "loading") return "Checking current County record...";
  if (enrichment.status === "unavailable") return "Unavailable";
  if (enrichment.status === "not_requested") return "Not requested — confirmed PIN required";
  if (enrichment.status === "not_checked") return "Not checked";
  if (enrichment.facts.countyClassStatus === "unavailable") return "Unavailable";
  if (enrichment.facts.countyClassStatus === "not_requested") {
    return "Not requested — confirmed PIN required";
  }
  return enrichment.facts.countyClass ?? "Not published";
}

function resolutionText(resolution: CandidateParcelResolution, effectivePin: string | null): string {
  if (resolution.status === "resolved") {
    return resolution.pinSource === "coordinate_exact"
      ? `PIN ${formatPin14(resolution.pin)} · current County parcel resolved by exact map-point intersection`
      : `PIN ${formatPin14(resolution.pin)} · published in the saved shortlist snapshot`;
  }
  if (resolution.status === "resolving") return "PIN not published in the saved shortlist snapshot · resolving the exact County parcel at this map point";
  if (resolution.status === "no_match") {
    return resolution.reason === "invalid_location"
      ? "PIN not published · this record has no usable Chicago map point for an exact parcel check"
      : "PIN not published · no exact address-matched County parcel was confirmed at this map point";
  }
  if (resolution.status === "ambiguous") return `PIN not assigned · ${resolution.candidateCount} County parcel records intersect this map point`;
  if (resolution.status === "unavailable") return "PIN not published · the exact County parcel lookup is temporarily unavailable";
  if (resolution.status === "malformed") return "PIN not published · the County parcel lookup returned an unusable response";
  return effectivePin
    ? `PIN ${formatPin14(effectivePin)}`
    : "PIN not published in the saved shortlist snapshot · County parcel not checked";
}

export function ParcelDossierDialog({
  row: record,
  zip,
  enrichment,
  resolution = { status: "not_checked" },
  onClose,
  onRetry,
  onRetryResolution,
}: {
  row: ParcelDossierRecord;
  zip?: string | null;
  enrichment: CandidateParcelEnrichmentState;
  resolution?: CandidateParcelResolution;
  onClose: () => void;
  onRetry: () => void;
  onRetryResolution?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const effectivePin = resolution.status === "resolved"
    ? resolution.pin
    : normalizePin14(record.pin);
  const parcelUrl = cookViewerUrl(effectivePin);
  const assessorUrl = assessorRecordUrl(effectivePin);
  const recordsUrl = clerkRecordsUrl(effectivePin);
  const mapsUrl = googleMapsSearchUrl({
    address: record.address,
    lat: record.lat,
    lon: record.lon,
    zip,
  });
  const facts = enrichment.status === "checked" ? enrichment.facts : null;
  const countyClassLabel = countyClassFactLabel(enrichment);
  const assessedValueLabel =
    facts?.assessedValueStatus === "unavailable"
      ? "Unavailable"
      : facts?.assessedValueStatus === "not_requested"
        ? "Not requested"
        : currency(facts?.assessedValue ?? null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const showResolutionRetry =
    onRetryResolution &&
    ((resolution.status === "no_match" && resolution.reason !== "invalid_location") ||
      resolution.status === "ambiguous" ||
      resolution.status === "unavailable" ||
      resolution.status === "malformed");

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-[#0C1B33]/55 p-0 sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="parcel-dossier-title"
        className="max-h-[92dvh] w-full overflow-y-auto bg-white shadow-2xl sm:max-w-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#0C1B33]/10 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#2563EB]">Parcel details</p>
            <h2 id="parcel-dossier-title" className="mt-1 break-words text-[20px] font-semibold text-[#0C1B33]">
              {record.address?.trim() || "Address not recorded"}
            </h2>
            <p aria-live="polite" className="mt-1 font-mono-bureau text-[10px] leading-relaxed text-[#0C1B33]/50">
              {resolutionText(resolution, effectivePin)}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close parcel details"
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center border border-[#0C1B33]/15 text-[#0C1B33] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {showResolutionRetry ? (
            <div className="border border-[#C2410C]/25 bg-[#FFF7ED] p-3" aria-live="polite">
              <p className="text-[12px] leading-relaxed text-[#9A3412]">County parcel identity was not confirmed. Google Maps remains available, but County links and facts stay locked until an exact match succeeds.</p>
              <button type="button" onClick={onRetryResolution} className="mt-3 inline-flex min-h-11 items-center border border-[#C2410C] px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.06em] text-[#9A3412] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
                Retry parcel lookup
              </button>
            </div>
          ) : null}

          <div>
            <h3 className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/50">Parcel and ownership facts</h3>
            <dl className="mt-2 grid grid-cols-1 gap-px bg-[#0C1B33]/10 sm:grid-cols-2">
              {[
                ["Lot area", countyAreaFactLabel(record, enrichment, "lotAreaSqft")],
                ["Assessor building area", countyAreaFactLabel(record, enrichment, "assessorBuildingSqft")],
                ["Assessor building tax year", assessorBuildingYearLabel(record, enrichment)],
                ["Owner classification", OWNER_SECTOR_LABELS[record.ownerSector]],
                ["Owner type", OWNER_STRUCTURE_LABELS[record.ownerStructure]],
                ["County property class", countyClassLabel],
              ].map(([label, value]) => (
                <div key={label} className="bg-white px-3 py-3">
                  <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/42">{label}</dt>
                  <dd className="mt-1 text-[13px] text-[#0C1B33]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="border border-[#0C1B33]/12 bg-[#F7F8FA] p-4" aria-live="polite">
            <h3 className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/50">County assessment</h3>
            {enrichment.status === "loading" ? (
              <p className="mt-2 text-[13px] text-[#0C1B33]/65">Checking the Cook County assessment record...</p>
            ) : enrichment.status === "unavailable" ? (
              <p className="mt-2 text-[13px] text-[#9A3412]">County assessment data is temporarily unavailable. Confirmed official record links below still work.</p>
            ) : enrichment.status === "not_checked" ? (
              <p className="mt-2 text-[13px] text-[#0C1B33]/65">County assessment has not been checked for this parcel.</p>
            ) : enrichment.status === "not_requested" ? (
              <p className="mt-2 text-[13px] text-[#0C1B33]/65">A confirmed 14-digit PIN is required before the County assessment can be checked.</p>
            ) : (
              <>
                {enrichment.sourceUnavailable ? <p className="mt-2 text-[12px] text-[#9A3412]">Some County assessment fields could not be checked.</p> : null}
                <dl className="mt-3 grid grid-cols-2 gap-4">
                  <div>
                    <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/42">Assessed value</dt>
                    <dd className="mt-1 text-[18px] font-semibold text-[#0C1B33]">{assessedValueLabel}</dd>
                    <dd className="text-[10px] text-[#0C1B33]/48">Tax year {assessedYearLabel(facts!.assessedYear) ?? "not published"}{facts!.assessedStage ? ` · ${facts!.assessedStage} total` : ""}</dd>
                  </div>
                  <div>
                    <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/42">Assessor-implied market</dt>
                    <dd className="mt-1 text-[18px] font-semibold text-[#0C1B33]">{currency(facts!.impliedMarketValue)}</dd>
                    <dd className="text-[10px] text-[#0C1B33]/48">Screening ballpark, not an appraisal</dd>
                  </div>
                </dl>
              </>
            )}
            {enrichment.status === "unavailable" || (enrichment.status === "checked" && enrichment.sourceUnavailable) ? (
              <button type="button" onClick={onRetry} className="mt-3 inline-flex min-h-11 items-center border border-[#2563EB] px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.06em] text-[#2563EB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
                Retry County details
              </button>
            ) : null}
          </div>

          <div>
            <h3 className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/50">Location and official records</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {mapsUrl ? (
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer" aria-label="Open this location in Google Maps (opens in a new tab)" className="inline-flex min-h-11 items-center justify-between gap-2 border border-[#0C1B33]/25 px-3 py-2 text-[11px] font-medium text-[#0C1B33]/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
                  Google Maps <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                </a>
              ) : null}
              {parcelUrl && assessorUrl && recordsUrl ? [
                ["CookViewer parcel details", parcelUrl],
                ["Assessor property record", assessorUrl],
                ["Clerk recorded documents", recordsUrl],
              ].map(([label, href]) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`} className="inline-flex min-h-11 items-center justify-between gap-2 border border-[#2563EB] px-3 py-2 text-[11px] font-medium text-[#2563EB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
                  {label}<ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                </a>
              )) : null}
            </div>
            {!effectivePin ? <p className="mt-2 text-[12px] text-[#0C1B33]/55">County record links require a confirmed 14-digit PIN.</p> : null}
          </div>

          <p className="border-t border-[#0C1B33]/10 pt-4 text-[11px] leading-relaxed text-[#0C1B33]/55">
            These are public screening records, not proof of current ownership, availability, title, condition, zoning approval, or appraised market value. Confirm the current record with the responsible County and City offices before acting.
          </p>
        </div>
      </section>
    </div>
  );
}
