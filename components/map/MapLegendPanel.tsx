"use client";

import React from "react";
import {
  ZONE_COLORS,
  ZONE_LABELS,
  ZONE_KEYS_SORTED,
  ZONE_DESCRIPTIONS,
  ZONE_LEARN_MORE,
  ZONING_CATEGORIES,
  ZONING_CODE_DESCRIPTIONS,
  VACANT_COLORS,
  VACANT_LABELS,
} from "@/lib/constants";
import {
  OWNER_TYPE_LABELS,
  OWNER_TYPE_COLORS,
  type OwnerType,
} from "@/lib/owner-classify";
import { CLASS_CODE_MAP } from "@/lib/parcel-classes";
import { MAP_PRESETS, POI_LAYERS } from "./map-helpers";

interface MapLegendPanelProps {
  zoneVisible: Record<string, boolean>;
  poiVisible: Record<string, boolean>;
  zoningVisible: Record<string, boolean>;
  vacantVisible: Record<string, boolean>;
  parcelsVisible: boolean;
  ownerFilter: OwnerType | "all";
  expandedZone: string | null;
  zoningRefOpen: boolean;
  classRefOpen: boolean;
  inspectMode: boolean;
  activePreset: string | null;
  onClose: () => void;
  onToggleZone: (key: string) => void;
  onTogglePoi: (key: string) => void;
  onToggleZoningCategory: (catKey: string) => void;
  onToggleAllZoning: () => void;
  onSetVacantVisible: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSetParcelsVisible: React.Dispatch<React.SetStateAction<boolean>>;
  onSetOwnerFilter: (value: OwnerType | "all") => void;
  onSetExpandedZone: (key: string | null) => void;
  onSetZoningRefOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onSetClassRefOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onSetInspectMode: React.Dispatch<React.SetStateAction<boolean>>;
  onApplyPreset: (presetId: string) => void;
}

export default function MapLegendPanel({
  zoneVisible,
  poiVisible,
  zoningVisible,
  vacantVisible,
  parcelsVisible,
  ownerFilter,
  expandedZone,
  zoningRefOpen,
  classRefOpen,
  inspectMode,
  activePreset,
  onClose,
  onToggleZone,
  onTogglePoi,
  onToggleZoningCategory,
  onToggleAllZoning,
  onSetVacantVisible,
  onSetParcelsVisible,
  onSetOwnerFilter,
  onSetExpandedZone,
  onSetZoningRefOpen,
  onSetClassRefOpen,
  onSetInspectMode,
  onApplyPreset,
}: MapLegendPanelProps) {
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
      <div className="px-4 pt-2 md:pt-4 pb-3">
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

      {/* Incentive Zones */}
      <div className="px-4 pt-3 pb-2">
        <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50 mb-3">
          Incentive Zones
        </div>
        <div className="space-y-0.5">
          {ZONE_KEYS_SORTED.map((key) => (
            <div key={key}>
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
            </div>
          ))}
        </div>
      </div>

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

    </div>
  );
}
