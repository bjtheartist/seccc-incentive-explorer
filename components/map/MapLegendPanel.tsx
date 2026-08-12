"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import {
  ZONE_COLORS,
  ZONE_LABELS,
  ZONE_KEYS_SORTED,
  ZONE_DESCRIPTIONS,
  ZONE_LEARN_MORE,
  ZONE_META,
  LEVELS,
  LEVEL_COLORS,
  ZONING_CATEGORIES,
  ZONING_CODE_DESCRIPTIONS,
  VACANT_COLORS,
  VACANT_LABELS,
} from "@/lib/constants";
import type { ProgramLevel } from "@/lib/types";
import {
  OWNER_TYPE_COLORS,
  OWNER_TYPE_LABELS,
  type OwnerType,
} from "@/lib/owner-classify";
import { CLASS_CODE_MAP } from "@/lib/parcel-classes";
import { MAP_PRESETS, POI_LAYERS, formatAwardedAmount } from "./map-helpers";
import {
  NESTED_ZONE_PARENTS,
  ZONE_LAYER_PRESETS,
  activeZoneLayerPreset,
  planZoneLayerPresetToggles,
  type ZoneLayerPresetId,
  type ZoneLayerPresetShape,
} from "./map-layer-presets";
import {
  DEFAULT_INVESTMENT_YEAR_RANGE,
  FUNDER_TYPE_COLORS,
  FUNDER_TYPE_LABELS,
  INVESTMENT_YEAR_RANGES,
  CAPITAL_CLASS_LABELS,
  CAPITAL_CLASS_MONEY_NOUN,
  CAPITAL_CLASS_OUTLINE,
  MEGAPROJECT_STATUS_GROUPS,
  MEGAPROJECT_STATUS_GROUP_LABELS,
  MEGAPROJECT_STATUS_GROUP_COLORS,
  MEGAPROJECT_ANNOUNCED_CAPITAL_LABEL,
  type MegaprojectSummary,
} from "@/lib/community-investment-layer";
import {
  DEFAULT_INVESTMENT_VIEW_MODE,
  INVESTMENT_VIEW_MODES,
  INVESTMENT_VIEW_MODE_LABELS,
  DENSITY_RAMP_HEXES,
  HEXAGON_RADIUS_M,
  DEFAULT_INVESTMENT_DENSITY_METRIC,
  INVESTMENT_DENSITY_METRICS,
  type InvestmentViewMode,
  type InvestmentDensityMetric,
} from "@/lib/investment-deck-modes";
import type { CapitalClass, FunderType } from "@/lib/community-investment";
import {
  GOVERNMENT_FUNDING_PURPOSE_LABELS,
  type GovernmentFundingPurpose,
} from "@/lib/government-funding-purpose";
import {
  DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY,
  PUBLIC_INVESTMENT_OVERLAY_COLORS,
  PUBLIC_INVESTMENT_OVERLAYS,
  type PublicInvestmentOverlayId,
  type PublicInvestmentOverlayVisibility,
} from "@/lib/public-investment-overlays";
import { PERMIT_MAP_TYPES, type PermitMapTypeKey } from "@/lib/permit-map";

interface MapLegendPanelProps {
  zoneVisible: Record<string, boolean>;
  poiVisible: Record<string, boolean>;
  zoningVisible: Record<string, boolean>;
  vacantVisible: Record<string, boolean>;
  parcelsVisible: boolean;
  permitsVisible?: boolean;
  permitTypeVisible?: Record<PermitMapTypeKey, boolean>;
  ownerFilter: OwnerType | "all";
  expandedZone: string | null;
  zoningRefOpen: boolean;
  classRefOpen: boolean;
  inspectMode: boolean;
  activePreset: string | null;
  /** Owner Files admin session probe result (components/map/MapView.tsx probes /api/owner-file/session once on mount). Gates the entire ADMIN section. */
  adminSessionActive: boolean;
  ownerClustersVisible: boolean;
  ownerClustersLoading?: boolean;
  ownerClustersError?: string | null;
  /** Owner types actually present in the loaded ownership-cluster data, in legend order — drives the color key below the toggle. */
  ownerClustersPresentTypes?: OwnerType[];
  /* ── Admin "Community investment" layer (gated on the same adminSessionActive) ── */
  communityInvestmentVisible?: boolean;
  communityInvestmentLoading?: boolean;
  communityInvestmentError?: string | null;
  /** Funder types actually present among the plotted points, in FUNDER_TYPE_ORDER — drives the funderType checkboxes. */
  investmentPresentFunderTypes?: FunderType[];
  /** Government funding purposes present among plotted base dots. */
  investmentPresentGovernmentFundingPurposes?: GovernmentFundingPurpose[];
  /** Capital classes present among plotted dots, in CAPITAL_CLASS_ORDER — drives the capital-class sub-legend. */
  investmentPresentCapitalClasses?: CapitalClass[];
  /** Count of tracked foundation HQs — the Arcs "Foundation flows (N tracked HQs)" honest label. */
  investmentFunderHqCount?: number;
  /** Active year-range chip id (INVESTMENT_YEAR_RANGES); defaults to "all". */
  investmentYearRange?: string;
  /** Per-funderType checkbox state (client-side filter). */
  investmentFunderTypes?: Record<FunderType, boolean>;
  /** Per-purpose checkbox state for government-funded base dots. */
  investmentGovernmentFundingPurposes?: Record<GovernmentFundingPurpose, boolean>;
  /** Citywide-geometry summary (count + total awarded dollars) — records that never plot as dots. */
  investmentCitywide?: { count: number; totalDollars: number } | null;
  /** Active admin view mode (Dots | Arcs | Density); defaults to "dots". */
  investmentViewMode?: InvestmentViewMode;
  /** Active density metric (dollars | records); defaults to "dollars". */
  investmentDensityMetric?: InvestmentDensityMetric;
  /** Arcs-mode fallback: philanthropic grants with no mapped funder HQ, shown as dots. */
  investmentArcMissingHqCount?: number;
  /** Megaprojects overlay summary: per-status-group counts + total announced capital. */
  investmentMegaprojectSummary?: MegaprojectSummary | null;
  /** Megaprojects overlay: names of the citywide (non-plotting) development projects. */
  investmentMegaprojectCitywideNames?: string[];
  /** Independent Megaprojects overlay state; can be combined with any base view. */
  investmentMegaprojectsVisible?: boolean;
  /** Independent historical/public-capital overlays, both default off. */
  publicInvestmentOverlays?: PublicInvestmentOverlayVisibility;
  countyReliefZipCount?: number;
  state2020ReliefZipCount?: number;
  state2020HospitalityCitywideCount?: number;
  stateRecoveryZipCount?: number;
  federalRestaurantReliefPlottedCount?: number;
  federalRestaurantReliefCitywideCount?: number;
  stateCapitalPlottedCount?: number;
  stateCapitalCitywideCount?: number;
  onSetCommunityInvestmentVisible?: (value: boolean) => void;
  onSetInvestmentYearRange?: (id: string) => void;
  onSetInvestmentViewMode?: (mode: InvestmentViewMode) => void;
  onSetInvestmentDensityMetric?: (metric: InvestmentDensityMetric) => void;
  onSetInvestmentMegaprojectsVisible?: (value: boolean) => void;
  onSetPublicInvestmentOverlay?: (id: PublicInvestmentOverlayId, value: boolean) => void;
  onToggleInvestmentFunderType?: (key: FunderType) => void;
  onToggleInvestmentGovernmentFundingPurpose?: (key: GovernmentFundingPurpose) => void;
  onClose: () => void;
  onToggleZone: (key: string) => void;
  onTogglePoi: (key: string) => void;
  onToggleZoningCategory: (catKey: string) => void;
  onToggleAllZoning: () => void;
  onSetVacantVisible: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSetParcelsVisible: React.Dispatch<React.SetStateAction<boolean>>;
  onSetPermitsVisible?: (value: boolean) => void;
  onSetPermitTypeVisible?: React.Dispatch<
    React.SetStateAction<Record<PermitMapTypeKey, boolean>>
  >;
  onSetOwnerFilter: (value: OwnerType | "all") => void;
  onSetExpandedZone: (key: string | null) => void;
  onSetZoningRefOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onSetClassRefOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onSetInspectMode: React.Dispatch<React.SetStateAction<boolean>>;
  onApplyPreset: (presetId: string) => void;
  onSetOwnerClustersVisible: (value: boolean) => void;
}

export default function MapLegendPanel({
  zoneVisible,
  poiVisible,
  zoningVisible,
  vacantVisible,
  parcelsVisible,
  permitsVisible = false,
  permitTypeVisible = {} as Record<PermitMapTypeKey, boolean>,
  ownerFilter,
  expandedZone,
  zoningRefOpen,
  classRefOpen,
  inspectMode,
  activePreset,
  adminSessionActive,
  ownerClustersVisible,
  ownerClustersLoading,
  ownerClustersError,
  ownerClustersPresentTypes = [],
  communityInvestmentVisible = false,
  communityInvestmentLoading,
  communityInvestmentError,
  investmentPresentFunderTypes = [],
  investmentPresentGovernmentFundingPurposes = [],
  investmentPresentCapitalClasses = [],
  investmentFunderHqCount = 0,
  investmentYearRange = DEFAULT_INVESTMENT_YEAR_RANGE,
  investmentFunderTypes = {} as Record<FunderType, boolean>,
  investmentGovernmentFundingPurposes = {} as Record<GovernmentFundingPurpose, boolean>,
  investmentCitywide = null,
  investmentViewMode = DEFAULT_INVESTMENT_VIEW_MODE,
  investmentDensityMetric = DEFAULT_INVESTMENT_DENSITY_METRIC,
  investmentArcMissingHqCount = 0,
  investmentMegaprojectSummary = null,
  investmentMegaprojectCitywideNames = [],
  investmentMegaprojectsVisible = false,
  publicInvestmentOverlays = { ...DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY },
  countyReliefZipCount = 0,
  state2020ReliefZipCount = 0,
  state2020HospitalityCitywideCount = 0,
  stateRecoveryZipCount = 0,
  federalRestaurantReliefPlottedCount = 0,
  federalRestaurantReliefCitywideCount = 0,
  stateCapitalPlottedCount = 0,
  stateCapitalCitywideCount = 0,
  onSetCommunityInvestmentVisible = () => {},
  onSetInvestmentYearRange = () => {},
  onSetInvestmentViewMode = () => {},
  onSetInvestmentDensityMetric = () => {},
  onSetInvestmentMegaprojectsVisible = () => {},
  onSetPublicInvestmentOverlay = () => {},
  onToggleInvestmentFunderType = () => {},
  onToggleInvestmentGovernmentFundingPurpose = () => {},
  onClose,
  onToggleZone,
  onTogglePoi,
  onToggleZoningCategory,
  onToggleAllZoning,
  onSetVacantVisible,
  onSetParcelsVisible,
  onSetPermitsVisible = () => {},
  onSetPermitTypeVisible = () => {},
  onSetOwnerFilter,
  onSetExpandedZone,
  onSetZoningRefOpen,
  onSetClassRefOpen,
  onSetInspectMode,
  onApplyPreset,
  onSetOwnerClustersVisible,
}: MapLegendPanelProps) {
  // Local collapse for the "Citywide commitments" note — purely presentational,
  // no need to lift into MapView (mirrors ZoneLayerSection's local useState).
  const [citywideOpen, setCitywideOpen] = useState(false);

  /* ── Zone-layer groups (WP4) ───────────────────────────────────
   * Applied through the zone checkboxes this panel already owns, so MapView
   * needs no new wiring. The "Public Capital & Past Awards" group is admin-only
   * (see map-layer-presets.ts) — it never changes the gating of the admin
   * Community Investment layer, and it does not render for anonymous visitors.
   */
  const zoneLayerPresets: ZoneLayerPresetShape[] = ZONE_LAYER_PRESETS.filter(
    (preset) => !preset.adminOnly || adminSessionActive
  );
  const activeZonePresetId = activeZoneLayerPreset(zoneVisible, ZONE_KEYS_SORTED);

  // Nested child layers (Past Grant Winners under NOF) cannot be raised in the
  // same commit as their parent — MapView.toggleZone reads the parent from the
  // rendered state — so they are flushed on the next commit.
  const [deferredZoneToggles, setDeferredZoneToggles] = useState<string[]>([]);

  useEffect(() => {
    if (deferredZoneToggles.length === 0) return;
    setDeferredZoneToggles([]);
    for (const key of deferredZoneToggles) {
      const parent = NESTED_ZONE_PARENTS[key];
      // Parent never came up (layer absent from the map) — drop it rather than retry.
      if (parent && !zoneVisible[parent]) continue;
      if (!zoneVisible[key]) onToggleZone(key);
    }
  }, [deferredZoneToggles, zoneVisible, onToggleZone]);

  const handleApplyZonePreset = (presetId: ZoneLayerPresetId) => {
    const preset = zoneLayerPresets.find((p) => p.id === presetId);
    if (!preset) return;
    const plan = planZoneLayerPresetToggles(preset, zoneVisible, ZONE_KEYS_SORTED);
    for (const key of plan.now) onToggleZone(key);
    setDeferredZoneToggles(plan.deferred);
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 md:bottom-auto md:top-12 md:left-3 md:right-auto z-20 md:z-10 bg-white/98 md:bg-white/95 backdrop-blur border-t md:border border-[#0C1B33]/10 md:w-72 max-h-[60vh] md:max-h-[calc(100vh-280px)] overflow-y-auto rounded-t-xl md:rounded-none shadow-lg md:shadow-none">
      {/* Mobile drag handle + close */}
      <div className="md:hidden flex flex-col items-center pt-2 pb-1">
        <div className="w-10 h-1 bg-[#0C1B33]/15 rounded-full mb-2" />
        <button
          onClick={() => onClose()}
          className="absolute top-3 right-3 text-[#0C1B33]/40 hover:text-[#0C1B33]/70 text-lg leading-none"
        >
          &times;
        </button>
      </div>

      {/* Presets */}
      <div data-tour="map-presets" className="px-4 pt-2 md:pt-4 pb-3">
        <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50 mb-2">
          Quick Presets
        </div>
        <div className="flex flex-wrap gap-1.5 md:gap-1">
          {MAP_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => onApplyPreset(preset.id)}
              className={`px-2.5 py-1.5 md:px-2 md:py-1 font-mono-bureau text-[10px] md:text-[8px] tracking-[0.08em] uppercase border transition-colors ${
                activePreset === preset.id
                  ? "bg-[#2563EB] text-white border-[#2563EB]"
                  : "bg-white text-[#0C1B33]/50 border-[#0C1B33]/12 hover:border-[#2563EB]/40 hover:text-[#2563EB]"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {/* Inspect Zoning button */}
        <button
          onClick={() => onSetInspectMode((v) => !v)}
          className={`mt-2 w-full px-2 py-2 md:py-1.5 font-mono-bureau text-[10px] md:text-[8px] tracking-[0.1em] uppercase border transition-colors ${
            inspectMode
              ? "bg-[#059669] text-white border-[#059669]"
              : "bg-white text-[#059669]/60 border-[#059669]/20 hover:border-[#059669]/40 hover:text-[#059669]"
          }`}
        >
          {inspectMode ? "Exit Inspect Zoning" : "Inspect Zoning (tap)"}
        </button>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-[#0C1B33]/8" />

      {/* Incentive Zones — grouped by gov level */}
      <ZoneLayerSection
        zoneVisible={zoneVisible}
        onToggleZone={onToggleZone}
        expandedZone={expandedZone}
        onSetExpandedZone={onSetExpandedZone}
        zoneLayerPresets={zoneLayerPresets}
        activeZonePresetId={activeZonePresetId}
        onApplyZonePreset={handleApplyZonePreset}
      />

      {/* Divider */}
      <div className="mx-4 h-px bg-[#0C1B33]/8" />

      {/* Vacant Properties */}
      <div className="px-4 pt-3 pb-2">
        <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#DC2626]/50 mb-3">
          Vacant Properties
        </div>
        <div className="space-y-0.5">
          {Object.entries(VACANT_LABELS).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2.5 py-1 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={vacantVisible[key]}
                onChange={() =>
                  onSetVacantVisible((prev) => ({ ...prev, [key]: !prev[key] }))
                }
                className="sr-only"
              />
              <span
                className="w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                style={{
                  borderColor: VACANT_COLORS[key],
                  backgroundColor: vacantVisible[key]
                    ? VACANT_COLORS[key] + "30"
                    : "transparent",
                }}
              >
                {vacantVisible[key] && (
                  <span
                    className="w-2 h-2 rounded-full block"
                    style={{ backgroundColor: VACANT_COLORS[key] }}
                  />
                )}
              </span>
              <span className="text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight">
                {label}
              </span>
            </label>
          ))}
        </div>
        <p className="text-[9px] text-[#0C1B33]/35 mt-1.5 ml-6">
          City data + 311 reports · Clusters at low zoom
        </p>

        {/* Owner Type Filter */}
        {Object.values(vacantVisible).some(Boolean) && (
          <div className="mt-3 ml-6">
            <label className="block text-[9px] font-mono-bureau tracking-[0.15em] uppercase text-[#0C1B33]/40 mb-1">
              Filter by Owner
            </label>
            <select
              value={ownerFilter}
              onChange={(e) => onSetOwnerFilter(e.target.value as OwnerType | "all")}
              className="w-full text-[11px] px-2 py-1.5 rounded border border-[#0C1B33]/15 bg-white text-[#0C1B33] focus:outline-none focus:border-[#2563EB]/50 transition-colors"
            >
              <option value="all">All Owners</option>
              {(Object.entries(OWNER_TYPE_LABELS) as [OwnerType, string][])
                .filter(([key]) => key !== "unknown")
                .map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
            </select>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-[#0C1B33]/8" />

      {/* Zoning Districts */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#059669]/50">
            Chicago Zoning Districts
          </div>
          <button
            onClick={onToggleAllZoning}
            className="font-mono-bureau text-[8px] tracking-[0.1em] uppercase text-[#059669]/40 hover:text-[#059669] transition-colors"
          >
            {Object.values(zoningVisible).some(Boolean) ? "Hide all" : "Show all"}
          </button>
        </div>
        <div className="space-y-0.5">
          {ZONING_CATEGORIES.map((cat) => (
            <label
              key={cat.key}
              className="flex items-center gap-2.5 py-1 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={zoningVisible[cat.key]}
                onChange={() => onToggleZoningCategory(cat.key)}
                className="sr-only"
              />
              <span
                className="w-3.5 h-3.5 border flex-shrink-0 flex items-center justify-center transition-colors"
                style={{
                  borderColor: cat.color,
                  backgroundColor: zoningVisible[cat.key]
                    ? cat.color + "30"
                    : "transparent",
                }}
              >
                {zoningVisible[cat.key] && (
                  <span
                    className="w-2 h-2 block"
                    style={{ backgroundColor: cat.color }}
                  />
                )}
              </span>
              <span className="text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight">
                {cat.label}
              </span>
            </label>
          ))}
        </div>

        {/* Collapsible zoning code reference */}
        <button
          onClick={() => onSetZoningRefOpen((v) => !v)}
          className="flex items-center gap-1.5 mt-3 mb-1 font-mono-bureau text-[8px] tracking-[0.12em] uppercase text-[#059669]/50 hover:text-[#059669] transition-colors"
        >
          <svg
            className={`w-2.5 h-2.5 transition-transform ${zoningRefOpen ? "rotate-90" : ""}`}
            viewBox="0 0 6 10" fill="currentColor"
          >
            <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          What do the codes mean?
        </button>
        {zoningRefOpen && (
          <div className="mt-1 space-y-2.5 max-h-64 overflow-y-auto pr-1">
            {ZONING_CATEGORIES.map((cat) => {
              const codes = Object.entries(ZONING_CODE_DESCRIPTIONS).filter(
                ([code]) => cat.prefixes.some((p) => code.startsWith(p))
              );
              // For PD/PMD, show a summary instead of listing hundreds
              if (cat.key === "pd") {
                return (
                  <div key={cat.key}>
                    <div
                      className="text-[9px] font-semibold mb-0.5"
                      style={{ color: cat.color }}
                    >
                      {cat.label}
                    </div>
                    <div className="text-[9px] text-[#0C1B33]/50 leading-relaxed">
                      <span className="font-mono-bureau text-[8px] text-[#0C1B33]/70">PD #</span> — Planned Development (site-specific zoning for large projects)
                    </div>
                    <div className="text-[9px] text-[#0C1B33]/50 leading-relaxed">
                      <span className="font-mono-bureau text-[8px] text-[#0C1B33]/70">PMD #</span> — Planned Manufacturing District (protected industrial areas)
                    </div>
                  </div>
                );
              }
              if (codes.length === 0) return null;
              return (
                <div key={cat.key}>
                  <div
                    className="text-[9px] font-semibold mb-0.5"
                    style={{ color: cat.color }}
                  >
                    {cat.label}
                  </div>
                  {codes.map(([code, desc]) => (
                    <div
                      key={code}
                      className="text-[9px] text-[#0C1B33]/50 leading-relaxed"
                    >
                      <span className="font-mono-bureau text-[8px] text-[#0C1B33]/70">
                        {code}
                      </span>{" "}
                      — {desc.replace(/^.*?\(/, "(").replace(/\)$/, ")") !== desc
                        ? desc
                        : desc}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-[#0C1B33]/8" />

      {/* Community Assets */}
      <div className="px-4 pt-3 pb-2">
        <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#059669]/50 mb-3">
          Community Assets
        </div>
        <div className="space-y-1">
          {Object.entries(POI_LAYERS).map(([key, cfg]) => (
            <label
              key={key}
              className="flex items-center gap-2.5 py-1 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={poiVisible[key]}
                onChange={() => onTogglePoi(key)}
                className="sr-only"
              />
              <span
                className="w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                style={{
                  borderColor: cfg.color,
                  backgroundColor: poiVisible[key]
                    ? cfg.color + "30"
                    : "transparent",
                }}
              >
                {poiVisible[key] && (
                  <span
                    className="w-2 h-2 rounded-full block"
                    style={{ backgroundColor: cfg.color }}
                  />
                )}
              </span>
              <span className="text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight">
                {cfg.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-[#0C1B33]/8" />

      {/* Parcels & Property */}
      <div className="px-4 pt-3 pb-3">
        <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#7C3AED]/50 mb-3">
          Parcels &amp; Property
        </div>
        <label className="flex items-center gap-2.5 py-1 cursor-pointer group">
          <input
            type="checkbox"
            checked={parcelsVisible}
            onChange={() => onSetParcelsVisible((v) => !v)}
            className="sr-only"
          />
          <span
            className="w-3.5 h-3.5 border flex-shrink-0 flex items-center justify-center transition-colors"
            style={{
              borderColor: "#7C3AED",
              backgroundColor: parcelsVisible ? "#7C3AED30" : "transparent",
            }}
          >
            {parcelsVisible && (
              <span className="w-2 h-2 block" style={{ backgroundColor: "#7C3AED" }} />
            )}
          </span>
          <span className="text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight">
            Parcels
          </span>
        </label>
        <p className="text-[9px] text-[#0C1B33]/35 mt-1 ml-6">
          Lot boundaries visible at zoom 15+
        </p>

        <div className="my-3 h-px bg-[#0C1B33]/8" />

        <label className="flex cursor-pointer items-center gap-2.5 py-1 group">
          <input
            type="checkbox"
            checked={permitsVisible}
            onChange={() => onSetPermitsVisible(!permitsVisible)}
            className="sr-only"
          />
          <span
            className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full border transition-colors"
            style={{
              borderColor: "#0F766E",
              backgroundColor: permitsVisible ? "#0F766E30" : "transparent",
            }}
          >
            {permitsVisible && (
              <span className="block h-2 w-2 rounded-full bg-[#0F766E]" />
            )}
          </span>
          <span className="text-[11px] leading-tight text-[#0C1B33]/70 transition-colors group-hover:text-[#0C1B33]">
            Building permits
          </span>
        </label>
        <p className="ml-6 mt-1 text-[9px] leading-relaxed text-[#0C1B33]/35">
          City permit filings since 2015 · visible at zoom 12+
        </p>

        {permitsVisible && (
          <details className="ml-6 mt-2 border-t border-[#0C1B33]/8 pt-2">
            <summary className="cursor-pointer font-mono-bureau text-[8px] uppercase tracking-[0.12em] text-[#0F766E]/70">
              Permit types
            </summary>
            <div className="mt-2 space-y-0.5">
              {PERMIT_MAP_TYPES.map((permitType) => (
                <label
                  key={permitType.key}
                  className="flex cursor-pointer items-start gap-2 py-1 group"
                >
                  <input
                    type="checkbox"
                    checked={permitTypeVisible[permitType.key] !== false}
                    onChange={() =>
                      onSetPermitTypeVisible((current) => ({
                        ...current,
                        [permitType.key]: current[permitType.key] === false,
                      }))
                    }
                    className="mt-0.5 h-3 w-3 flex-shrink-0 accent-[#0F766E]"
                  />
                  <span className="text-[10px] leading-snug text-[#0C1B33]/55 transition-colors group-hover:text-[#0C1B33]/80">
                    {permitType.label}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[9px] leading-relaxed text-[#0C1B33]/35">
              Filings indicate permit activity, not completed construction. Verify status with the City.
            </p>
          </details>
        )}

        {/* Collapsible class code reference */}
        <button
          onClick={() => onSetClassRefOpen((v) => !v)}
          className="flex items-center gap-1.5 mt-3 mb-1 font-mono-bureau text-[8px] tracking-[0.12em] uppercase text-[#7C3AED]/50 hover:text-[#7C3AED] transition-colors"
        >
          <svg
            className={`w-2.5 h-2.5 transition-transform ${classRefOpen ? "rotate-90" : ""}`}
            viewBox="0 0 6 10" fill="currentColor"
          >
            <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          What do the classes mean?
        </button>
        {classRefOpen && (
          <div className="mt-1 space-y-2.5 max-h-64 overflow-y-auto pr-1">
            {[
              { label: "Vacant Land", prefix: "1-", color: "#94A3B8" },
              { label: "Residential", prefix: "2-", color: "#059669" },
              { label: "Multi-Unit (7+)", prefix: "3-", color: "#2563EB" },
              { label: "Commercial", prefix: "5-", color: "#D97706" },
              { label: "Industrial", prefix: "6-", color: "#DC2626" },
            ].map((group) => {
              const codes = Object.entries(CLASS_CODE_MAP).filter(
                ([code]) => code.startsWith(group.prefix)
              );
              if (codes.length === 0) return null;
              return (
                <div key={group.prefix}>
                  <div
                    className="text-[9px] font-semibold mb-0.5"
                    style={{ color: group.color }}
                  >
                    {group.label}
                  </div>
                  {codes.map(([code, desc]) => (
                    <div
                      key={code}
                      className="text-[9px] text-[#0C1B33]/50 leading-relaxed"
                    >
                      <span className="font-mono-bureau text-[8px] text-[#0C1B33]/70">
                        {code}
                      </span>{" "}
                      — {desc}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ADMIN — Ownership clusters (Owner Files, gated on adminSessionActive; PRs #65/#67/#68) */}
      {adminSessionActive && (
        <>
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 pt-3 pb-3">
            <div className="mb-3 flex items-center gap-1.5">
              <Lock className="h-2.5 w-2.5 text-[#B45309]" aria-hidden="true" />
              <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#B45309]">
                Admin
              </span>
            </div>
            <label className="flex items-center gap-2.5 py-1 cursor-pointer group">
              <input
                type="checkbox"
                checked={ownerClustersVisible}
                onChange={() => onSetOwnerClustersVisible(!ownerClustersVisible)}
                className="sr-only"
              />
              <span
                className="w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                style={{
                  borderColor: "#7C3AED",
                  backgroundColor: ownerClustersVisible ? "#7C3AED30" : "transparent",
                }}
              >
                {ownerClustersVisible && (
                  <span className="w-2 h-2 rounded-full block" style={{ backgroundColor: "#7C3AED" }} />
                )}
              </span>
              <span className="text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight">
                Ownership clusters
              </span>
            </label>
            <p className="text-[9px] text-[#0C1B33]/35 mt-1.5 ml-6">
              Owner Files pilot ZIPs · admin-only, never shown to public visitors
            </p>
            {ownerClustersVisible && ownerClustersPresentTypes.length > 0 && (
              <div className="mt-2.5 ml-6 space-y-1">
                {ownerClustersPresentTypes.map((type) => (
                  <div key={type} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: OWNER_TYPE_COLORS[type] }}
                    />
                    <span className="text-[10px] text-[#0C1B33]/60 leading-tight">
                      {OWNER_TYPE_LABELS[type]}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {ownerClustersVisible && (
              <p className="text-[9px] text-[#0C1B33]/35 mt-1.5 ml-6">
                Dot size = vacant parcels in cluster
              </p>
            )}
            {ownerClustersLoading && (
              <p className="text-[9px] text-[#0C1B33]/40 mt-1.5 ml-6">Loading ownership clusters…</p>
            )}
            {ownerClustersError && (
              <p className="text-[9px] text-red-600 mt-1.5 ml-6">{ownerClustersError}</p>
            )}
          </div>

          {/* Community investment — public + private dollars sited citywide (gated on adminSessionActive) */}
          <div className="mx-4 h-px bg-[#0C1B33]/8" />
          <div className="px-4 pt-3 pb-3">
            <label className="flex items-center gap-2.5 py-1 cursor-pointer group">
              <input
                type="checkbox"
                checked={communityInvestmentVisible}
                onChange={() => onSetCommunityInvestmentVisible(!communityInvestmentVisible)}
                className="sr-only"
              />
              <span
                className="w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                style={{
                  borderColor: "#2563EB",
                  backgroundColor: communityInvestmentVisible ? "#2563EB30" : "transparent",
                }}
              >
                {communityInvestmentVisible && (
                  <span className="w-2 h-2 rounded-full block" style={{ backgroundColor: "#2563EB" }} />
                )}
              </span>
              <span className="text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight">
                Community investment
              </span>
            </label>
            <p className="text-[9px] text-[#0C1B33]/35 mt-1.5 ml-6 leading-relaxed">
              <span className="block">Public + philanthropic capital · optional major-development layer</span>
              <span className="block">Admin-only · never shown to public visitors</span>
            </p>

            {communityInvestmentVisible && (
              <div className="mt-3 ml-6 pr-1 space-y-4">
                {/* View-mode control (admin only, appears with the toggle on) —
                    Dots (default, mapbox circles) · Arcs (deck.gl philanthropic
                    HQ→recipient) · Density (deck.gl $ hex bins). */}
                <div>
                  <div className="font-mono-bureau text-[8px] tracking-[0.15em] uppercase text-[#0C1B33]/40 mb-1.5">
                    View
                  </div>
                  <div
                    className="grid grid-cols-3 overflow-hidden rounded-[6px] border border-[#2563EB]/25"
                    role="group"
                    aria-label="Investment view mode"
                  >
                    {INVESTMENT_VIEW_MODES.map((mode) => {
                      const active = investmentViewMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={active}
                          onClick={() => onSetInvestmentViewMode(mode)}
                          className="h-8 border-r border-[#2563EB]/20 last:border-r-0 font-mono-bureau text-[8px] tracking-[0.08em] uppercase px-2 transition-colors"
                          style={{
                            color: active ? "#fff" : "#2563EB",
                            backgroundColor: active ? "#2563EB" : "transparent",
                          }}
                        >
                          {INVESTMENT_VIEW_MODE_LABELS[mode]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Independent overlay: unlike the base view selector, this can
                    be combined with Dots, Arcs, or Density. */}
                <div className="border-t border-[#0C1B33]/8 pt-3">
                  <div className="font-mono-bureau text-[8px] tracking-[0.15em] uppercase text-[#0C1B33]/40 mb-1.5">
                    Additional layers
                  </div>
                  <div className="space-y-2 border-b border-[#0C1B33]/8 pb-3 mb-2">
                    {(["capital_project", "programmatic"] as const).map((purpose) => (
                      <div key={purpose} className="space-y-1.5">
                        <div className="font-mono-bureau text-[8px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
                          {GOVERNMENT_FUNDING_PURPOSE_LABELS[purpose]}
                        </div>
                        {PUBLIC_INVESTMENT_OVERLAYS.filter(
                          (overlay) => overlay.fundingPurpose === purpose,
                        ).map((overlay) => {
                          const checked = publicInvestmentOverlays[overlay.id];
                          const color = PUBLIC_INVESTMENT_OVERLAY_COLORS[overlay.id];
                          const countLabel =
                            overlay.id === "county_relief_awards"
                              ? `${countyReliefZipCount} Chicago ZIP areas mapped`
                              : overlay.id === "state_2020_relief"
                                ? `${state2020ReliefZipCount} BIG ZIP areas mapped · ${state2020HospitalityCitywideCount} Hospitality records held unplotted`
                              : overlay.id === "state_recovery_awards"
                                ? `${stateRecoveryZipCount} Chicago ZIP areas mapped`
                                : overlay.id === "federal_restaurant_relief"
                                  ? `${federalRestaurantReliefPlottedCount} address-sited · ${federalRestaurantReliefCitywideCount} held unplotted`
                                  : `${stateCapitalPlottedCount} address-sited · ${stateCapitalCitywideCount} held unplotted`;
                          return (
                            <label key={overlay.id} className="flex items-start gap-2.5 py-1 cursor-pointer group">
                              <input
                                type="checkbox"
                                role="switch"
                                aria-label={`Toggle ${overlay.label} overlay`}
                                checked={checked}
                                onChange={() => onSetPublicInvestmentOverlay(overlay.id, !checked)}
                                className="sr-only"
                              />
                              <span
                                aria-hidden="true"
                                className="relative mt-0.5 h-5 w-9 flex-shrink-0 rounded-full border transition-colors"
                                style={{
                                  borderColor: checked ? color : "#0C1B3326",
                                  backgroundColor: checked ? color : "#0C1B330A",
                                }}
                              >
                                <span
                                  className="absolute top-[2px] h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform"
                                  style={{ transform: checked ? "translateX(17px)" : "translateX(2px)" }}
                                />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-[11px] font-medium text-[#0C1B33]/75 group-hover:text-[#0C1B33] transition-colors">
                                  {overlay.label}
                                </span>
                                <span className="block text-[9px] text-[#0C1B33]/40 leading-relaxed">
                                  {overlay.description}
                                </span>
                                {checked && (
                                  <span className="mt-1 block font-mono-bureau text-[8px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
                                    {countLabel}
                                  </span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ))}
                    <div className="space-y-1">
                      <div className="font-mono-bureau text-[8px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
                        Arts funding
                      </div>
                      <Link
                        href="/investment#illinois-arts-awards"
                        className="block text-[9px] leading-relaxed text-[#2563EB] hover:underline"
                      >
                        City-level Illinois Arts Council awards are not mapped →
                      </Link>
                    </div>
                  </div>
                  <label className="flex items-center gap-2.5 py-1 cursor-pointer group">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="Toggle Megaprojects overlay"
                      checked={investmentMegaprojectsVisible}
                      onChange={() => onSetInvestmentMegaprojectsVisible(!investmentMegaprojectsVisible)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className="relative h-5 w-9 flex-shrink-0 rounded-full border transition-colors"
                      style={{
                        borderColor: investmentMegaprojectsVisible ? "#2563EB" : "#0C1B3326",
                        backgroundColor: investmentMegaprojectsVisible ? "#2563EB" : "#0C1B330A",
                      }}
                    >
                      <span
                        className="absolute top-[2px] h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform"
                        style={{
                          transform: investmentMegaprojectsVisible ? "translateX(17px)" : "translateX(2px)",
                        }}
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-medium text-[#0C1B33]/75 group-hover:text-[#0C1B33] transition-colors">
                        Megaprojects
                      </span>
                      <span className="block text-[9px] text-[#0C1B33]/40 leading-snug">
                        Major private developments
                      </span>
                    </span>
                  </label>
                  {investmentMegaprojectsVisible && (
                    <div className="mt-2.5 space-y-2 border-l-2 border-[#2563EB]/15 pl-3">
                      <div className="font-mono-bureau text-[9px] tracking-[0.08em] uppercase text-[#0C1B33]/55">
                        Major developments
                        {investmentMegaprojectSummary
                          ? ` (${investmentMegaprojectSummary.plottedCount} plotted)`
                          : ""}
                      </div>
                      <div className="space-y-0.5">
                        {MEGAPROJECT_STATUS_GROUPS.map((group) => (
                          <div key={group} className="flex items-center gap-2.5 py-0.5">
                            <span
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: MEGAPROJECT_STATUS_GROUP_COLORS[group] }}
                            />
                            <span className="text-[11px] text-[#0C1B33]/70 leading-tight flex-1">
                              {MEGAPROJECT_STATUS_GROUP_LABELS[group]}
                            </span>
                            <span className="font-mono-bureau text-[10px] text-[#0C1B33]/45 tabular-nums">
                              {investmentMegaprojectSummary?.groupCounts[group] ?? 0}
                            </span>
                          </div>
                        ))}
                      </div>
                      {investmentMegaprojectSummary && (
                        <div className="pt-0.5">
                          <div className="text-[13px] font-semibold text-[#0C1B33] tabular-nums">
                            {formatAwardedAmount(investmentMegaprojectSummary.totalAnnounced)}
                          </div>
                          <div className="text-[9px] text-[#0C1B33]/40 leading-snug">
                            {MEGAPROJECT_ANNOUNCED_CAPITAL_LABEL}
                          </div>
                        </div>
                      )}
                      <p className="text-[9px] text-[#0C1B33]/35 leading-snug">
                        Dot size = announced capital · color = status · year and funder filters do not apply
                      </p>
                      {investmentMegaprojectCitywideNames.length > 0 && (
                        <p
                          className="text-[9px] text-[#0C1B33]/40 leading-snug cursor-help"
                          title={investmentMegaprojectCitywideNames.join("\n")}
                        >
                          {investmentMegaprojectCitywideNames.length} citywide/multi-site
                          {investmentMegaprojectCitywideNames.length === 1 ? " project" : " projects"} not
                          plotted
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Year-range chips — client-side filter over the plotted points */}
                <div>
                  <div className="font-mono-bureau text-[8px] tracking-[0.15em] uppercase text-[#0C1B33]/40 mb-1.5">
                    Year
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {INVESTMENT_YEAR_RANGES.map((range) => {
                      const active = investmentYearRange === range.id;
                      return (
                        <button
                          key={range.id}
                          onClick={() => onSetInvestmentYearRange(range.id)}
                          className="font-mono-bureau text-[8px] tracking-[0.08em] uppercase px-2 py-1 rounded-full border transition-colors"
                          style={{
                            color: active ? "#fff" : "#2563EB",
                            backgroundColor: active ? "#2563EB" : "transparent",
                            borderColor: active ? "#2563EB" : "#2563EB40",
                          }}
                        >
                          {range.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Funder-type checkboxes — only for types actually present (doubles as the color key) */}
                {investmentPresentFunderTypes.length > 0 && (
                  <div>
                    <div className="font-mono-bureau text-[8px] tracking-[0.15em] uppercase text-[#0C1B33]/40 mb-1.5">
                      Funder type
                    </div>
                    <div className="space-y-0.5">
                      {investmentPresentFunderTypes.map((type) => {
                        const checked = investmentFunderTypes[type] ?? true;
                        return (
                          <label key={type} className="flex items-center gap-2.5 py-1 cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => onToggleInvestmentFunderType(type)}
                              className="sr-only"
                            />
                            <span
                              className="w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                              style={{
                                borderColor: FUNDER_TYPE_COLORS[type],
                                backgroundColor: checked ? FUNDER_TYPE_COLORS[type] + "30" : "transparent",
                              }}
                            >
                              {checked && (
                                <span
                                  className="w-2 h-2 rounded-full block"
                                  style={{ backgroundColor: FUNDER_TYPE_COLORS[type] }}
                                />
                              )}
                            </span>
                            <span className="text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight">
                              {FUNDER_TYPE_LABELS[type]}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {investmentPresentGovernmentFundingPurposes.length > 0 && (
                  <div>
                    <div className="font-mono-bureau text-[8px] tracking-[0.15em] uppercase text-[#0C1B33]/40 mb-1.5">
                      Government funding purpose
                    </div>
                    <div className="space-y-0.5">
                      {investmentPresentGovernmentFundingPurposes.map((purpose) => {
                        const checked = investmentGovernmentFundingPurposes[purpose] ?? true;
                        return (
                          <label
                            key={purpose}
                            className="flex items-center gap-2.5 py-1 cursor-pointer group"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                onToggleInvestmentGovernmentFundingPurpose(purpose)
                              }
                              className="sr-only"
                            />
                            <span
                              className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center border border-[#0C1B33]/25 bg-white transition-colors"
                              aria-hidden="true"
                            >
                              {checked ? (
                                <span className="block h-2 w-2 bg-[#2563EB]" />
                              ) : null}
                            </span>
                            <span className="text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight">
                              {GOVERNMENT_FUNDING_PURPOSE_LABELS[purpose]}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Capital-class sub-legend (Sol #4) — the dot OUTLINE tells the
                    base-map capital classes apart (all government records share
                    a blue fill). Shown only when a NON-grant class is on the map. */}
                {investmentPresentCapitalClasses.some((c) => c !== "grant") && (
                  <div>
                    <div className="font-mono-bureau text-[8px] tracking-[0.15em] uppercase text-[#0C1B33]/40 mb-1.5">
                      Capital class · dot outline
                    </div>
                    <div className="space-y-0.5">
                      {investmentPresentCapitalClasses.map((cls) => (
                        <div key={cls} className="flex items-center gap-2.5 py-0.5">
                          <span
                            className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                            style={{
                              backgroundColor: FUNDER_TYPE_COLORS.government,
                              border: `2px solid ${CAPITAL_CLASS_OUTLINE[cls]}`,
                              boxShadow: "0 0 0 1px rgba(12,27,51,0.12)",
                            }}
                          />
                          <span className="text-[10px] text-[#0C1B33]/60 leading-tight">
                            {CAPITAL_CLASS_LABELS[cls]}
                            <span className="text-[#0C1B33]/35"> · {CAPITAL_CLASS_MONEY_NOUN[cls]}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mode-specific caption / mini legend. */}
                {investmentViewMode === "dots" && (
                  <p className="text-[9px] text-[#0C1B33]/35">Dot size = each record&rsquo;s own capital amount</p>
                )}

                {investmentViewMode === "arcs" && (
                  <div className="space-y-1.5">
                    {/* Honest label (Sol #4): the arcs mode only draws the tracked
                        foundation HQs, not all capital. */}
                    <div className="font-mono-bureau text-[9px] tracking-[0.08em] uppercase text-[#0C1B33]/55">
                      Foundation flows ({investmentFunderHqCount} tracked HQ{investmentFunderHqCount === 1 ? "" : "s"})
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-[2px] w-6 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: FUNDER_TYPE_COLORS.philanthropic }}
                      />
                      <span className="text-[9px] text-[#0C1B33]/45">
                        Arc: funder HQ &rarr; grant recipient
                      </span>
                    </div>
                    <p className="text-[9px] text-[#0C1B33]/35">
                      Only philanthropic grants from a tracked foundation HQ draw an arc — most capital has no HQ arc.
                    </p>
                    {investmentArcMissingHqCount > 0 && (
                      <p className="text-[9px] text-[#0C1B33]/35">
                        {investmentArcMissingHqCount} grant{investmentArcMissingHqCount === 1 ? "" : "s"} without a
                        mapped funder HQ shown as dots
                      </p>
                    )}
                  </div>
                )}

                {investmentViewMode === "density" && (
                  <div className="space-y-1.5">
                    {/* dollars | records metric toggle (Sol #4). */}
                    <div className="flex gap-1" role="group" aria-label="Density metric">
                      {INVESTMENT_DENSITY_METRICS.map((metric) => {
                        const active = investmentDensityMetric === metric;
                        return (
                          <button
                            key={metric}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onSetInvestmentDensityMetric(metric)}
                            className="flex-1 font-mono-bureau text-[8px] tracking-[0.08em] uppercase px-2 py-1 rounded border transition-colors"
                            style={{
                              color: active ? "#fff" : "#2563EB",
                              backgroundColor: active ? "#2563EB" : "transparent",
                              borderColor: active ? "#2563EB" : "#2563EB40",
                            }}
                          >
                            {metric === "dollars" ? "Dollars" : "Records"}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex h-2 w-full overflow-hidden rounded-full">
                      {DENSITY_RAMP_HEXES.map((hex) => (
                        <span key={hex} className="flex-1" style={{ backgroundColor: hex }} />
                      ))}
                    </div>
                    <p className="text-[9px] text-[#0C1B33]/35">
                      {investmentDensityMetric === "records"
                        ? `record count (hex bins, ${HEXAGON_RADIUS_M}m)`
                        : `$ awarded (hex bins, ${HEXAGON_RADIUS_M}m)`}
                    </p>
                  </div>
                )}

                {communityInvestmentLoading && (
                  <p className="text-[9px] text-[#0C1B33]/40">Loading community investment…</p>
                )}
                {communityInvestmentError && (
                  <p className="text-[9px] text-red-600">{communityInvestmentError}</p>
                )}

                {/* Citywide commitments — records that NEVER plot as dots (intermediary /
                    unmappable). Collapsible note with count + total awarded dollars. */}
                {investmentCitywide && investmentCitywide.count > 0 && (
                  <div>
                    <button
                      onClick={() => setCitywideOpen((v) => !v)}
                      className="flex items-center gap-1.5 font-mono-bureau text-[8px] tracking-[0.12em] uppercase text-[#0C1B33]/45 hover:text-[#0C1B33]/70 transition-colors"
                    >
                      <svg
                        className={`w-2.5 h-2.5 transition-transform ${citywideOpen ? "rotate-90" : ""}`}
                        viewBox="0 0 6 10"
                        fill="currentColor"
                      >
                        <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
                      </svg>
                      Citywide commitments ({investmentCitywide.count})
                    </button>
                    {citywideOpen && (
                      <p className="text-[9px] text-[#0C1B33]/50 mt-1 leading-relaxed">
                        {investmentCitywide.count} commitment{investmentCitywide.count === 1 ? "" : "s"} held
                        citywide rather than plotted — intermediary or unmappable grants
                        {investmentCitywide.totalDollars > 0
                          ? ` · ${formatAwardedAmount(investmentCitywide.totalDollars)} awarded`
                          : ""}
                        .
                      </p>
                    )}
                  </div>
                )}

                {/* Cross-nav to the per-community Investment & Impact analysis (admin-only, same gate) */}
                <Link
                  href="/investment"
                  className="inline-flex items-center gap-1 font-mono-bureau text-[9px] tracking-[0.12em] uppercase text-[#2563EB] hover:text-[#0C1B33] transition-colors"
                >
                  Investment analysis →
                </Link>
              </div>
            )}
          </div>
        </>
      )}

    </div>
  );
}

/* ── Zone layer section: gov-level grouping + quick filters ───── */

interface ZoneLayerSectionProps {
  zoneVisible: Record<string, boolean>;
  onToggleZone: (key: string) => void;
  expandedZone: string | null;
  onSetExpandedZone: (key: string | null) => void;
  /** Zone-layer groups the current viewer may see (admin-only groups pre-filtered). */
  zoneLayerPresets: ZoneLayerPresetShape[];
  activeZonePresetId: ZoneLayerPresetId | null;
  onApplyZonePreset: (presetId: ZoneLayerPresetId) => void;
}

function ZoneLayerSection({
  zoneVisible,
  onToggleZone,
  expandedZone,
  onSetExpandedZone,
  zoneLayerPresets,
  activeZonePresetId,
  onApplyZonePreset,
}: ZoneLayerSectionProps) {
  const [activeLevel, setActiveLevel] = useState<ProgramLevel | "All">("All");
  const topLevelZoneKeys = ZONE_KEYS_SORTED.filter((key) => key !== "nofFundedProjects");

  const groupedKeys = topLevelZoneKeys.filter((key) => {
    if (activeLevel === "All") return true;
    const meta = ZONE_META[key];
    if (!meta) return false;
    const jurisdictions = meta.jurisdictions || [meta.level];
    return jurisdictions.includes(activeLevel);
  });

  // For grouped rendering when "All" is selected, organize keys by level
  const sectionsToRender: { level: ProgramLevel; keys: string[] }[] = [];
  if (activeLevel === "All") {
    for (const lvl of LEVELS) {
      if (lvl === "Utility") continue; // no Utility-level zone layers yet
      const keys = topLevelZoneKeys.filter((k) => ZONE_META[k]?.level === lvl);
      if (keys.length > 0) sectionsToRender.push({ level: lvl, keys });
    }
  } else {
    sectionsToRender.push({ level: activeLevel as ProgramLevel, keys: groupedKeys });
  }

  return (
    <div className="px-4 pt-3 pb-2">
      <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50 mb-2">
        Incentive Zones
      </div>

      {/* Layer groups — one tap selects a whole family of zone layers and
          clears the rest. The individual checkboxes below stay available. */}
      {zoneLayerPresets.length > 0 && (
        <div className="mb-3" role="group" aria-label="Zone layer groups">
          <div className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/35 mb-1.5">
            Layer Groups
          </div>
          <div className="space-y-1">
            {zoneLayerPresets.map((preset) => {
              const active = activeZonePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={active}
                  title={preset.description}
                  onClick={() => onApplyZonePreset(preset.id as ZoneLayerPresetId)}
                  className={`w-full flex items-center justify-between gap-2 text-left px-2 py-2 md:py-1.5 border transition-colors ${
                    active
                      ? "bg-[#2563EB] text-white border-[#2563EB]"
                      : "bg-white text-[#0C1B33]/55 border-[#0C1B33]/12 hover:border-[#2563EB]/40 hover:text-[#2563EB]"
                  }`}
                >
                  <span className="font-mono-bureau text-[9px] md:text-[8px] tracking-[0.08em] uppercase leading-tight">
                    {preset.label}
                  </span>
                  <span
                    className={`font-mono-bureau text-[9px] md:text-[8px] tabular-nums flex-shrink-0 ${
                      active ? "text-white/70" : "text-[#0C1B33]/35"
                    }`}
                  >
                    {preset.zones.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Gov-level quick filter chips */}
      <div className="flex flex-wrap gap-1 mb-3">
        {(["All", ...LEVELS.filter((l) => l !== "Utility")] as const).map((lvl) => {
          const active = activeLevel === lvl;
          const color = lvl === "All" ? "#0C1B33" : LEVEL_COLORS[lvl as ProgramLevel];
          return (
            <button
              key={lvl}
              onClick={() => setActiveLevel(lvl as ProgramLevel | "All")}
              className="font-mono-bureau text-[8px] tracking-[0.1em] uppercase px-2 py-1 rounded-full border transition-colors"
              style={{
                color: active ? "#fff" : color,
                backgroundColor: active ? color : "transparent",
                borderColor: active ? color : `${color}40`,
              }}
            >
              {lvl}
            </button>
          );
        })}
      </div>
      <div className="space-y-2">
        {sectionsToRender.map(({ level, keys }) => (
          <div key={level}>
            {activeLevel === "All" && (
              <div
                className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase mb-1.5 pl-0.5"
                style={{ color: LEVEL_COLORS[level] }}
              >
                {level}
              </div>
            )}
            <div className="space-y-0.5">
              {keys.map((key) => {
                const meta = ZONE_META[key];
                const levelColor = meta ? LEVEL_COLORS[meta.level] : "#6b7280";
                return (
                  <div key={key} style={{ borderLeft: `2px solid ${levelColor}`, paddingLeft: 4 }}>
                    <label className="flex items-center gap-2.5 py-2 md:py-1 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={zoneVisible[key]}
                        onChange={() => onToggleZone(key)}
                        className="sr-only"
                      />
                      <span
                        className="w-5 h-5 md:w-3.5 md:h-3.5 border flex-shrink-0 flex items-center justify-center transition-colors"
                        style={{
                          borderColor: ZONE_COLORS[key],
                          backgroundColor: zoneVisible[key]
                            ? ZONE_COLORS[key] + "30"
                            : "transparent",
                        }}
                      >
                        {zoneVisible[key] && (
                          <span
                            className="w-3 h-3 md:w-2 md:h-2 block"
                            style={{ backgroundColor: ZONE_COLORS[key] }}
                          />
                        )}
                      </span>
                      <span
                        className="text-[13px] md:text-[11px] text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors leading-tight flex-1"
                        onClick={(e) => {
                          e.preventDefault();
                          onSetExpandedZone(expandedZone === key ? null : key);
                        }}
                      >
                        {ZONE_LABELS[key]}
                      </span>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          onSetExpandedZone(expandedZone === key ? null : key);
                        }}
                        className="text-[9px] text-[#2563EB]/40 hover:text-[#2563EB] transition-colors flex-shrink-0"
                        title="More info"
                      >
                        {expandedZone === key ? "−" : "?"}
                      </button>
                    </label>
                    {/* Expanded description */}
                    {expandedZone === key && ZONE_DESCRIPTIONS[key] && (
                      <div className="ml-6 pl-0.5 pb-2 border-l-2 border-[#0C1B33]/5">
                        <p className="text-[10px] text-[#0C1B33]/50 leading-relaxed mt-1 mb-1.5">
                          {ZONE_DESCRIPTIONS[key]}
                        </p>
                        {meta?.boundaryDisclaimer && (
                          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 leading-relaxed mb-1.5">
                            {meta.boundaryDisclaimer}
                          </p>
                        )}
                        {ZONE_LEARN_MORE[key] && (
                          <a
                            href={ZONE_LEARN_MORE[key]}
                            target={ZONE_LEARN_MORE[key].startsWith("http") ? "_blank" : undefined}
                            rel={ZONE_LEARN_MORE[key].startsWith("http") ? "noopener noreferrer" : undefined}
                            className="font-mono-bureau text-[9px] tracking-wide text-[#2563EB]/70 hover:text-[#2563EB] transition-colors"
                          >
                            Learn more &rarr;
                          </a>
                        )}
                      </div>
                    )}
                    {key === "nof" && zoneVisible.nof && (
                      <div className="ml-6 mt-0.5 mb-1.5 border-l border-[#0C1B33]/8 pl-3">
                        <label className="flex items-center gap-2 py-1.5 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={zoneVisible.nofFundedProjects}
                            onChange={() => onToggleZone("nofFundedProjects")}
                            className="sr-only"
                          />
                          <span
                            className="w-4 h-4 md:w-3 md:h-3 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors"
                            style={{
                              borderColor: ZONE_COLORS.nofFundedProjects,
                              backgroundColor: zoneVisible.nofFundedProjects
                                ? ZONE_COLORS.nofFundedProjects + "30"
                                : "transparent",
                            }}
                          >
                            {zoneVisible.nofFundedProjects && (
                              <span
                                className="w-2.5 h-2.5 md:w-1.5 md:h-1.5 rounded-full block"
                                style={{ backgroundColor: ZONE_COLORS.nofFundedProjects }}
                              />
                            )}
                          </span>
                          <span
                            className="text-[12px] md:text-[10px] text-[#0C1B33]/55 group-hover:text-[#0C1B33]/75 transition-colors leading-tight flex-1"
                            onClick={(e) => {
                              e.preventDefault();
                              onSetExpandedZone(
                                expandedZone === "nofFundedProjects" ? null : "nofFundedProjects"
                              );
                            }}
                          >
                            {ZONE_LABELS.nofFundedProjects}
                          </span>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              onSetExpandedZone(
                                expandedZone === "nofFundedProjects" ? null : "nofFundedProjects"
                              );
                            }}
                            className="text-[9px] text-[#2563EB]/40 hover:text-[#2563EB] transition-colors flex-shrink-0"
                            title="More info"
                          >
                            {expandedZone === "nofFundedProjects" ? "−" : "?"}
                          </button>
                        </label>
                        {expandedZone === "nofFundedProjects" && ZONE_DESCRIPTIONS.nofFundedProjects && (
                          <div className="ml-5 pl-0.5 pb-2 border-l-2 border-[#0C1B33]/5">
                            <p className="text-[10px] text-[#0C1B33]/50 leading-relaxed mt-1 mb-1.5">
                              {ZONE_DESCRIPTIONS.nofFundedProjects}
                            </p>
                            {ZONE_LEARN_MORE.nofFundedProjects && (
                              <a
                                href={ZONE_LEARN_MORE.nofFundedProjects}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono-bureau text-[9px] tracking-wide text-[#2563EB]/70 hover:text-[#2563EB] transition-colors"
                              >
                                Learn more &rarr;
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
