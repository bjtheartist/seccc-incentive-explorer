"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { OwnerCluster } from "@/lib/corridor-owners";
import { OWNER_TYPE_COLORS, OWNER_TYPE_LABELS, OWNER_TYPE_ORDER, normalizeOwnerType, type OwnerType } from "@/lib/owner-classify";
import {
  sortAndFilterClusters,
  type ClusterSortKey,
  type EntityFilter,
} from "@/lib/owner-cluster-sort-filter";

/**
 * Client island for the Owner Files per-ZIP cluster list
 * (app/admin/owner-files/[zip]/page.tsx). The server page keeps doing the
 * admin-session gate + listOwnerClusters fetch (never move that client-side
 * — it's the same auth/data pattern every other Owner Files route uses);
 * this component only owns sort/filter UI state over the already-loaded
 * clusters array, via the pure helpers in lib/owner-cluster-sort-filter.ts.
 *
 * Card row order (mirrored by the map popup in components/map/map-helpers.ts
 * buildOwnerClusterPopupHtml where the leaner geo export has the data):
 *   1. owner name (bold) + owner-type chip, confidence tier badge right-aligned
 *   2. "X vacant / Y parcels" metric, + building violations when non-null
 *   3. "Taxpayer mailing: {address}"
 *   4. sample addresses ("+N more")
 */

const CONFIDENCE_BADGE: Record<string, string> = {
  High: "bg-[#DCFCE7] text-[#16A34A]",
  Medium: "bg-[#FEF3C7] text-[#D97706]",
  Low: "bg-[#0C1B33]/5 text-[#0C1B33]/45",
};

const SORT_OPTIONS: { value: ClusterSortKey; label: string }[] = [
  { value: "vacant", label: "Vacant count" },
  { value: "parcels", label: "Total parcels" },
  { value: "ownerName", label: "Owner name (A–Z)" },
];

const ENTITY_FILTER_OPTIONS: { value: EntityFilter; label: string }[] = [
  { value: "all", label: "All owners" },
  { value: "entities", label: "Entities only" },
  { value: "individuals", label: "Individuals only" },
];

const MIN_VACANT_QUICK_FILTER = 3;

interface OwnerClusterListClientProps {
  zip: string;
  clusters: OwnerCluster[];
}

export default function OwnerClusterListClient({ zip, clusters }: OwnerClusterListClientProps) {
  const [sortKey, setSortKey] = useState<ClusterSortKey>("vacant");
  const [ownerTypeFilters, setOwnerTypeFilters] = useState<ReadonlySet<OwnerType>>(new Set());
  const [entityFilter, setEntityFilter] = useState<EntityFilter>("all");
  const [minVacantOnly, setMinVacantOnly] = useState(false);

  function toggleOwnerType(type: OwnerType) {
    setOwnerTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  const visibleClusters = useMemo(
    () =>
      sortAndFilterClusters(clusters, {
        sortKey,
        ownerTypes: ownerTypeFilters.size > 0 ? Array.from(ownerTypeFilters) : undefined,
        entityFilter,
        minVacant: minVacantOnly ? MIN_VACANT_QUICK_FILTER : 0,
      }),
    [clusters, sortKey, ownerTypeFilters, entityFilter, minVacantOnly]
  );

  if (clusters.length === 0) {
    return (
      <div className="mt-8 border border-[#0C1B33]/10 bg-white p-6">
        <p className="text-[13px] text-[#0C1B33]/45">No ownership clusters found for ZIP {zip} yet.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Controls */}
      <div className="mt-8 flex flex-col gap-3 border border-[#0C1B33]/10 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <label htmlFor="cluster-sort" className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/40">
            Sort
          </label>
          <select
            id="cluster-sort"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as ClusterSortKey)}
            className="border border-[#0C1B33]/15 bg-white px-2 py-1.5 text-[12px] text-[#0C1B33] focus:border-[#2563EB] focus:outline-none"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {OWNER_TYPE_ORDER.map((type) => {
            const active = ownerTypeFilters.has(type);
            const color = OWNER_TYPE_COLORS[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleOwnerType(type)}
                aria-pressed={active}
                className="px-2 py-1 font-mono-bureau text-[9px] uppercase tracking-[0.06em] border transition-colors"
                style={{
                  backgroundColor: active ? color : "white",
                  color: active ? "white" : color,
                  borderColor: color,
                }}
              >
                {OWNER_TYPE_LABELS[type]}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {ENTITY_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setEntityFilter(opt.value)}
              aria-pressed={entityFilter === opt.value}
              className={`px-2 py-1 font-mono-bureau text-[9px] uppercase tracking-[0.06em] border transition-colors ${
                entityFilter === opt.value
                  ? "bg-[#0C1B33] text-white border-[#0C1B33]"
                  : "bg-white text-[#0C1B33]/55 border-[#0C1B33]/15 hover:border-[#0C1B33]/30"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 font-mono-bureau text-[9px] uppercase tracking-[0.06em] text-[#0C1B33]/55">
          <input type="checkbox" checked={minVacantOnly} onChange={() => setMinVacantOnly((v) => !v)} />
          {MIN_VACANT_QUICK_FILTER}+ vacant
        </label>
      </div>

      <p className="mt-3 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/35">
        {visibleClusters.length} of {clusters.length} clusters
      </p>

      {/* Cluster cards */}
      <div className="mt-2 divide-y divide-[#0C1B33]/8 border border-[#0C1B33]/10 bg-white">
        {visibleClusters.length === 0 ? (
          <p className="p-6 text-[13px] text-[#0C1B33]/45">No clusters match the current filters.</p>
        ) : (
          visibleClusters.map((cluster) => {
            const ownerType = normalizeOwnerType(cluster.ownerType);
            const ownerColor = OWNER_TYPE_COLORS[ownerType];
            const ownerLabel = OWNER_TYPE_LABELS[ownerType];
            const violations = cluster.distressSignals.buildingViolationCount;

            return (
              <Link
                key={cluster.clusterKey}
                href={`/admin/owner-files/${zip}/${encodeURIComponent(cluster.clusterKey)}`}
                className="flex flex-col gap-2 p-5 transition-colors hover:bg-[#FAF9F6]"
              >
                {/* Row 1: owner name + owner-type chip, confidence badge right-aligned */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="truncate font-editorial text-[20px] text-[#0C1B33]">
                      {cluster.ownerName || "Owner record unavailable"}
                    </p>
                    <span
                      className="shrink-0 px-2 py-0.5 font-mono-bureau text-[9px] uppercase tracking-[0.06em]"
                      style={{
                        backgroundColor: `${ownerColor}1A`,
                        color: ownerColor,
                        border: `1px solid ${ownerColor}4D`,
                      }}
                    >
                      {ownerLabel}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-1 font-mono-bureau text-[10px] uppercase tracking-[0.1em] ${
                      CONFIDENCE_BADGE[cluster.confidence] ?? CONFIDENCE_BADGE.Low
                    }`}
                  >
                    {cluster.confidence}
                  </span>
                </div>

                {/* Row 2: metric line */}
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono-bureau text-[12px] font-semibold uppercase tracking-[0.08em] text-[#0C1B33]">
                    {cluster.vacantParcelCount} vacant / {cluster.parcelCount} parcels
                  </span>
                  {violations != null && (
                    <span className="font-mono-bureau text-[11px] uppercase tracking-[0.08em] text-[#DC2626]/75">
                      {violations} building violation{violations === 1 ? "" : "s"}
                    </span>
                  )}
                </div>

                {/* Row 3: taxpayer mailing address */}
                <p className="truncate text-[12px] text-[#0C1B33]/45">
                  Taxpayer mailing: {cluster.ownerMailingAddress || "unavailable"}
                </p>

                {/* Row 4: sample addresses */}
                {cluster.sampleAddresses.length > 0 && (
                  <p className="truncate text-[11px] text-[#0C1B33]/35">
                    {cluster.sampleAddresses.slice(0, 2).join("; ")}
                    {cluster.parcelCount > 2 ? ` +${cluster.parcelCount - 2} more` : ""}
                  </p>
                )}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
