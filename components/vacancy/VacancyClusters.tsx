"use client";

/**
 * VacancyClusters — the "coordinated intervention" cards for the Vacancy
 * Opportunity Index web report (D5). One card per proximity cluster
 * (lib/vacancy-index.ts clusterVacantSites, attached to each edition as
 * `clusters`), each summarising who owns the vacant properties packed into a
 * ~150 m radius, their distress load, and their land/building split — with a deep-link that focuses
 * the live map on the cluster's bbox.
 *
 * Standalone + presentational: it renders whatever `clusters` it's handed and
 * calls `onFocus(bbox)` on the "View on map" button. The orchestrator mounts it
 * into app/vacancy/[zip]/page.tsx and wires `onFocus` to VacancyReportMap's
 * `focusBbox` prop. It never fetches. Swiss-mono idiom mirrors the report page
 * (font-mono-bureau labels, #0C1B33 ink, hairline borders, red distress ring).
 */

import type { OwnerType } from "@/lib/owner-classify";
import type { VacancyCluster } from "@/lib/vacancy-index";

const DISTRESS_RED = "#DC2626";


interface VacancyClustersProps {
  zip: string;
  clusters: VacancyCluster[] | null;
  clustersNote: string;
  onFocus?: (bbox: [number, number, number, number]) => void;
}

/** Join non-empty segments grammatically ("a", "a and b", "a, b, and c"). */
function joinGrammar(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** The cluster headline sentence, in Billy's exact shape, with zero segments
 *  dropped grammatically. */
function clusterHeadline(c: VacancyCluster): string {
  const by = new Map<OwnerType, number>();
  for (const o of c.ownerTypeCounts) by.set(o.ownerType, o.count);
  const publiclyControlled = by.get("city_public") ?? 0;
  const locallyOwned = by.get("local_private") ?? 0;
  const corporate = (by.get("corporate_llc") ?? 0) + (by.get("out_of_state") ?? 0);
  const requiringVerification = by.get("unknown") ?? 0;

  const segments: string[] = [];
  if (publiclyControlled > 0) segments.push(`${publiclyControlled} publicly controlled`);
  if (locallyOwned > 0) segments.push(`${locallyOwned} locally owned`);
  if (corporate > 0) segments.push(`${corporate} corporate/investor-held`);
  if (requiringVerification > 0) segments.push(`${requiringVerification} requiring verification`);

  const prefix = c.corridorName ? `${c.corridorName} corridor: ` : "";
  const properties = `${c.count} vacant ${c.count === 1 ? "property" : "properties"}`;
  return segments.length === 0
    ? `${prefix}This cluster contains ${properties}.`
    : `${prefix}This cluster contains ${properties}: ${joinGrammar(segments)}.`;
}


function DistressChip({ label, count }: { label: string; count: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono-bureau text-[9px] uppercase tracking-[0.06em]"
      style={{ borderColor: DISTRESS_RED, color: DISTRESS_RED }}
    >
      <span className="inline-block h-2 w-2 rounded-full border-2" style={{ borderColor: DISTRESS_RED }} />
      {count.toLocaleString("en-US")} {label}
    </span>
  );
}

function ClusterCard({
  cluster,
  onFocus,
}: {
  cluster: VacancyCluster;
  onFocus?: (bbox: [number, number, number, number]) => void;
}) {
  const { taxSaleCount, violationCount, vacantLandCount, vacantBuildingCount } = cluster;
  const hasDistress = taxSaleCount > 0 || violationCount > 0;

  return (
    <div className="border border-[#0C1B33]/12 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center bg-[#0C1B33] font-mono-bureau text-[11px] font-semibold text-white">
            {cluster.id}
          </span>
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/55">
            {cluster.count.toLocaleString("en-US")} sites
          </span>
        </div>
        {onFocus && (
          <button
            type="button"
            onClick={() => onFocus(cluster.bbox)}
            className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#2563EB] hover:underline"
          >
            View on map →
          </button>
        )}
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-[#0C1B33]/85">{clusterHeadline(cluster)}</p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono-bureau text-[10px] text-[#0C1B33]/55">
          {vacantLandCount.toLocaleString("en-US")} land · {vacantBuildingCount.toLocaleString("en-US")}{" "}
          {vacantBuildingCount === 1 ? "building" : "buildings"}
        </span>
        {hasDistress && (
          <span className="flex flex-wrap items-center gap-1.5">
            {taxSaleCount > 0 && <DistressChip label="tax-sale" count={taxSaleCount} />}
            {violationCount > 0 && <DistressChip label="violations" count={violationCount} />}
          </span>
        )}
      </div>
    </div>
  );
}

export default function VacancyClusters({ zip, clusters, clustersNote, onFocus }: VacancyClustersProps) {
  const hasClusters = clusters != null && clusters.length > 0;

  return (
    <section aria-label={`Coordinated intervention clusters for ${zip}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-mono-bureau text-[11px] uppercase tracking-[0.16em] text-[#0C1B33]/70">
          Coordinated intervention
        </h2>
        {hasClusters && (
          <span className="font-mono-bureau text-[10px] text-[#0C1B33]/45">
            {clusters!.length.toLocaleString("en-US")} {clusters!.length === 1 ? "cluster" : "clusters"}
          </span>
        )}
      </div>

      {hasClusters ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {clusters!.map((cluster) => (
              <ClusterCard key={cluster.id} cluster={cluster} onFocus={onFocus} />
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-snug text-[#0C1B33]/45">{clustersNote}</p>
        </>
      ) : (
        <div className="border border-[#0C1B33]/12 bg-white px-4 py-6 text-center">
          <p className="text-[12px] text-[#0C1B33]/45">Clusters compute on the next data refresh.</p>
        </div>
      )}
    </section>
  );
}
