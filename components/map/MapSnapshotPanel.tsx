"use client";

import { OWNER_TYPE_LABELS, OWNER_TYPE_COLORS, type OwnerType } from "@/lib/owner-classify";
import { formatMiles } from "@/lib/transport-access";
import type { AreaStats } from "./map-helpers";
import type { ProgramCheckResult } from "@/lib/types";

interface MapSnapshotPanelProps {
  areaStats: AreaStats;
  snapshotLabel: string;
  snapshotPrograms: ProgramCheckResult[];
  zoningInfo: string | null;
  isGeneratingSnapshot: boolean;
  onClose: () => void;
  onDrawArea: () => void;
  onGenerateSnapshot: () => void;
}

export default function MapSnapshotPanel({
  areaStats,
  snapshotLabel,
  snapshotPrograms,
  zoningInfo,
  isGeneratingSnapshot,
  onClose,
  onDrawArea,
  onGenerateSnapshot,
}: MapSnapshotPanelProps) {
  return (
    <div className="absolute bottom-0 left-0 right-0 md:bottom-auto md:top-12 md:left-auto md:right-3 z-20 md:z-10 bg-white/98 md:bg-white/95 backdrop-blur border-t md:border border-[#0C1B33]/10 md:w-72 max-h-[60vh] md:max-h-[calc(100%-4rem)] overflow-y-auto rounded-t-xl md:rounded-none shadow-lg md:shadow-none">
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
        <div className="text-[11px] font-medium text-[#0C1B33]/80 leading-tight">
          {snapshotLabel}
        </div>
        <div className="text-[9px] text-[#0C1B33]/30 mt-0.5 font-mono-bureau tracking-wide">
          Search or click map to update
        </div>
      </div>

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
      {areaStats.transport && (
        <>
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 py-3">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0E7490]/60 mb-1.5">
              Logistics Access
            </div>
            <div className="space-y-1">
              {areaStats.transport.expressway && (
                <div className="flex justify-between items-baseline gap-2 text-[10px]">
                  <span className="text-[#0C1B33]/50 truncate">{areaStats.transport.expressway.name}</span>
                  <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0">{formatMiles(areaStats.transport.expressway.miles)}</span>
                </div>
              )}
              {areaStats.transport.rail && (
                <div className="flex justify-between items-baseline gap-2 text-[10px]">
                  <span className="text-[#0C1B33]/50 truncate">Freight rail ({areaStats.transport.rail.name})</span>
                  <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0">{formatMiles(areaStats.transport.rail.miles)}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline gap-2 text-[10px]">
                <span className="text-[#0C1B33]/50">Midway Airport</span>
                <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0">{formatMiles(areaStats.transport.midwayMiles)}</span>
              </div>
              <div className="flex justify-between items-baseline gap-2 text-[10px]">
                <span className="text-[#0C1B33]/50">O&apos;Hare Airport</span>
                <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0">{formatMiles(areaStats.transport.ohareMiles)}</span>
              </div>
            </div>
            <p className="text-[9px] text-[#0C1B33]/30 mt-1.5 leading-relaxed">
              Straight-line distances to the nearest expressway, freight rail main line, and airports.
            </p>
          </div>
        </>
      )}

      {/* Site signals */}
      {areaStats.siteSignals && (
        <>
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 py-3">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#78350F]/60 mb-1.5">
              Site Signals
            </div>
            <div className="space-y-1">
              {areaStats.siteSignals.nofAwardsNearby > 0 && (
                <div className="flex justify-between items-baseline gap-2 text-[10px]">
                  <span className="text-[#0C1B33]/50">NOF grants funded within ½ mi</span>
                  <span className="font-mono-bureau text-[#047857] font-medium shrink-0">{areaStats.siteSignals.nofAwardsNearby}</span>
                </div>
              )}
              {areaStats.siteSignals.incentiveParcelsNearby > 0 && (
                <div className="flex justify-between items-baseline gap-2 text-[10px]">
                  <span className="text-[#0C1B33]/50">County incentive parcels within ¼ mi</span>
                  <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0">{areaStats.siteSignals.incentiveParcelsNearby}</span>
                </div>
              )}
              {areaStats.siteSignals.brownfield && areaStats.siteSignals.brownfield.miles < 0.5 && (
                <div className="flex justify-between items-baseline gap-2 text-[10px]">
                  <span className="text-[#0C1B33]/50 truncate">Brownfield site ({areaStats.siteSignals.brownfield.name})</span>
                  <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0">{formatMiles(areaStats.siteSignals.brownfield.miles)}</span>
                </div>
              )}
              {areaStats.siteSignals.openLustNearby > 0 && (
                <div className="flex justify-between items-baseline gap-2 text-[10px]">
                  <span className="text-[#0C1B33]/50">Open tank-leak incidents within ¼ mi</span>
                  <span className="font-mono-bureau text-[#B91C1C] font-medium shrink-0">{areaStats.siteSignals.openLustNearby}</span>
                </div>
              )}
              {areaStats.siteSignals.nofAwardsNearby === 0 &&
                areaStats.siteSignals.incentiveParcelsNearby === 0 &&
                areaStats.siteSignals.openLustNearby === 0 &&
                (!areaStats.siteSignals.brownfield || areaStats.siteSignals.brownfield.miles >= 0.5) && (
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
            <div className="text-[12px] text-[#0C1B33]/80">
              <a
                href={`https://www.cookcountyassessoril.gov/pin/${areaStats.parcelPin}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#2563EB] hover:underline"
              >
                {areaStats.parcelPin}
              </a>
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
              Property Owner
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
          </div>
        </>
      )}

      {/* Districts */}
      {(areaStats.districts || areaStats.districtsLoading) && (
        <>
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 py-3">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#D97706]/50 mb-1.5">
              Districts
            </div>
            {areaStats.districtsLoading && !areaStats.districts ? (
              <div className="text-[10px] text-[#0C1B33]/40 italic">Loading districts...</div>
            ) : areaStats.districts ? (
              <div className="space-y-0.5">
                {areaStats.districts.ward && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-[#0C1B33]/50">Ward</span>
                    <span className="font-mono-bureau text-[#0C1B33]/80">{areaStats.districts.ward}</span>
                  </div>
                )}
                {areaStats.districts.commissionerDistrict && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-[#0C1B33]/50">Commissioner</span>
                    <span className="font-mono-bureau text-[#0C1B33]/80">Dist. {areaStats.districts.commissionerDistrict}</span>
                  </div>
                )}
                {areaStats.districts.congressionalDistrict && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-[#0C1B33]/50">Congressional</span>
                    <span className="font-mono-bureau text-[#0C1B33]/80">IL-{areaStats.districts.congressionalDistrict}</span>
                  </div>
                )}
                {areaStats.districts.stateHouseDistrict && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-[#0C1B33]/50">State Rep</span>
                    <span className="font-mono-bureau text-[#0C1B33]/80">Dist. {areaStats.districts.stateHouseDistrict}</span>
                  </div>
                )}
                {areaStats.districts.stateSenateDistrict && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-[#0C1B33]/50">State Senate</span>
                    <span className="font-mono-bureau text-[#0C1B33]/80">Dist. {areaStats.districts.stateSenateDistrict}</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </>
      )}

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
      {snapshotPrograms.length > 0 && (
        <>
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 pt-3 pb-2">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50 mb-2">
              Top Programs Here
            </div>
            <div className="space-y-1.5">
              {snapshotPrograms.map((r) => (
                <div key={r.programId}>
                  <div className="text-[10px] text-[#0C1B33]/70 leading-snug">
                    {r.program.name}
                  </div>
                  <div className="font-mono-bureau text-[8px] text-[#0C1B33]/40 mt-0.5">
                    {r.benefitRange}
                  </div>
                </div>
              ))}
            </div>
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
          className="block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase bg-[#2563EB] text-white py-2 px-3 hover:bg-[#1d4ed8] disabled:bg-[#2563EB]/45 transition-colors"
        >
          {isGeneratingSnapshot ? "Preparing Snapshot" : "Generate Location Snapshot"}
        </button>
        <button
          onClick={onDrawArea}
          className="block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase border border-[#0C1B33]/15 text-[#0C1B33]/60 py-2 px-3 hover:text-[#0C1B33] hover:border-[#0C1B33]/30 transition-colors"
        >
          Draw Area Analysis
        </button>
        <a
          href="/programs"
          className="block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase border border-[#0C1B33]/15 text-[#0C1B33]/60 py-2 px-3 hover:text-[#0C1B33] hover:border-[#0C1B33]/30 transition-colors"
        >
          Browse All Programs
        </a>
      </div>
    </div>
  );
}
