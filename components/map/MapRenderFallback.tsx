"use client";

// ─── Map Render Fallback ─────────────────────────────────────────────
// The honest state for every way the interactive map can fail to exist:
// missing token, no WebGL2 (older iOS, most in-app browsers), a thrown
// constructor, a fatal style load, or a lost GL context. The silent
// alternative — a grey rectangle — reads as "this product is broken";
// this reads as "here is what happened and what still works."
//
// The address lookup does not need the map, so the fallback always
// offers it as the working path.

import { MapPinOff, RotateCcw, Search } from "lucide-react";
import type { MapFailureReason } from "@/lib/map-support";

const REASON_COPY: Record<MapFailureReason, { headline: string; detail: string }> = {
  "no-webgl2": {
    headline: "This browser can't run the interactive map",
    detail:
      "The map needs WebGL2, which this browser doesn't provide. That's common inside in-app browsers (Instagram, LinkedIn, Facebook) and on older devices — opening this page in Safari or Chrome usually fixes it.",
  },
  "no-token": {
    headline: "The map couldn't start",
    detail: "The map service isn't configured for this deployment. The address lookup below still works.",
  },
  "init-error": {
    headline: "The map couldn't start",
    detail: "Something failed while starting the interactive map. Reloading usually fixes it.",
  },
  "style-error": {
    headline: "The map couldn't load its base layers",
    detail: "The map service didn't respond. Reloading usually fixes it; the address lookup works without the map.",
  },
  "context-lost": {
    headline: "The map stopped rendering",
    detail: "The browser reclaimed the map's graphics context — this can happen when a phone is low on memory. Reloading restores it.",
  },
};

export function MapRenderFallback({
  reason,
  onRetry,
}: {
  reason: MapFailureReason;
  onRetry?: () => void;
}) {
  const copy = REASON_COPY[reason];
  return (
    <div
      role="status"
      data-map-fallback={reason}
      className="absolute inset-0 z-40 flex items-center justify-center bg-[#FAF9F6] p-6"
    >
      <div className="max-w-md text-center">
        <MapPinOff aria-hidden="true" className="mx-auto mb-4 h-8 w-8 text-[#0C1B33]/30" />
        <h3 className="mb-2 text-base font-semibold text-[#0C1B33]">{copy.headline}</h3>
        <p className="mb-6 text-sm leading-relaxed text-[#0C1B33]/60">{copy.detail}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onRetry ?? (() => window.location.reload())}
            className="inline-flex min-h-11 items-center gap-2 border border-[#0C1B33]/20 bg-white px-4 py-2 text-[13px] text-[#0C1B33] transition-colors hover:border-[#2563EB] hover:text-[#2563EB]"
          >
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
            Try again
          </button>
          <a
            href="/check"
            className="inline-flex min-h-11 items-center gap-2 border border-[#0C1B33]/20 bg-white px-4 py-2 text-[13px] text-[#0C1B33] transition-colors hover:border-[#2563EB] hover:text-[#2563EB]"
          >
            <Search aria-hidden="true" className="h-3.5 w-3.5" />
            Look up an address without the map
          </a>
        </div>
      </div>
    </div>
  );
}
