"use client";

import Link from "next/link";
import { OWNER_TYPE_LABELS, OWNER_TYPE_COLORS, type OwnerType } from "@/lib/owner-classify";
import type { AreaStats } from "./map-helpers";
import { StaleFactsNote } from "./StaleFactsNote";
import type { SafeMapProgramMatch } from "@/lib/types";
import type { TifFinanceContext } from "@/lib/tif-finance";
import type { SafeLocationContextMapSummary } from "@/lib/location-context";
import { formatMiles } from "@/lib/transport-access";
import { siteSignalRecordGroup } from "@/lib/site-signals";
import NearbyRecordDisclosure from "./NearbyRecordDisclosure";
import { clerkRecordsUrl, cookViewerUrl } from "@/lib/cook-viewer";
import { WatchAreaButton } from "@/components/workspace/WatchAreaButton";

interface MapSnapshotPanelProps {
  areaStats: AreaStats;
  snapshotLabel: string;
  snapshotLat?: number | null;
  snapshotLon?: number | null;
  snapshotPrograms: SafeMapProgramMatch[];
  snapshotTifFinance: TifFinanceContext | null;
  snapshotContextSummary?: SafeLocationContextMapSummary | null;
  tifFinanceLoading: boolean;
  zoningInfo: string | null;
  isGeneratingSnapshot: boolean;
  openedAt?: number;
  onClose: () => void;
  onDrawArea: () => void;
  onGenerateSnapshot: () => void;
}

function mappedProgramReason(result: SafeMapProgramMatch): string {
  return result.program.zoneKey
    ? "Mapped boundary intersects this location."
    : "Included from the program catalog for further review.";
}

export default function MapSnapshotPanel({
  areaStats,
  snapshotLabel,
  snapshotLat,
  snapshotLon,
  snapshotPrograms,
  snapshotTifFinance,
  snapshotContextSummary,
  tifFinanceLoading,
  zoningInfo,
  isGeneratingSnapshot,
  openedAt,
  onClose,
  onDrawArea,
  onGenerateSnapshot,
}: MapSnapshotPanelProps) {
  const contextPrograms = snapshotContextSummary?.programs ?? snapshotPrograms;
  const contextTifFinance = snapshotContextSummary?.tifFinance ?? snapshotTifFinance;
  const contextTransport = snapshotContextSummary?.transport ?? areaStats.transport;
  const contextSiteSignals = snapshotContextSummary?.siteSignals ?? areaStats.siteSignals;
  const tifSection =
    contextTifFinance || tifFinanceLoading ? (
      <>
        <div className="mx-4 h-px bg-[#0C1B33]/8" />
        <div className="px-4 py-3">
          <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50 mb-1.5">
            TIF Funding Overview
          </div>
          {tifFinanceLoading && !contextTifFinance ? (
            <div className="text-[10px] text-[#0C1B33]/40 italic">Loading TIF finance context...</div>
          ) : contextTifFinance ? (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-[#0C1B33]/85 leading-snug">
                {contextTifFinance.districtName}
                {contextTifFinance.reportYear && (
                  <span className="text-[#0C1B33]/40"> · {contextTifFinance.reportYear}</span>
                )}
              </div>
              {contextTifFinance.fundBalance != null && (
                <div className="flex justify-between gap-3 text-[10px]">
                  <span className="text-[#0C1B33]/50">Reported fund balance</span>
                  <span className="font-mono-bureau text-[#0C1B33]/85">${contextTifFinance.fundBalance.toLocaleString()}</span>
                </div>
              )}
              {contextTifFinance.amountDesignatedProjectCosts != null && (
                <div className="flex justify-between gap-3 text-[10px]">
                  <span className="text-[#0C1B33]/50">Project-cost designation</span>
                  <span className="font-mono-bureau text-[#0C1B33]/85">${contextTifFinance.amountDesignatedProjectCosts.toLocaleString()}</span>
                </div>
              )}
              {contextTifFinance.expirationYear && (
                <div className="flex justify-between gap-3 text-[10px]">
                  <span className="text-[#0C1B33]/50">District expiration</span>
                  <span className="font-mono-bureau text-[#0C1B33]/85">{contextTifFinance.expirationYear}</span>
                </div>
              )}
              <p className="text-[9px] text-[#0C1B33]/35 leading-relaxed pt-1">
                District-level City annual report context. This does not show available funds or project approval.
              </p>
            </div>
          ) : null}
        </div>
      </>
    ) : null;

  return (
    <aside
      aria-label="Location Snapshot"
      className="absolute bottom-0 left-0 right-0 md:bottom-auto md:top-12 md:left-auto md:right-3 z-20 md:z-10 bg-white/98 md:bg-white/95 backdrop-blur border-t md:border border-[#0C1B33]/10 md:w-72 max-h-[calc(100%-8rem)] md:max-h-[calc(100%-4rem)] overflow-y-auto rounded-t-xl md:rounded-none shadow-lg md:shadow-none touch-manipulation"
      // Mobile search starts 4rem from the map top and is 3rem tall. Reserving
      // 8rem caps this bottom sheet below it with a 1rem visual gap; overflow
      // stays scrollable instead of allowing the sheet to cover place details.
      // touch-manipulation: this sheet sits over the map canvas (which Mapbox's
      // own CSS sets to touch-action:none) — without it, Safari's residual
      // double-tap/zoom gesture heuristics can still apply to the panel itself.
      // Swallow the synthetic "ghost click" iOS fires ~300ms after the map tap that opened this panel — it would otherwise hit the ×, a link, or Generate.
      onClickCapture={(e) => {
        if (openedAt && Date.now() - openedAt < 350) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {/* Mobile drag handle */}
      <div className="md:hidden flex flex-col items-center pt-2 pb-1">
        <div className="w-10 h-1 bg-[#0C1B33]/15 rounded-full" />
      </div>

      <div className="px-4 pt-2 md:pt-4 pb-1 flex items-center justify-between">
        <div className="font-mono-bureau text-[10px] md:text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30">
          Location Snapshot
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="text-[#0C1B33]/30 hover:text-[#0C1B33]/60 text-[20px] md:text-[16px] leading-none transition-colors p-2 -mr-1"
          title="Close"
        >
          &times;
        </button>
      </div>

      {/* Location label */}
      <div className="px-4 pb-3">
        <div className="text-[13px] md:text-[11px] font-medium text-[#0C1B33]/80 leading-tight">
          {snapshotLabel}
        </div>
        <div className="text-[9px] text-[#0C1B33]/30 mt-0.5 font-mono-bureau tracking-wide">
          Search or tap the map to update
        </div>
      </div>

      {/* Mobile eligibility glance + primary CTA (search-first / conversion-led) */}
      <div className="md:hidden px-4 pb-3">
        <div className="flex items-center gap-2 mb-2.5">
          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold ${contextPrograms.length > 0 ? "bg-[#2563EB]/10 text-[#2563EB]" : "bg-[#0C1B33]/5 text-[#0C1B33]/40"}`}>
            {contextPrograms.length > 0 ? "✓" : "—"}
          </span>
          <span className="text-[13px] text-[#0C1B33]/75 leading-tight">
            {contextPrograms.length > 0
              ? `${contextPrograms.length} mapped program${contextPrograms.length !== 1 ? "s" : ""} to review here`
              : "Reviewing mapped programs…"}
          </span>
        </div>
        <button
          type="button"
          onClick={onGenerateSnapshot}
          disabled={isGeneratingSnapshot}
          className="block w-full text-center font-mono-bureau text-[11px] tracking-[0.15em] uppercase bg-[#2563EB] text-white py-3.5 rounded-lg shadow-sm hover:bg-[#1d4ed8] disabled:bg-[#2563EB]/45 transition-colors"
        >
          {isGeneratingSnapshot ? "Preparing report…" : "Generate report →"}
        </button>
      </div>

      {tifSection && <div className="md:hidden">{tifSection}</div>}

      <div className="mx-4 h-px bg-[#0C1B33]/8" />

      {/* Stats */}
      <div className="px-4 pt-3 pb-3 space-y-3">
        <div>
          <div className="flex justify-between items-baseline">
            <span className="text-[11px] text-[#0C1B33]/60">Median Home Price</span>
            <span className="font-mono-bureau text-[13px] text-[#0C1B33]/90 font-medium">
              {areaStats.medianHomePrice}
            </span>
          </div>
          <p className="text-[9px] text-[#0C1B33]/30 mt-0.5 leading-relaxed">
            Median sale price of homes in this census tract (ACS 5-Year Estimate).
          </p>
        </div>

        <div>
          <div className="flex justify-between items-baseline">
            <span className="text-[11px] text-[#0C1B33]/60">Median Income</span>
            <span className="font-mono-bureau text-[13px] text-[#0C1B33]/90 font-medium">
              {areaStats.medianIncome}
            </span>
          </div>
          <p className="text-[9px] text-[#0C1B33]/30 mt-0.5 leading-relaxed">
            Median household income for the tract, used to determine HUD low-income eligibility.
          </p>
        </div>

        <div>
          <div className="flex justify-between items-baseline">
            <span className="text-[11px] text-[#0C1B33]/60">EPA Walkability Index</span>
            <div className="flex items-center gap-2">
              <div className="w-14 h-1.5 bg-[#0C1B33]/10 overflow-hidden">
                <div
                  className="h-full bg-[#2563EB]"
                  style={{ width: `${(areaStats.walkScore / 20) * 100}%` }}
                />
              </div>
              <span className="font-mono-bureau text-[13px] text-[#0C1B33]/90 font-medium">
                {areaStats.walkScore}/20
              </span>
            </div>
          </div>
          <p className="text-[9px] text-[#0C1B33]/30 mt-0.5 leading-relaxed">
            Scores land use diversity, intersection density, and transit proximity.{" "}
            <a href="https://www.epa.gov/smartgrowth/smart-location-mapping#702702702702702702702702" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#2563EB]/60">EPA Smart Location Database</a>
          </p>
        </div>
      </div>

      {/* Logistics access */}
      {contextTransport && (
        <>
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 py-3">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#475569]/60 mb-1.5">
              Logistics Access
            </div>
            <div className="space-y-1">
              {contextTransport.expressway && (
                <div className="flex justify-between items-baseline gap-2 text-[10px]">
                  <span className="text-[#0C1B33]/50 truncate">{contextTransport.expressway.name}</span>
                  <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0">
                    {formatMiles(contextTransport.expressway.miles)}
                  </span>
                </div>
              )}
              {contextTransport.rail && (
                <div className="flex justify-between items-baseline gap-2 text-[10px]">
                  <span className="text-[#0C1B33]/50 truncate">Freight rail ({contextTransport.rail.name})</span>
                  <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0">
                    {formatMiles(contextTransport.rail.miles)}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-baseline gap-2 text-[10px]">
                <span className="text-[#0C1B33]/50">Midway Airport</span>
                <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0">
                  {formatMiles(contextTransport.midwayMiles)}
                </span>
              </div>
              <div className="flex justify-between items-baseline gap-2 text-[10px]">
                <span className="text-[#0C1B33]/50">O&apos;Hare Airport</span>
                <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0">
                  {formatMiles(contextTransport.ohareMiles)}
                </span>
              </div>
            </div>
            <p className="text-[9px] text-[#0C1B33]/30 mt-1.5 leading-relaxed">
              Straight-line distances to the nearest expressway, freight rail main line, and airports.
            </p>
          </div>
        </>
      )}

      {/* Site signals */}
      {contextSiteSignals && (
        <>
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 py-3">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#78350F]/60 mb-1.5">
              Site Signals
            </div>
            <div className="space-y-1">
              {contextSiteSignals.nofAwardsNearby > 0 && (
                <NearbyRecordDisclosure
                  variant="compact"
                  label="NOF grants funded within 1/2 mi"
                  value={contextSiteSignals.nofAwardsNearby}
                  valueClassName="font-mono-bureau text-[#047857] font-medium"
                  group={siteSignalRecordGroup(contextSiteSignals, "nofAwards")}
                />
              )}
              {contextSiteSignals.incentiveParcelsNearby > 0 && (
                <NearbyRecordDisclosure
                  variant="compact"
                  label="County incentive parcels within 1/4 mi"
                  value={contextSiteSignals.incentiveParcelsNearby}
                  group={siteSignalRecordGroup(contextSiteSignals, "incentiveParcels")}
                />
              )}
              {contextSiteSignals.brownfield && contextSiteSignals.brownfield.miles < 0.5 && (
                <NearbyRecordDisclosure
                  variant="compact"
                  truncateLabel
                  label={`Brownfield site (${contextSiteSignals.brownfield.name})`}
                  value={formatMiles(contextSiteSignals.brownfield.miles)}
                  group={siteSignalRecordGroup(contextSiteSignals, "brownfields")}
                />
              )}
              {contextSiteSignals.openLustNearby > 0 && (
                <NearbyRecordDisclosure
                  variant="compact"
                  label="Open tank-leak incidents within 1/4 mi"
                  value={contextSiteSignals.openLustNearby}
                  valueClassName="font-mono-bureau text-[#B91C1C] font-medium"
                  group={siteSignalRecordGroup(contextSiteSignals, "openLust")}
                />
              )}
              {contextSiteSignals.nofAwardsNearby === 0 &&
                contextSiteSignals.incentiveParcelsNearby === 0 &&
                contextSiteSignals.openLustNearby === 0 &&
                (!contextSiteSignals.brownfield || contextSiteSignals.brownfield.miles >= 0.5) && (
                  <div className="text-[10px] text-[#0C1B33]/40 italic">No nearby signals</div>
                )}
            </div>
            <p className="text-[9px] text-[#0C1B33]/30 mt-1.5 leading-relaxed">
              Nearby funding precedents and environmental flags from public data. Verify with the administering agencies before relying on them.
            </p>
          </div>
        </>
      )}

      {/* Parcel info */}
      {areaStats.parcelPin && (
        <>
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 py-3">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#7C3AED]/50 mb-1">
              Parcel
            </div>
            <StaleFactsNote stale={areaStats.parcelStale} className="mb-2" />
            {areaStats.parcelAddressMatch === "mismatch" && areaStats.parcelAddress && (
              <div className="mb-2 border border-[#B45309]/40 bg-[#FEF3C7]/60 p-2 text-[10px] leading-relaxed text-[#78350F]">
                <span className="font-semibold">Different parcel address.</span>{" "}
                This record is for{" "}
                <span className="font-semibold">{areaStats.parcelAddress.split(",")[0]}</span>
                {areaStats.parcelRequestedAddress
                  ? ` — the parcel at this location — not for ${areaStats.parcelRequestedAddress}.`
                  : " — the parcel at this location, not the searched address."}
              </div>
            )}
            <div className="text-[12px] text-[#0C1B33]/80">
              <a
                href={`https://www.cookcountyassessoril.gov/pin/${areaStats.parcelPin}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#2563EB] hover:underline"
              >
                {areaStats.parcelPin}
              </a>
              {areaStats.parcelAddress && (
                <span className="text-[#0C1B33]/50"> · {areaStats.parcelAddress.split(",")[0]}</span>
              )}
              {areaStats.parcelClass && <span className="text-[#0C1B33]/50"> · Class {areaStats.parcelClass}</span>}
              {areaStats.parcelValue && <span className="text-[#0C1B33]/50"> · {areaStats.parcelValue}</span>}
            </div>
            {areaStats.parcelClassDescription && (
              <div className="text-[10px] text-[#0C1B33]/40 mt-0.5 italic">
                {areaStats.parcelClassDescription}
              </div>
            )}
            {/* Tax Code, Township, Parcel Type row */}
            {(areaStats.parcelTaxCode || areaStats.parcelTownship || areaStats.parcelType) && (
              <div className="flex gap-3 mt-1.5 font-mono-bureau text-[9px] text-[#0C1B33]/50">
                {areaStats.parcelTaxCode && <span>Tax Code {areaStats.parcelTaxCode}</span>}
                {areaStats.parcelTownship && <span>{areaStats.parcelTownship}</span>}
                {areaStats.parcelType && <span>{areaStats.parcelType}</span>}
              </div>
            )}
            {/* Property and ownership records pair the public parcel record with
                deed history. Taxpayer data remains a lead, never a title finding. */}
            {cookViewerUrl(areaStats.parcelPin) && (
              <div className="mt-2">
                <div className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/35">
                  Property &amp; ownership records
                </div>
                <div className="mt-1">
                  <a
                    href={cookViewerUrl(areaStats.parcelPin)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[#2563EB] hover:underline"
                  >
                    View parcel &amp; ownership details in CookViewer ↗
                  </a>
                  <div className="text-[9px] text-[#0C1B33]/40 mt-0.5">
                    Opens Cook County&rsquo;s official parcel record in a new tab.
                  </div>
                </div>
                <div className="mt-1.5">
                  <a
                    href={clerkRecordsUrl(areaStats.parcelPin)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[#2563EB] hover:underline"
                  >
                    View deeds and ownership history at the Cook County Clerk ↗
                  </a>
                  <div className="text-[9px] text-[#0C1B33]/40 mt-0.5">
                    Review recorded deeds, grantors, grantees, liens, releases, and other documents
                    associated with this parcel.
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Assessment */}
      {areaStats.assessedTotal != null && (
        <>
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 py-3">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#059669]/50 mb-1.5">
              Assessment{areaStats.taxYear ? ` (${areaStats.taxYear})` : ""}
            </div>
            <div className="space-y-0.5">
              {areaStats.assessedLand != null && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-[#0C1B33]/50">Land</span>
                  <span className="font-mono-bureau text-[#0C1B33]/80">${areaStats.assessedLand.toLocaleString()}</span>
                </div>
              )}
              {areaStats.assessedBuilding != null && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-[#0C1B33]/50">Building</span>
                  <span className="font-mono-bureau text-[#0C1B33]/80">${areaStats.assessedBuilding.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-[10px] font-medium">
                <span className="text-[#0C1B33]/60">Total Assessed</span>
                <span className="font-mono-bureau text-[#0C1B33]/90">${areaStats.assessedTotal.toLocaleString()}</span>
              </div>
              {areaStats.priorYearTax != null && (
                <div className="flex justify-between text-[10px] mt-1 pt-1 border-t border-[#0C1B33]/5">
                  <span className="text-[#0C1B33]/50">Prior Year Tax</span>
                  <span className="font-mono-bureau text-[#0C1B33]/80">${areaStats.priorYearTax.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Ownership */}
      {areaStats.ownerName && (
        <>
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 py-3">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#7C3AED]/50 mb-1.5">
              Taxpayer of Record
            </div>
            <div className="text-[11px] font-medium text-[#0C1B33]/90 mb-1">
              {areaStats.ownerName}
            </div>
            {areaStats.ownerType && areaStats.ownerType !== "unknown" && (
              <span
                className="inline-block text-[9px] font-medium px-2 py-0.5 rounded"
                style={{
                  backgroundColor: (OWNER_TYPE_COLORS[areaStats.ownerType as OwnerType] || "#9CA3AF") + "15",
                  color: OWNER_TYPE_COLORS[areaStats.ownerType as OwnerType] || "#9CA3AF",
                  border: `1px solid ${(OWNER_TYPE_COLORS[areaStats.ownerType as OwnerType] || "#9CA3AF")}30`,
                }}
              >
                {OWNER_TYPE_LABELS[areaStats.ownerType as OwnerType] || areaStats.ownerType}
              </span>
            )}
            <p className="text-[9px] text-[#0C1B33]/35 leading-relaxed pt-1">
              Public taxpayer records do not replace a title search. Verify current ownership and decision-makers independently.
            </p>
          </div>
        </>
      )}

      {/* Civic representation */}
      {(areaStats.districts || areaStats.districtsLoading) && (
        <>
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 py-3">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#D97706]/50 mb-1.5">
              Civic Representation
            </div>
            {areaStats.districtsLoading && !areaStats.districts ? (
              <div className="text-[10px] text-[#0C1B33]/40 italic">Loading districts...</div>
            ) : areaStats.districts ? (
              <div className="space-y-0.5">
                {areaStats.districts.ward && (
                  <div className="flex justify-between gap-3 text-[10px]">
                    <span className="text-[#0C1B33]/50 shrink-0">Alderperson</span>
                    <span className="font-mono-bureau text-[#0C1B33]/80 text-right">
                      {areaStats.districts.officials?.alderperson?.name
                        ? `${areaStats.districts.officials.alderperson.name} · Ward ${areaStats.districts.ward}`
                        : `Ward ${areaStats.districts.ward}`}
                    </span>
                  </div>
                )}
                {areaStats.districts.commissionerDistrict && (
                  <div className="flex justify-between gap-3 text-[10px]">
                    <span className="text-[#0C1B33]/50 shrink-0">Commissioner</span>
                    <span className="font-mono-bureau text-[#0C1B33]/80 text-right">
                      {areaStats.districts.officials?.commissioner?.name
                        ? `${areaStats.districts.officials.commissioner.name} · Dist. ${areaStats.districts.commissionerDistrict}`
                        : `Dist. ${areaStats.districts.commissionerDistrict}`}
                    </span>
                  </div>
                )}
                {areaStats.districts.congressionalDistrict && (
                  <div className="flex justify-between gap-3 text-[10px]">
                    <span className="text-[#0C1B33]/50 shrink-0">Congress</span>
                    <span className="font-mono-bureau text-[#0C1B33]/80 text-right">
                      {areaStats.districts.officials?.congressionalRepresentative?.name
                        ? `${areaStats.districts.officials.congressionalRepresentative.name} · IL-${areaStats.districts.congressionalDistrict}`
                        : `IL-${areaStats.districts.congressionalDistrict}`}
                    </span>
                  </div>
                )}
                {areaStats.districts.stateHouseDistrict && (
                  <div className="flex justify-between gap-3 text-[10px]">
                    <span className="text-[#0C1B33]/50 shrink-0">State Rep</span>
                    <span className="font-mono-bureau text-[#0C1B33]/80 text-right">
                      {areaStats.districts.officials?.stateRepresentative?.name
                        ? `${areaStats.districts.officials.stateRepresentative.name} · Dist. ${areaStats.districts.stateHouseDistrict}`
                        : `Dist. ${areaStats.districts.stateHouseDistrict}`}
                    </span>
                  </div>
                )}
                {areaStats.districts.stateSenateDistrict && (
                  <div className="flex justify-between gap-3 text-[10px]">
                    <span className="text-[#0C1B33]/50 shrink-0">State Senate</span>
                    <span className="font-mono-bureau text-[#0C1B33]/80 text-right">
                      {areaStats.districts.officials?.stateSenator?.name
                        ? `${areaStats.districts.officials.stateSenator.name} · Dist. ${areaStats.districts.stateSenateDistrict}`
                        : `Dist. ${areaStats.districts.stateSenateDistrict}`}
                    </span>
                  </div>
                )}
                {areaStats.districts.officials && (
                  <div className="pt-1 text-[9px] text-[#0C1B33]/35">
                    Current public roster lookup; verify before reaching out.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </>
      )}

      {tifSection && <div className="hidden md:block">{tifSection}</div>}

      {/* Zoning info */}
      {zoningInfo && (
        <>
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 py-3">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#059669]/50 mb-1">
              Zoning
            </div>
            <div className="text-[12px] text-[#0C1B33]/80">{zoningInfo}</div>
          </div>
        </>
      )}

      {/* Top 3 Programs Here */}
      {contextPrograms.length > 0 && (
        <>
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 pt-3 pb-2">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50 mb-2">
              Mapped Programs to Review
            </div>
            <div className="space-y-1.5">
              {contextPrograms.map((r) => (
                <div key={r.programId} className="space-y-0.5">
                  <div className="text-[10px] text-[#0C1B33]/70 leading-snug">
                    {r.program.name}
                  </div>
                  <p className="text-[9px] leading-relaxed text-[#0C1B33]/45">
                    {mappedProgramReason(r)}
                  </p>
                  {(r.program.sourceUrl || r.program.url) && (
                    <a
                      href={r.program.sourceUrl || r.program.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#2563EB] underline-offset-2 hover:underline"
                    >
                      Review source
                    </a>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[9px] text-[#0C1B33]/35 leading-relaxed pt-2">
              Boundary intersection does not confirm applicant or project eligibility, funding availability, or approval.
            </p>
          </div>
        </>
      )}

      {/* Actions */}
      <div className="mx-4 h-px bg-[#0C1B33]/8" />
      <div className="px-4 py-3 space-y-2">
        <button
          type="button"
          onClick={onGenerateSnapshot}
          disabled={isGeneratingSnapshot}
          className="hidden md:block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase bg-[#2563EB] text-white py-2 px-3 hover:bg-[#1d4ed8] disabled:bg-[#2563EB]/45 transition-colors"
        >
          {isGeneratingSnapshot ? "Preparing Snapshot" : "Generate Location Snapshot"}
        </button>
        {snapshotLat != null && snapshotLon != null && (
          <WatchAreaButton
            lat={snapshotLat}
            lon={snapshotLon}
            label={snapshotLabel}
            callbackUrl="/map"
            variant="panel"
          />
        )}
        <button
          onClick={onDrawArea}
          className="block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase border border-[#0C1B33]/15 text-[#0C1B33]/60 py-2 px-3 hover:text-[#0C1B33] hover:border-[#0C1B33]/30 transition-colors"
        >
          Draw Area Analysis
        </button>
        <Link
          href="/programs"
          className="block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase border border-[#0C1B33]/15 text-[#0C1B33]/60 py-2 px-3 hover:text-[#0C1B33] hover:border-[#0C1B33]/30 transition-colors"
        >
          Browse All Programs
        </Link>
      </div>
    </aside>
  );
}
