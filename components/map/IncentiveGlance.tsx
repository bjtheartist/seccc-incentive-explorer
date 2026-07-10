"use client";

import { useState } from "react";
import { ZONE_COLORS, ZONE_KEYS } from "@/lib/constants";
import { cachedFetch } from "@/lib/fetch-cache";

interface ZoneStat {
  count: number;
  pct: number;
  label: string;
}

interface StatsData {
  totalBusinesses: number;
  totalCategories: number;
  zipCodes: string[];
  zoneCoverage: Record<string, ZoneStat>;
  stackingDistribution: Record<string, number>;
  sbif: { localProjects: number };
}

export default function IncentiveGlance() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [open, setOpen] = useState(false);

  const loadStats = async () => {
    if (stats) {
      setOpen((o) => !o);
      return;
    }
    try {
      const data = await cachedFetch<StatsData>("/api/stats");
      setStats(data);
      setOpen(true);
      return;
    } catch {
      // Fall through to static
    }
    try {
      const data = await cachedFetch<StatsData>("/data/stats.json");
      setStats(data);
      setOpen(true);
    } catch { /* ignore */ }
  };

  /* Primary zones by relative citywide coverage */
  const topZones = stats
    ? ZONE_KEYS.filter((k) => stats.zoneCoverage[k])
        .sort((a, b) => stats.zoneCoverage[b].pct - stats.zoneCoverage[a].pct)
        .slice(0, 5)
    : [];

  const coverageLabel = (pct: number) => {
    if (pct >= 70) return "Broad";
    if (pct >= 40) return "Common";
    if (pct >= 15) return "Targeted";
    return "Limited";
  };

  return (
    <div className="mt-6 border border-[#0C1B33]/10 bg-white">
      {/* Header bar — always visible */}
      <button
        onClick={loadStats}
        className="w-full flex items-center justify-between px-6 py-4 group"
      >
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-[#2563EB]/10 flex items-center justify-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#2563EB"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div className="text-left">
            <h3 className="text-sm text-[#0C1B33]/80 font-medium">
              Incentives at a Glance
            </h3>
            <p className="text-[11px] text-[#0C1B33]/40 mt-0.5">
              Citywide zone context and custom report tools
            </p>
          </div>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-[#0C1B33]/30 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expandable panel */}
      {open && stats && (
        <div className="border-t border-[#0C1B33]/8">
          {/* Top stats row */}
          <div className="grid grid-cols-3 gap-0">
            {[
              {
                label: "Layer Inventory",
                value: "Curated",
              },
              {
                label: "Stacking Potential",
                value: "Location based",
              },
              {
                label: "Coverage Lens",
                value: "Directional",
              },
            ].map((stat, i) => (
              <div
                key={i}
                className={`px-6 py-4 ${i < 2 ? "border-r border-[#0C1B33]/6" : ""}`}
              >
                <div className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 mb-1">
                  {stat.label}
                </div>
                <div className="font-mono-bureau text-lg text-[#0C1B33]/80">
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Zone coverage bars */}
          <div className="border-t border-[#0C1B33]/8 px-6 py-5">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/40 mb-4">
              Common Zone Layers — Chicago
            </div>
            <div className="space-y-2.5">
              {topZones.map((key) => {
                const z = stats.zoneCoverage[key];
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span
                      className="w-2 h-2 flex-shrink-0"
                      style={{ backgroundColor: ZONE_COLORS[key] }}
                    />
                    <span className="text-[11px] text-[#0C1B33]/60 w-44 truncate">
                      {z.label}
                    </span>
                    <div className="flex-1 h-1.5 bg-[#0C1B33]/6 overflow-hidden">
                      <div
                        className="h-full transition-all duration-500"
                        style={{
                          width: `${z.pct}%`,
                          backgroundColor: ZONE_COLORS[key],
                          opacity: 0.6,
                        }}
                      />
                    </div>
                    <span className="font-mono-bureau text-[10px] tracking-[0.08em] uppercase text-[#0C1B33]/45 w-16 text-right">
                      {coverageLabel(z.pct)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Report CTA */}
          <div className="border-t border-[#0C1B33]/8 px-6 py-4 flex items-center justify-between">
            <div>
              <div className="text-[12px] text-[#0C1B33]/70">
                Chicago Site Incentive Report
              </div>
              <div className="text-[11px] text-[#0C1B33]/35 mt-0.5">
                Start with project goals, readiness, incentives, and next steps
              </div>
            </div>
            <a
              href="/report?source=map_inline_card"
              className="flex items-center gap-2 bg-[#0C1B33] text-white px-4 py-2 text-[11px] font-mono-bureau tracking-[0.1em] uppercase hover:bg-[#1E3054] transition-colors"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              Start Guided Report
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
