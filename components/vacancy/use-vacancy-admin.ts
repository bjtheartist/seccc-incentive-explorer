"use client";

/**
 * Admin gate + starred-set subscription for the public vacancy surfaces.
 *
 * `useVacancyAdmin()` probes /api/owner-file/session exactly once per mount —
 * the same cheap, body-less probe components/map/MapView.tsx and
 * components/report/AdminOwnershipPanel.tsx already use to decide whether to
 * render an admin affordance at all. Semantics are copied verbatim from
 * components/investment/SessionGuard.tsx:
 *
 *   • 204            → live admin session. Stars render; the saved set stands.
 *   • any other code → NOT an admin (the httpOnly cookie lapsed at 8h or was
 *                      cleared). Stars are hidden AND the starred set is wiped,
 *                      so the next person on a shared machine cannot recover a
 *                      departed admin's shortlist through DevTools.
 *   • network/abort  → INCONCLUSIVE. Stars stay hidden (fail closed on the UI)
 *                      but nothing is wiped — a flaky network must never
 *                      destroy saved work.
 *
 * `useStarredKeys()` is the read side: a hydration-safe useSyncExternalStore
 * over the localStorage store, empty on the server so SSR and the first client
 * paint agree.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  clearStarredSites,
  getStarredServerSnapshot,
  getStarredSnapshot,
  subscribeStarredSites,
  type StarredSite,
} from "@/lib/vacancy-starred";

/** True only for a confirmed-live Owner Files admin session. */
export function useVacancyAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/owner-file/session", { signal: controller.signal })
      .then((res) => {
        if (res.status === 204) {
          setIsAdmin(true);
          return;
        }
        // Definitively not an admin — hide the affordance and purge the set.
        setIsAdmin(false);
        clearStarredSites();
      })
      .catch(() => {
        // Inconclusive probe (network / abort) — never wipe on uncertainty.
      });
    return () => controller.abort();
  }, []);

  return isAdmin;
}

/** The live starred list (hydration-safe, effect-free). */
export function useStarredSites(): StarredSite[] {
  return useSyncExternalStore(
    subscribeStarredSites,
    getStarredSnapshot,
    getStarredServerSnapshot,
  );
}

/**
 * The live starred keys as a Set — what row/dot lookups need. Memoized on the
 * (referentially stable) snapshot so the Set itself is stable too and can be
 * used as an effect dependency without re-running on every render.
 */
export function useStarredKeys(): ReadonlySet<string> {
  const sites = useStarredSites();
  return useMemo(() => new Set(sites.map((s) => s.key)), [sites]);
}
