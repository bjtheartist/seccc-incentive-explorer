"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FileText,
  Landmark,
  LibraryBig,
  MapPin,
  ScanLine,
  Store,
  X,
} from "lucide-react";
import { OWNER_TYPE_LABELS, OWNER_TYPE_COLORS, type OwnerType } from "@/lib/owner-classify";
import type { AreaStats } from "./map-helpers";
import { StaleFactsNote } from "./StaleFactsNote";
import type { SafeMapProgramMatch } from "@/lib/types";
import type { TifFinanceContext } from "@/lib/tif-finance";
import type { SafeLocationContextMapSummary } from "@/lib/location-context";
import type {
  MapDossierAction,
  MapDossierSelection,
} from "@/lib/map-dossier";
import { formatMiles } from "@/lib/transport-access";
import { clerkRecordsUrl, cookViewerUrl } from "@/lib/cook-viewer";
import { WatchAreaButton } from "@/components/workspace/WatchAreaButton";
import {
  compactParcelSpaceFacts,
  siteMatchAreaForProperty,
  siteMatchAreaLabel,
  squareFeetLabel,
  vacancySpaceFacts,
  type ParcelSpaceFacts,
} from "@/lib/parcel-space";

export interface MapDossierCardProps {
  areaStats: AreaStats;
  snapshotLabel: string;
  snapshotLat?: number | null;
  snapshotLon?: number | null;
  snapshotPrograms: SafeMapProgramMatch[];
  snapshotTifFinance: TifFinanceContext | null;
  snapshotContextSummary?: SafeLocationContextMapSummary | null;
  /** review5 S2/S3: non-null when one or more Zone Evidence v2 layers
   *  could not be resolved for this location. Must render ALONGSIDE
   *  snapshotPrograms (known positives), regardless of how many programs
   *  matched — never suppressed by a nonzero match count, and never the
   *  reason a zero-match state silently reads as a confirmed negative. */
  snapshotZoneCoverageNote?: string | null;
  tifFinanceLoading: boolean;
  zoningInfo: string | null;
  isGeneratingSnapshot: boolean;
  openedAt?: number;
  selection: MapDossierSelection;
  onClose: () => void;
  onDrawArea: () => void;
  onGenerateSnapshot: () => void;
}

interface DossierSectionProps {
  title: string;
  badge?: string | null;
  children: ReactNode;
}

interface FactRowProps {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}

interface NextStepPresentation {
  text: string;
  primaryAction?: MapDossierAction | null;
  secondaryAction?: MapDossierAction | null;
  generateReport: boolean;
}

function mappedProgramReason(result: SafeMapProgramMatch): string {
  return result.program.zoneKey
    ? "Mapped boundary intersects this location."
    : "Included from the program catalog for further review.";
}

const VACANCY_TYPE_LABELS = {
  vacant_land: "Vacant land",
  vacant_building: "Vacant building",
} as const;

function DossierSection({ title, badge, children }: DossierSectionProps) {
  return (
    <details className="group border-t border-[#0C1B33]/10">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-mono-bureau text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5A6478] transition-colors hover:text-[#0C1B33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563EB] [&::-webkit-details-marker]:hidden">
        <span>
          {title}
          {badge ? <span className="ml-1.5 text-[#8A93A6]">· {badge}</span> : null}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90"
          strokeWidth={1.8}
        />
      </summary>
      <div className="space-y-3 px-4 pb-4 text-[11px] leading-relaxed text-[#5A6478]">
        {children}
      </div>
    </details>
  );
}

function FactRow({ label, value, note }: FactRowProps) {
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <span className="text-[#5A6478]">{label}</span>
        <span className="max-w-[58%] text-right font-medium text-[#0C1B33]">{value}</span>
      </div>
      {note ? <div className="mt-1 text-[9px] leading-relaxed text-[#8A93A6]">{note}</div> : null}
    </div>
  );
}

function SpaceFactRows({ space }: { space: ParcelSpaceFacts | null | undefined }) {
  return (
    <div className="space-y-2 border-t border-[#0C1B33]/8 pt-3">
      <div className="font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8A93A6]">
        Site dimensions
      </div>
      <FactRow
        label="Lot area"
        value={squareFeetLabel(space?.lotAreaSqft)}
        note="Cook County parcel area."
      />
      <FactRow
        label="Assessor building area"
        value={squareFeetLabel(space?.assessorBuildingSqft)}
        note={
          space?.assessorBuildingYear
            ? `Assessor tax year ${space.assessorBuildingYear}; not proof of currently available space.`
            : "Whole-building assessor record; not proof of currently available space."
        }
      />
      <FactRow
        label="Mapped building footprint on parcel"
        value={squareFeetLabel(space?.cityGroundFootprintSqft)}
        note={space?.cityGroundFootprintVintage ?? "City polygon measurement not yet mapped."}
      />
      <FactRow
        label="Reported available space"
        value={space?.availableSpaceSqft ? squareFeetLabel(space.availableSpaceSqft) : "Not verified"}
        note={
          space?.availableSpaceVerifiedAt
            ? `Verified ${new Date(space.availableSpaceVerifiedAt).toLocaleDateString("en-US")} via ${space.availableSpaceSource ?? "a documented source"}; reconfirm by ${space.availableSpaceReconfirmAfter ? new Date(space.availableSpaceReconfirmAfter).toLocaleDateString("en-US") : "the next review"}.`
            : space?.availableSpaceSource ??
              "Requires an explicit owner, chamber, or official record; confirm current availability."
        }
      />
    </div>
  );
}

function selectionKindLabel(selection: MapDossierSelection): string {
  switch (selection.kind) {
    case "address":
      return "Selected location";
    case "parcel":
      return "Parcel";
    case "vacancy":
      return "Vacant property";
    case "permit":
      return "Building permit";
    case "poi":
      return "Nearby place";
  }
}

function SelectionIcon({ kind }: { kind: MapDossierSelection["kind"] }) {
  const iconClass = "h-4 w-4";
  switch (kind) {
    case "address":
      return <MapPin aria-hidden="true" className={iconClass} />;
    case "parcel":
      return <Landmark aria-hidden="true" className={iconClass} />;
    case "vacancy":
      return <Building2 aria-hidden="true" className={iconClass} />;
    case "permit":
      return <FileText aria-hidden="true" className={iconClass} />;
    case "poi":
      return <Store aria-hidden="true" className={iconClass} />;
  }
}

function selectionSubtitle(selection: MapDossierSelection): string {
  if (selection.subtitle?.trim()) return selection.subtitle.trim();

  switch (selection.kind) {
    case "address":
      return "Address or selected map point";
    case "parcel":
      return selection.pin ? `Cook County parcel ${selection.pin}` : "Cook County parcel";
    case "vacancy": {
      const type = VACANCY_TYPE_LABELS[selection.vacancyType];
      const space = vacancySpaceFacts(selection.vacancyType, selection.space, selection.squareFeet);
      const matchArea = siteMatchAreaForProperty(selection.vacancyType, space);
      const size =
        matchArea.sqft != null
          ? ` · ${matchArea.sqft.toLocaleString("en-US")} sq ft ${siteMatchAreaLabel(matchArea.kind).toLowerCase()}`
          : "";
      return `${type}${size}`;
    }
    case "permit":
      return `${selection.permitType?.trim() || "Published permit"} · ${selection.permitId}`;
    case "poi":
      return selection.category;
  }
}

function selectionSummary(
  selection: MapDossierSelection,
  mappedProgramCount: number,
): string {
  if (selection.summary?.trim()) return selection.summary.trim();

  switch (selection.kind) {
    case "address":
      return mappedProgramCount > 0
        ? `${mappedProgramCount} mapped program${mappedProgramCount === 1 ? "" : "s"} and public location context are available to review.`
        : "Review mapped public records and location context before planning next steps.";
    case "parcel":
      return "Public parcel context is available for initial research. Verify ownership, title, and current condition with the official county records.";
    case "vacancy": {
      const count = selection.incentiveGeographyCount;
      const geography =
        count != null && count > 0
          ? ` It intersects ${count} mapped incentive ${count === 1 ? "geography" : "geographies"}.`
          : "";
      return `Records flag this as a tracked ${VACANCY_TYPE_LABELS[selection.vacancyType].toLowerCase()} for follow-up.${geography}`;
    }
    case "permit":
      return "This is a published permit record tied to the selected location. Verify its scope, status, and issue details in the City source.";
    case "poi":
      return "This place provides nearby context. Select an address or parcel when you need property-specific records and a location report.";
  }
}

function defaultNextStep(
  selection: MapDossierSelection,
  fallbackPin?: string | null,
): NextStepPresentation {
  if (selection.nextStep) {
    return {
      text: selection.nextStep.text,
      primaryAction: selection.nextStep.primaryAction,
      secondaryAction: selection.nextStep.secondaryAction,
      generateReport: !selection.nextStep.primaryAction,
    };
  }

  const selectionPin =
    selection.kind === "parcel" || selection.kind === "vacancy" || selection.kind === "permit"
      ? selection.pin
      : null;
  const pin = selectionPin || fallbackPin || null;
  const parcelUrl = cookViewerUrl(pin);
  const deedUrl = clerkRecordsUrl(pin);

  if ((selection.kind === "parcel" || selection.kind === "vacancy") && parcelUrl) {
    return {
      text:
        selection.kind === "vacancy"
          ? "Verify the parcel record, current condition, and disposition path before outreach."
          : "Review the official parcel record and deed history before relying on ownership or condition details.",
      primaryAction: { label: "Check parcel record", href: parcelUrl, external: true },
      secondaryAction: deedUrl
        ? { label: "Review deed history", href: deedUrl, external: true }
        : null,
      generateReport: false,
    };
  }

  if (selection.kind === "permit") {
    const permitSource = selection.sources?.find((source) => source.href)?.href;
    if (permitSource) {
      return {
        text: "Open the source record to verify the permit's current status and authorized work.",
        primaryAction: {
          label: "Verify permit record",
          href: permitSource,
          external: true,
        },
        generateReport: false,
      };
    }
  }

  if (selection.kind === "poi") {
    return {
      text: "Use this nearby place as context, then generate a report for the selected location.",
      generateReport: true,
    };
  }

  return {
    text: "Generate a location report to review mapped programs, districts, and public records.",
    generateReport: true,
  };
}

function ActionLink({ action, primary = false }: { action: MapDossierAction; primary?: boolean }) {
  return (
    <a
      href={action.href}
      target={action.external ? "_blank" : undefined}
      rel={action.external ? "noopener noreferrer" : undefined}
      className={
        primary
          ? "inline-flex min-h-9 items-center gap-1.5 bg-[#0C1B33] px-3 py-2 font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.08em] text-white transition-colors hover:bg-[#172B4D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2"
          : "inline-flex min-h-9 items-center gap-1.5 px-1 py-2 text-[10px] font-medium text-[#2563EB] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
      }
    >
      {action.label}
      {action.external ? (
        <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      )}
    </a>
  );
}

function SelectionFacts({ selection }: { selection: MapDossierSelection }) {
  switch (selection.kind) {
    case "address": {
      const hasCoordinates =
        typeof selection.lat === "number" &&
        Number.isFinite(selection.lat) &&
        typeof selection.lon === "number" &&
        Number.isFinite(selection.lon);
      return hasCoordinates ? (
        <FactRow
          label="Coordinates"
          value={`${selection.lat!.toFixed(5)}, ${selection.lon!.toFixed(5)}`}
          note="Map point used for this location lookup."
        />
      ) : (
        <p>Address-level context. Select a parcel for parcel-specific records.</p>
      );
    }
    case "parcel":
      return (
        <>
          <FactRow label="PIN" value={selection.pin || "Not recorded"} />
          {selection.propertyClass ? <FactRow label="Property class" value={selection.propertyClass} /> : null}
          {selection.propertyClassDescription ? (
            <p className="text-[#5A6478]">{selection.propertyClassDescription}</p>
          ) : null}
          {selection.propertyType ? <FactRow label="Parcel type" value={selection.propertyType} /> : null}
          {selection.assessedTotal != null ? (
            <FactRow
              label="Total assessed value"
              value={`$${selection.assessedTotal.toLocaleString("en-US")}`}
              note="Assessed value is a tax record, not a sale price or project budget."
            />
          ) : null}
        </>
      );
    case "vacancy":
      return (
        <>
          <FactRow label="Tracked type" value={VACANCY_TYPE_LABELS[selection.vacancyType]} />
          {selection.pin ? <FactRow label="PIN" value={selection.pin} /> : null}
          {/* review6 S12: cited directly in the finding text ("map dossiers
              render non-null zero as mapped") — `!= null` alone let a
              genuine `0` render as an audited "Mapped incentive
              geographies: 0" fact row, same false-zero shape as the
              shortlist card's `?? 0` coercion (see
              components/vacancy/SiteShortlistResults.tsx's
              incentiveCountText). This value comes from a separate,
              deeper DB pipeline this session has no live access to audit
              (documented gap, review5 S2) — `> 0` is the conservative
              fix available without that access: only a positive,
              unambiguous count is shown at all. */}
          {selection.incentiveGeographyCount != null && selection.incentiveGeographyCount > 0 ? (
            <FactRow
              label="Mapped incentive geographies"
              value={selection.incentiveGeographyCount.toLocaleString("en-US")}
              note="A boundary intersection is a location signal, not an eligibility determination."
            />
          ) : null}
          {selection.reasonFlagged ? <FactRow label="Flagged because" value={selection.reasonFlagged} /> : null}
        </>
      );
    case "permit":
      return (
        <>
          <FactRow label="Permit number" value={selection.permitId} />
          {selection.pin ? <FactRow label="Matched PIN" value={selection.pin} /> : null}
        </>
      );
    case "poi":
      return (
        <>
          <FactRow label="Place type" value={selection.category} />
          {selection.address ? <FactRow label="Address" value={selection.address} /> : null}
          {selection.agency ? <FactRow label="Published by" value={selection.agency} /> : null}
        </>
      );
  }
}

export default function MapDossierCard({
  areaStats,
  snapshotLabel,
  snapshotLat,
  snapshotLon,
  snapshotPrograms,
  snapshotTifFinance,
  snapshotContextSummary,
  snapshotZoneCoverageNote,
  tifFinanceLoading,
  zoningInfo,
  isGeneratingSnapshot,
  openedAt,
  selection,
  onClose,
  onDrawArea,
  onGenerateSnapshot,
}: MapDossierCardProps) {
  const activeSelection = selection;
  const contextPrograms = snapshotContextSummary?.programs ?? snapshotPrograms;
  const contextTifFinance = snapshotContextSummary?.tifFinance ?? snapshotTifFinance;
  const contextTransport = snapshotContextSummary?.transport ?? areaStats.transport;
  const contextSiteSignals = snapshotContextSummary?.siteSignals ?? areaStats.siteSignals;
  const title = activeSelection.title.trim() || snapshotLabel.trim() || "Selected location";
  const selectedPin =
    activeSelection.kind === "parcel" ||
    activeSelection.kind === "vacancy" ||
    activeSelection.kind === "permit"
      ? activeSelection.pin ?? null
      : null;
  const selectedSpace =
    activeSelection.kind === "parcel"
      ? activeSelection.space
      : activeSelection.kind === "vacancy"
        ? vacancySpaceFacts(
            activeSelection.vacancyType,
            activeSelection.space,
            activeSelection.squareFeet,
          )
        : undefined;
  const propertySpace = compactParcelSpaceFacts({
    ...selectedSpace,
    ...areaStats.space,
  });
  const dossierPin = selectedPin ?? areaStats.parcelPin;
  const nextStep = defaultNextStep(activeSelection, dossierPin);
  const parcelUrl = cookViewerUrl(dossierPin);
  const deedUrl = clerkRecordsUrl(dossierPin);
  const hasPropertyRecords = Boolean(
    dossierPin ||
      propertySpace ||
      areaStats.assessedTotal != null ||
      areaStats.ownerName ||
      areaStats.districts ||
      areaStats.districtsLoading,
  );
  const hasProgramsAndZones = Boolean(
    contextPrograms.length > 0 ||
      zoningInfo ||
      contextTifFinance ||
      tifFinanceLoading ||
      snapshotZoneCoverageNote,
  );

  return (
    <aside
      aria-label="Selected map location details"
      className="max-h-[min(58vh,520px)] w-[min(430px,calc(100vw-24px))] touch-manipulation overflow-y-auto border border-[#0C1B33]/15 bg-white shadow-xl"
      onClickCapture={(event) => {
        if (openedAt && Date.now() - openedAt < 350) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <header className="px-4 pb-4 pt-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-[#2563EB]/20 bg-[#2563EB]/5 text-[#2563EB]">
            <SelectionIcon kind={activeSelection.kind} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.16em] text-[#8A93A6]">
              {selectionKindLabel(activeSelection)}
            </div>
            <h2 className="mt-1 break-words text-[16px] font-semibold leading-tight text-[#0C1B33]">
              {title}
            </h2>
            <p className="mt-1 text-[11px] leading-snug text-[#5A6478]">
              {selectionSubtitle(activeSelection)}
            </p>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="-mr-2 -mt-2 inline-flex h-10 w-10 shrink-0 items-center justify-center text-[#5A6478] transition-colors hover:text-[#0C1B33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
            aria-label="Close property details"
            title="Close"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]">
          {selectionSummary(activeSelection, contextPrograms.length)}
        </p>

        {activeSelection.freshness?.status === "stale" ? (
          <div className="mt-3 flex gap-2 border-l-2 border-[#B45309] bg-[#FFFBEB] px-3 py-2 text-[10px] leading-relaxed text-[#78350F]">
            <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {activeSelection.freshness.note ||
                "Some selection details may be outdated."}{" "}
              Verify them against the linked public source.
              {activeSelection.freshness.asOf ? ` Records as of ${activeSelection.freshness.asOf}.` : ""}
            </p>
          </div>
        ) : null}

        <div className="mt-4 border border-[#0C1B33]/15 border-l-[3px] border-l-[#0C1B33] bg-[#0C1B33]/[0.025] p-3">
          <div className="font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.15em] text-[#8A93A6]">
            Next step
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-[#0C1B33]">{nextStep.text}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {nextStep.generateReport ? (
              <button
                type="button"
                onClick={onGenerateSnapshot}
                disabled={isGeneratingSnapshot}
                className="inline-flex min-h-9 items-center gap-1.5 bg-[#0C1B33] px-3 py-2 font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.08em] text-white transition-colors hover:bg-[#172B4D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 disabled:cursor-wait disabled:bg-[#0C1B33]/45"
              >
                <FileText aria-hidden="true" className="h-3.5 w-3.5" />
                {isGeneratingSnapshot ? "Preparing report" : "Generate location report"}
              </button>
            ) : nextStep.primaryAction ? (
              <ActionLink action={nextStep.primaryAction} primary />
            ) : null}
            {nextStep.secondaryAction ? <ActionLink action={nextStep.secondaryAction} /> : null}
          </div>
        </div>
      </header>

      <DossierSection title="Site facts">
        <SelectionFacts selection={activeSelection} />
      </DossierSection>

      {hasProgramsAndZones ? (
        <DossierSection
          title="Programs and zones"
          badge={contextPrograms.length > 0 ? `${contextPrograms.length} mapped` : "location context"}
        >
          {zoningInfo ? <FactRow label="Zoning" value={zoningInfo} /> : null}

          {/* review5 S2/S3: rendered unconditionally alongside any known
              positives below — this is a coverage caveat, not a
              replacement, and must never be hidden just because programs
              also matched or the match count is nonzero. */}
          {snapshotZoneCoverageNote ? (
            <div className="mb-3 flex gap-2 border-l-2 border-[#B45309] bg-[#FFFBEB] px-3 py-2 text-[10px] leading-relaxed text-[#78350F]">
              <CircleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>{snapshotZoneCoverageNote}</p>
            </div>
          ) : null}

          {contextPrograms.length > 0 ? (
            <div className="space-y-3">
              <div className="font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8A93A6]">
                Mapped programs to review
              </div>
              {contextPrograms.map((result) => (
                <div key={result.programId}>
                  <div className="font-medium leading-snug text-[#0C1B33]">{result.program.name}</div>
                  <p className="mt-1 text-[10px]">{mappedProgramReason(result)}</p>
                  {(result.program.sourceUrl || result.program.url) ? (
                    <a
                      href={result.program.sourceUrl || result.program.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#2563EB] underline-offset-2 hover:underline"
                    >
                      Review source
                      <ExternalLink aria-hidden="true" className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              ))}
              <p className="text-[9px] text-[#8A93A6]">
                Boundary intersection does not confirm applicant or project eligibility, funding availability, or approval.
              </p>
            </div>
          ) : null}

          {tifFinanceLoading && !contextTifFinance ? (
            <p className="italic text-[#8A93A6]">Loading TIF finance context...</p>
          ) : contextTifFinance ? (
            <div className="space-y-2 border-t border-[#0C1B33]/8 pt-3">
              <div className="font-medium text-[#0C1B33]">
                {contextTifFinance.districtName}
                {contextTifFinance.reportYear ? (
                  <span className="font-normal text-[#8A93A6]"> · {contextTifFinance.reportYear}</span>
                ) : null}
              </div>
              {contextTifFinance.fundBalance != null ? (
                <FactRow
                  label="Reported fund balance"
                  value={`$${contextTifFinance.fundBalance.toLocaleString("en-US")}`}
                />
              ) : null}
              {contextTifFinance.amountDesignatedProjectCosts != null ? (
                <FactRow
                  label="Project-cost designation"
                  value={`$${contextTifFinance.amountDesignatedProjectCosts.toLocaleString("en-US")}`}
                />
              ) : null}
              {contextTifFinance.expirationYear ? (
                <FactRow label="District expiration" value={contextTifFinance.expirationYear} />
              ) : null}
              <p className="text-[9px] text-[#8A93A6]">
                District-level City annual-report context. These figures do not indicate available project funds or approval.
              </p>
            </div>
          ) : null}
        </DossierSection>
      ) : null}

      <DossierSection title="Site activity context" badge="public measurements">
        <FactRow
          label="Median home price"
          value={areaStats.medianHomePrice}
          note="Median home sale-price context for the census tract from the public estimate used by the Explorer."
        />
        <FactRow
          label="Median household income"
          value={areaStats.medianIncome}
          note="Census-tract household-income context from the public estimate used by the Explorer."
        />
        <FactRow
          label="EPA walkability index"
          value={`${areaStats.walkScore}/20`}
          note={
            <>
              Public EPA index based on land-use diversity, intersection density, and transit proximity. It is not an Explorer match score. {" "}
              <a
                href="https://www.epa.gov/smartgrowth/smart-location-mapping#702702702702702702702702"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#2563EB] underline underline-offset-2"
              >
                EPA source
              </a>
            </>
          }
        />

        {contextTransport ? (
          <div className="space-y-2 border-t border-[#0C1B33]/8 pt-3">
            <div className="font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8A93A6]">
              Logistics access
            </div>
            {contextTransport.expressway ? (
              <FactRow
                label={contextTransport.expressway.name}
                value={formatMiles(contextTransport.expressway.miles)}
              />
            ) : null}
            {contextTransport.rail ? (
              <FactRow
                label={`Freight rail (${contextTransport.rail.name})`}
                value={formatMiles(contextTransport.rail.miles)}
              />
            ) : null}
            <FactRow label="Midway Airport" value={formatMiles(contextTransport.midwayMiles)} />
            <FactRow label="O'Hare Airport" value={formatMiles(contextTransport.ohareMiles)} />
            <p className="text-[9px] text-[#8A93A6]">
              Straight-line proximity signals, not routed travel times.
            </p>
          </div>
        ) : null}

        {contextSiteSignals ? (
          <div className="space-y-2 border-t border-[#0C1B33]/8 pt-3">
            <div className="font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8A93A6]">
              Nearby records
            </div>
            {contextSiteSignals.nofAwardsNearby > 0 ? (
              <FactRow label="NOF grants funded within 1/2 mi" value={contextSiteSignals.nofAwardsNearby} />
            ) : null}
            {contextSiteSignals.incentiveParcelsNearby > 0 ? (
              <FactRow
                label="County incentive parcels within 1/4 mi"
                value={contextSiteSignals.incentiveParcelsNearby}
              />
            ) : null}
            {contextSiteSignals.brownfield && contextSiteSignals.brownfield.miles < 0.5 ? (
              <FactRow
                label={`Brownfield record (${contextSiteSignals.brownfield.name})`}
                value={formatMiles(contextSiteSignals.brownfield.miles)}
              />
            ) : null}
            {contextSiteSignals.openLustNearby > 0 ? (
              <FactRow
                label="Open tank-leak records within 1/4 mi"
                value={contextSiteSignals.openLustNearby}
              />
            ) : null}
            <p className="text-[9px] text-[#8A93A6]">
              Nearby public records provide context only. Verify current conditions with the source agencies.
            </p>
          </div>
        ) : null}
      </DossierSection>

      {activeSelection.kind === "permit" ? (
        <DossierSection title="Building permit record" badge="published record">
          {activeSelection.permitType ? <FactRow label="Permit type" value={activeSelection.permitType} /> : null}
          {activeSelection.permitStatus ? <FactRow label="Current status text" value={activeSelection.permitStatus} /> : null}
          {activeSelection.issueDate ? <FactRow label="Issue date" value={activeSelection.issueDate} /> : null}
          {activeSelection.workDescription ? (
            <div>
              <div className="text-[#5A6478]">Authorized work description</div>
              <p className="mt-1 text-[#0C1B33]">{activeSelection.workDescription}</p>
            </div>
          ) : null}
          {activeSelection.reportedCost != null ? (
            <FactRow
              label="Applicant-reported cost"
              value={`$${activeSelection.reportedCost.toLocaleString("en-US")}`}
              note="This is the applicant's reported estimate in the permit record, not a verified investment amount, award, or available incentive budget."
            />
          ) : null}
        </DossierSection>
      ) : null}

      {hasPropertyRecords ? (
        <DossierSection title="Property and public records">
          {areaStats.parcelAddressMatch === "mismatch" && areaStats.parcelAddress ? (
            <div className="border border-[#B45309]/40 bg-[#FEF3C7]/60 p-2.5 text-[11px] leading-relaxed text-[#78350F]">
              <span className="font-semibold">Different parcel address.</span>{" "}
              These County records are for{" "}
              <span className="font-semibold">{areaStats.parcelAddress.split(",")[0]}</span>
              {areaStats.parcelRequestedAddress
                ? ` — the parcel at this location — not for ${areaStats.parcelRequestedAddress}.`
                : " — the parcel at this location, not the searched address."}{" "}
              No County parcel record was found under the searched address itself.
            </div>
          ) : null}
          {dossierPin ? (
            <>
              <StaleFactsNote stale={areaStats.parcelStale} />
              <FactRow label="PIN" value={dossierPin} />
              {areaStats.parcelAddress ? (
                <FactRow label="Parcel address" value={areaStats.parcelAddress.split(",")[0]} />
              ) : null}
              {areaStats.parcelClass ? <FactRow label="Property class" value={areaStats.parcelClass} /> : null}
              {areaStats.parcelClassDescription ? <p>{areaStats.parcelClassDescription}</p> : null}
              {areaStats.parcelValue ? <FactRow label="Recorded parcel value" value={areaStats.parcelValue} /> : null}
              {areaStats.parcelTaxCode ? <FactRow label="Tax code" value={areaStats.parcelTaxCode} /> : null}
              {areaStats.parcelTownship ? <FactRow label="Township" value={areaStats.parcelTownship} /> : null}
              {areaStats.parcelType ? <FactRow label="Parcel type" value={areaStats.parcelType} /> : null}
            </>
          ) : null}

          {propertySpace ? <SpaceFactRows space={propertySpace} /> : null}

          {areaStats.assessedTotal != null ? (
            <div className="space-y-2 border-t border-[#0C1B33]/8 pt-3">
              <div className="font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8A93A6]">
                Assessment{areaStats.taxYear ? ` · ${areaStats.taxYear}` : ""}
              </div>
              {areaStats.assessedLand != null ? (
                <FactRow label="Land" value={`$${areaStats.assessedLand.toLocaleString("en-US")}`} />
              ) : null}
              {areaStats.assessedBuilding != null ? (
                <FactRow label="Building" value={`$${areaStats.assessedBuilding.toLocaleString("en-US")}`} />
              ) : null}
              <FactRow label="Total assessed" value={`$${areaStats.assessedTotal.toLocaleString("en-US")}`} />
              {areaStats.priorYearTax != null ? (
                <FactRow label="Prior-year tax" value={`$${areaStats.priorYearTax.toLocaleString("en-US")}`} />
              ) : null}
            </div>
          ) : null}

          {areaStats.ownerName ? (
            <div className="space-y-2 border-t border-[#0C1B33]/8 pt-3">
              <FactRow label="Taxpayer of record" value={areaStats.ownerName} />
              {areaStats.ownerType && areaStats.ownerType !== "unknown" ? (
                <div className="flex items-center justify-between gap-4">
                  <span>Ownership type</span>
                  <span
                    className="border px-2 py-0.5 text-[9px] font-medium"
                    style={{
                      backgroundColor:
                        (OWNER_TYPE_COLORS[areaStats.ownerType as OwnerType] || "#9CA3AF") + "10",
                      borderColor:
                        (OWNER_TYPE_COLORS[areaStats.ownerType as OwnerType] || "#9CA3AF") + "35",
                      color: OWNER_TYPE_COLORS[areaStats.ownerType as OwnerType] || "#64748B",
                    }}
                  >
                    {OWNER_TYPE_LABELS[areaStats.ownerType as OwnerType] || areaStats.ownerType}
                  </span>
                </div>
              ) : null}
              <p className="text-[9px] text-[#8A93A6]">
                Public taxpayer records do not replace a title search. Verify current ownership and decision-makers independently.
              </p>
            </div>
          ) : null}

          {areaStats.districtsLoading && !areaStats.districts ? (
            <p className="border-t border-[#0C1B33]/8 pt-3 italic text-[#8A93A6]">Loading civic districts...</p>
          ) : areaStats.districts ? (
            <div className="space-y-2 border-t border-[#0C1B33]/8 pt-3">
              <div className="font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8A93A6]">
                Civic representation
              </div>
              {areaStats.districts.ward ? (
                <FactRow
                  label="Alderperson"
                  value={
                    areaStats.districts.officials?.alderperson?.name
                      ? `${areaStats.districts.officials.alderperson.name} · Ward ${areaStats.districts.ward}`
                      : `Ward ${areaStats.districts.ward}`
                  }
                />
              ) : null}
              {areaStats.districts.commissionerDistrict ? (
                <FactRow
                  label="Commissioner"
                  value={
                    areaStats.districts.officials?.commissioner?.name
                      ? `${areaStats.districts.officials.commissioner.name} · Dist. ${areaStats.districts.commissionerDistrict}`
                      : `Dist. ${areaStats.districts.commissionerDistrict}`
                  }
                />
              ) : null}
              {areaStats.districts.congressionalDistrict ? (
                <FactRow label="Congress" value={`IL-${areaStats.districts.congressionalDistrict}`} />
              ) : null}
              {areaStats.districts.stateHouseDistrict ? (
                <FactRow label="State House" value={`Dist. ${areaStats.districts.stateHouseDistrict}`} />
              ) : null}
              {areaStats.districts.stateSenateDistrict ? (
                <FactRow label="State Senate" value={`Dist. ${areaStats.districts.stateSenateDistrict}`} />
              ) : null}
              <p className="text-[9px] text-[#8A93A6]">Verify the current public roster before reaching out.</p>
            </div>
          ) : null}

          {parcelUrl || deedUrl ? (
            <div className="flex flex-wrap gap-3 border-t border-[#0C1B33]/8 pt-3">
              {parcelUrl ? (
                <ActionLink
                  action={{ label: "CookViewer parcel record", href: parcelUrl, external: true }}
                />
              ) : null}
              {deedUrl ? (
                <ActionLink
                  action={{ label: "Clerk deed history", href: deedUrl, external: true }}
                />
              ) : null}
            </div>
          ) : null}
        </DossierSection>
      ) : null}

      <DossierSection title="Data and sources">
        {activeSelection.sources?.length ? (
          <div className="space-y-3">
            {activeSelection.sources.map((source, index) => (
              <div key={`${source.label}-${index}`}>
                {source.href ? (
                  <a
                    href={source.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-[#2563EB] underline-offset-2 hover:underline"
                  >
                    {source.label}
                    <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <div className="font-medium text-[#0C1B33]">{source.label}</div>
                )}
                {source.asOf ? <div className="mt-0.5 text-[9px] text-[#8A93A6]">As of {source.asOf}</div> : null}
                {source.note ? <p className="mt-1 text-[9px] text-[#8A93A6]">{source.note}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <p>Source links appear when the selected map record includes a published verification destination.</p>
        )}
        <div className="space-y-1 border-t border-[#0C1B33]/8 pt-3 text-[9px] text-[#8A93A6]">
          <p>Mapped programs and boundaries are discovery signals, not eligibility determinations or funding approvals.</p>
          <p>Verify parcel ownership, site condition, and permit status with the responsible public agencies before relying on them.</p>
        </div>
      </DossierSection>

      <div className="space-y-2 border-t border-[#0C1B33]/10 px-4 py-4">
        {!nextStep.generateReport ? (
          <button
            type="button"
            onClick={onGenerateSnapshot}
            disabled={isGeneratingSnapshot}
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 bg-[#2563EB] px-3 py-2 font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 disabled:cursor-wait disabled:bg-[#2563EB]/45"
          >
            <FileText aria-hidden="true" className="h-4 w-4" />
            {isGeneratingSnapshot ? "Preparing report" : "Generate location report"}
          </button>
        ) : null}
        {snapshotLat != null && snapshotLon != null ? (
          <WatchAreaButton
            lat={snapshotLat}
            lon={snapshotLon}
            label={title}
            callbackUrl="/map"
            variant="panel"
          />
        ) : null}
        <button
          type="button"
          onClick={onDrawArea}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 border border-[#0C1B33]/15 px-3 py-2 font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.1em] text-[#5A6478] transition-colors hover:border-[#0C1B33]/35 hover:text-[#0C1B33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          <ScanLine aria-hidden="true" className="h-4 w-4" />
          Draw area analysis
        </button>
        <Link
          href="/programs"
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 border border-[#0C1B33]/15 px-3 py-2 font-mono-bureau text-[9px] font-semibold uppercase tracking-[0.1em] text-[#5A6478] transition-colors hover:border-[#0C1B33]/35 hover:text-[#0C1B33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          <LibraryBig aria-hidden="true" className="h-4 w-4" />
          Browse all programs
        </Link>
      </div>
    </aside>
  );
}
