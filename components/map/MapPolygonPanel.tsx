"use client";

import { useMemo, useCallback } from "react";
import { ZONE_COLORS, ZONE_LABELS } from "@/lib/constants";
import { OWNER_TYPE_LABELS, OWNER_TYPE_COLORS, type OwnerType } from "@/lib/owner-classify";

/** Vacancy follow-up resources */
const RESOURCES = [
  {
    name: "Cook County Land Bank (CCLBA)",
    desc: "Acquire vacant lots and buildings cleared of back taxes",
    url: "http://www.cookcountylandbank.org/",
  },
  {
    name: "Chicago Large Lots Program",
    desc: "Purchase city-owned vacant lots for $1 in eligible areas",
    url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/large-lot-program.html",
  },
  {
    name: "Chi Block Builders",
    desc: "Community-led vacant lot activation and block development",
    url: "https://www.chiblockbuilders.com/",
  },
  {
    name: "Neighborhood Opportunity Fund",
    desc: "Grants for commercial projects on the South & West Sides",
    url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/neighborhood-opportunity-fund0.html",
  },
];

interface MapPolygonPanelProps {
  results: GeoJSON.FeatureCollection;
  loading: boolean;
  onClose: () => void;
  onClear: () => void;
}

export default function MapPolygonPanel({
  results,
  loading,
  onClose,
  onClear,
}: MapPolygonPanelProps) {
  const features = results.features;

  /* ── Summary counts ── */
  const vacantLandCount = features.filter(
    (f) => f.properties?.propertyType === "vacant_land"
  ).length;
  const vacantBuildingCount = features.filter(
    (f) => f.properties?.propertyType === "vacant_building"
  ).length;
  const totalZoneMatches = features.reduce((total, f) => {
    const matches = f.properties?.zoneMatches ?? [];
    return total + (Array.isArray(matches) ? matches.length : 0);
  }, 0);
  const avgZones =
    features.length > 0 ? (totalZoneMatches / features.length).toFixed(1) : "0";

  /* ── Top community area ── */
  const topCommunityArea = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of features) {
      const ca = f.properties?.communityArea;
      if (ca) map.set(ca, (map.get(ca) ?? 0) + 1);
    }
    let top = "";
    let max = 0;
    for (const [k, v] of map) {
      if (v > max) { top = k; max = v; }
    }
    return top;
  }, [features]);

  /* ── Zone breakdown ── */
  const zoneCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of features) {
      const matches = f.properties?.zoneMatches ?? [];
      for (const z of matches) {
        const key = typeof z === "string" ? z : z.zoneKey;
        if (key) map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count }));
  }, [features]);

  /* ── Ownership breakdown ── */
  const ownerCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of features) {
      const ot: string = f.properties?.ownerType ?? "unknown";
      map.set(ot, (map.get(ot) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key: key as OwnerType, count }));
  }, [features]);

  /* ── Narrative summary ── */
  const narrative = useMemo(() => {
    if (features.length === 0) return "";
    const parts: string[] = [];
    parts.push(
      `This area contains ${features.length} vacant ${features.length === 1 ? "property" : "properties"}`
    );
    if (topCommunityArea) {
      parts[0] += ` in ${topCommunityArea}`;
    }
    parts[0] += ".";

    const typeBreak: string[] = [];
    if (vacantLandCount > 0) typeBreak.push(`${vacantLandCount} vacant lot${vacantLandCount !== 1 ? "s" : ""}`);
    if (vacantBuildingCount > 0) typeBreak.push(`${vacantBuildingCount} vacant building${vacantBuildingCount !== 1 ? "s" : ""}`);
    if (typeBreak.length === 2) {
      parts.push(`That includes ${typeBreak.join(" and ")}.`);
    }

    if (zoneCounts.length > 0) {
      const topZone = ZONE_LABELS[zoneCounts[0].key] ?? zoneCounts[0].key;
      parts.push(
        `${zoneCounts[0].count} of these fall within a ${topZone} zone${zoneCounts.length > 1 ? `, plus ${zoneCounts.length - 1} other incentive ${zoneCounts.length - 1 === 1 ? "zone" : "zones"}` : ""}.`
      );
    }

    const cityCount = ownerCounts.find((o) => o.key === "city_public")?.count ?? 0;
    if (cityCount > 0) {
      parts.push(
        `${cityCount} ${cityCount === 1 ? "is" : "are"} city-owned — potentially available through the Large Lots program or CCLBA.`
      );
    }

    return parts.join(" ");
  }, [features, topCommunityArea, vacantLandCount, vacantBuildingCount, zoneCounts, ownerCounts]);

  /* ── Export CSV ── */
  const handleExportCsv = useCallback(() => {
    const header = [
      "Address",
      "Property Type",
      "Ward",
      "Community Area",
      "Zoning Class",
      "Sq Ft",
      "Owner Name",
      "Owner Type",
      "Incentive Count",
      "Zone Matches",
    ];
    const rows = features.map((f) => {
      const p = f.properties ?? {};
      return [
        p.address ?? "",
        p.propertyType ?? "",
        p.ward ?? "",
        p.communityArea ?? "",
        p.zoningClass ?? "",
        p.squareFeet ?? "",
        p.ownerName ?? "",
        p.ownerType ?? "",
        p.incentiveCount ?? "",
        (p.zoneMatches ?? []).map((z: { zoneKey?: string }) => z.zoneKey ?? z).join("; "),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
    });

    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "area-analysis.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [features]);

  /** Build report link for a property using its coordinates */
  const buildReportLink = (f: GeoJSON.Feature) => {
    const p = f.properties ?? {};
    const coords = f.geometry.type === "Point" ? (f.geometry as GeoJSON.Point).coordinates : null;
    if (!coords) return "/report";
    return `/report?instant=true&lat=${coords[1].toFixed(5)}&lon=${coords[0].toFixed(5)}&addr=${encodeURIComponent(p.address ?? "")}`;
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 md:bottom-auto md:top-12 md:left-auto md:right-3 z-20 md:z-10 bg-[#FAF9F6] backdrop-blur border-t md:border border-[#0C1B33]/10 md:w-[380px] max-h-[68vh] md:max-h-[calc(100%-4rem)] overflow-y-auto rounded-t-xl md:rounded-none shadow-2xl md:shadow-xl">
      {/* Mobile drag handle */}
      <div className="md:hidden flex flex-col items-center pt-2 pb-1 bg-white">
        <div className="w-10 h-1 bg-[#0C1B33]/15" />
      </div>

      {/* ── Branded Header ── */}
      <div className="bg-[#0C1B33] px-5 pt-5 pb-4 flex items-start justify-between">
        <div>
          <div className="font-mono-bureau text-[9px] tracking-[0.3em] uppercase text-white/35">
            Area Analysis
          </div>
          <div className="font-editorial text-[24px] text-white leading-tight mt-1">
            Vacancy Report
          </div>
          <div className="mt-3 h-[3px] w-10 bg-white/25" />
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="text-white/35 hover:text-white text-[22px] leading-none transition-colors p-2 -mr-2 -mt-2"
          title="Close"
        >
          &times;
        </button>
      </div>

      {/* Clear & Redraw */}
      <div className="px-5 py-3 bg-white border-b border-[#0C1B33]/8 flex items-center justify-between">
        <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30">
          Drawn Area
        </span>
        <button
          onClick={onClear}
          className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#2563EB] hover:text-[#1d4ed8] transition-colors"
        >
          Clear &amp; Redraw
        </button>
      </div>

      {/* ── Loading state ── */}
      {loading && (
        <div className="px-5 py-6 flex items-center gap-2 bg-white">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2563EB] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2563EB]" />
          </span>
          <span className="text-[11px] text-[#0C1B33]/60">
            Analyzing area...
          </span>
        </div>
      )}

      {/* ── Results ── */}
      {!loading && (
        <>
          {/* ── Empty state ── */}
          {features.length === 0 && (
            <div className="px-5 py-8 text-center bg-white">
              <div className="text-[11px] text-[#0C1B33]/50 mb-1">No vacant properties found</div>
              <div className="text-[10px] text-[#0C1B33]/35">Try drawing a larger area or a different location.</div>
            </div>
          )}

          {/* ── Narrative Summary ── */}
          {features.length > 0 && narrative && (
            <div className="px-5 pt-5 pb-4 bg-white">
              <div className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/25 mb-2">
                Executive Snapshot
              </div>
              <p className="text-[13px] text-[#0C1B33]/60 leading-relaxed">
                {narrative}
              </p>
            </div>
          )}

          {/* ── At a Glance ── */}
          {features.length > 0 && (
            <>
              <div className="mx-5 h-px bg-[#0C1B33]/8" />
              <div className="px-5 py-4 bg-white">
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50 mb-3">
                  At a Glance
                </div>
                <div className="grid grid-cols-2 gap-px bg-[#0C1B33]/8 border border-[#0C1B33]/8">
                  {[
                    { label: "Properties", value: features.length },
                    { label: "Vacant Land", value: vacantLandCount },
                    { label: "Buildings", value: vacantBuildingCount },
                    { label: "Avg. Zones", value: avgZones },
                  ].map((stat) => (
                    <div key={stat.label} className="bg-[#FAF9F6] px-3 py-3">
                      <div className="font-editorial text-[24px] leading-none text-[#0C1B33]">
                        {stat.value}
                      </div>
                      <div className="font-mono-bureau text-[8px] tracking-[0.18em] uppercase text-[#0C1B33]/35 mt-2">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Zone Breakdown ── */}
          {zoneCounts.length > 0 && (
            <>
              <div className="mx-5 h-px bg-[#0C1B33]/8" />
              <div className="px-5 py-4 bg-white">
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#059669]/50 mb-1.5">
                  Incentive Zones in Area
                </div>
                <div className="text-[9px] text-[#0C1B33]/35 mb-1.5">
                  Properties covered by each zone
                </div>
                <div className="space-y-1">
                  {zoneCounts.map(({ key, count }) => (
                    <div
                      key={key}
                      className="flex items-center justify-between text-[10px]"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{
                            backgroundColor:
                              ZONE_COLORS[key] ?? "#9CA3AF",
                          }}
                        />
                        <span className="text-[#0C1B33]/70 truncate">
                          {ZONE_LABELS[key] ?? key}
                        </span>
                      </div>
                      <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0 ml-2">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Ownership Breakdown ── */}
          {ownerCounts.length > 0 && (
            <>
              <div className="mx-5 h-px bg-[#0C1B33]/8" />
              <div className="px-5 py-4 bg-white">
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#7C3AED]/50 mb-1.5">
                  Ownership Breakdown
                </div>
                <div className="space-y-1">
                  {ownerCounts.map(({ key, count }) => {
                    const color =
                      OWNER_TYPE_COLORS[key] ?? "#9CA3AF";
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between text-[10px]"
                      >
                        <span
                          className="inline-block text-[9px] font-medium px-2 py-0.5 rounded"
                          style={{
                            backgroundColor: color + "15",
                            color,
                            border: `1px solid ${color}30`,
                          }}
                        >
                          {OWNER_TYPE_LABELS[key] ?? key}
                        </span>
                        <span className="font-mono-bureau text-[#0C1B33]/80 ml-2">
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ── Property List ── */}
          {features.length > 0 && (
            <>
              <div className="mx-5 h-px bg-[#0C1B33]/8" />
              <div className="px-5 py-4 bg-white">
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#D97706]/50 mb-0.5">
                  Properties
                </div>
                <div className="text-[9px] text-[#0C1B33]/35 mb-1.5">
                  Click an address to generate its incentive report
                </div>
                <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                  {features.map((f, i) => {
                    const p = f.properties ?? {};
                    const isLand = p.propertyType === "vacant_land";
                    const zones: unknown[] = p.zoneMatches ?? [];
                    const ownerColor =
                      OWNER_TYPE_COLORS[p.ownerType as OwnerType] ??
                      "#9CA3AF";
                    return (
                      <div
                        key={p.address ?? i}
                        className="text-[10px] leading-snug border-l border-[#0C1B33]/10 pl-3 py-0.5"
                      >
                        <a
                          href={buildReportLink(f)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-[#2563EB]/80 hover:text-[#2563EB] truncate block transition-colors"
                          title={`Generate report for ${p.address}`}
                        >
                          {p.address ?? "Unknown Address"}
                        </a>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span
                            className="inline-block text-[8px] font-medium px-1.5 py-px rounded"
                            style={{
                              backgroundColor: isLand
                                ? "#EF444415"
                                : "#F9731615",
                              color: isLand ? "#EF4444" : "#F97316",
                              border: `1px solid ${
                                isLand ? "#EF444430" : "#F9731630"
                              }`,
                            }}
                          >
                            {isLand ? "Land" : "Building"}
                          </span>
                          {zones.length > 0 && (
                            <span className="text-[8px] text-[#0C1B33]/40 font-mono-bureau">
                              {zones.length} zone
                              {zones.length !== 1 ? "s" : ""}
                            </span>
                          )}
                          {p.ownerType && p.ownerType !== "unknown" && (
                            <span
                              className="inline-block text-[8px] px-1.5 py-px rounded"
                              style={{
                                backgroundColor: ownerColor + "15",
                                color: ownerColor,
                                border: `1px solid ${ownerColor}30`,
                              }}
                            >
                              {OWNER_TYPE_LABELS[
                                p.ownerType as OwnerType
                              ] ?? p.ownerType}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ── Export CSV ── */}
          {features.length > 0 && (
            <>
              <div className="mx-5 h-px bg-[#0C1B33]/8" />
              <div className="px-5 py-4 space-y-2 bg-white">
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30 mb-2">
                  Report Actions
                </div>
                <button
                  onClick={handleExportCsv}
                  className="block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase bg-[#2563EB] text-white py-2 px-3 hover:bg-[#1d4ed8] transition-colors"
                >
                  Export CSV
                </button>
              </div>
            </>
          )}

          {/* ── Follow-Up Resources ── */}
          <div className="mx-5 h-px bg-[#0C1B33]/8" />
          <div className="px-5 py-4 bg-white">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30 mb-1.5">
              Next Steps &amp; Resources
            </div>
            <div className="space-y-2">
              {RESOURCES.map((r) => (
                <a
                  key={r.name}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block group"
                >
                  <div className="text-[10px] font-medium text-[#2563EB]/70 group-hover:text-[#2563EB] transition-colors">
                    {r.name}
                  </div>
                  <div className="text-[9px] text-[#0C1B33]/40 leading-snug">
                    {r.desc}
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="mx-5 h-px bg-[#0C1B33]/8" />
          <div className="px-5 py-4 space-y-2 bg-white">
            <a
              href="/programs"
              className="block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase border border-[#0C1B33]/15 text-[#0C1B33]/60 py-2 px-3 hover:text-[#0C1B33] hover:border-[#0C1B33]/30 transition-colors"
            >
              Browse All Programs
            </a>
          </div>

          {/* ── Attribution ── */}
          <div className="px-5 py-3 bg-[#F5F5F0] border-t border-[#0C1B33]/8">
            <p className="text-[8px] text-[#0C1B33]/25 leading-snug">
              Data: City of Chicago Open Data &amp; Cook County Assessor. Vacancy records may not reflect current conditions. Always verify on-site.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
