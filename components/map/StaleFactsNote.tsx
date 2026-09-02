import { STALE_PARCEL_FACTS_NOTE } from "./map-helpers";

/**
 * The staleness disclosure for County parcel facts served from
 * lib/fetch-cache.ts's stale-while-error fallback. See `AreaStats.parcelStale`
 * for why this exists; the copy lives in map-helpers.ts so the two surfaces
 * that render it (MapSnapshotPanel, MapDossierCard) cannot drift apart.
 *
 * Renders nothing when the data is live, which is the ordinary case.
 */
export function StaleFactsNote({ stale, className = "" }: { stale?: boolean; className?: string }) {
  if (!stale) return null;
  return (
    <div
      role="note"
      data-testid="stale-parcel-facts-note"
      className={`border border-[#B45309]/40 bg-[#FEF3C7]/60 p-2 text-[10px] leading-relaxed text-[#78350F] ${className}`.trim()}
    >
      <span className="font-semibold">Data may be stale.</span> {STALE_PARCEL_FACTS_NOTE}
    </div>
  );
}
