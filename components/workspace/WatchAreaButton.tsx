"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Check, Eye, Loader2 } from "lucide-react";
import type { WatchedArea } from "@/lib/types/user-intel";

/**
 * Watch/unwatch a point on the map. Conforms to the /api/watchlist contract:
 * POST { areaType, areaId, areaLabel } / DELETE ?areaType=&areaId=.
 *
 * Points are stored as areaType "point" with areaId "lat,lon" rounded to 4
 * decimals — the API's UNIQUE(user_id, area_type, area_id) upsert makes the
 * rounding double as client-side dedupe for repeat taps on the same spot.
 */

export const POINT_AREA_TYPE = "point";

export function pointAreaId(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export function WatchAreaButton({
  lat,
  lon,
  label,
  callbackUrl,
  variant = "panel",
}: {
  lat: number;
  lon: number;
  label: string;
  /** Where /login should return the user, e.g. "/map". */
  callbackUrl: string;
  /** "panel" = compact map-panel row; "action" = report action-bar pill. */
  variant?: "panel" | "action";
}) {
  const { status } = useSession();
  const [watched, setWatched] = useState(false);
  const [busy, setBusy] = useState(false);

  const areaId = pointAreaId(lat, lon);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/watchlist")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { areas?: WatchedArea[] } | null) => {
        if (cancelled || !data?.areas) return;
        setWatched(
          data.areas.some(
            (a) => a.areaType === POINT_AREA_TYPE && a.areaId === areaId
          )
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status, areaId]);

  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (watched) {
        const res = await fetch(
          `/api/watchlist?areaType=${POINT_AREA_TYPE}&areaId=${encodeURIComponent(areaId)}`,
          { method: "DELETE" }
        );
        if (res.ok || res.status === 404) setWatched(false);
      } else {
        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            areaType: POINT_AREA_TYPE,
            areaId,
            areaLabel: label,
          }),
        });
        if (res.ok) setWatched(true);
      }
    } catch {
      // leave state unchanged; the user can retry
    } finally {
      setBusy(false);
    }
  }, [areaId, busy, label, watched]);

  const panelClasses =
    "block w-full text-center font-mono-bureau text-[9px] tracking-[0.15em] uppercase py-2 px-3 transition-colors";
  const actionClasses =
    "w-full sm:w-auto inline-flex items-center justify-center gap-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 transition-colors cursor-pointer shadow-md";

  if (status === "loading") return null;

  if (status !== "authenticated") {
    const href = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    if (variant === "panel") {
      return (
        <Link
          href={href}
          className={`${panelClasses} border border-[#0C1B33]/15 text-[#0C1B33]/60 hover:text-[#0C1B33] hover:border-[#0C1B33]/30`}
        >
          Sign in to watch this area
        </Link>
      );
    }
    return (
      <Link
        href={href}
        className={`${actionClasses} bg-white border border-[#2563EB]/30 text-[#2563EB] hover:bg-[#2563EB]/5 hover:border-[#2563EB]/50`}
      >
        <Eye className="w-3.5 h-3.5" />
        Sign in to Watch Area
      </Link>
    );
  }

  const icon = busy ? (
    <Loader2 className="w-3.5 h-3.5 animate-spin" />
  ) : watched ? (
    <Check className="w-3.5 h-3.5" />
  ) : (
    <Eye className="w-3.5 h-3.5" />
  );

  if (variant === "panel") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={`${panelClasses} ${
          watched
            ? "border border-[#2563EB]/40 bg-[#2563EB]/5 text-[#2563EB]"
            : "border border-[#0C1B33]/15 text-[#0C1B33]/60 hover:text-[#0C1B33] hover:border-[#0C1B33]/30"
        } disabled:opacity-60`}
      >
        <span className="inline-flex items-center justify-center gap-1.5">
          {icon}
          {watched ? "Watching this area" : "Watch this area"}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`${actionClasses} ${
        watched
          ? "bg-white border border-[#2563EB]/50 text-[#2563EB]"
          : "bg-white border border-[#2563EB]/30 text-[#2563EB] hover:bg-[#2563EB]/5 hover:border-[#2563EB]/50"
      } disabled:opacity-60`}
    >
      {icon}
      {watched ? "Watching Area" : "Watch This Area"}
    </button>
  );
}
