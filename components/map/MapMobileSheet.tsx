"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Layers, Loader2 } from "lucide-react";
import {
  MOBILE_MAP_PRESETS,
  type MobileMapPresetId,
} from "./map-layer-presets";

interface MapMobileSheetProps {
  activePreset: MobileMapPresetId | null;
  snapshotLabel: string;
  isGeneratingSnapshot: boolean;
  onApplyPreset: (presetId: MobileMapPresetId) => void;
  onGenerateSnapshot: () => void;
  onOpenLegend?: () => void;
  onShowAdvanced?: () => void;
}

export default function MapMobileSheet({
  activePreset,
  snapshotLabel,
  isGeneratingSnapshot,
  onApplyPreset,
  onGenerateSnapshot,
  onOpenLegend,
  onShowAdvanced,
}: MapMobileSheetProps) {
  const advancedAction = onShowAdvanced ?? onOpenLegend;
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="md:hidden absolute bottom-0 left-0 right-0 z-20 max-h-[72vh] overflow-y-auto bg-white/98 backdrop-blur border-t border-[#0C1B33]/10 rounded-t-xl shadow-lg">
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        className="flex w-full flex-col items-center pt-2 pb-1"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? "Minimize map discovery" : "Expand map discovery"}
      >
        <div className="w-10 h-1 rounded-full bg-[#0C1B33]/15" />
      </button>

      <div className="px-4 pt-2 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50">
              Map Discovery
            </div>
            <div className="mt-1 truncate text-[12px] font-medium text-[#0C1B33]/75">
              {snapshotLabel}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded((value) => !value)}
              className="flex h-10 w-10 items-center justify-center border border-[#0C1B33]/12 bg-white text-[#0C1B33]/55 transition-colors hover:border-[#2563EB]/40 hover:text-[#2563EB]"
              aria-label={isExpanded ? "Minimize quick filters" : "Show quick filters"}
              title={isExpanded ? "Minimize" : "Quick filters"}
            >
              {isExpanded ? (
                <ChevronDown size={17} strokeWidth={1.8} />
              ) : (
                <ChevronUp size={17} strokeWidth={1.8} />
              )}
            </button>
            {advancedAction && (
            <button
              type="button"
              onClick={advancedAction}
              className="flex h-10 w-10 items-center justify-center border border-[#0C1B33]/12 bg-white text-[#0C1B33]/55 transition-colors hover:border-[#2563EB]/40 hover:text-[#2563EB]"
              aria-label={onShowAdvanced ? "Show advanced map controls" : "Open map legend"}
              title={onShowAdvanced ? "Advanced controls" : "Legend"}
            >
              <Layers size={17} strokeWidth={1.8} />
            </button>
            )}
          </div>
        </div>

        {isExpanded && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {MOBILE_MAP_PRESETS.map((preset) => {
            const isActive = activePreset === preset.id;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onApplyPreset(preset.id)}
                aria-pressed={isActive}
                className={`min-h-16 border px-3 py-2 text-left transition-colors ${
                  isActive
                    ? "border-[#2563EB] bg-[#2563EB] text-white"
                    : "border-[#0C1B33]/12 bg-white text-[#0C1B33] hover:border-[#2563EB]/40"
                }`}
              >
                <span className="block font-mono-bureau text-[10px] uppercase tracking-[0.12em]">
                  {preset.label}
                </span>
                <span
                  className={`mt-1 block text-[10px] leading-snug ${
                    isActive ? "text-white/75" : "text-[#0C1B33]/45"
                  }`}
                >
                  {preset.description}
                </span>
              </button>
            );
          })}
        </div>
        )}

        <button
          type="button"
          onClick={onGenerateSnapshot}
          disabled={isGeneratingSnapshot}
          className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 bg-[#0C1B33] px-4 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.14em] text-white transition-colors hover:bg-[#2563EB] disabled:cursor-not-allowed disabled:bg-[#0C1B33]/45"
        >
          {isGeneratingSnapshot && <Loader2 size={16} strokeWidth={1.8} className="animate-spin" />}
          {isGeneratingSnapshot ? "Generating Snapshot" : "Generate Location Snapshot"}
        </button>
      </div>
    </div>
  );
}
