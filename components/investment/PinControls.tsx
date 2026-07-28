"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import {
  MAX_PINNED_AREAS,
  clearPinnedAreas,
  getPinnedServerSnapshot,
  getPinnedSnapshot,
  subscribePins,
  togglePinnedArea,
} from "./local-store";

/**
 * The Compare working set (Sol #3): pin 2–4 community areas, then open a
 * side-by-side compare. State lives in localStorage (admin-side, the whole tree is
 * gated) so pins persist as the admin moves between the landing, area pages, and
 * compare. Both widgets read the pinned set through useSyncExternalStore — the
 * external store is localStorage + our event bus — which is hydration-safe (the
 * server snapshot is the empty set) and effect-free.
 */

/** The pinned-areas list, live from the localStorage store. */
function usePinnedAreas(): string[] {
  return useSyncExternalStore(subscribePins, getPinnedSnapshot, getPinnedServerSnapshot);
}

/** Toggle-pin button for one community area (area page + landing rows). */
export function PinButton({ area }: { area: string }) {
  const pinned = usePinnedAreas();
  const isPinned = pinned.includes(area);
  const atCap = !isPinned && pinned.length >= MAX_PINNED_AREAS;

  return (
    <button
      type="button"
      onClick={() => togglePinnedArea(area)}
      disabled={atCap}
      aria-pressed={isPinned}
      title={atCap ? `Compare holds up to ${MAX_PINNED_AREAS} areas` : undefined}
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] transition-colors ${
        isPinned
          ? "border-[#2563EB] bg-[#2563EB]/[0.08] text-[#2563EB]"
          : "border-[#0C1B33]/15 bg-white text-[#0C1B33]/60 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] disabled:cursor-not-allowed disabled:opacity-45"
      }`}
    >
      <span aria-hidden>{isPinned ? "★" : "☆"}</span>
      {isPinned ? "Pinned to compare" : "Pin to compare"}
    </button>
  );
}

/** Sticky bar summarizing the pinned set with a Compare link + clear. Hidden when
 * nothing is pinned. Shown across the landing and area pages so the working set
 * follows the admin. */
export function ComparePinBar() {
  const pinned = usePinnedAreas();
  if (pinned.length === 0) return null;

  const href = `/investment/compare?areas=${pinned.map(encodeURIComponent).join(",")}`;
  const canCompare = pinned.length >= 2;

  return (
    <div className="no-print sticky bottom-4 z-20 mt-8">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 rounded-[4px] border border-[#0C1B33]/15 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
          Compare set ({pinned.length}/{MAX_PINNED_AREAS})
        </span>
        <div className="flex flex-1 flex-wrap items-center gap-1.5">
          {pinned.map((area) => (
            <button
              key={area}
              type="button"
              onClick={() => togglePinnedArea(area)}
              className="group inline-flex items-center gap-1 rounded-[2px] border border-[#0C1B33]/12 bg-[#FAF9F6] px-2 py-0.5 text-[11px] text-[#0C1B33]/70 hover:border-[#0C1B33]/25"
              title="Remove from compare"
            >
              {area}
              <span aria-hidden className="text-[#0C1B33]/35 group-hover:text-[#0C1B33]/60">
                ×
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearPinnedAreas}
            className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/40 hover:text-[#0C1B33]/70"
          >
            Clear
          </button>
          {canCompare ? (
            <Link
              href={href}
              className="rounded-[3px] bg-[#2563EB] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white hover:bg-[#1D4ED8]"
            >
              Compare →
            </Link>
          ) : (
            <span className="rounded-[3px] bg-[#0C1B33]/[0.06] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[#0C1B33]/40">
              Pin 1 more
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
