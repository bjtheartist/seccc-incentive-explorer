"use client";

import { useMemo, useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import { FileText, Loader2, Mail, X } from "lucide-react";
import { ZONE_COLORS, ZONE_LABELS } from "@/lib/constants";
import { OWNER_TYPE_LABELS, OWNER_TYPE_COLORS, type OwnerType } from "@/lib/owner-classify";
import type { GeneratedReport } from "@/lib/report-engine";
import type { WizardState } from "@/lib/report-wizard-config";
import { SaveReportModal } from "@/components/workspace/SaveReportModal";
import { storePendingReport } from "@/components/workspace/PendingReportSaver";

/** Vacancy follow-up resources */
const RESOURCES = [
  {
    name: "CCSA Storefront Activation",
    desc: "$30.5M in grants for storefront improvements across 12 corridors",
    url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/ccsa.html",
  },
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
  const { status } = useSession();
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const features = results.features;

  /* ── Summary counts ── */
  const vacantLandCount = features.filter(
    (f) => f.properties?.propertyType === "vacant_land"
  ).length;
  const vacantBuildingCount = features.filter(
    (f) => f.properties?.propertyType === "vacant_building"
  ).length;

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

  const areaReport = useMemo<GeneratedReport>(() => {
    const areaName = topCommunityArea || "Drawn Area";
    const zoneItems = zoneCounts.map(({ key, count }) => ({
      label: ZONE_LABELS[key] || key,
      value: `${count} propert${count === 1 ? "y" : "ies"}`,
      detail: `${features.length > 0 ? Math.round((count / features.length) * 100) : 0}% of properties in the drawn area fall within this zone.`,
    }));

    const ownerItems = ownerCounts.map(({ key, count }) => ({
      label: OWNER_TYPE_LABELS[key] || key,
      value: `${count} propert${count === 1 ? "y" : "ies"}`,
      detail: `${features.length > 0 ? Math.round((count / features.length) * 100) : 0}% of the drawn area vacancy set.`,
    }));

    const propertyItems = features.slice(0, 20).map((feature) => {
      const p = feature.properties ?? {};
      const zones: unknown[] = p.zoneMatches ?? [];
      return {
        label: String(p.address || "Unknown Address"),
        value: p.propertyType === "vacant_land" ? "Vacant land" : "Vacant building",
        detail: `${zones.length} incentive zone${zones.length !== 1 ? "s" : ""}${p.ownerType ? ` · ${OWNER_TYPE_LABELS[p.ownerType as OwnerType] || p.ownerType}` : ""}`,
      };
    });

    return {
      title: `Vacancy Area Report — ${areaName}`,
      subtitle: "Drawn-area vacancy overview",
      reportType: "best-location",
      generatedAt: new Date().toISOString(),
      summary:
        narrative ||
        `This drawn area contains ${features.length} vacant ${features.length === 1 ? "property" : "properties"}.`,
      sections: [
        {
          title: "Area Snapshot",
          description: "Summary of vacant properties inside the drawn area.",
          items: [
            { label: "Total Properties", value: String(features.length) },
            { label: "Vacant Land", value: String(vacantLandCount) },
            { label: "Vacant Buildings", value: String(vacantBuildingCount) },
            { label: "Community Area", value: topCommunityArea || "Drawn area" },
          ],
        },
        ...(zoneItems.length > 0
          ? [
              {
                title: "Incentive Zones in Area",
                description: "Zone coverage among properties inside the drawn area.",
                items: zoneItems,
              },
            ]
          : []),
        ...(ownerItems.length > 0
          ? [
              {
                title: "Ownership Breakdown",
                description: "Ownership classification among vacancy records.",
                items: ownerItems,
              },
            ]
          : []),
        ...(propertyItems.length > 0
          ? [
              {
                title: "Priority Properties",
                description:
                  propertyItems.length < features.length
                    ? `Showing the first ${propertyItems.length} of ${features.length} properties. Export CSV for the full list.`
                    : "Properties inside the drawn area.",
                items: propertyItems,
              },
            ]
          : []),
      ],
      recommendedActions: [
        {
          label: "Export and review the full property list",
          description:
            "Use the CSV to prioritize addresses by ownership, vacancy type, and incentive zone overlap.",
          priority: "high",
        },
        {
          label: "Verify property status",
          description:
            "Vacancy records can lag real conditions. Confirm status through site visits, assessor records, or local partners.",
          priority: "medium",
        },
        {
          label: "Contact an acquisition or corridor partner",
          description:
            "Use the report to start conversations with CCLBA, DPD, CCSA, or a local business support partner.",
          priority: "medium",
        },
      ],
      metadata: {
        address: areaName,
        projectType: "vacant-acquisition",
      },
      dataSources: [
        {
          id: "chicago-open-data",
          label: "City of Chicago Open Data",
          description: "Vacant property and public boundary data.",
          url: "https://data.cityofchicago.org/",
        },
        {
          id: "cook-county-assessor",
          label: "Cook County Assessor",
          description: "Property assessment and ownership context.",
          url: "https://www.cookcountyassessor.com/",
        },
      ],
    };
  }, [
    features,
    narrative,
    ownerCounts,
    topCommunityArea,
    vacantBuildingCount,
    vacantLandCount,
    zoneCounts,
  ]);

  const areaWizardState = useMemo<WizardState>(() => ({
    reportType: "dev-feasibility",
    address: topCommunityArea || "Drawn Area",
    lat: null,
    lon: null,
    neighborhood: topCommunityArea || "",
    industry: "",
    budgetRange: "skip",
    projectType: "vacant-acquisition",
    creditsToAnalyze: zoneCounts.map(({ key }) => key),
  }), [topCommunityArea, zoneCounts]);

  const handleSaveReport = useCallback(() => {
    if (status === "authenticated") {
      setSaveModalOpen(true);
      return;
    }

    storePendingReport({ reportData: areaReport, wizardState: areaWizardState });
    window.location.assign(
      `/login?callbackUrl=${encodeURIComponent("/workspace?savePending=1")}`
    );
  }, [areaReport, areaWizardState, status]);

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

    const area = topCommunityArea ? topCommunityArea.toLowerCase().replace(/\s+/g, "-") : "area";
    const date = new Date().toISOString().slice(0, 10);
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vacancy-report-${area}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [features, topCommunityArea]);

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
          {topCommunityArea && !loading && features.length > 0 && (
            <div className="font-mono-bureau text-[10px] text-white/50 mt-1.5">
              {topCommunityArea}
            </div>
          )}
          <div className="mt-3 h-[3px] w-10 bg-[#2563EB]" />
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
        <div className="px-5 py-10 flex flex-col items-center gap-3 bg-white">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="block w-2 h-2 bg-[#2563EB] rounded-full"
                style={{ animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite` }}
              />
            ))}
          </div>
          <span className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/40">
            Analyzing area...
          </span>
        </div>
      )}

      {/* ── Results ── */}
      {!loading && (
        <>
          {/* ── Empty state ── */}
          {features.length === 0 && (
            <div className="px-5 py-10 text-center bg-white">
              <div className="font-editorial text-[18px] text-[#0C1B33]/30 mb-2">No properties found</div>
              <div className="text-[11px] text-[#0C1B33]/40">Try drawing a larger area or a different location.</div>
            </div>
          )}

          {/* ── Narrative Summary ── */}
          {features.length > 0 && narrative && (
            <div className="px-5 pt-5 pb-4 bg-white border-b border-[#0C1B33]/8">
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
            <div className="px-5 py-4 bg-white">
              <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/50 mb-3">
                At a Glance
              </div>
              <div className="grid grid-cols-3 gap-px bg-[#0C1B33]/8 border border-[#0C1B33]/8">
                {[
                  { label: "Total", value: features.length },
                  { label: "Vacant Land", value: vacantLandCount },
                  { label: "Buildings", value: vacantBuildingCount },
                ].map((stat) => (
                  <div key={stat.label} className="bg-[#FAF9F6] px-3 py-3 text-center">
                    <div className="font-editorial text-[22px] leading-none text-[#0C1B33]">
                      {stat.value}
                    </div>
                    <div className="font-mono-bureau text-[7px] tracking-[0.18em] uppercase text-[#0C1B33]/35 mt-2">
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>
              {zoneCounts.length > 0 && (
                <div className="mt-2 flex items-center justify-between text-[10px] px-1">
                  <span className="text-[#0C1B33]/40">Incentive zones covering this area</span>
                  <span className="font-mono-bureau font-medium text-[#059669]">{zoneCounts.length}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Zone Breakdown ── */}
          {zoneCounts.length > 0 && (
            <>
              <div className="mx-5 h-px bg-[#0C1B33]/8" />
              <div className="px-5 py-4 bg-white">
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#059669]/50 mb-1.5">
                  Incentive Zones in Area
                </div>
                <div className="text-[9px] text-[#0C1B33]/35 mb-2">
                  Properties covered by each zone
                </div>
                <div className="space-y-1.5">
                  {zoneCounts.map(({ key, count }) => {
                    const pct = features.length > 0 ? Math.round((count / features.length) * 100) : 0;
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between text-[10px] mb-0.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                              style={{ backgroundColor: ZONE_COLORS[key] ?? "#9CA3AF" }}
                            />
                            <span className="text-[#0C1B33]/70 truncate">
                              {ZONE_LABELS[key] ?? key}
                            </span>
                          </div>
                          <span className="font-mono-bureau text-[#0C1B33]/80 shrink-0 ml-2">
                            {count}
                          </span>
                        </div>
                        <div className="h-1 bg-[#0C1B33]/5 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: ZONE_COLORS[key] ?? "#9CA3AF",
                              opacity: 0.6,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ── Ownership Breakdown ── */}
          {ownerCounts.length > 0 && (
            <>
              <div className="mx-5 h-px bg-[#0C1B33]/8" />
              <div className="px-5 py-4 bg-white">
                <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#7C3AED]/50 mb-2">
                  Ownership Breakdown
                </div>
                <div className="space-y-1.5">
                  {ownerCounts.map(({ key, count }) => {
                    const color = OWNER_TYPE_COLORS[key] ?? "#9CA3AF";
                    const pct = features.length > 0 ? Math.round((count / features.length) * 100) : 0;
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between text-[10px]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block text-[9px] font-medium px-2 py-0.5 rounded shrink-0"
                            style={{
                              backgroundColor: color + "15",
                              color,
                              border: `1px solid ${color}30`,
                            }}
                          >
                            {OWNER_TYPE_LABELS[key] ?? key}
                          </span>
                          <span className="text-[9px] text-[#0C1B33]/30">{pct}%</span>
                        </div>
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
                <div className="flex items-baseline justify-between mb-0.5">
                  <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#D97706]/50">
                    Properties
                  </div>
                  <span className="font-mono-bureau text-[9px] text-[#0C1B33]/30">
                    {features.length} total
                  </span>
                </div>
                <div className="text-[9px] text-[#0C1B33]/35 mb-2">
                  Click an address to generate its incentive report
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
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
                        className="text-[10px] leading-snug border-l-2 pl-3 py-1 hover:bg-[#FAF9F6] transition-colors"
                        style={{ borderColor: isLand ? "#EF4444" : "#F97316" }}
                      >
                        <a
                          href={buildReportLink(f)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-[#0C1B33]/80 hover:text-[#2563EB] truncate block transition-colors"
                          title={`Generate report for ${p.address}`}
                        >
                          {p.address ?? "Unknown Address"}
                        </a>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span
                            className="inline-block text-[8px] font-medium px-1.5 py-px rounded"
                            style={{
                              backgroundColor: isLand ? "#EF444410" : "#F9731610",
                              color: isLand ? "#EF4444" : "#F97316",
                            }}
                          >
                            {isLand ? "Land" : "Building"}
                          </span>
                          {zones.length > 0 && (
                            <span className="text-[8px] text-[#0C1B33]/40 font-mono-bureau">
                              {zones.length} zone{zones.length !== 1 ? "s" : ""}
                            </span>
                          )}
                          {p.ownerType && p.ownerType !== "unknown" && (
                            <span
                              className="inline-block text-[8px] px-1.5 py-px rounded"
                              style={{
                                backgroundColor: ownerColor + "12",
                                color: ownerColor,
                              }}
                            >
                              {OWNER_TYPE_LABELS[p.ownerType as OwnerType] ?? p.ownerType}
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

          {/* ── Actions ── */}
          {features.length > 0 && (
            <>
              <div className="mx-5 h-px bg-[#0C1B33]/8" />
              <div className="px-5 py-4 bg-white">
                <div className="grid grid-cols-1 gap-2 mb-2">
                  <button
                    onClick={handleSaveReport}
                    className="w-full inline-flex items-center justify-center gap-2 text-center font-mono-bureau text-[10px] tracking-[0.15em] uppercase bg-[#2563EB] text-white py-3 px-3 hover:bg-[#1d4ed8] transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Save Report
                  </button>
                  <button
                    onClick={() => setEmailModalOpen(true)}
                    className="w-full inline-flex items-center justify-center gap-2 text-center font-mono-bureau text-[10px] tracking-[0.15em] uppercase border border-[#2563EB]/30 text-[#2563EB] py-3 px-3 hover:bg-[#2563EB]/5 transition-colors"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Email This to Me
                  </button>
                </div>
                <button
                  onClick={handleExportCsv}
                  className="block w-full text-center font-mono-bureau text-[10px] tracking-[0.15em] uppercase bg-[#0C1B33] text-white py-3 px-3 hover:bg-[#0C1B33]/80 transition-colors"
                >
                  Export Full Report (CSV)
                </button>
              </div>
            </>
          )}

          {/* ── Follow-Up Resources ── */}
          <div className="mx-5 h-px bg-[#0C1B33]/8" />
          <div className="px-5 py-4 bg-white">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30 mb-2">
              Next Steps &amp; Resources
            </div>
            <div className="space-y-2.5">
              {RESOURCES.map((r) => (
                <a
                  key={r.name}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 group"
                >
                  <span className="text-[#2563EB]/40 group-hover:text-[#2563EB] mt-0.5 text-[8px] shrink-0">&#x2192;</span>
                  <div>
                    <div className="text-[10px] font-medium text-[#0C1B33]/70 group-hover:text-[#2563EB] transition-colors">
                      {r.name}
                    </div>
                    <div className="text-[9px] text-[#0C1B33]/35 leading-snug">
                      {r.desc}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="mx-5 h-px bg-[#0C1B33]/8" />
          <div className="px-5 py-3 bg-white">
            <a
              href="/programs"
              className="block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase border border-[#0C1B33]/15 text-[#0C1B33]/50 py-2 px-3 hover:text-[#0C1B33] hover:border-[#0C1B33]/30 transition-colors"
            >
              Browse All Programs
            </a>
          </div>

          {/* ── Attribution ── */}
          <div className="px-5 py-3 bg-[#F5F5F0] border-t border-[#0C1B33]/6">
            <p className="text-[8px] text-[#0C1B33]/25 leading-snug">
              Data: City of Chicago Open Data &amp; Cook County Assessor. Vacancy records may not reflect current conditions. Always verify on-site.
            </p>
          </div>
        </>
      )}
      {saveModalOpen && (
        <SaveReportModal
          reportData={areaReport}
          wizardState={areaWizardState}
          onClose={() => setSaveModalOpen(false)}
        />
      )}
      {emailModalOpen && (
        <AreaEmailReportModal
          report={areaReport}
          onClose={() => setEmailModalOpen(false)}
        />
      )}
    </div>
  );
}

function AreaEmailReportModal({
  report,
  onClose,
}: {
  report: GeneratedReport;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const handleSend = async () => {
    if (!email.includes("@")) return;
    setStatus("sending");
    setError("");

    try {
      const { generateReportPdfBase64 } = await import("@/lib/pdf-report");
      const { base64, filename } = generateReportPdfBase64(report);

      const res = await fetch("/api/email-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          pdfBase64: base64,
          filename,
          businessName: report.title,
          address: report.metadata.address,
          incentiveCount: report.sections.length,
        }),
      });

      if (!res.ok) throw new Error("Could not send email");
      setStatus("sent");
      setTimeout(onClose, 1200);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not send email");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white border border-[#0C1B33]/10 shadow-2xl">
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-[#0C1B33]/8">
          <div>
            <p className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/60 mb-2">
              Email Vacancy Report
            </p>
            <h3 className="font-editorial text-2xl text-[#0C1B33] leading-tight">
              Send this area report to yourself.
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#0C1B33]/35 hover:text-[#0C1B33] p-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="w-full border border-[#0C1B33]/10 px-4 py-3 text-sm text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB]"
          />
          {error && (
            <p className="text-[12px] text-red-600 bg-red-50 border border-red-100 px-3 py-2">
              {error}
            </p>
          )}
          {status === "sent" && (
            <p className="text-[12px] text-green-700 bg-green-50 border border-green-100 px-3 py-2">
              Sent. Check your inbox.
            </p>
          )}
        </div>
        <div className="px-6 pb-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button
            onClick={onClose}
            className="px-5 py-3 border border-[#0C1B33]/10 text-[#0C1B33]/50 font-mono-bureau text-[10px] tracking-[0.15em] uppercase hover:border-[#0C1B33]/25"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={!email.includes("@") || status === "sending" || status === "sent"}
            className="px-5 py-3 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase hover:bg-[#1E3054] disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {status === "sending" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Email This to Me
          </button>
        </div>
      </div>
    </div>
  );
}
